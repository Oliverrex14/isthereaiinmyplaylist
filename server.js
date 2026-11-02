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
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // API: Analyze playlist, single track, or artist
  if (pathname === "/api/analyze" && req.method === "POST") {
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
  if (pathname === "/api/database" && req.method === "GET") {
    const db = loadAiDatabase();
    return sendJson(res, 200, db);
  }

  // API: Submit Community AI Report
  if (pathname === "/api/report" && req.method === "POST") {
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
    // Fallback to index.html for SPA navigation
    const indexFile = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(indexFile)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(indexFile).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  }
});

server.listen(PORT, () => {
  console.log(
    `🎵 IsThereAIInMyPlaylist server running at http://localhost:${PORT}`
  );
});
