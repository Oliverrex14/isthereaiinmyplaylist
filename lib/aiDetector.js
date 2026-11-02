const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "ai_database.json");

// Caches for fast scanning across playlists
const artistCache = new Map();
const trackLookupCache = new Map();

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

function saveCommunityReport(report) {
  const db = loadAiDatabase();
  const entry = {
    id: `rep-${Date.now()}`,
    artist: (report.artist || "").trim(),
    title: (report.title || "").trim(),
    platform: report.platform || "Other",
    reason: (report.reason || "Flagged by user submission").trim(),
    createdAt: new Date().toISOString(),
  };

  db.communityReports.push(entry);

  const exists = db.knownAiArtists.some(
    (a) => a.name.toLowerCase() === entry.artist.toLowerCase()
  );
  if (!exists && entry.artist) {
    db.knownAiArtists.push({
      name: entry.artist,
      platform: entry.platform,
      reason: `User submission: ${entry.reason}`,
      confidence: 88,
    });
  }

  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
  } catch {
    // On read-only serverless filesystems (e.g. Vercel), keep in-memory for the instance lifetime
  }
  artistCache.clear();
  trackLookupCache.clear();
  return entry;
}

function getPrimaryArtist(artistStr) {
  if (!artistStr) return "";
  return artistStr
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\bwith\b/i)[0]
    .trim();
}

/**
 * 1. Keyword & Naming Heuristics
 */
function analyzeKeywords(track) {
  const signals = [];
  let score = 0;

  const combinedText = `${track.title || ""} ${track.rawTitle || ""} ${
    track.artist || ""
  } ${track.channelName || ""}`.toLowerCase();

  const directAiPatterns = [
    {
      regex: /\bsuno(\s*ai|\s*v3|\s*v3\.5|\s*v4)?\b/i,
      label: "Explicit Suno generator reference in metadata",
      points: 85,
    },
    {
      regex: /\budio(\s*ai)?\b/i,
      label: "Explicit Udio generator reference in metadata",
      points: 85,
    },
    {
      regex:
        /\b(ai\s*cover|ai\s*version|ai\s*generated|ai\s*song|ai\s*music|ai\s*voice|ai\s*remix|ai\s*vocals)\b/i,
      label: "Explicit AI generation tag in title",
      points: 85,
    },
    {
      regex:
        /\b(rvc\s*v2|sovits|kits\.ai|elevenlabs|boomy|mubert|riffusion|aiva|soundraw)\b/i,
      label: "Voice clone or synthetic audio model mentioned",
      points: 80,
    },
    {
      regex: /\[ai\]|\(ai\)/i,
      label: "Tagged with [AI] / (AI) marker",
      points: 85,
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
    /\b(lofi|lo-fi|chillhop|synthwave|sleep|ambient|study|relaxing)\s+(ai|beats\s+ai|bot|generator)\b/i,
    /\bai\s+(records|studios|collective|orchestra|ensemble|band|project)\b/i,
  ];
  for (const pat of genericArtistPatterns) {
    if (pat.test(track.artist || "")) {
      score += 45;
      signals.push({
        type: "warning",
        category: "NAME",
        text: `Artist name "${track.artist}" matches synthetic project naming convention`,
      });
    }
  }

  return { score, signals };
}

/**
 * 2. Known Synthetic Index & Community Submissions
 */
function analyzeDatabase(track, db) {
  const signals = [];
  let score = 0;
  let matchedDbEntry = null;

  const primaryArtist = getPrimaryArtist(track.artist).toLowerCase();
  const fullArtist = (track.artist || "").toLowerCase();
  const channel = (track.channelName || "").toLowerCase();
  const title = (track.title || "").toLowerCase();

  for (const item of db.knownAiArtists || []) {
    const target = item.name.toLowerCase();
    if (
      primaryArtist === target ||
      fullArtist.includes(target) ||
      (channel && channel === target)
    ) {
      score += item.confidence || 90;
      matchedDbEntry = item.name;
      signals.push({
        type: "danger",
        category: "INDEX",
        text: `Matched in known synthetic artist index (${item.reason})`,
      });
      break;
    }
  }

  for (const rep of db.communityReports || []) {
    const repArtist = (rep.artist || "").toLowerCase();
    const repTitle = (rep.title || "").toLowerCase();
    if (
      (repArtist &&
        (primaryArtist === repArtist || fullArtist.includes(repArtist))) ||
      (repTitle && title === repTitle)
    ) {
      score += 75;
      signals.push({
        type: "danger",
        category: "REPORT",
        text: `Flagged in user database: ${rep.reason}`,
      });
      break;
    }
  }

  return { score, signals, matchedDbEntry };
}

/**
 * 3. Deep Artist & Catalog Forensics (Deezer + iTunes + MusicBrainz)
 */
async function fetchArtistForensics(artistName, db) {
  const primary = getPrimaryArtist(artistName);
  const cacheKey = primary.toLowerCase();
  if (
    !primary ||
    primary === "unknown artist" ||
    primary === "unknown channel"
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
        releasesLast12Mo: 0,
        releaseCadencePerYear: 0,
        singleToAlbumRatio: null,
        singleCount: 0,
        albumCount: 0,
        avgTrackCountPerRelease: null,
        primaryDistributor: "Unknown",
        musicBrainzVerified: false,
        mbType: null,
        mbCountry: null,
        verifiedPreAiEra: false,
      },
    };
  }

  if (artistCache.has(cacheKey)) {
    return artistCache.get(cacheKey);
  }

  const signals = [];
  let scoreDelta = 0;

  const forensics = {
    deezerFans: null,
    deezerAlbums: null,
    earliestYear: null,
    latestYear: null,
    careerSpanYears: 0,
    releasesLast12Mo: 0,
    releaseCadencePerYear: 0,
    singleToAlbumRatio: null, // % of releases that are 1-2 track singles
    singleCount: 0,
    albumCount: 0,
    avgTrackCountPerRelease: null,
    primaryDistributor: "Independent / Unlisted",
    copyrightSample: null,
    musicBrainzVerified: false,
    mbType: null,
    mbCountry: null,
    mbDisambiguation: null,
    verifiedPreAiEra: false,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const [deezerRes, itunesRes, mbRes] = await Promise.allSettled([
      fetch(
        `https://api.deezer.com/search/artist?q=${encodeURIComponent(
          primary
        )}&limit=3`,
        { signal: controller.signal }
      ).then((r) => (r.ok ? r.json() : null)),
      fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(
          primary
        )}&entity=album&limit=50`,
        { signal: controller.signal }
      ).then((r) => (r.ok ? r.json() : null)),
      fetch(
        `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(
          `"${primary}"`
        )}&fmt=json&limit=3`,
        {
          headers: {
            "User-Agent":
              "IsThereAIInMyPlaylist/2.0 (https://github.com/Oliverrex14/isthereaiinmyplaylist)",
          },
          signal: controller.signal,
        }
      ).then((r) => (r.ok ? r.json() : null)),
    ]);

    clearTimeout(timeout);

    // 1. Deezer Listener & Album Footprint
    if (
      deezerRes.status === "fulfilled" &&
      deezerRes.value?.data?.length > 0
    ) {
      const exactMatch =
        deezerRes.value.data.find(
          (a) => a.name.toLowerCase() === primary.toLowerCase()
        ) || deezerRes.value.data[0];

      if (exactMatch) {
        forensics.deezerFans = exactMatch.nb_fan ?? 0;
        forensics.deezerAlbums = exactMatch.nb_album ?? 0;
      }
    }

    // 2. MusicBrainz Human/Band Registry Check
    if (
      mbRes.status === "fulfilled" &&
      Array.isArray(mbRes.value?.artists) &&
      mbRes.value.artists.length > 0
    ) {
      const mbArtist = mbRes.value.artists.find(
        (a) =>
          a.name?.toLowerCase() === primary.toLowerCase() &&
          (a.score === undefined || Number(a.score) >= 90)
      );
      if (mbArtist) {
        forensics.musicBrainzVerified = true;
        forensics.mbType = mbArtist.type || "Entity";
        forensics.mbCountry = mbArtist.country || mbArtist.area?.name || null;
        forensics.mbDisambiguation = mbArtist.disambiguation || null;
      }
    }

    // 3. iTunes Discography, Single-to-Album Ratio, Velocity & Copyrights
    if (
      itunesRes.status === "fulfilled" &&
      itunesRes.value?.results?.length > 0
    ) {
      const artistReleases = itunesRes.value.results.filter(
        (r) =>
          r.artistName &&
          r.artistName.toLowerCase().includes(primary.toLowerCase())
      );

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
        // Clean up copyright string to extract primary label/distributor
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

    // --- Evaluate Forensic Signals ---
    const copyrightBlob = (forensics.copyrightSample || "").toLowerCase();

    // Check known AI labels in copyright
    for (const aiLabel of db.knownAiLabels || []) {
      if (new RegExp(`\\b${aiLabel}\\b`, "i").test(copyrightBlob)) {
        scoreDelta += 75;
        signals.push({
          type: "danger",
          category: "LICENSE",
          text: `Copyright line credits synthetic generator "${aiLabel}"`,
        });
        break;
      }
    }

    // Check Pre-AI Era History
    if (forensics.earliestYear && forensics.earliestYear <= 2022) {
      forensics.verifiedPreAiEra = true;
      scoreDelta -= 28;
      signals.push({
        type: "safe",
        category: "TIMELINE",
        text: `Catalog dates back to ${forensics.earliestYear} (${forensics.careerSpanYears} yr active span, pre-AI era)`,
      });
    } else if (forensics.earliestYear && forensics.earliestYear >= 2024) {
      if (forensics.releasesLast12Mo >= 12) {
        scoreDelta += 42;
        signals.push({
          type: "danger",
          category: "VELOCITY",
          text: `High-frequency output: debuted ${forensics.earliestYear} with ${forensics.releasesLast12Mo} releases in 12 months`,
        });
      } else {
        scoreDelta += 14;
        signals.push({
          type: "warning",
          category: "TIMELINE",
          text: `First indexed release is from ${forensics.earliestYear} (post-generative AI boom)`,
        });
      }
    }

    // Single-to-Album Farm Ratio (AI farms almost exclusively drop 1-track singles)
    if (
      !forensics.verifiedPreAiEra &&
      forensics.singleToAlbumRatio !== null &&
      forensics.singleToAlbumRatio >= 88 &&
      forensics.singleCount >= 8
    ) {
      scoreDelta += 22;
      signals.push({
        type: "warning",
        category: "CATALOG",
        text: `${forensics.singleToAlbumRatio}% single-only release pattern (${forensics.singleCount} singles, ${forensics.albumCount} albums)`,
      });
    }

    // MusicBrainz verification
    if (forensics.musicBrainzVerified) {
      scoreDelta -= 12;
      signals.push({
        type: "safe",
        category: "REGISTRY",
        text: `Indexed in MusicBrainz (${forensics.mbType}${
          forensics.mbCountry ? `, ${forensics.mbCountry}` : ""
        })`,
      });
    } else if (!forensics.verifiedPreAiEra) {
      scoreDelta += 12;
      signals.push({
        type: "warning",
        category: "REGISTRY",
        text: "Unlisted in MusicBrainz open music encyclopedia",
      });
    }

    // Listener-to-Catalog anomaly
    if (forensics.deezerFans !== null) {
      if (forensics.deezerFans >= 15000) {
        scoreDelta -= 22;
        signals.push({
          type: "safe",
          category: "AUDIENCE",
          text: `Established audience (${forensics.deezerFans.toLocaleString(
            "en-US"
          )} indexed Deezer followers)`,
        });
      } else if (forensics.deezerFans < 80 && forensics.deezerAlbums >= 15) {
        scoreDelta += 36;
        signals.push({
          type: "danger",
          category: "ANOMALY",
          text: `Disproportionate catalog: ${forensics.deezerAlbums} releases vs. ${forensics.deezerFans} followers`,
        });
      } else if (forensics.deezerFans < 25) {
        scoreDelta += 15;
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
      scoreDelta += 24;
      signals.push({
        type: "warning",
        category: "IDENTITY",
        text: `Artist "${primary}" has zero cross-platform catalog records`,
      });
    }

    // DIY Distributor check on new low-following profiles
    if (
      !forensics.verifiedPreAiEra &&
      (forensics.deezerFans === null || forensics.deezerFans < 300) &&
      copyrightBlob
    ) {
      const matchedDiy = (db.suspiciousDiyDistributors || []).find((dist) =>
        copyrightBlob.includes(dist.toLowerCase())
      );
      if (matchedDiy || /\d{5,}\s*records\s*dk/i.test(copyrightBlob)) {
        forensics.primaryDistributor = matchedDiy || "Records DK (DistroKid)";
        scoreDelta += 18;
        signals.push({
          type: "warning",
          category: "DISTRIBUTOR",
          text: `Self-service distribution (${forensics.primaryDistributor}) with no pre-2024 history`,
        });
      }
    }
  } catch {
    // Fallback if offline or rate-limited
  }

  const out = { scoreDelta, signals, forensics };
  artistCache.set(cacheKey, out);
  return out;
}

/**
 * 4. Track-Level Lookup (Deezer Track API for BPM, Gain, Rank & Fallback Preview)
 */
async function fetchTrackLevelMetrics(track) {
  const primary = getPrimaryArtist(track.artist);
  const cleanTitle = (track.title || "")
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .trim();
  const key = `${primary.toLowerCase()}:::${cleanTitle.toLowerCase()}`;

  if (trackLookupCache.has(key)) {
    return trackLookupCache.get(key);
  }

  const metrics = {
    deezerRank: null,
    bpm: null,
    gainDb: null,
    isrcCountry: null,
    fallbackPreviewUrl: null,
  };

  if (!primary || !cleanTitle) return metrics;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
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

  trackLookupCache.set(key, metrics);
  return metrics;
}

/**
 * 5. Audio Stream & Duration Telemetry
 */
async function analyzeAudioTelemetry(track, isSuspectOrNew) {
  const signals = [];
  let scoreDelta = 0;
  const audioTelemetry = {
    durationSeconds: track.durationMs ? Math.round(track.durationMs / 1000) : null,
    matchesGeneratorWindow: false,
    sampleBytes: null,
    shannonEntropy: null,
    byteVariance: null,
    zeroCrossRatio: null,
  };

  if (audioTelemetry.durationSeconds) {
    const sec = audioTelemetry.durationSeconds;
    // Suno v3/v3.5/v4 typical generation windows (1:57-2:03, 3:57-4:03)
    if ((sec >= 117 && sec <= 123) || (sec >= 237 && sec <= 243)) {
      audioTelemetry.matchesGeneratorWindow = true;
      if (isSuspectOrNew) {
        scoreDelta += 9;
        signals.push({
          type: "warning",
          category: "DURATION",
          text: `Duration (${Math.floor(sec / 60)}:${String(sec % 60).padStart(
            2,
            "0"
          )}) aligns with standard 2:00 / 4:00 AI model window`,
        });
      }
    }
  }

  if (track.previewUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
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
            if (i > 0 && (buf[i] >= 128) !== (buf[i - 1] >= 128)) {
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
 * Full Multi-Metric Track Analysis
 */
async function analyzeTrack(track, db) {
  let rawScore = 10;
  const allSignals = [];

  // 1. Keywords & Naming
  const kwResult = analyzeKeywords(track);
  rawScore += kwResult.score;
  allSignals.push(...kwResult.signals);

  // 2. Database & Submissions
  const dbResult = analyzeDatabase(track, db);
  rawScore += dbResult.score;
  allSignals.push(...dbResult.signals);

  // 3. Artist & Catalog Forensics + Track Lookup
  const [artistIntel, trackMetrics] = await Promise.all([
    fetchArtistForensics(track.artist, db),
    fetchTrackLevelMetrics(track),
  ]);

  if (!track.previewUrl && trackMetrics.fallbackPreviewUrl) {
    track.previewUrl = trackMetrics.fallbackPreviewUrl;
  }

  if (kwResult.score >= 70 || dbResult.score >= 70) {
    rawScore += Math.max(0, artistIntel.scoreDelta);
  } else {
    rawScore += artistIntel.scoreDelta;
  }
  allSignals.push(...artistIntel.signals);

  // 4. Audio Stream & Duration Telemetry
  const isSuspectOrNew =
    !artistIntel.forensics?.verifiedPreAiEra || rawScore >= 35;
  const audioResult = await analyzeAudioTelemetry(track, isSuspectOrNew);
  rawScore += audioResult.scoreDelta;
  allSignals.push(...audioResult.signals);

  const aiProbability = Math.max(2, Math.min(99, Math.round(rawScore)));

  // Compute sub-vector scores (0-100) for detailed breakdown
  const f = artistIntel.forensics;
  const subScores = {
    metadataScore: Math.min(100, kwResult.score + dbResult.score),
    catalogVelocityScore: f.verifiedPreAiEra
      ? 5
      : Math.min(
          100,
          (f.releasesLast12Mo >= 12 ? 75 : f.releasesLast12Mo * 5) +
            (f.singleToAlbumRatio && f.singleToAlbumRatio >= 85 ? 25 : 0)
        ),
    footprintRiskScore:
      f.deezerFans !== null && f.deezerFans >= 10000
        ? 4
        : f.deezerFans !== null && f.deezerFans < 50
        ? 82
        : f.musicBrainzVerified
        ? 18
        : 64,
    distributionRiskScore:
      dbResult.score >= 80
        ? 95
        : f.verifiedPreAiEra
        ? 8
        : f.primaryDistributor.includes("DistroKid") ||
          f.primaryDistributor.includes("Records DK")
        ? 68
        : 25,
  };

  let verdict = "human";
  let verdictLabel = "VERIFIED HUMAN";

  if (aiProbability >= 68) {
    verdict = "ai";
    verdictLabel = "FLAGGED AI";
  } else if (aiProbability >= 38) {
    verdict = "suspicious";
    verdictLabel = "UNVERIFIED / SUSPECT";
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
      ...artistIntel.forensics,
      deezerTrackRank: trackMetrics.deezerRank,
      ...audioResult.audioTelemetry,
    },
  };
}

/**
 * Analyze all tracks in playlist and compute aggregate playlist telemetry
 */
async function analyzePlaylistTracks(playlist) {
  const db = loadAiDatabase();
  const tracks = playlist.tracks || [];
  const analyzedTracks = [];

  const batchSize = 6;
  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((t) => analyzeTrack(t, db))
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
      post2024Count,
      highVelocityCount,
      avgDurationSec,
      medianFollowers,
    },
    tracks: analyzedTracks,
  };
}

module.exports = {
  analyzePlaylistTracks,
  loadAiDatabase,
  saveCommunityReport,
};
