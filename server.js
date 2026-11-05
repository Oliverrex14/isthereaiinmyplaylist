const http = require("http");
const fs = require("fs");
const path = require("path");
const { fetchPlaylist } = require("./lib/playlistFetcher");
const {
  analyzePlaylistTracks,
  ensureOnlineAiDatabase,
  getDatabaseOverview,
  saveCommunityReport,
  removeCommunityReport,
} = require("./lib/aiDetector");
const {
  signSession,
  getUserFromRequest,
  serializeSessionCookie,
  createLocalDevUser,
  getOAuthUrl,
  exchangeOAuthCode,
} = require("./lib/auth");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// Security Headers applied to all responses
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' https: data:",
    "media-src 'self' https: data:",
    "connect-src 'self' https://vitals.vercel-insights.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

// Simple in-memory IP rate limiter (protects /api/analyze & /api/report against abuse)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_ANALYZE_PER_MIN = 25;
const MAX_REPORT_PER_MIN = 20;

function checkRateLimit(ip, key, maxRequests) {
  const now = Date.now();
  const bucketKey = `${ip}:${key}`;
  const entry = rateLimitMap.get(bucketKey);

  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(bucketKey, { start: now, count: 1 });
    return true;
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    return false;
  }
  return true;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function sanitizeInput(str, maxLen = 300) {
  if (typeof str !== "string") return "";
  return str
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function parseJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string") {
    if (req.body.length > 32768) {
      return Promise.reject(new Error("Payload too large"));
    }
    try {
      return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    } catch {
      return Promise.reject(new Error("Invalid JSON body"));
    }
  }
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > 32768) {
      return Promise.reject(new Error("Payload too large"));
    }
    try {
      const str = req.body.toString("utf-8");
      return Promise.resolve(str ? JSON.parse(str) : {});
    } catch {
      return Promise.reject(new Error("Invalid JSON body"));
    }
  }
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 32768) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function requestHandler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...SECURITY_HEADERS,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const rawHost = (
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    "isthereaiinmyplaylist.tech"
  )
    .split(",")[0]
    .trim()
    .replace(/[^a-zA-Z0-9.:-]/g, "");
  const rawProto =
    (req.headers["x-forwarded-proto"] || "https")
      .split(",")[0]
      .trim()
      .replace(/[^a-zA-Z]/g, "") || "https";

  let pathname = "/";
  let parsedUrl = null;
  try {
    parsedUrl = new URL(req.url || "/", `${rawProto}://${rawHost}`);
    pathname = parsedUrl.pathname;
  } catch {
    pathname = (req.url || "/").split("?")[0] || "/";
  }

  const clientIp = getClientIp(req);

  // Google Search Console HTML file verification
  if (pathname === "/googlecdef3fd0e19d3000.html" && req.method === "GET") {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
    });
    return res.end("google-site-verification: googlecdef3fd0e19d3000.html");
  }

  // Dynamic robots.txt
  if (pathname === "/robots.txt" && req.method === "GET") {
    const robots = [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "",
      `Sitemap: ${rawProto}://${rawHost}/sitemap.xml`,
    ].join("\n");
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    });
    return res.end(robots);
  }

  // Dynamic sitemap.xml
  if (pathname === "/sitemap.xml" && req.method === "GET") {
    const today = new Date().toISOString().split("T")[0];
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${rawProto}://${rawHost}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": "application/xml; charset=utf-8",
    });
    return res.end(sitemap);
  }

  // API: Analyze playlist, single track, or artist
  if (pathname.startsWith("/api/analyze") && req.method === "POST") {
    if (!checkRateLimit(clientIp, "analyze", MAX_ANALYZE_PER_MIN)) {
      return sendJson(res, 429, {
        error: "Rate limit exceeded. Please wait a minute before running another scan.",
      });
    }

    try {
      const body = await parseJsonBody(req);
      const rawInput = sanitizeInput(body.url, 500);
      const allowedModes = new Set(["auto", "playlist", "track", "artist"]);
      const modeHint = allowedModes.has(body.mode) ? body.mode : "auto";

      if (!rawInput) {
        return sendJson(res, 400, {
          error: "Please enter a valid link from Spotify, Apple Music, or YouTube.",
        });
      }

      const db = await ensureOnlineAiDatabase();
      const rawTarget = await fetchPlaylist(
        rawInput,
        modeHint,
        db.knownAiArtists || []
      );
      const analyzed = await analyzePlaylistTracks(rawTarget);
      return sendJson(res, 200, analyzed);
    } catch (err) {
      return sendJson(res, 400, {
        error: err.message || "Failed to analyze the target.",
      });
    }
  }

  // API: Get Known AI Database (merged local + online Soul Over AI, Spotify AI Blocker, MusicBrainz AI)
  if (pathname.startsWith("/api/database") && req.method === "GET") {
    let q = "";
    let source = "all";
    let limit = 250;
    try {
      const parsedUrl = new URL(req.url || "/", `${rawProto}://${rawHost}`);
      q = sanitizeInput(parsedUrl.searchParams.get("q") || "", 120);
      source = sanitizeInput(parsedUrl.searchParams.get("source") || "all", 40);
      const reqLim = parseInt(parsedUrl.searchParams.get("limit") || "250", 10);
      if (!isNaN(reqLim) && reqLim > 0 && reqLim <= 1000) {
        limit = reqLim;
      }
    } catch {
      // ignore
    }
    const dbOverview = await getDatabaseOverview(q, source, limit);
    return sendJson(res, 200, dbOverview);
  }

  // API: Get Current Auth State
  if (pathname === "/api/auth/me" && req.method === "GET") {
    const user = getUserFromRequest(req);
    return sendJson(res, 200, {
      authenticated: Boolean(user),
      user: user
        ? {
            userId: user.userId,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            provider: user.provider,
            isLocalDev: Boolean(user.isLocalDev),
          }
        : null,
      providers: {
        spotify: Boolean(process.env.SPOTIFY_CLIENT_ID),
        google: Boolean(process.env.GOOGLE_CLIENT_ID),
        localDev: process.env.NODE_ENV !== "production",
      },
    });
  }

  // API: Initiate OAuth Login or Local Dev Sign-In
  if (pathname === "/api/auth/login" && req.method === "GET") {
    const provider = parsedUrl?.searchParams?.get("provider") || "spotify";
    const redirectBack = parsedUrl?.searchParams?.get("redirect") || "/";

    const isProd = process.env.NODE_ENV === "production";

    // Local Dev / Simulator Login (strictly disabled in production)
    if (!isProd && (provider === "local" || (!process.env.SPOTIFY_CLIENT_ID && provider === "spotify") || (!process.env.GOOGLE_CLIENT_ID && provider === "google"))) {
      const name =
        parsedUrl?.searchParams?.get("name") ||
        (provider === "google"
          ? "Google Reviewer"
          : "Spotify Reviewer");
      const devUser = createLocalDevUser({ provider, name });
      const cookieHeader = serializeSessionCookie(devUser.token);
      res.writeHead(302, {
        ...SECURITY_HEADERS,
        "Set-Cookie": cookieHeader,
        Location: redirectBack,
      });
      return res.end();
    }

    if (provider === "local" && isProd) {
      return sendJson(res, 403, {
        error: "Local simulator login is disabled in production.",
      });
    }

    // Production OAuth 2.0 flow
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers.host || `localhost:${PORT}`;
    const baseUrl = process.env.APP_URL
      ? process.env.APP_URL.replace(/\/+$/, "")
      : `${protocol}://${host}`;

    // Clean standard OAuth 2.0 redirect URI (no query params in redirect_uri for Spotify compatibility)
    const redirectUri = `${baseUrl}/api/auth/callback`;
    const statePayload = JSON.stringify({ p: provider, r: redirectBack });
    const oauthUrl = getOAuthUrl(provider, redirectUri, statePayload);

    if (!oauthUrl) {
      return sendJson(res, 400, {
        error: `Provider ${provider} is not configured.`,
      });
    }

    res.writeHead(302, {
      ...SECURITY_HEADERS,
      Location: oauthUrl,
    });
    return res.end();
  }

  // API: OAuth Callback
  if (pathname === "/api/auth/callback" && req.method === "GET") {
    let provider = parsedUrl?.searchParams?.get("provider");
    const code = parsedUrl?.searchParams?.get("code");
    const rawState = parsedUrl?.searchParams?.get("state") || "";
    let redirectBack = "/";

    if (rawState) {
      try {
        const decoded = decodeURIComponent(rawState);
        const parsedState = JSON.parse(decoded);
        if (parsedState.p) provider = provider || parsedState.p;
        if (parsedState.r) redirectBack = parsedState.r;
      } catch {
        if (rawState.startsWith("/")) redirectBack = rawState;
      }
    }
    provider = provider || "spotify";

    if (!code) {
      res.writeHead(302, { Location: "/?auth_error=no_code" });
      return res.end();
    }

    try {
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host || `localhost:${PORT}`;
      const baseUrl = process.env.APP_URL
        ? process.env.APP_URL.replace(/\/+$/, "")
        : `${protocol}://${host}`;

      // Match clean redirect URI or fallback to query-based if provider was explicit in callback URL
      const redirectUri = parsedUrl?.searchParams?.has("provider")
        ? `${baseUrl}/api/auth/callback?provider=${provider}`
        : `${baseUrl}/api/auth/callback`;

      const userProfile = await exchangeOAuthCode(provider, code, redirectUri);
      const token = signSession(userProfile);
      const cookieHeader = serializeSessionCookie(token);

      console.log(
        `[AUTH LOGIN] User signed in: "${userProfile.name}" <${userProfile.email || "no-email"}> via ${userProfile.provider.toUpperCase()} (ID: ${userProfile.userId}) at ${new Date().toISOString()}`
      );

      res.writeHead(302, {
        ...SECURITY_HEADERS,
        "Set-Cookie": cookieHeader,
        Location: redirectBack,
      });
      return res.end();
    } catch (err) {
      console.error("[AUTH ERROR] OAuth callback failed:", err.message);
      res.writeHead(302, {
        Location: `/?auth_error=${encodeURIComponent(err.message)}`,
      });
      return res.end();
    }
  }

  // API: Logout
  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const authUser = getUserFromRequest(req);
    if (authUser) {
      console.log(
        `[AUTH LOGOUT] User signed out: "${authUser.name}" <${authUser.email || "no-email"}> via ${authUser.provider.toUpperCase()}`
      );
    }
    const clearCookie = serializeSessionCookie(null, true);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Set-Cookie": clearCookie,
      "Content-Type": "application/json",
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // API: Submit Community AI Report (Protected by Authentication)
  if (pathname.startsWith("/api/report") && req.method === "POST") {
    const authUser = getUserFromRequest(req);
    if (!authUser) {
      return sendJson(res, 401, {
        error: "Authentication required to flag tracks. Please sign in with Spotify or Google.",
        authRequired: true,
      });
    }

    if (!checkRateLimit(clientIp, "report", MAX_REPORT_PER_MIN)) {
      return sendJson(res, 429, {
        error: "Too many submissions from your IP. Please try again in a minute.",
      });
    }

    try {
      const body = await parseJsonBody(req);
      const cleanArtist = sanitizeInput(body.artist, 120);
      const cleanTitle = sanitizeInput(body.title, 150);
      const cleanPlatform = sanitizeInput(body.platform, 40) || "Other";
      const cleanReason = sanitizeInput(body.reason, 280);

      if (!cleanArtist && !cleanTitle) {
        return sendJson(res, 400, {
          error: "Please provide an artist name or track title.",
        });
      }

      const saved = await saveCommunityReport({
        artist: cleanArtist,
        title: cleanTitle,
        platform: cleanPlatform,
        reason: cleanReason,
        reportedBy: {
          id: authUser.userId,
          name: authUser.name,
          provider: authUser.provider,
        },
      });

      console.log(
        `[COMMUNITY REPORT] New AI flag by "${authUser.name}" (${authUser.provider}): "${cleanArtist} - ${cleanTitle}" [Reason: ${cleanReason || "Flagged"}]`
      );

      return sendJson(res, 201, {
        success: true,
        report: saved,
      });
    } catch (err) {
      return sendJson(res, 400, {
        error: err.message || "Error saving report.",
      });
    }
  }

  // API: Remove / Revoke Community AI Report (Unflag - Protected by Authentication)
  if (
    (pathname.startsWith("/api/unflag") && req.method === "POST") ||
    (pathname.startsWith("/api/report") && req.method === "DELETE")
  ) {
    const authUser = getUserFromRequest(req);
    if (!authUser) {
      return sendJson(res, 401, {
        error: "Authentication required. Please sign in.",
        authRequired: true,
      });
    }

    try {
      const body = await parseJsonBody(req);
      const cleanArtist = sanitizeInput(body.artist, 120);
      const cleanTitle = sanitizeInput(body.title, 150);

      if (!cleanArtist && !cleanTitle) {
        return sendJson(res, 400, {
          error: "Please provide an artist name or track title to unflag.",
        });
      }

      const result = await removeCommunityReport({
        artist: cleanArtist,
        title: cleanTitle,
      });

      console.log(
        `[COMMUNITY UNFLAG] Flag removed by "${authUser.name}" (${authUser.provider}): "${cleanArtist} - ${cleanTitle}"`
      );

      return sendJson(res, 200, {
        success: true,
        ...result,
      });
    } catch (err) {
      return sendJson(res, 400, {
        error: err.message || "Error removing report.",
      });
    }
  }

  // Block any other /api/* requests cleanly
  if (pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "API endpoint not found." });
  }

  // Static files with strict path traversal protection
  let safePath = pathname === "/" ? "/index.html" : pathname;
  safePath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(PUBLIC_DIR, "." + safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { ...SECURITY_HEADERS, "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const cacheHeader =
      ext === ".woff2" || ext === ".woff" || ext === ".png" || ext === ".ico"
        ? "public, max-age=31536000, immutable"
        : "no-cache, no-store, must-revalidate";
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": contentType,
      "Cache-Control": cacheHeader,
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const indexFile = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(indexFile)) {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      });
      fs.createReadStream(indexFile).pipe(res);
    } else {
      res.writeHead(404, {
        ...SECURITY_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Not found");
    }
  }
}

if (require.main === module) {
  let portToTry = parseInt(PORT, 10) || 3000;
  const maxAttempts = 10;
  let attempts = 0;

  function startListening(port) {
    const server = http.createServer(requestHandler);

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && attempts < maxAttempts) {
        attempts++;
        console.warn(
          `⚠️ Port ${port} is already in use by another process. Trying port ${port + 1}...`
        );
        startListening(port + 1);
      } else {
        console.error("❌ Failed to start server:", err.message || err);
        process.exit(1);
      }
    });

    server.listen(port, () => {
      console.log(
        `🎵 IsThereAIInMyPlaylist server running at http://localhost:${port}`
      );
      if (port !== 3000) {
        console.log(
          `ℹ️ (Poznámka: Port 3000 byl obsazený, server běží na http://localhost:${port})`
        );
      }
    });
  }

  startListening(portToTry);
}

module.exports = requestHandler;
