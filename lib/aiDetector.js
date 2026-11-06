const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DB_PATH = path.join(__dirname, "..", "data", "ai_database.json");

// Shared global cloud store for user-flagged songs & artists (persists across all serverless instances worldwide)
const CLOUD_STORAGE_URL =
  "https://api.restful-api.dev/objects/ff808181a09d98f701a1ac6e52aa445c";
const TMP_REPORTS_PATH = path.join("/tmp", "community_reports.json");
const CLOUD_REPORTS_TTL_MS = 5000; // Refresh shared user flags every 5 seconds

let cloudReportsCache = {
  lastFetchedAt: 0,
  list: [],
};

// Online open-source / community AI music databases
const SOUL_OVER_AI_URL =
  "https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json";
const SPOTIFY_AI_BLOCKER_CSV_URL =
  "https://raw.githubusercontent.com/CennoxX/spotify-ai-blocker/main/SpotifyAiArtists.csv";
const MUSICBRAINZ_AI_QUERY =
  'tag:"ai generated" OR tag:"ai-generated" OR tag:"ai slop" OR tag:"suno ai" OR tag:"ai music" OR comment:"AI generated" OR comment:"AI-generated" OR comment:"AI artist"';

const ONLINE_DB_TTL_MS = 6 * 60 * 60 * 1000; // Refresh every 6 hours

// Caches for fast scanning across large playlists
const artistCache = new Map();
const trackLookupCache = new Map();
const mbArtistCache = new Map();

let onlineDbCache = {
  lastSyncedAt: 0,
  syncPromise: null,
  entries: [],
  bySpotifyId: new Map(),
  byAppleId: new Map(),
  byYouTubeId: new Map(),
  byName: new Map(),
  sourceCounts: {
    local: 0,
    soulOverAi: 0,
    spotifyAiBlocker: 0,
    musicBrainzAi: 0,
    totalUnique: 0,
  },
};

const MB_AI_TAG_REGEX =
  /\b(ai|ai[\s-]generated|ai[\s-]slop|ai[\s-]music|suno|suno[\s-]ai|udio|boomy|aiva|mubert|riffusion|software as artist|generative ai|neural network|virtual artist|ai artist|ai band|ai singer|ai composer|ai producer|ai rock|ai metal|ai pop|ai jazz|ai country|ai blues|ai folk|ai vocal)\b/i;

const MAJOR_OR_INDIE_HUMAN_LABELS = [
  "universal music",
  "sony music",
  "warner music",
  "warner records",
  "atlantic records",
  "columbia records",
  "republic records",
  "interscope",
  "def jam",
  "capitol records",
  "RCA records",
  "parlophone",
  "polydor",
  "island records",
  "epic records",
  "elektra",
  "geffen",
  "virgin records",
  "domino recording",
  "xl recordings",
  "sub pop",
  "matador",
  "4ad",
  "warp records",
  "ninja tune",
  "nuclear blast",
  "century media",
  "napalm records",
  "epitaph",
  "fearless records",
  "beggars",
  "rough trade",
  "secretly canadian",
  "jagjaguwar",
  "dead oceans",
  "modular recordings",
  "fiction records",
  "bmg",
  "concord",
];

function normalizeArtistKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadAiDatabase() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      knownAiArtists: [],
      knownAiLabels: [],
      suspiciousDiyDistributors: [],
      communityReports: [],
    };
  }
}

/**
 * Rebuild indexed lookup Maps combining local data/ai_database.json + live online databases
 */
function buildMergedIndex(localDb, onlineParts = {}) {
  const bySpotifyId = new Map();
  const byAppleId = new Map();
  const byYouTubeId = new Map();
  const byName = new Map();
  const mergedMap = new Map();

  function upsertArtist(entry) {
    const cleanName = (entry.name || "").trim();
    if (!cleanName) return;
    const nameKey = normalizeArtistKey(cleanName);
    const uniqueKey = entry.spotifyId
      ? `sp:${entry.spotifyId}`
      : entry.appleId
      ? `am:${entry.appleId}`
      : `nm:${nameKey}`;

    const existing = mergedMap.get(uniqueKey) || byName.get(nameKey);
    const keepExistingSource =
      existing &&
      (existing.source === "Soul Over AI Directory" ||
        existing.source === "Local Curated Index" ||
        existing.source === "MusicBrainz AI Index") &&
      entry.source === "Spotify AI Blocker DB";

    const isImpersonation = Boolean(
      entry.isImpersonation ||
      /\b(impersonat|impersonator|impersonation)\b/i.test(
        `${entry.reason || ""} ${entry.disambiguation || ""}`
      )
    );

    const combined = {
      name: existing?.name || cleanName,
      platform: existing?.platform || entry.platform || "Spotify / All",
      reason: keepExistingSource
        ? existing.reason
        : entry.reason || existing?.reason || "Indexed in AI music database",
      source: keepExistingSource
        ? `${existing.source} + AI Blocker`
        : entry.source || existing?.source || "Community Index",
      confidence: Math.max(entry.confidence || 90, existing?.confidence || 0),
      spotifyId: entry.spotifyId || existing?.spotifyId || null,
      appleId: entry.appleId || existing?.appleId || null,
      youtubeId: entry.youtubeId || existing?.youtubeId || null,
      markers:
        existing?.markers && existing.markers.length > 0
          ? existing.markers
          : entry.markers || [],
      isImpersonation: existing?.isImpersonation || isImpersonation,
    };

    mergedMap.set(uniqueKey, combined);
    if (!byName.has(nameKey) || combined.confidence >= byName.get(nameKey).confidence) {
      byName.set(nameKey, combined);
    }
    if (combined.spotifyId) {
      bySpotifyId.set(String(combined.spotifyId), combined);
    }
    if (combined.appleId) {
      byAppleId.set(String(combined.appleId), combined);
    }
    if (combined.youtubeId) {
      byYouTubeId.set(String(combined.youtubeId), combined);
    }
  }

  // 1. Local curated entries
  const localArtists = localDb.knownAiArtists || [];
  for (const item of localArtists) {
    upsertArtist({
      name: item.name,
      platform: item.platform || "All",
      reason: item.reason || "Confirmed AI-generated project",
      source: "Local Curated Index",
      confidence: item.confidence || 95,
      spotifyId: item.spotifyId || null,
      appleId: item.appleId || null,
    });
  }

  // 2. Soul Over AI / Zoundhub directory (rich metadata + multi-platform IDs)
  const soulList = onlineParts.soulList || [];
  let soulCount = 0;
  for (const item of soulList) {
    if (!item || item.removed || !item.name) continue;
    soulCount++;
    const markers = Array.isArray(item.markers) ? item.markers : [];
    const markerText = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
    const noteText = item.notes
      ? item.notes.slice(0, 140) + (item.notes.length > 140 ? "..." : "")
      : `Documented in Soul Over AI / Zoundhub directory${markerText}`;

    upsertArtist({
      name: item.name,
      platform: item.spotify
        ? item.apple
          ? "Spotify / Apple Music"
          : "Spotify"
        : "All",
      reason: noteText,
      source: "Soul Over AI Directory",
      confidence: 96,
      spotifyId: item.spotify || null,
      appleId: item.apple ? String(item.apple) : null,
      youtubeId: item.youtube || null,
      markers,
    });
  }

  // 3. MusicBrainz AI Tag & Disambiguation Registry
  const mbList = onlineParts.mbList || [];
  let mbCount = 0;
  for (const item of mbList) {
    if (!item || !item.name) continue;
    const beginYr = item["life-span"]?.begin
      ? parseInt(String(item["life-span"].begin).slice(0, 4), 10)
      : null;
    const hasIsni = Array.isArray(item.isnis) && item.isnis.length > 0;
    // Skip established pre-AI artists who were mistakenly returned due to single troll tags
    if (
      (beginYr && beginYr <= 2022) ||
      (hasIsni && ["Person", "Group", "Orchestra", "Choir"].includes(item.type))
    ) {
      continue;
    }

    const disamb = item.disambiguation || "";
    const validTags = (item.tags || [])
      .filter((t) => (t.count ?? 1) >= 2)
      .map((t) => t.name);
    const tagStr = validTags.join(", ");
    if (!MB_AI_TAG_REGEX.test(disamb) && !MB_AI_TAG_REGEX.test(tagStr)) {
      continue;
    }
    const isImpersonation = /\b(impersonat|impersonator|impersonation)\b/i.test(
      `${disamb} ${tagStr}`
    );
    mbCount++;
    upsertArtist({
      name: item.name,
      platform: "MusicBrainz Registry",
      reason: `MusicBrainz AI classification: ${
        disamb || tagStr || "AI-generated artist"
      }`,
      source: "MusicBrainz AI Index",
      confidence: 95,
      isImpersonation,
    });
  }

  // 4. Spotify AI Blocker CSV (8,800+ daily-updated Spotify AI artists)
  const blockerList = onlineParts.blockerList || [];
  let blockerCount = 0;
  for (const item of blockerList) {
    if (!item || !item.name || !item.spotifyId) continue;
    blockerCount++;
    upsertArtist({
      name: item.name,
      platform: "Spotify",
      reason: `Verified in Spotify AI Blocker community database (ID: ${item.spotifyId})`,
      source: "Spotify AI Blocker DB",
      confidence: 94,
      spotifyId: item.spotifyId,
    });
  }

  const allEntries = Array.from(mergedMap.values());

  onlineDbCache.entries = allEntries;
  onlineDbCache.bySpotifyId = bySpotifyId;
  onlineDbCache.byAppleId = byAppleId;
  onlineDbCache.byYouTubeId = byYouTubeId;
  onlineDbCache.byName = byName;
  onlineDbCache.sourceCounts = {
    local: localArtists.length,
    soulOverAi: soulCount,
    spotifyAiBlocker: blockerCount,
    musicBrainzAi: mbCount,
    totalUnique: allEntries.length,
  };
}

/**
 * Fetch and cache live online AI music databases (Soul Over AI, Spotify AI Blocker, MusicBrainz AI Registry)
 */
async function ensureOnlineAiDatabase(forceRefresh = false) {
  const localDb = loadAiDatabase();
  const now = Date.now();

  if (
    !forceRefresh &&
    onlineDbCache.lastSyncedAt > 0 &&
    now - onlineDbCache.lastSyncedAt < ONLINE_DB_TTL_MS &&
    onlineDbCache.entries.length > 0
  ) {
    return {
      ...localDb,
      knownAiArtists: onlineDbCache.entries,
      index: onlineDbCache,
    };
  }

  if (onlineDbCache.syncPromise) {
    await onlineDbCache.syncPromise;
    return {
      ...localDb,
      knownAiArtists: onlineDbCache.entries,
      index: onlineDbCache,
    };
  }

  onlineDbCache.syncPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2800);

    try {
      const [soulRes, csvRes, mbRes] = await Promise.allSettled([
        fetch(SOUL_OVER_AI_URL, { signal: controller.signal }).then((r) =>
          r.ok ? r.json() : []
        ),
        fetch(SPOTIFY_AI_BLOCKER_CSV_URL, { signal: controller.signal }).then(
          (r) => (r.ok ? r.text() : "")
        ),
        fetch(
          `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(
            MUSICBRAINZ_AI_QUERY
          )}&fmt=json&limit=100`,
          {
            headers: {
              "User-Agent":
                "IsThereAIInMyPlaylist/2.5 (https://isthereaiinmyplaylist.tech)",
            },
            signal: controller.signal,
          }
        ).then((r) => (r.ok ? r.json() : {})),
      ]);

      clearTimeout(timeout);

      const soulList =
        soulRes.status === "fulfilled" && Array.isArray(soulRes.value)
          ? soulRes.value
          : [];

      const blockerList = [];
      if (csvRes.status === "fulfilled" && typeof csvRes.value === "string") {
        const lines = csvRes.value.trim().split(/\r?\n/).slice(1);
        for (const line of lines) {
          const lastComma = line.lastIndexOf(",");
          if (lastComma > 0) {
            const name = line
              .slice(0, lastComma)
              .replace(/^"|"$/g, "")
              .trim();
            const spotifyId = line.slice(lastComma + 1).trim();
            if (name && /^[a-zA-Z0-9]{22}$/.test(spotifyId)) {
              blockerList.push({ name, spotifyId });
            }
          }
        }
      }

      const mbList =
        mbRes.status === "fulfilled" && Array.isArray(mbRes.value?.artists)
          ? mbRes.value.artists
          : [];

      buildMergedIndex(localDb, { soulList, blockerList, mbList });
      onlineDbCache.lastSyncedAt = Date.now();
    } catch {
      clearTimeout(timeout);
      if (onlineDbCache.entries.length === 0) {
        buildMergedIndex(localDb, {});
      }
    } finally {
      onlineDbCache.syncPromise = null;
    }
  })();

  await onlineDbCache.syncPromise;
  return {
    ...localDb,
    knownAiArtists: onlineDbCache.entries,
    index: onlineDbCache,
  };
}

/**
 * Fetch globally shared community-flagged songs & artists from cloud storage + local DB
 */
async function fetchCloudCommunityReports(forceRefresh = false) {
  const localDb = loadAiDatabase();
  const localReports = Array.isArray(localDb.communityReports)
    ? localDb.communityReports
    : [];
  const now = Date.now();

  if (
    !forceRefresh &&
    cloudReportsCache.lastFetchedAt > 0 &&
    now - cloudReportsCache.lastFetchedAt < CLOUD_REPORTS_TTL_MS
  ) {
    return cloudReportsCache.list;
  }

  let remoteReports = [];

  // 1. Try Vercel KV / Upstash Redis if configured
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const kvRes = await fetch(`${process.env.KV_REST_API_URL}/get/community_reports`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      });
      if (kvRes.ok) {
        const kvData = await kvRes.json();
        const items = Array.isArray(kvData.result)
          ? kvData.result
          : typeof kvData.result === "string"
          ? JSON.parse(kvData.result)
          : null;
        if (Array.isArray(items) && items.length > 0) {
          remoteReports = items;
        }
      }
    } catch {}
  }

  // 2. Fetch from shared Cloud Storage API if not loaded from Vercel KV
  if (remoteReports.length === 0) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(CLOUD_STORAGE_URL, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const body = await res.json();
        if (body?.data?.items && Array.isArray(body.data.items)) {
          remoteReports = body.data.items.map((r, idx) => ({
            id: r.id || `cloud-${idx}`,
            artist: r.artist || r.a || "",
            title: r.title || r.t || "",
            isArtistFlag: Boolean(r.isArtistFlag || !r.title || !r.t),
            platform: r.platform || r.p || "Spotify / All",
            reason: r.reason || r.r || "Flagged as AI by community user",
            reportedBy: r.reportedBy || r.by || null,
            createdAt: r.createdAt || r.c || new Date().toISOString(),
          }));
        }
      }
    } catch {}
  }

  // 3. Fallback to /tmp disk cache on serverless lambdas
  let tmpReports = [];
  try {
    if (fs.existsSync(TMP_REPORTS_PATH)) {
      const tmpRaw = fs.readFileSync(TMP_REPORTS_PATH, "utf-8");
      const parsedTmp = JSON.parse(tmpRaw);
      if (Array.isArray(parsedTmp)) tmpReports = parsedTmp;
    }
  } catch {}

  // Merge remoteReports + tmpReports + localReports + current in-memory cache (newest first, deduplicated)
  const merged = [];
  const seenKeys = new Set();
  for (const rep of [
    ...remoteReports,
    ...tmpReports,
    ...cloudReportsCache.list,
    ...localReports,
  ]) {
    if (!rep || (!rep.artist && !rep.title)) continue;
    const dedupKey = `${normalizeArtistKey(rep.artist)}:::${normalizeArtistKey(
      rep.title
    )}`;
    if (!seenKeys.has(dedupKey)) {
      seenKeys.add(dedupKey);
      merged.push(rep);
    }
  }

  cloudReportsCache.list = merged;
  cloudReportsCache.lastFetchedAt = now;
  return merged;
}

/**
 * Save a user-flagged song/artist to the shared global cloud database AND local database
 * so that all users immediately see it in the database and during scans.
 */
async function saveCommunityReport(report) {
  const db = loadAiDatabase();
  const isArtistFlag = Boolean(report.isArtistFlag || !report.title);
  const cleanArtist = (report.artist || "").trim();
  const cleanTitle = isArtistFlag ? "" : (report.title || "").trim();

  const entry = {
    id: `rep-${Date.now()}`,
    artist: cleanArtist,
    title: cleanTitle,
    isArtistFlag,
    platform: report.platform || "Spotify",
    reason: (
      report.reason || (isArtistFlag ? "Entire artist flagged as AI-generated by community" : "Flagged as AI-generated by community user")
    ).trim(),
    reportedBy: report.reportedBy || { name: "Community User", provider: "community" },
    createdAt: new Date().toISOString(),
  };

  // 1. Fetch latest global community reports and prepend this new entry
  const existingGlobal = await fetchCloudCommunityReports(true);
  const dedupKey = `${normalizeArtistKey(entry.artist)}:::${normalizeArtistKey(
    entry.title
  )}`;
  const updatedGlobal = [
    entry,
    ...existingGlobal.filter(
      (r) =>
        `${normalizeArtistKey(r.artist)}:::${normalizeArtistKey(r.title)}` !==
        dedupKey
    ),
  ].slice(0, 200);

  cloudReportsCache.list = updatedGlobal;
  cloudReportsCache.lastFetchedAt = Date.now();

  // 2. Persist to shared global Cloud Storage API so all users across the world see it immediately
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    await fetch(CLOUD_STORAGE_URL, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: { items: updatedGlobal },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {}

  // 3. Persist to Vercel KV / Upstash Redis if configured
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(`${process.env.KV_REST_API_URL}/set/community_reports`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatedGlobal),
      });
    } catch {}
  }

  // 4. Save to /tmp/community_reports.json on serverless lambdas
  try {
    fs.writeFileSync(TMP_REPORTS_PATH, JSON.stringify(updatedGlobal), "utf-8");
  } catch {}

  // 5. If this is an artist-wide flag, update memory cache & local db knownAiArtists
  if (isArtistFlag && cleanArtist) {
    const normKey = normalizeArtistKey(cleanArtist);
    onlineDbCache.byName.set(normKey, {
      name: cleanArtist,
      platform: entry.platform || "All",
      reason: entry.reason || "Entire artist flagged as AI-generated by community",
      source: "Community Flagged",
      confidence: 95,
    });

    if (!Array.isArray(db.knownAiArtists)) {
      db.knownAiArtists = [];
    }
    const alreadyKnown = db.knownAiArtists.some(
      (a) => normalizeArtistKey(a.name) === normKey
    );
    if (!alreadyKnown) {
      db.knownAiArtists.unshift({
        name: cleanArtist,
        platform: entry.platform || "All",
        reason: entry.reason || "Community Flagged AI Artist",
        source: "Community Flagged",
        confidence: 95,
      });
    }
  }

  // 6. Also save to local data/ai_database.json when filesystem is writable
  db.communityReports = updatedGlobal;
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
  } catch {}

  artistCache.clear();
  trackLookupCache.clear();
  return entry;
}

/**
 * Remove an accidental or revoked community flag by artist & optional title
 */
async function removeCommunityReport({ artist, title, isArtistFlag = false }) {
  const normArtist = normalizeArtistKey(artist);
  const normTitle = normalizeArtistKey(title);
  if (!normArtist && !normTitle) {
    throw new Error("Artist or track title required to remove report.");
  }

  const isWholeArtist = Boolean(isArtistFlag || !normTitle);

  // 1. Fetch current global community reports
  const existingGlobal = await fetchCloudCommunityReports(true);

  // 2. Filter out matching report
  const updatedGlobal = existingGlobal.filter((r) => {
    const rArtist = normalizeArtistKey(r.artist);
    const rTitle = normalizeArtistKey(r.title);
    if (isWholeArtist) {
      return rArtist !== normArtist;
    }
    if (normArtist && normTitle) {
      return !(rArtist === normArtist && rTitle === normTitle);
    }
    return rTitle !== normTitle;
  });

  cloudReportsCache.list = updatedGlobal;
  cloudReportsCache.lastFetchedAt = Date.now();

  // 3. Persist updated list to shared Cloud Storage
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    await fetch(CLOUD_STORAGE_URL, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: { items: updatedGlobal },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {}

  // 4. Persist to Vercel KV / Upstash Redis if configured
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(`${process.env.KV_REST_API_URL}/set/community_reports`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatedGlobal),
      });
    } catch {}
  }

  // 5. Update /tmp cache on serverless
  try {
    fs.writeFileSync(TMP_REPORTS_PATH, JSON.stringify(updatedGlobal), "utf-8");
  } catch {}

  // 6. Update local db if writable and clean up any accidental knownAiArtists entries
  const db = loadAiDatabase();
  db.communityReports = updatedGlobal;
  if (Array.isArray(db.knownAiArtists)) {
    db.knownAiArtists = db.knownAiArtists.filter((a) => {
      const isMatching = normalizeArtistKey(a.name) === normArtist;
      const isCommunityFlag =
        String(a.reason || "").includes("Community Flag") ||
        a.source === "Community Flagged";
      return !(isMatching && isCommunityFlag);
    });
  }

  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
  } catch {}

  // 7. Clean up from onlineDbCache.byName if present
  if (normArtist && onlineDbCache.byName.has(normArtist)) {
    const hit = onlineDbCache.byName.get(normArtist);
    if (hit && hit.source === "Community Flagged") {
      onlineDbCache.byName.delete(normArtist);
    }
  }

  artistCache.clear();
  trackLookupCache.clear();
  return { success: true, removed: true, remaining: updatedGlobal.length };
}

function getPrimaryArtist(artistStr) {
  if (!artistStr) return "";
  return artistStr
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0]
    .trim();
}

function getAllTrackArtists(artistStr) {
  if (!artistStr) return [];
  return artistStr
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Detect if a track is a legitimate musical cover / remake / tribute
 * (distinguishes authentic human cover performances from synthetic AI voice clones / AI generators)
 */
function detectCoverContext(title = "", artist = "") {
  const combined = `${title} ${artist}`.toLowerCase();

  // If explicitly labeled as an AI generator / voice clone, this is NOT a human cover
  const isExplicitAi =
    /\b(ai\s*(?:[a-z0-9_-]+\s*)?cover|(?:[a-z0-9_-]+\s+)?ai\s*cover|ai\s*version|ai\s*voice|ai\s*vocals|suno|udio|rvc\s*v2|voice\s*clone|so-vits|kits\.ai|elevenlabs)\b/i.test(
      combined
    ) ||
    (/\b(?:cover|remake|tribute)\b/i.test(combined) &&
      /\b(?:ai|suno|udio|voice\s*clone|rvc)\b/i.test(combined));

  if (isExplicitAi) {
    return { isCover: false, isAiCover: true };
  }

  const coverPatterns = [
    /\b(cover|acoustic\s+cover|rock\s+cover|metal\s+cover|piano\s+cover|guitar\s+cover|drum\s+cover|vocal\s+cover|fingerstyle\s+cover|live\s+cover|cover\s+version|remake)\b/i,
    /\((?:[^\)]*\s+)?cover(?:\s+[^\)]*)?\)/i,
    /\[(?:[^\]]*\s+)?cover(?:\s+[^\]]*)?\]/i,
    /\b(originally\s+by|tribute\s+to|orig\.?\s+by|remade\s+by|cover\s+by)\b/i,
  ];

  const isCover = coverPatterns.some((pat) => pat.test(combined));
  return { isCover, isAiCover: false };
}

/**
 * Detect if a track is a legitimate musical remix / club mix / extended mix
 * (distinguishes legitimate DJ/dance remixes from synthetic AI voice conversions)
 */
function detectMixContext(title = "", artist = "") {
  const combined = `${title} ${artist}`.toLowerCase();

  const isExplicitAi =
    /\b(ai\s*(?:[a-z0-9_-]+\s*)?remix|ai\s*mix|ai\s*version|ai\s*voice|suno|udio|rvc\s*v2|voice\s*clone|so-vits)\b/i.test(
      combined
    ) ||
    (/\b(?:mix|remix|edit|bootleg)\b/i.test(combined) &&
      /\b(?:ai|suno|udio|voice\s*clone|rvc)\b/i.test(combined));

  if (isExplicitAi) {
    return { isMix: false, isAiMix: true };
  }

  const mixPatterns = [
    /\b(remix|club\s+mix|extended\s+mix|original\s+mix|vip\s+mix|dub\s+mix|radio\s+mix|continuous\s+mix|dance\s+mix|acoustic\s+mix|summer\s+mix|chill\s+mix|live\s+mix|megamix|mashup|edit|bootleg)\b/i,
    /\((?:[^\)]*\s+)?(?:remix|mix|edit|bootleg|dub)(?:\s+[^\)]*)?\)/i,
    /\[(?:[^\]]*\s+)?(?:remix|mix|edit|bootleg|dub)(?:\s+[^\]]*)?\]/i,
  ];

  const isMix = mixPatterns.some((pat) => pat.test(combined));
  return { isMix, isAiMix: false };
}

/**
 * 1. Keyword & Naming Heuristics
 */
function analyzeKeywords(track) {
  const signals = [];
  let score = 0;

  const combinedText = `${track.title || ""} ${track.rawTitle || ""} ${
    track.artist || ""
  } ${track.channelName || ""} ${track.album || ""}`.toLowerCase();

  const directAiPatterns = [
    {
      regex: /\bsuno(\s*ai|\s*v3|\s*v3\.5|\s*v4|\s*v4\.5|\s*studio)?\b/i,
      label: "Explicit Suno AI generator reference in metadata",
      points: 88,
    },
    {
      regex: /\budio(\s*ai|\s*v1|\s*v1\.5)?\b/i,
      label: "Explicit Udio AI generator reference in metadata",
      points: 88,
    },
    {
      regex:
        /\b(ai\s*(?:[a-z0-9_-]+\s*)?cover|(?:[a-z0-9_-]+\s+)?ai\s*cover|ai\s*(?:[a-z0-9_-]+\s*)?remix|ai\s*version|ai\s*generated|ai-generated|ai\s*song|ai\s*music|ai\s*voice|ai\s*vocals|made\s*with\s*ai|created\s*with\s*ai)\b/i,
      label: "Explicit AI generation tag in title/metadata",
      points: 86,
    },
    {
      regex:
        /\b(rvc\s*v2|sovits|so-vits|kits\.ai|elevenlabs|boomy|mubert|riffusion|aiva|soundraw|loudly\s*ai|jammable|weights\.gg)\b/i,
      label: "Voice clone or synthetic audio model mentioned",
      points: 84,
    },
    {
      regex: /\[ai\]|\(ai\)|\[suno\]|\(suno\)|\[udio\]|\(udio\)/i,
      label: "Tagged with explicit [AI] / [Suno] / [Udio] marker",
      points: 88,
    },
  ];

  for (const pat of directAiPatterns) {
    if (pat.regex.test(combinedText)) {
      score += pat.points;
      signals.push({
        type: "danger",
        category: "TAG",
        text: pat.label,
      });
    }
  }

  const genericArtistPatterns = [
    /\b(lofi|lo-fi|chillhop|synthwave|sleep|ambient|study|relaxing|meditation|binaural|phonk)\s+(ai|beats\s+ai|bot|generator|neural|algorithm)\b/i,
    /\bai\s+(records|studios|collective|orchestra|ensemble|band|project|beats|lounge|vibes|harmonic)\b/i,
    /\b(neural|algorithmic|synthetic|cybernetic)\s+(groove|beats|melody|symphony|soundscapes|lofi)\b/i,
  ];
  for (const pat of genericArtistPatterns) {
    if (pat.test(track.artist || "")) {
      score += 46;
      signals.push({
        type: "warning",
        category: "NAME",
        text: `Artist name "${track.artist}" matches synthetic project naming convention`,
      });
      break;
    }
  }

  // Stream-Farm SEO Generator Patterns (Common in automated Suno/Udio mood-farm accounts)
  const seoFarmPatterns = [
    {
      regex: /\b(432\s*hz|528\s*hz|binaural\s*beats|solfeggio\s*frequencies|brainwave\s*entrainment|delta\s*waves|theta\s*waves|isochronic\s*tones|frequency\s*healing)\b/i,
      label: "Algorithmic functional audio keyword signature (binaural/healing frequency SEO)",
      points: 38,
    },
    {
      regex: /\b(deep\s*sleep\s*music\s*for|study\s*beats\s*for\s*homework|rain\s*sounds\s*for\s*sleeping|brown\s*noise\s*for\s*adhd|white\s*noise\s*sleep\s*machine)\b/i,
      label: "Automated SEO stream-farm naming formula",
      points: 32,
    },
  ];
  for (const pat of seoFarmPatterns) {
    if (pat.regex.test(combinedText)) {
      score += pat.points;
      signals.push({
        type: "warning",
        category: "KEYWORDS",
        text: pat.label,
      });
      break;
    }
  }

  return { score, signals };
}

/**
 * 2. Multi-Source Online & Local AI Index Verification
 * Checks exact Spotify Artist ID, Apple Music Artist ID, YouTube Channel ID,
 * and homonym-safe artist name matching against 9,500+ indexed AI artists.
 */
function analyzeDatabase(track, db) {
  const signals = [];
  let score = 0;
  let matchedDbEntry = null;
  let matchedDbSource = null;
  let matchedReason = null;
  let matchedById = false;
  let isImpersonation = false;

  const idx = db.index || onlineDbCache;
  const trackSpotifyIds = Array.isArray(track.artistIds) ? track.artistIds : [];
  const trackAppleIds = Array.isArray(track.appleArtistIds)
    ? track.appleArtistIds
    : [];
  const trackChannelId = track.channelId || null;

  // A. Exact Platform Artist ID Match (100% profile precision, immune to name collisions)
  for (const spId of trackSpotifyIds) {
    const hit = idx.bySpotifyId?.get(String(spId));
    if (hit) {
      score += hit.confidence || 96;
      matchedDbEntry = hit.name;
      matchedDbSource = hit.source;
      matchedReason = hit.reason || null;
      isImpersonation = Boolean(
        hit.isImpersonation ||
        (hit.reason && /\b(impersonat|impersonator|impersonation)\b/i.test(hit.reason))
      );
      matchedById = true;
      signals.push({
        type: "danger",
        category: "ONLINE DB",
        text: `Exact Spotify Artist ID matched in ${hit.source}: ${hit.reason}`,
      });
      break;
    }
  }

  if (!matchedDbEntry) {
    for (const amId of trackAppleIds) {
      const hit = idx.byAppleId?.get(String(amId));
      if (hit) {
        score += hit.confidence || 96;
        matchedDbEntry = hit.name;
        matchedDbSource = hit.source;
        matchedReason = hit.reason || null;
        isImpersonation = Boolean(
          hit.isImpersonation ||
          (hit.reason && /\b(impersonat|impersonator|impersonation)\b/i.test(hit.reason))
        );
        matchedById = true;
        signals.push({
          type: "danger",
          category: "ONLINE DB",
          text: `Exact Apple Music Artist ID matched in ${hit.source}: ${hit.reason}`,
        });
        break;
      }
    }
  }

  if (!matchedDbEntry && trackChannelId) {
    const hit = idx.byYouTubeId?.get(String(trackChannelId));
    if (hit) {
      score += hit.confidence || 96;
      matchedDbEntry = hit.name;
      matchedDbSource = hit.source;
      matchedReason = hit.reason || null;
      isImpersonation = Boolean(
        hit.isImpersonation ||
        (hit.reason && /\b(impersonat|impersonator|impersonation)\b/i.test(hit.reason))
      );
      matchedById = true;
      signals.push({
        type: "danger",
        category: "ONLINE DB",
        text: `Exact YouTube Channel ID matched in ${hit.source}: ${hit.reason}`,
      });
    }
  }

  // B. Homonym-Safe Artist Name Match
  if (!matchedDbEntry) {
    const candidateNames = [
      ...getAllTrackArtists(track.artist),
      track.artist,
      track.channelName,
    ]
      .filter(Boolean)
      .map(normalizeArtistKey);

    for (const cand of candidateNames) {
      const hit = idx.byName?.get(cand);
      if (!hit) continue;

      // Homonym protection: if the track comes from Spotify with known artistIds,
      // and the DB entry ALSO has a Spotify ID, but they do NOT match,
      // then this is a different artist who happens to share the same name!
      if (
        trackSpotifyIds.length > 0 &&
        hit.spotifyId &&
        !trackSpotifyIds.includes(String(hit.spotifyId))
      ) {
        continue;
      }
      if (
        trackAppleIds.length > 0 &&
        hit.appleId &&
        !trackAppleIds.includes(String(hit.appleId))
      ) {
        continue;
      }

      score += hit.confidence || 90;
      matchedDbEntry = hit.name;
      matchedDbSource = hit.source;
      matchedReason = hit.reason || null;
      isImpersonation = Boolean(
        hit.isImpersonation ||
        (hit.reason && /\b(impersonat|impersonator|impersonation)\b/i.test(hit.reason))
      );
      signals.push({
        type: "danger",
        category: "ONLINE DB",
        text: `Matched in ${hit.source} (${hit.reason})`,
      });
      break;
    }
  }

  // C. User Community Reports (shared global database of flagged songs & artists)
  const primaryArtist = normalizeArtistKey(getPrimaryArtist(track.artist));
  const fullArtistKey = normalizeArtistKey(track.artist);
  const titleKey = normalizeArtistKey(track.title);
  for (const rep of db.communityReports || []) {
    const repArtist = normalizeArtistKey(rep.artist);
    const repTitle = normalizeArtistKey(rep.title);
    const artistMatched =
      repArtist && (primaryArtist === repArtist || fullArtistKey === repArtist || fullArtistKey.includes(repArtist) || repArtist.includes(primaryArtist));
    const titleMatched =
      repTitle &&
      titleKey === repTitle &&
      (!repArtist || artistMatched || fullArtistKey.includes(repArtist));

    const isArtistReport = Boolean(rep.isArtistFlag || !repTitle);

    if ((isArtistReport && artistMatched) || (!isArtistReport && titleMatched)) {
      score = Math.max(score, 95);
      matchedDbEntry = matchedDbEntry || (isArtistReport ? `${rep.artist} (Entire Artist Flagged)` : (rep.title ? `${rep.artist} — "${rep.title}"` : rep.artist));
      matchedDbSource = "Community Flagged";
      matchedReason = rep.reason || (isArtistReport ? "Entire artist flagged as AI-generated by community" : "Flagged as AI-generated by community");
      matchedById = false;
      signals.push({
        type: "danger",
        category: "COMMUNITY AI REGISTRY",
        text: isArtistReport
          ? `Entire artist flagged as AI-generated by community: ${rep.artist} (${rep.reason || "Catalog flagged"})`
          : `Flagged as AI-generated by community: ${
              rep.title ? `"${rep.title}" — ${rep.artist}` : rep.artist
            } (${rep.reason || "Reported by verified user"})`,
      });
      break;
    }
  }

  return {
    score,
    signals,
    matchedDbEntry,
    matchedDbSource,
    matchedReason,
    matchedById,
    isImpersonation,
  };
}

/**
 * Evaluate a MusicBrainz artist record for human legitimacy vs. AI classification
 */
function evaluateMusicBrainzRecord(mbArtist) {
  if (!mbArtist) {
    return {
      found: false,
      verifiedHuman: false,
      aiFlagged: false,
      mbType: null,
      mbCountry: null,
      mbBeginYear: null,
      mbDisambiguation: null,
      mbAiTags: [],
      hasRightsCodes: false,
      isImpersonation: false,
    };
  }

  const disamb = mbArtist.disambiguation || "";
  const rawTags = Array.isArray(mbArtist.tags) ? mbArtist.tags : [];
  // Require at least 2 community votes on tags to avoid 0-vote or single troll submissions
  const validTags = rawTags
    .filter((t) => (t.count ?? 1) >= 2)
    .map((t) => t.name);
  const aiTags = validTags.filter((t) => MB_AI_TAG_REGEX.test(t));
  const disambIsAi = MB_AI_TAG_REGEX.test(disamb);

  let mbBeginYear = null;
  if (mbArtist["life-span"]?.begin) {
    const yr = parseInt(String(mbArtist["life-span"].begin).slice(0, 4), 10);
    if (!isNaN(yr) && yr >= 1850) {
      mbBeginYear = yr;
    }
  }

  const isniCount = Array.isArray(mbArtist.isnis) ? mbArtist.isnis.length : 0;
  const ipiCount = Array.isArray(mbArtist.ipis) ? mbArtist.ipis.length : 0;
  const hasRightsCodes = isniCount > 0 || ipiCount > 0;
  const mbCountry = mbArtist.country || mbArtist.area?.name || null;
  const mbType = mbArtist.type || "Entity";

  const isHumanType = ["Person", "Group", "Orchestra", "Choir"].includes(mbType);
  const isEstablishedPreAi = Boolean(mbBeginYear && mbBeginYear <= 2022);
  const isImpersonationNote = /\b(impersonat|impersonator|impersonation)\b/i.test(
    `${disamb} ${rawTags.map((t) => t.name).join(" ")}`
  );

  // Safeguard: An established human artist formed before 2023 or with verified ISNI cannot be an AI group/person
  if (isEstablishedPreAi || (hasRightsCodes && isHumanType)) {
    return {
      found: true,
      verifiedHuman: true,
      aiFlagged: false,
      mbType,
      mbCountry,
      mbBeginYear,
      mbDisambiguation: disamb || null,
      mbAiTags: [],
      hasRightsCodes,
      isImpersonation: isImpersonationNote,
    };
  }

  const aiFlagged =
    !isImpersonationNote &&
    (aiTags.length > 0 ||
      disambIsAi ||
      (mbArtist.type === "Other" &&
        /\b(ai|suno|udio|synthetic|neural|virtual|bot)\b/i.test(
          `${mbArtist.name} ${disamb} ${validTags.join(" ")}`
        )));

  // An artist in MusicBrainz is verified human if NOT AI-flagged AND has human/group attributes
  const verifiedHuman =
    !aiFlagged &&
    (isHumanType ||
      hasRightsCodes ||
      isEstablishedPreAi ||
      Boolean(mbCountry));

  return {
    found: true,
    verifiedHuman,
    aiFlagged,
    mbType,
    mbCountry,
    mbBeginYear,
    mbDisambiguation: disamb || null,
    mbAiTags: aiTags,
    hasRightsCodes,
    isImpersonation: isImpersonationNote,
  };
}

/**
 * Batch-prefetch MusicBrainz records for unique artists in a playlist (20 artists per Lucene query).
 * Eliminates MusicBrainz 503 rate-limiting and speeds up 100-1000+ track playlists by 10x.
 */
async function prefetchMusicBrainzArtists(artistNames) {
  const uncached = [];
  for (const name of artistNames) {
    const primary = getPrimaryArtist(name);
    const key = normalizeArtistKey(primary);
    if (
      key &&
      key !== "unknown artist" &&
      key !== "unknown channel" &&
      !mbArtistCache.has(key)
    ) {
      uncached.push(primary);
    }
  }

  const uniqueUncached = [...new Set(uncached)];
  const CHUNK_SIZE = 18;

  for (let i = 0; i < uniqueUncached.length; i += CHUNK_SIZE) {
    const chunk = uniqueUncached.slice(i, i + CHUNK_SIZE);
    const luceneParts = chunk.map(
      (a) => `"${a.replace(/["\\]/g, " ").trim()}"`
    );
    const query = `artist:(${luceneParts.join(" OR ")})`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(
        `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(
          query
        )}&fmt=json&limit=100`,
        {
          headers: {
            "User-Agent":
              "IsThereAIInMyPlaylist/2.5 (https://isthereaiinmyplaylist.tech)",
          },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const returned = Array.isArray(data?.artists) ? data.artists : [];

        for (const reqName of chunk) {
          const reqKey = normalizeArtistKey(reqName);
          const matches = returned.filter(
            (a) => normalizeArtistKey(a.name) === reqKey
          );
          // Prioritize legitimate established human artist (ISNI/IPI, career begin <= 2022, country, Person/Group)
          const richMatch = matches.find(
            (m) =>
              (m.isnis?.length ||
                m.ipis?.length ||
                (m["life-span"]?.begin &&
                  parseInt(String(m["life-span"].begin).slice(0, 4), 10) <= 2022)) &&
              ["Person", "Group", "Orchestra", "Choir"].includes(m.type)
          );
          const primaryMatch =
            matches.find((m) => m.score === "100" || m.score === 100) ||
            matches[0];
          // Only consider AI flag if no rich established match exists and the primary match itself is flagged
          const aiMatch =
            !richMatch &&
            matches.find((m) => evaluateMusicBrainzRecord(m).aiFlagged);
          const chosen = richMatch || primaryMatch || aiMatch || matches[0] || null;
          mbArtistCache.set(reqKey, evaluateMusicBrainzRecord(chosen));
        }
      }
    } catch {
      // Ignore network/timeout errors; individual fallback still works
    }
  }
}

/**
 * 3. Deep Artist & Catalog Forensics (Deezer + iTunes + MusicBrainz + Rights/Timeline)
 */
async function fetchArtistForensics(artistName, db) {
  const primary = getPrimaryArtist(artistName);
  const cacheKey = normalizeArtistKey(primary);
  if (
    !cacheKey ||
    cacheKey === "unknown artist" ||
    cacheKey === "unknown channel"
  ) {
    return {
      scoreDelta: 15,
      signals: [],
      forensics: {
        deezerFans: null,
        deezerAlbums: null,
        earliestYear: null,
        latestYear: null,
        careerSpanYears: 0,
        pre2023ReleaseCount: 0,
        post2024ReleaseCount: 0,
        releasesLast12Mo: 0,
        releaseCadencePerYear: 0,
        singleToAlbumRatio: null,
        singleCount: 0,
        albumCount: 0,
        avgTrackCountPerRelease: null,
        primaryDistributor: "Unknown",
        musicBrainzVerified: false,
        mbAiFlagged: false,
        mbHasRightsCodes: false,
        mbType: null,
        mbCountry: null,
        verifiedPreAiEra: false,
        hijackAnomaly: false,
      },
    };
  }

  // Deduplicate concurrent in-flight requests for the same artist
  if (artistCache.has(cacheKey)) {
    return await artistCache.get(cacheKey);
  }

  const promise = (async () => {
    const signals = [];
    let scoreDelta = 0;

    const forensics = {
      deezerFans: null,
      deezerAlbums: null,
      earliestYear: null,
      latestYear: null,
      careerSpanYears: 0,
      pre2023ReleaseCount: 0,
      post2024ReleaseCount: 0,
      releasesLast12Mo: 0,
      releaseCadencePerYear: 0,
      singleToAlbumRatio: null,
      singleCount: 0,
      albumCount: 0,
      avgTrackCountPerRelease: null,
      primaryDistributor: "Independent / Unlisted",
      copyrightSample: null,
      musicBrainzVerified: false,
      mbAiFlagged: false,
      mbHasRightsCodes: false,
      mbType: null,
      mbCountry: null,
      mbDisambiguation: null,
      verifiedPreAiEra: false,
      hijackAnomaly: false,
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);

      const needMbFetch = !mbArtistCache.has(cacheKey);

      const [deezerRes, itunesRes, mbRes] = await Promise.allSettled([
        fetch(
          `https://api.deezer.com/search/artist?q=${encodeURIComponent(
            primary
          )}&limit=25`,
          { signal: controller.signal }
        ).then((r) => (r.ok ? r.json() : null)),
        fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(
            primary
          )}&entity=album&limit=60`,
          { signal: controller.signal }
        ).then((r) => (r.ok ? r.json() : null)),
        needMbFetch
          ? fetch(
              `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(
                `"${primary}"`
              )}&fmt=json&limit=10`,
              {
                headers: {
                  "User-Agent":
                    "IsThereAIInMyPlaylist/2.5 (https://isthereaiinmyplaylist.tech)",
                },
                signal: controller.signal,
              }
            ).then((r) => (r.ok ? r.json() : null))
          : Promise.resolve(null),
      ]);

      clearTimeout(timeout);

      // 1. Deezer Listener & Album Footprint (strict exact artist name match)
      if (
        deezerRes.status === "fulfilled" &&
        deezerRes.value?.data?.length > 0
      ) {
        const exactMatches = deezerRes.value.data.filter(
          (a) => normalizeArtistKey(a.name) === cacheKey
        );
        const exactMatch =
          exactMatches.sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0))[0] ||
          null;

        if (exactMatch) {
          forensics.deezerFans = exactMatch.nb_fan ?? 0;
          forensics.deezerAlbums = exactMatch.nb_album ?? 0;
        }
      }

      // 2. MusicBrainz Semantic & Rights Check
      let mbEval = mbArtistCache.get(cacheKey);
      if (
        !mbEval &&
        mbRes.status === "fulfilled" &&
        Array.isArray(mbRes.value?.artists)
      ) {
        const matches = mbRes.value.artists.filter(
          (a) =>
            normalizeArtistKey(a.name) === cacheKey &&
            (a.score === undefined || Number(a.score) >= 80)
        );
        // Prioritize legitimate established human artist (ISNI/IPI, career begin <= 2022, country, Person/Group)
        const richMatch = matches.find(
          (m) =>
            (m.isnis?.length ||
              m.ipis?.length ||
              (m["life-span"]?.begin &&
                parseInt(String(m["life-span"].begin).slice(0, 4), 10) <= 2022)) &&
            ["Person", "Group", "Orchestra", "Choir"].includes(m.type)
        );
        const primaryMatch =
          matches.find((m) => m.score === "100" || m.score === 100) ||
          matches[0];
        const aiMatch =
          !richMatch &&
          matches.find((m) => evaluateMusicBrainzRecord(m).aiFlagged);
        mbEval = evaluateMusicBrainzRecord(
          richMatch || primaryMatch || aiMatch || matches[0]
        );
        mbArtistCache.set(cacheKey, mbEval);
      }

      if (mbEval && mbEval.found) {
        forensics.musicBrainzVerified = mbEval.verifiedHuman;
        forensics.mbAiFlagged = mbEval.aiFlagged;
        forensics.mbHasRightsCodes = mbEval.hasRightsCodes;
        forensics.mbType = mbEval.mbType;
        forensics.mbCountry = mbEval.mbCountry;
        forensics.mbDisambiguation = mbEval.mbDisambiguation;
        forensics.hasImpersonator = Boolean(mbEval.isImpersonation);
      }

      // 3. iTunes Discography, Single-to-Album Ratio, Velocity & Copyrights
      // Strict artist matching to prevent substring false-positives (e.g. "Nova" matching "Bossa Nova")
      if (
        itunesRes.status === "fulfilled" &&
        itunesRes.value?.results?.length > 0
      ) {
        const exactArtistReleases = itunesRes.value.results.filter((r) => {
          if (!r.artistName) return false;
          const rNorm = normalizeArtistKey(r.artistName);
          if (rNorm === cacheKey) return true;
          const parts = getAllTrackArtists(r.artistName).map(normalizeArtistKey);
          return parts.includes(cacheKey);
        });

        // Group by artistId and choose the primary artistId cluster if multiple homonyms exist
        let artistReleases = exactArtistReleases;
        if (exactArtistReleases.length > 1) {
          const byId = new Map();
          for (const rel of exactArtistReleases) {
            const aid = String(rel.artistId || "unknown");
            if (!byId.has(aid)) byId.set(aid, []);
            byId.get(aid).push(rel);
          }
          if (byId.size > 1) {
            // Pick the artistId cluster with the most releases
            const sortedClusters = [...byId.values()].sort(
              (a, b) => b.length - a.length
            );
            artistReleases = sortedClusters[0];
          }
        }

        const years = [];
        const copyrights = [];
        let totalTracksAcrossReleases = 0;
        const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

        for (const rel of artistReleases) {
          if (rel.releaseDate) {
            const d = new Date(rel.releaseDate);
            const yr = d.getFullYear();
            if (!isNaN(yr) && yr > 1920) {
              years.push(yr);
              if (yr <= 2022) forensics.pre2023ReleaseCount++;
              if (yr >= 2024) forensics.post2024ReleaseCount++;
            }
            if (d.getTime() >= oneYearAgo) {
              forensics.releasesLast12Mo++;
            }
          }

          const tCount = rel.trackCount || 1;
          totalTracksAcrossReleases += tCount;
          const colName = (rel.collectionName || "").toLowerCase();
          if (tCount <= 2 || colName.includes("- single")) {
            forensics.singleCount++;
          } else {
            forensics.albumCount++;
          }

          if (rel.copyright) {
            copyrights.push(rel.copyright);
          }
        }

        const totalRels = forensics.singleCount + forensics.albumCount;
        if (totalRels > 0) {
          forensics.singleToAlbumRatio = Math.round(
            (forensics.singleCount / totalRels) * 100
          );
          forensics.avgTrackCountPerRelease = Number(
            (totalTracksAcrossReleases / totalRels).toFixed(1)
          );
        }

        if (years.length > 0) {
          forensics.earliestYear = Math.min(...years);
          forensics.latestYear = Math.max(...years);
          forensics.careerSpanYears = Math.max(
            1,
            forensics.latestYear - forensics.earliestYear + 1
          );
          forensics.releaseCadencePerYear = Number(
            (totalRels / forensics.careerSpanYears).toFixed(1)
          );
        }

        if (copyrights.length > 0) {
          forensics.copyrightSample = copyrights[0];
          const cleanedLabel = copyrights[0]
            .replace(/^[℗©(P)(C)\s0-9-]+/i, "")
            .split(/under exclusive license|all rights reserved|\./i)[0]
            .trim();
          if (cleanedLabel) {
            forensics.primaryDistributor =
              cleanedLabel.length > 42
                ? cleanedLabel.slice(0, 42) + "..."
                : cleanedLabel;
          }
        }
      }

      // If MusicBrainz has a verified human begin year <= 2022, incorporate into earliestYear
      if (
        forensics.musicBrainzVerified &&
        mbEval?.mbBeginYear &&
        mbEval.mbBeginYear <= 2022 &&
        (!forensics.earliestYear || mbEval.mbBeginYear < forensics.earliestYear)
      ) {
        if (!forensics.earliestYear) {
          forensics.earliestYear = mbEval.mbBeginYear;
          forensics.careerSpanYears =
            new Date().getFullYear() - mbEval.mbBeginYear + 1;
        }
      }

      // --- Evaluate Forensic Signals ---
      const copyrightBlob = (forensics.copyrightSample || "").toLowerCase();

      // A. MusicBrainz Explicit AI Flag
      if (forensics.mbAiFlagged) {
        scoreDelta += 85;
        const reasonDetail =
          mbEval?.mbDisambiguation ||
          (mbEval?.mbAiTags || []).join(", ") ||
          "AI artist";
        signals.push({
          type: "danger",
          category: "MB AI TAG",
          text: `MusicBrainz explicitly classifies artist as AI-generated (${reasonDetail})`,
        });
      }

      // B. Check known AI labels in copyright
      for (const aiLabel of db.knownAiLabels || []) {
        if (new RegExp(`\\b${aiLabel}\\b`, "i").test(copyrightBlob)) {
          scoreDelta += 78;
          signals.push({
            type: "danger",
            category: "LICENSE",
            text: `Copyright line credits synthetic generator "${aiLabel}"`,
          });
          break;
        }
      }

      // C. Detect Dormant / Hijacked Profile Anomaly vs. True Pre-AI Era History
      // Some AI stream farms upload under the same name as a dormant 1-release artist from years ago
      const hasHijackPattern =
        !forensics.musicBrainzVerified &&
        forensics.pre2023ReleaseCount <= 1 &&
        forensics.releasesLast12Mo >= 14 &&
        (forensics.singleToAlbumRatio || 0) >= 85;

      if (hasHijackPattern) {
        forensics.hijackAnomaly = true;
      }

      if (
        forensics.earliestYear &&
        forensics.earliestYear <= 2022 &&
        !forensics.mbAiFlagged &&
        !hasHijackPattern
      ) {
        forensics.verifiedPreAiEra = true;
        scoreDelta -= 30;
        signals.push({
          type: "safe",
          category: "TIMELINE",
          text: `Artist back-catalog dates back to ${forensics.earliestYear} (${forensics.careerSpanYears} yr active span, pre-AI era)`,
        });
      } else if (hasHijackPattern) {
        scoreDelta += 38;
        signals.push({
          type: "danger",
          category: "HIJACK / VELOCITY",
          text: `Profile anomaly: ${forensics.releasesLast12Mo} singles dropped in last 12m (${forensics.singleToAlbumRatio}% singles) despite ${forensics.earliestYear} collision`,
        });
      } else if (forensics.earliestYear && forensics.earliestYear >= 2024) {
        if (forensics.releasesLast12Mo >= 20) {
          scoreDelta += 48;
          signals.push({
            type: "danger",
            category: "VELOCITY",
            text: `Extreme stream-farm cadence: debuted ${forensics.earliestYear} with ${forensics.releasesLast12Mo} releases in 12 months`,
          });
        } else if (forensics.releasesLast12Mo >= 10) {
          scoreDelta += 36;
          signals.push({
            type: "danger",
            category: "VELOCITY",
            text: `High-frequency output: debuted ${forensics.earliestYear} with ${forensics.releasesLast12Mo} releases in 12 months`,
          });
        } else {
          scoreDelta += 15;
          signals.push({
            type: "warning",
            category: "TIMELINE",
            text: `First indexed release is from ${forensics.earliestYear} (post-generative AI boom)`,
          });
        }
      } else if (forensics.earliestYear === 2023) {
        if (forensics.releasesLast12Mo >= 15) {
          scoreDelta += 32;
          signals.push({
            type: "danger",
            category: "VELOCITY",
            text: `High release velocity: ${forensics.releasesLast12Mo} releases in last 12 months`,
          });
        } else {
          scoreDelta += 6;
        }
      }

      // D. Single-to-Album Farm Ratio (AI farms almost exclusively drop 1-track singles)
      if (
        !forensics.verifiedPreAiEra &&
        forensics.singleToAlbumRatio !== null
      ) {
        if (forensics.singleToAlbumRatio >= 90 && forensics.singleCount >= 6) {
          scoreDelta += 22;
          signals.push({
            type: "warning",
            category: "CATALOG",
            text: `${forensics.singleToAlbumRatio}% single-only waterfall pattern (${forensics.singleCount} singles, ${forensics.albumCount} albums, avg ${forensics.avgTrackCountPerRelease} tracks/rel)`,
          });
        } else if (
          forensics.singleToAlbumRatio >= 80 &&
          forensics.singleCount >= 8
        ) {
          scoreDelta += 14;
          signals.push({
            type: "warning",
            category: "CATALOG",
            text: `High single ratio: ${forensics.singleToAlbumRatio}% singles (${forensics.singleCount}S / ${forensics.albumCount}A)`,
          });
        }
      }

      // E. MusicBrainz Human & Rights Registry Verification (ISNI / IPI)
      if (forensics.musicBrainzVerified) {
        const rightsBonus = forensics.mbHasRightsCodes ? 22 : 15;
        scoreDelta -= rightsBonus;
        signals.push({
          type: "safe",
          category: "REGISTRY",
          text: `Verified in MusicBrainz (${forensics.mbType}${
            forensics.mbCountry ? `, ${forensics.mbCountry}` : ""
          }${forensics.mbHasRightsCodes ? ", ISNI/IPI rights registered" : ""})`,
        });
      } else if (!forensics.verifiedPreAiEra && !forensics.mbAiFlagged) {
        scoreDelta += 3;
        signals.push({
          type: "info",
          category: "REGISTRY",
          text: "Independent creator (unlisted in MusicBrainz open encyclopedia)",
        });
      }

      // F. Listener-to-Catalog Engagement Anomaly
      if (forensics.deezerFans !== null) {
        if (forensics.deezerFans >= 15000 && !forensics.mbAiFlagged) {
          scoreDelta -= 24;
          signals.push({
            type: "safe",
            category: "AUDIENCE",
            text: `Established audience (${forensics.deezerFans.toLocaleString(
              "en-US"
            )} indexed Deezer followers)`,
          });
        } else if (
          forensics.deezerFans >= 2500 &&
          !forensics.mbAiFlagged &&
          forensics.releasesLast12Mo < 15
        ) {
          scoreDelta -= 12;
          signals.push({
            type: "safe",
            category: "AUDIENCE",
            text: `Verified listener footprint (${forensics.deezerFans.toLocaleString(
              "en-US"
            )} Deezer followers)`,
          });
        } else if (forensics.deezerFans < 100 && forensics.deezerAlbums >= 15) {
          scoreDelta += 36;
          signals.push({
            type: "danger",
            category: "ANOMALY",
            text: `Ghost catalog anomaly: ${forensics.deezerAlbums} releases vs. only ${forensics.deezerFans} followers`,
          });
        } else if (forensics.deezerFans < 30 && !forensics.verifiedPreAiEra) {
          scoreDelta += 14;
          signals.push({
            type: "warning",
            category: "AUDIENCE",
            text: `Minimal listener footprint (${forensics.deezerFans} followers)`,
          });
        }
      } else if (
        forensics.singleCount + forensics.albumCount === 0 &&
        !forensics.musicBrainzVerified
      ) {
        scoreDelta += 8;
        signals.push({
          type: "info",
          category: "IDENTITY",
          text: `Artist "${primary}" has independent footprint (unindexed in commercial streaming registries)`,
        });
      }

      // G. Major/Established Label vs. DIY Distributor Check
      if (copyrightBlob) {
        const matchedMajor = MAJOR_OR_INDIE_HUMAN_LABELS.find((lbl) =>
          copyrightBlob.includes(lbl.toLowerCase())
        );
        if (matchedMajor && !forensics.mbAiFlagged) {
          scoreDelta -= 18;
          signals.push({
            type: "safe",
            category: "LABEL",
            text: `Signed / distributed via established label (${forensics.primaryDistributor})`,
          });
        } else if (
          !forensics.verifiedPreAiEra &&
          (forensics.deezerFans === null || forensics.deezerFans < 500)
        ) {
          const matchedDiy = (db.suspiciousDiyDistributors || []).find((dist) =>
            copyrightBlob.includes(dist.toLowerCase())
          );
          if (matchedDiy || /\d{5,}\s*records\s*dk/i.test(copyrightBlob)) {
            forensics.primaryDistributor =
              matchedDiy || "Records DK (DistroKid)";
            scoreDelta += 18;
            signals.push({
              type: "warning",
              category: "DISTRIBUTOR",
              text: `Anonymous DIY distribution (${forensics.primaryDistributor}) with no pre-2024 history`,
            });
          }
        }
      }
    } catch {
      // Fallback if offline or rate-limited
    }

    return { scoreDelta, signals, forensics };
  })();

  artistCache.set(cacheKey, promise);
  return await promise;
}

/**
 * 4. Track-Level Lookup (Deezer Track API for Rank & Fallback Preview)
 */
async function fetchTrackLevelMetrics(track, skipNetwork = false) {
  const primary = getPrimaryArtist(track.artist);
  const cleanTitle = (track.title || "")
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .trim();
  const key = `${normalizeArtistKey(primary)}:::${normalizeArtistKey(
    cleanTitle
  )}`;

  if (trackLookupCache.has(key)) {
    return await trackLookupCache.get(key);
  }

  const defaultMetrics = {
    deezerRank: null,
    fallbackPreviewUrl: null,
  };

  if (!primary || !cleanTitle || skipNetwork) return defaultMetrics;

  const promise = (async () => {
    const metrics = { ...defaultMetrics };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const q = `artist:"${primary}" track:"${cleanTitle}"`;
      const res = await fetch(
        `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=1`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const item = data?.data?.[0];
        if (item) {
          metrics.deezerRank = item.rank || null;
          metrics.fallbackPreviewUrl = item.preview || null;
        }
      }
    } catch {
      // ignore
    }
    return metrics;
  })();

  trackLookupCache.set(key, promise);
  return await promise;
}

/**
 * 5. Audio Stream & Duration Telemetry
 */
async function analyzeAudioTelemetry(
  track,
  isSuspectOrNew,
  allowStreamFetch = true
) {
  const signals = [];
  let scoreDelta = 0;
  const audioTelemetry = {
    durationSeconds: track.durationMs
      ? Math.round(track.durationMs / 1000)
      : null,
    matchesGeneratorWindow: false,
    sampleBytes: null,
    shannonEntropy: null,
    byteVariance: null,
    zeroCrossRatio: null,
  };

  if (audioTelemetry.durationSeconds) {
    const sec = audioTelemetry.durationSeconds;
    // Suno v3/v3.5/v4 & Udio typical generation windows (1:57-2:03, 2:58-3:02, 3:57-4:03)
    if (
      (sec >= 117 && sec <= 123) ||
      (sec >= 178 && sec <= 182) ||
      (sec >= 237 && sec <= 243)
    ) {
      audioTelemetry.matchesGeneratorWindow = true;
      if (isSuspectOrNew) {
        scoreDelta += 8;
        signals.push({
          type: "warning",
          category: "DURATION",
          text: `Duration (${Math.floor(sec / 60)}:${String(sec % 60).padStart(
            2,
            "0"
          )}) aligns with standard AI generator context window`,
        });
      }
    } else if (sec > 0 && sec < 65 && isSuspectOrNew) {
      scoreDelta += 6;
      signals.push({
        type: "warning",
        category: "DURATION",
        text: `Micro-track duration (${sec}s) common in stream-farming catalogs`,
      });
    }
  }

  if (track.previewUrl && allowStreamFetch) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2200);
      const res = await fetch(track.previewUrl, {
        headers: { Range: "bytes=0-32768" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 4096) {
          audioTelemetry.sampleBytes = buf.length;
          const freq = new Array(256).fill(0);
          let sum = 0;
          let zeroCrosses = 0;

          for (let i = 0; i < buf.length; i++) {
            freq[buf[i]]++;
            sum += buf[i];
            if (i > 0 && buf[i] >= 128 !== buf[i - 1] >= 128) {
              zeroCrosses++;
            }
          }

          let entropy = 0;
          for (let i = 0; i < 256; i++) {
            if (freq[i] > 0) {
              const p = freq[i] / buf.length;
              entropy -= p * Math.log2(p);
            }
          }

          const mean = sum / buf.length;
          let sqDiff = 0;
          for (let i = 0; i < buf.length; i++) {
            const d = buf[i] - mean;
            sqDiff += d * d;
          }

          audioTelemetry.shannonEntropy = Number(entropy.toFixed(3));
          audioTelemetry.byteVariance = Math.round(sqDiff / buf.length);
          audioTelemetry.zeroCrossRatio = Number(
            (zeroCrosses / buf.length).toFixed(3)
          );

          signals.push({
            type: "info",
            category: "AUDIO",
            text: `Preview telemetry: H=${audioTelemetry.shannonEntropy} b/B, ZCR=${audioTelemetry.zeroCrossRatio}, σ²=${audioTelemetry.byteVariance}`,
          });
        }
      }
    } catch {
      // ignore preview stream timeout
    }
  }

  return { scoreDelta, signals, audioTelemetry };
}

/**
 * Full Multi-Metric Track Analysis (7 Vectors)
 */
async function analyzeTrack(track, db, options = {}) {
  const { isLargePlaylist = false } = options;
  let rawScore = 10;
  let hasConflictingSignals = false;
  const allSignals = [];

  // 1. Keywords & Naming
  const kwResult = analyzeKeywords(track);
  rawScore += kwResult.score;
  allSignals.push(...kwResult.signals);

  // 2. Online & Local AI Database Match
  const dbResult = analyzeDatabase(track, db);

  // 3. Artist & Catalog Forensics + Track Lookup
  const skipTrackLookup =
    isLargePlaylist && (Boolean(track.previewUrl) || Boolean(track.spotifyPlaycount));
  const [artistIntel, trackMetrics] = await Promise.all([
    fetchArtistForensics(track.artist, db),
    fetchTrackLevelMetrics(track, skipTrackLookup),
  ]);

  if (!track.previewUrl && trackMetrics.fallbackPreviewUrl) {
    track.previewUrl = trackMetrics.fallbackPreviewUrl;
  }

  const f = { ...artistIntel.forensics };

  // Incorporate track-level release year & Spotify stream telemetry when available
  if (track.albumReleaseYear) {
    f.trackReleaseYear = track.albumReleaseYear;
    if (!f.earliestYear || track.albumReleaseYear < f.earliestYear) {
      f.earliestYear = track.albumReleaseYear;
    }
    if (track.albumReleaseYear <= 2022 && !f.mbAiFlagged && !f.hijackAnomaly) {
      if (!f.verifiedPreAiEra) {
        f.verifiedPreAiEra = true;
        rawScore -= 28;
        allSignals.push({
          type: "safe",
          category: "TRACK DATE",
          text: `Track released in ${track.albumReleaseYear} (pre-dates commercial music AI generators)`,
        });
      }
    }
  }

  // Evaluate DB match with universal homonym & AI impersonation safeguard for non-ID matches
  let verifiedDbMatch = false;
  if (dbResult.score > 0) {
    const isPreAiTrack = Boolean(
      (track.albumReleaseYear && track.albumReleaseYear <= 2022) ||
      (f.trackReleaseYear && f.trackReleaseYear <= 2022) ||
      (f.earliestYear && f.earliestYear <= 2022 && (!track.albumReleaseYear || track.albumReleaseYear <= 2022))
    );

    const isDocumentedImpersonation = Boolean(
      dbResult.isImpersonation ||
      f.hasImpersonator ||
      (dbResult.matchedReason &&
        /\b(impersonat|impersonator|impersonation|fake|copycat|spoof)\b/i.test(dbResult.matchedReason))
    );

    // A database match by artist name alone (without exact platform ID like Spotify Artist ID)
    // must NOT flag authentic human artists when:
    // 1. The track itself was released in or before 2022 (pre-dates generative AI models like Suno/Udio).
    // 2. The database entry documents an AI impersonator of an established human artist (verified pre-AI catalog or MusicBrainz).
    // 3. Universal homonym collision: verified pre-AI human artist with established presence or listenership.
    const isHomonymOrImpersonationCollision =
      !dbResult.matchedById &&
      (
        isPreAiTrack ||
        (isDocumentedImpersonation &&
          (f.verifiedPreAiEra || f.musicBrainzVerified || (f.deezerFans && f.deezerFans >= 1000))) ||
        (f.verifiedPreAiEra &&
          f.musicBrainzVerified &&
          ((f.deezerFans && f.deezerFans >= 3000) ||
            (track.spotifyPlaycount && track.spotifyPlaycount >= 1000000))) ||
        ((f.deezerFans && f.deezerFans >= 15000) ||
          (track.spotifyPlaycount && track.spotifyPlaycount >= 5000000))
      );

    // Safeguard human artists against unverified community false positives
    const isCommunityReport = dbResult.matchedDbSource === "Community Flagged";
    const isHumanVerifiedOrEstablished = Boolean(
      f.verifiedPreAiEra ||
      (f.musicBrainzVerified && !f.mbAiFlagged) ||
      (f.earliestYear && f.earliestYear <= 2022) ||
      (f.deezerFans && f.deezerFans >= 500) ||
      (track.spotifyPlaycount && track.spotifyPlaycount >= 100000)
    );

    if (isCommunityReport && isHumanVerifiedOrEstablished) {
      if (isPreAiTrack) {
        // Track itself was released pre-2023: community flag is chronologically impossible
        allSignals.push({
          type: "info",
          category: "COMMUNITY SHIELD",
          text: `Community flag for "${track.artist}" disregarded: Track was released in ${track.albumReleaseYear || f.earliestYear} (pre-dates commercial generative music AI).`,
        });
      } else {
        // Decouple: Artist has human back-catalog, but this specific post-2022 release has a community report.
        // Keep both evidence signals visible and hold the outcome as Inconclusive / Conflicted.
        hasConflictingSignals = true;
        allSignals.push({
          type: "safe",
          category: "ARTIST PROVENANCE",
          text: `Artist has established pre-AI discography (active since ${f.earliestYear || "pre-2023"}), establishing older releases but not guaranteeing this specific post-2022 track.`,
        });
        allSignals.push({
          type: "warning",
          category: "COMMUNITY REPORT",
          text: `Community catalog match: "${track.artist}" has community synthetic reports (${dbResult.matchedReason || "community flagged"}).`,
        });
        allSignals.push({
          type: "warning",
          category: "CONFLICTING SIGNALS",
          text: `Conflicting evidence: Established human artist history vs. unverified community track flag. Held in Inconclusive tier pending manual review.`,
        });
      }
    } else if (isHomonymOrImpersonationCollision) {
      if (isDocumentedImpersonation) {
        allSignals.push({
          type: "info",
          category: "IMPERSONATION GUARD",
          text: `Artist "${track.artist}" has documented AI impersonators (${dbResult.matchedReason || dbResult.matchedDbSource}); verified authentic original catalog (${isPreAiTrack ? `released ${track.albumReleaseYear || f.earliestYear}, pre-AI era` : "verified human identity"})`,
        });

        // For recent post-2022 releases under an artist with documented impersonators without exact ID:
        // Flag for caution ONLY if there are genuine hijack / upload cadence anomalies:
        if (!isPreAiTrack && (track.albumReleaseYear >= 2023 || !track.albumReleaseYear)) {
          if (f.hijackAnomaly || f.releasesLast12Mo >= 15) {
            rawScore += 25;
            allSignals.push({
              type: "warning",
              category: "IMPERSONATION SUSPECT",
              text: `Recent release under artist with documented AI impersonator; flagged for manual review due to anomalous upload pattern`,
            });
          }
        }
      } else {
        allSignals.push({
          type: "info",
          category: "HOMONYM SHIELD",
          text: `Name match in ${dbResult.matchedDbSource} filtered (established verified artist "${track.artist}" distinct from indexed AI profile)`,
        });
      }
    } else {
      verifiedDbMatch = true;
      rawScore += dbResult.score;
      allSignals.push(...dbResult.signals);
    }
  }

  // Apply artist forensics score delta
  if (kwResult.score >= 75 || verifiedDbMatch || f.mbAiFlagged) {
    rawScore += Math.max(0, artistIntel.scoreDelta);
  } else {
    rawScore += artistIntel.scoreDelta;
  }
  allSignals.push(...artistIntel.signals);

  // Spotify Playcount / Stream Telemetry
  if (
    typeof track.spotifyPlaycount === "number" &&
    track.spotifyPlaycount > 0
  ) {
    f.spotifyPlaycount = track.spotifyPlaycount;
    if (
      track.spotifyPlaycount >= 5_000_000 &&
      !f.mbAiFlagged &&
      !verifiedDbMatch
    ) {
      rawScore -= 16;
      allSignals.push({
        type: "safe",
        category: "STREAMS",
        text: `High verified listenership (${track.spotifyPlaycount.toLocaleString(
          "en-US"
        )} Spotify streams)`,
      });
    } else if (
      track.spotifyPlaycount < 1000 &&
      !f.verifiedPreAiEra &&
      f.releasesLast12Mo >= 10
    ) {
      rawScore += 10;
    }
  }

  // 4. Audio Stream & Duration Telemetry
  const isSuspectOrNew = !f.verifiedPreAiEra || rawScore >= 35;
  const allowStreamFetch = !isLargePlaylist || rawScore >= 40;
  const audioResult = await analyzeAudioTelemetry(
    track,
    isSuspectOrNew,
    allowStreamFetch
  );
  rawScore += audioResult.scoreDelta;
  allSignals.push(...audioResult.signals);

  // 5. Human Cover & Remix / Mix Recognition & Balance
  const coverInfo = detectCoverContext(track.title, track.artist);
  const mixInfo = detectMixContext(track.title, track.artist);

  const isHumanCover =
    coverInfo.isCover &&
    !coverInfo.isAiCover &&
    kwResult.score < 50 &&
    !verifiedDbMatch &&
    !f.mbAiFlagged;

  const isHumanMix =
    mixInfo.isMix &&
    !mixInfo.isAiMix &&
    kwResult.score < 50 &&
    !verifiedDbMatch &&
    !f.mbAiFlagged;

  if (isHumanCover || isHumanMix) {
    f.isCoverOrMix = true;
    // Human covers & DJ remixes are naturally released as singles and often through DIY aggregators.
    // Normalize and cap any AI-farm penalties that don't apply to human performances/mixes.
    rawScore = Math.min(rawScore, 24);
    rawScore = Math.max(2, rawScore - 12);

    allSignals.push({
      type: "safe",
      category: isHumanCover ? "COVER" : "REMIX",
      text: isHumanCover
        ? "Human musical cover / tribute version (catalog metrics normalized for single releases)"
        : "Legitimate musical remix / club mix (catalog metrics normalized for electronic dance singles)",
    });

    // Remove false alarm single-ratio or DIY distributor warnings from signals
    for (let i = allSignals.length - 1; i >= 0; i--) {
      if (
        allSignals[i].category === "CATALOG" ||
        allSignals[i].category === "DISTRIBUTOR" ||
        allSignals[i].category === "VELOCITY"
      ) {
        allSignals.splice(i, 1);
      }
    }
  }

  let aiProbability = Math.max(2, Math.min(99, Math.round(rawScore)));

  // Hard Safeguard: Metadata sparsity or release velocity alone CANNOT cross into FLAGGED AI (>=68%)
  // High-confidence AI strictly requires compound proof (confirmed database match, MusicBrainz AI tag, or prompt telemetry)
  const hasDefinitiveCompoundProof = Boolean(
    verifiedDbMatch ||
    f.mbAiFlagged ||
    (kwResult.score >= 60) ||
    ((f.releasesLast12Mo || 0) >= 25) ||
    (kwResult.score >= 32 && (f.releasesLast12Mo || 0) >= 12)
  );

  if (!hasDefinitiveCompoundProof && aiProbability >= 68) {
    aiProbability = 64; // Strictly capped inside the Inconclusive tier
    allSignals.push({
      type: "info",
      category: "CEILING SAFEGUARD",
      text: "Score capped at Inconclusive: Rapid release pace or missing label records is never treated as solitary proof of AI.",
    });
  }

  // Hold conflicting signals (established human artist vs. track-level AI report) in the Inconclusive buffer
  if (hasConflictingSignals) {
    aiProbability = Math.max(46, Math.min(52, aiProbability));
  }

  // Compute sub-vector scores (0-100) for detailed breakdown
  const subScores = {
    metadataScore: Math.min(
      100,
      kwResult.score + (verifiedDbMatch ? dbResult.score : 0) + (f.mbAiFlagged ? 90 : 0)
    ),
    catalogVelocityScore: isHumanCover || isHumanMix
      ? 8
      : f.verifiedPreAiEra && !f.hijackAnomaly
      ? 5
      : Math.min(
          100,
          (f.releasesLast12Mo >= 20
            ? 85
            : f.releasesLast12Mo >= 12
            ? 72
            : f.releasesLast12Mo * 5) +
            (f.singleToAlbumRatio && f.singleToAlbumRatio >= 85 ? 25 : 0)
        ),
    footprintRiskScore:
      (f.deezerFans !== null && f.deezerFans >= 15000) ||
      (track.spotifyPlaycount && track.spotifyPlaycount >= 5_000_000)
        ? 4
        : f.deezerFans !== null && f.deezerFans < 50
        ? 84
        : f.musicBrainzVerified
        ? 14
        : 66,
    distributionRiskScore: isHumanCover || isHumanMix
      ? 12
      : verifiedDbMatch || f.mbAiFlagged
      ? 96
      : f.verifiedPreAiEra
      ? 8
      : f.primaryDistributor.includes("DistroKid") ||
        f.primaryDistributor.includes("Records DK")
      ? 72
      : 24,
  };

  let verdict = "human";
  let verdictLabel = "VERIFIED HUMAN";

  if (aiProbability >= 68) {
    verdict = "ai";
    verdictLabel = "FLAGGED AI";
  } else if (aiProbability >= 38) {
    verdict = "suspicious";
    if (hasConflictingSignals) {
      verdictLabel = "INCONCLUSIVE / CONFLICTING EVIDENCE";
    } else if (!verifiedDbMatch && kwResult.score < 50) {
      verdictLabel = "INSUFFICIENT EVIDENCE / SPARSE METADATA";
      if (!allSignals.some((s) => s.category === "TELEMETRY CONTEXT")) {
        allSignals.push({
          type: "info",
          category: "TELEMETRY CONTEXT",
          text: "Sparse public registry footprint. Lacking major label or MusicBrainz records is normal for independent creators and is NOT proof of AI.",
        });
      }
    } else {
      verdictLabel = "INCONCLUSIVE / UNKNOWN";
    }
  }

  if (allSignals.length === 0) {
    allSignals.push({
      type: "safe",
      category: "PASS",
      text: "No synthetic generator markers found",
    });
  }

  return {
    ...track,
    aiProbability,
    verdict,
    verdictLabel,
    signals: allSignals,
    subScores,
    forensics: {
      ...f,
      matchedDbSource: verifiedDbMatch ? dbResult.matchedDbSource : null,
      deezerTrackRank: trackMetrics.deezerRank,
      bpm: track.bpm || null,
      musicalKey: track.musicalKey || null,
      ...audioResult.audioTelemetry,
    },
  };
}

/**
 * Analyze ALL tracks in playlist (supports 100 to 5,000+ tracks) and compute aggregate playlist telemetry
 */
async function analyzePlaylistTracks(playlist) {
  const [db, communityReports] = await Promise.all([
    ensureOnlineAiDatabase(),
    fetchCloudCommunityReports(),
  ]);
  db.communityReports = communityReports;
  const tracks = playlist.tracks || [];
  const isLargePlaylist = tracks.length > 45;

  // Step 1: Batch-prefetch MusicBrainz records for unique artists in the playlist (up to 360 unique artists = 20 batch queries)
  const uniqueArtists = [
    ...new Set(tracks.map((t) => getPrimaryArtist(t.artist)).filter(Boolean)),
  ];
  await prefetchMusicBrainzArtists(uniqueArtists.slice(0, 360));

  // Step 2: Pre-warm deep iTunes/Deezer artist forensics.
  // For massive playlists (>80 unique artists), prioritize artists that are post-2022, low-stream, or unverified
  // while synthesizing instant forensics for pre-2022 high-stream Spotify tracks to prevent API rate-limiting.
  let artistsForDeepFetch = uniqueArtists;
  if (uniqueArtists.length > 80) {
    const priorityArtists = [];
    for (const artist of uniqueArtists) {
      const aKey = normalizeArtistKey(artist);
      const sampleTrack = tracks.find(
        (t) => normalizeArtistKey(getPrimaryArtist(t.artist)) === aKey
      );
      const mbInfo = mbArtistCache.get(aKey);
      const isClearlyEstablishedPreAi =
        sampleTrack &&
        sampleTrack.albumReleaseYear &&
        sampleTrack.albumReleaseYear <= 2022 &&
        (sampleTrack.spotifyPlaycount || 0) >= 250000 &&
        mbInfo?.verifiedHuman &&
        !mbInfo?.aiFlagged;

      if (isClearlyEstablishedPreAi) {
        // Seed artistCache directly from verified Spotify + MusicBrainz telemetry
        artistCache.set(
          aKey,
          Promise.resolve({
            scoreDelta: -45,
            signals: [
              {
                type: "safe",
                category: "TIMELINE",
                text: `Verified pre-AI catalog (release year ${sampleTrack.albumReleaseYear})`,
              },
              {
                type: "safe",
                category: "REGISTRY",
                text: `Verified in MusicBrainz (${mbInfo.mbType || "Artist"}${
                  mbInfo.mbCountry ? ", " + mbInfo.mbCountry : ""
                })`,
              },
            ],
            forensics: {
              deezerFans: null,
              deezerAlbums: null,
              earliestYear: mbInfo.mbBeginYear || sampleTrack.albumReleaseYear,
              latestYear: sampleTrack.albumReleaseYear,
              careerSpanYears: Math.max(
                1,
                new Date().getFullYear() -
                  (mbInfo.mbBeginYear || sampleTrack.albumReleaseYear) +
                  1
              ),
              pre2023ReleaseCount: 1,
              post2024ReleaseCount: 0,
              releasesLast12Mo: 0,
              releaseCadencePerYear: 1,
              singleToAlbumRatio: null,
              singleCount: 0,
              albumCount: 1,
              avgTrackCountPerRelease: null,
              primaryDistributor: "Verified Catalog",
              musicBrainzVerified: true,
              mbAiFlagged: false,
              mbHasRightsCodes: Boolean(mbInfo.hasRightsCodes),
              mbType: mbInfo.mbType || "Artist",
              mbCountry: mbInfo.mbCountry || null,
              verifiedPreAiEra: true,
              hijackAnomaly: false,
            },
          })
        );
      } else {
        priorityArtists.push(artist);
      }
    }
    artistsForDeepFetch = priorityArtists.slice(0, 90);
    // For any remaining uncached artists in huge playlists (beyond top 90 priority), seed from MB + track metadata
    for (const artist of priorityArtists.slice(90)) {
      const aKey = normalizeArtistKey(artist);
      if (artistCache.has(aKey)) continue;
      const sampleTrack = tracks.find(
        (t) => normalizeArtistKey(getPrimaryArtist(t.artist)) === aKey
      );
      const mbInfo = mbArtistCache.get(aKey);
      const yr = sampleTrack?.albumReleaseYear || mbInfo?.mbBeginYear || null;
      const isPreAi = Boolean(yr && yr <= 2022 && !mbInfo?.aiFlagged);
      let delta = 0;
      const sigs = [];
      if (mbInfo?.aiFlagged) {
        delta += 85;
        sigs.push({
          type: "danger",
          category: "MB AI TAG",
          text: "MusicBrainz explicitly classifies artist as AI-generated",
        });
      } else if (isPreAi) {
        delta -= 28;
        sigs.push({
          type: "safe",
          category: "TIMELINE",
          text: `Catalog dates back to ${yr} (pre-AI era)`,
        });
      } else if (yr && yr >= 2024) {
        delta += 16;
        sigs.push({
          type: "warning",
          category: "TIMELINE",
          text: `Release from ${yr} (post-generative AI boom)`,
        });
      }
      if (mbInfo?.verifiedHuman) {
        delta -= 15;
        sigs.push({
          type: "safe",
          category: "REGISTRY",
          text: `Verified in MusicBrainz (${mbInfo.mbType || "Artist"})`,
        });
      }
      artistCache.set(
        aKey,
        Promise.resolve({
          scoreDelta: delta,
          signals: sigs,
          forensics: {
            deezerFans: null,
            deezerAlbums: null,
            earliestYear: yr,
            latestYear: sampleTrack?.albumReleaseYear || yr,
            careerSpanYears: yr ? Math.max(1, new Date().getFullYear() - yr + 1) : 0,
            pre2023ReleaseCount: isPreAi ? 1 : 0,
            post2024ReleaseCount: yr && yr >= 2024 ? 1 : 0,
            releasesLast12Mo: 0,
            releaseCadencePerYear: 0,
            singleToAlbumRatio: null,
            singleCount: 0,
            albumCount: 0,
            avgTrackCountPerRelease: null,
            primaryDistributor: "Spotify / Catalog",
            musicBrainzVerified: Boolean(mbInfo?.verifiedHuman),
            mbAiFlagged: Boolean(mbInfo?.aiFlagged),
            mbHasRightsCodes: Boolean(mbInfo?.hasRightsCodes),
            mbType: mbInfo?.mbType || null,
            mbCountry: mbInfo?.mbCountry || null,
            verifiedPreAiEra: isPreAi,
            hijackAnomaly: false,
          },
        })
      );
    }
  }

  const artistBatchSize = 15;
  for (let i = 0; i < artistsForDeepFetch.length; i += artistBatchSize) {
    const batch = artistsForDeepFetch.slice(i, i + artistBatchSize);
    await Promise.all(batch.map((artist) => fetchArtistForensics(artist, db)));
  }

  // Step 3: Analyze all tracks in parallel batches
  const analyzedTracks = [];
  const trackBatchSize = isLargePlaylist ? 25 : 10;
  for (let i = 0; i < tracks.length; i += trackBatchSize) {
    const batch = tracks.slice(i, i + trackBatchSize);
    const batchResults = await Promise.all(
      batch.map((t) => analyzeTrack(t, db, { isLargePlaylist }))
    );
    analyzedTracks.push(...batchResults);
  }

  const total = analyzedTracks.length;
  const aiCount = analyzedTracks.filter((t) => t.verdict === "ai").length;
  const suspiciousCount = analyzedTracks.filter(
    (t) => t.verdict === "suspicious"
  ).length;
  const humanCount = analyzedTracks.filter((t) => t.verdict === "human").length;

  const avgAiScore =
    total > 0
      ? Math.round(
          analyzedTracks.reduce((sum, t) => sum + t.aiProbability, 0) / total
        )
      : 0;

  // Additional playlist-level metrics
  const preAiCount = analyzedTracks.filter(
    (t) => t.forensics?.verifiedPreAiEra
  ).length;
  const mbVerifiedCount = analyzedTracks.filter(
    (t) => t.forensics?.musicBrainzVerified
  ).length;
  const onlineDbMatchedCount = analyzedTracks.filter((t) =>
    Boolean(t.forensics?.matchedDbSource)
  ).length;
  const post2024Count = analyzedTracks.filter(
    (t) => t.forensics?.earliestYear && t.forensics.earliestYear >= 2024
  ).length;
  const highVelocityCount = analyzedTracks.filter(
    (t) => (t.forensics?.releasesLast12Mo || 0) >= 10
  ).length;

  const durations = analyzedTracks
    .map((t) => t.forensics?.durationSeconds)
    .filter((d) => d && d > 0);
  const avgDurationSec =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

  const followerCounts = analyzedTracks
    .map((t) => t.forensics?.deezerFans)
    .filter((f) => typeof f === "number")
    .sort((a, b) => a - b);
  const medianFollowers =
    followerCounts.length > 0
      ? followerCounts[Math.floor(followerCounts.length / 2)]
      : 0;

  return {
    ...playlist,
    summary: {
      totalTracks: total,
      aiCount,
      suspiciousCount,
      humanCount,
      aiPercentage: total > 0 ? Math.round((aiCount / total) * 100) : 0,
      avgAiScore,
      preAiPercentage: total > 0 ? Math.round((preAiCount / total) * 100) : 0,
      mbVerifiedPercentage:
        total > 0 ? Math.round((mbVerifiedCount / total) * 100) : 0,
      onlineDbMatchedCount,
      post2024Count,
      highVelocityCount,
      avgDurationSec,
      medianFollowers,
      databaseTotalIndexed: onlineDbCache.sourceCounts.totalUnique || 0,
    },
    tracks: analyzedTracks,
  };
}

/**
 * Return database payload for /api/database (with optional query filter & source breakdown)
 */
async function getDatabaseOverview(query = "", sourceFilter = "all", limit = 250) {
  const [db, communityReports] = await Promise.all([
    ensureOnlineAiDatabase(),
    fetchCloudCommunityReports(),
  ]);
  const q = normalizeArtistKey(query);

  // Convert shared community-flagged songs & artists into top-priority visible entries
  const communityEntries = communityReports.map((rep) => ({
    name: rep.isArtistFlag || !rep.title
      ? `${rep.artist || "Unknown Artist"} (Entire Artist Flagged)`
      : `${rep.artist || "Unknown Artist"} — "${rep.title}"`,
    artistName: rep.artist || "",
    trackTitle: rep.isArtistFlag ? "" : (rep.title || ""),
    isArtistFlag: Boolean(rep.isArtistFlag || !rep.title),
    platform: rep.platform || "Spotify",
    reason: `${rep.reason || "Flagged by user"} (Shared Community Flag)`,
    source: "Community Flagged",
    confidence: 95,
    createdAt: rep.createdAt,
  }));

  const all = [...communityEntries, ...(db.knownAiArtists || [])];

  const filtered = all.filter((item) => {
    if (sourceFilter && sourceFilter !== "all") {
      if (
        !String(item.source || "")
          .toLowerCase()
          .includes(sourceFilter.toLowerCase())
      ) {
        return false;
      }
    }
    if (!q) return true;
    return (
      normalizeArtistKey(item.name).includes(q) ||
      String(item.reason || "")
        .toLowerCase()
        .includes(q) ||
      String(item.spotifyId || "")
        .toLowerCase()
        .includes(q)
    );
  });

  const sources = {
    ...onlineDbCache.sourceCounts,
    community: communityEntries.length,
    totalUnique:
      (onlineDbCache.sourceCounts.totalUnique || 0) + communityEntries.length,
  };

  return {
    totalIndexed: all.length,
    matchedCount: filtered.length,
    lastSyncedAt: onlineDbCache.lastSyncedAt
      ? new Date(onlineDbCache.lastSyncedAt).toISOString()
      : null,
    sources,
    knownAiArtists: filtered.slice(0, limit),
    knownAiLabels: db.knownAiLabels || [],
    suspiciousDiyDistributors: db.suspiciousDiyDistributors || [],
    communityReports,
  };
}

module.exports = {
  analyzePlaylistTracks,
  loadAiDatabase,
  ensureOnlineAiDatabase,
  getDatabaseOverview,
  saveCommunityReport,
  removeCommunityReport,
};
