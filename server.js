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
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function parseJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string") {
    try {
      return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    } catch {
      return Promise.reject(new Error("Invalid JSON body"));
    }
  }
  if (Buffer.isBuffer(req.body)) {
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
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Request body too large"));
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
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const rawHost = (req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000")
    .split(",")[0]
    .trim();
  const rawProto = (req.headers["x-forwarded-proto"] || "https")
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
  const host = rawHost;
  const proto = rawProto;

  // Dynamic robots.txt so it always points to the active domain's sitemap
  if (pathname === "/robots.txt" && req.method === "GET") {
    const robots = [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "",
      `Sitemap: ${proto}://${host}/sitemap.xml`,
    ].join("\n");
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(robots);
  }

  // Dynamic sitemap.xml for Google Search Console indexing
  if (pathname === "/sitemap.xml" && req.method === "GET") {
    const today = new Date().toISOString().split("T")[0];
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${proto}://${host}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    return res.end(sitemap);
  }

  // API: Analyze playlist, single track, or artist
  if (pathname.startsWith("/api/analyze") && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const rawInput = (body.url || "").trim();
      const modeHint = (body.mode || "auto").trim();
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
    try {
      const body = await parseJsonBody(req);
      if (!body.artist && !body.title) {
        return sendJson(res, 400, {
          error: "Please provide an artist name or track title.",
        });
      }
      const saved = saveCommunityReport(body);
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

  // Static files
  let safePath = pathname === "/" ? "/index.html" : pathname;
  safePath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const indexFile = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(indexFile)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(indexFile).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  }
}

// Start standalone HTTP server when run directly (local dev / Render / Railway),
// and export handler for Vercel Serverless deployment
if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => {
    console.log(
      `🎵 IsThereAIInMyPlaylist server running at http://localhost:${PORT}`
    );
  });
}

module.exports = requestHandler;
