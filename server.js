const http = require("http");
const fs = require("fs");
const path = require("path");
const { fetchPlaylist } = require("./lib/playlistFetcher");
const {
  analyzePlaylistTracks,
  loadAiDatabase,
  saveCommunityReport,
} = require("./lib/aiDetector");

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
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
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
const MAX_REPORT_PER_MIN = 8;

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
  try {
    const parsedUrl = new URL(req.url || "/", `${rawProto}://${rawHost}`);
    pathname = parsedUrl.pathname;
  } catch {
    pathname = (req.url || "/").split("?")[0] || "/";
  }

  const clientIp = getClientIp(req);

  // Serve /favicon.ico as our SVG icon so browsers requesting /favicon.ico never get a 404
  if (pathname === "/favicon.ico" && req.method === "GET") {
    const svgPath = path.join(PUBLIC_DIR, "favicon.svg");
    if (fs.existsSync(svgPath)) {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      });
      return fs.createReadStream(svgPath).pipe(res);
    }
  }

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
          error: "Please enter a playlist URL, track link/title, or artist name.",
        });
      }

      const db = loadAiDatabase();
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

  // API: Get Known AI Database
  if (pathname.startsWith("/api/database") && req.method === "GET") {
    const db = loadAiDatabase();
    return sendJson(res, 200, db);
  }

  // API: Submit Community AI Report
  if (pathname.startsWith("/api/report") && req.method === "POST") {
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

      const saved = saveCommunityReport({
        artist: cleanArtist,
        title: cleanTitle,
        platform: cleanPlatform,
        reason: cleanReason,
      });
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
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": contentType });
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
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => {
    console.log(
      `🎵 IsThereAIInMyPlaylist server running at http://localhost:${PORT}`
    );
  });
}

module.exports = requestHandler;
