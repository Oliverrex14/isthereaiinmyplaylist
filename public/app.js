const analyzeForm = document.getElementById("analyzeForm");
const playlistUrlInput = document.getElementById("playlistUrlInput");
const clearInputBtn = document.getElementById("clearInputBtn");
const analyzeBtn = document.getElementById("analyzeBtn");

const errorAlert = document.getElementById("errorAlert");
const errorText = document.getElementById("errorText");
const loadingSection = document.getElementById("loadingSection");
const loadingBar = document.getElementById("loadingBar");
const loadingStep = document.getElementById("loadingStep");
const resultsSection = document.getElementById("resultsSection");

const playlistCoverWrap = document.getElementById("playlistCoverWrap");
const playlistPlatformBadge = document.getElementById("playlistPlatformBadge");
const playlistTitle = document.getElementById("playlistTitle");
const playlistSubtitle = document.getElementById("playlistSubtitle");

// 8 Telemetry cells
const statTotal = document.getElementById("statTotal");
const statAi = document.getElementById("statAi");
const statAiPct = document.getElementById("statAiPct");
const statSuspicious = document.getElementById("statSuspicious");
const statHuman = document.getElementById("statHuman");
const statAvgRisk = document.getElementById("statAvgRisk");
const statPreAi = document.getElementById("statPreAi");
const statMbVerified = document.getElementById("statMbVerified");
const statHighVelocity = document.getElementById("statHighVelocity");

const overallVerdictBanner = document.getElementById("overallVerdictBanner");
const verdictHeadline = document.getElementById("verdictHeadline");
const verdictDescription = document.getElementById("verdictDescription");
const verdictPercent = document.getElementById("verdictPercent");

const barSegAi = document.getElementById("barSegAi");
const barSegSuspicious = document.getElementById("barSegSuspicious");
const barSegHuman = document.getElementById("barSegHuman");
const statExtraTelemetry = document.getElementById("statExtraTelemetry");

const tabCountAll = document.getElementById("tabCountAll");
const tabCountAi = document.getElementById("tabCountAi");
const tabCountSuspicious = document.getElementById("tabCountSuspicious");
const tabCountHuman = document.getElementById("tabCountHuman");

const sortSelect = document.getElementById("sortSelect");
const trackFilterInput = document.getElementById("trackFilterInput");
const tracksList = document.getElementById("tracksList");
const previewAudioPlayer = document.getElementById("previewAudioPlayer");

// Modals
const reportModal = document.getElementById("reportModal");
const openReportBtn = document.getElementById("openReportBtn");
const closeReportModal = document.getElementById("closeReportModal");
const cancelReportBtn = document.getElementById("cancelReportBtn");
const reportForm = document.getElementById("reportForm");

const dbModal = document.getElementById("dbModal");
const openDbBtn = document.getElementById("openDbBtn");
const closeDbModal = document.getElementById("closeDbModal");
const dbModalContent = document.getElementById("dbModalContent");
const dbCountBadge = document.getElementById("dbCountBadge");

let currentTracks = [];
let activeFilter = "all";
let activeMode = "auto";
let activePlayingUrl = null;
const expandedRows = new Set();
const queryPrefix = document.getElementById("queryPrefix");

const MODE_CONFIG = {
  auto: {
    prefix: "TARGET //",
    placeholder:
      "Paste any playlist/track/artist link (Spotify, Apple, YouTube) or type an artist / song name...",
  },
  playlist: {
    prefix: "PLAYLIST //",
    placeholder:
      "https://open.spotify.com/playlist/... or music.apple.com/.../playlist/... or youtube.com/playlist?list=...",
  },
  track: {
    prefix: "TRACK //",
    placeholder:
      "Paste a Spotify / Apple / YouTube song link OR type 'Artist - Track Title'...",
  },
  artist: {
    prefix: "ARTIST //",
    placeholder:
      "Paste a Spotify / Apple / YouTube artist link OR type an artist name (e.g. The Velvet Sundown)...",
  },
};

function setInspectionMode(mode) {
  activeMode = mode || "auto";
  document.querySelectorAll(".mode-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-mode") === activeMode);
  });
  const cfg = MODE_CONFIG[activeMode] || MODE_CONFIG.auto;
  if (queryPrefix) queryPrefix.textContent = cfg.prefix;
  playlistUrlInput.placeholder = cfg.placeholder;
}

document.querySelectorAll(".mode-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    setInspectionMode(btn.getAttribute("data-mode"));
    playlistUrlInput.focus();
  });
});

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "--:--";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatCompactNumber(num) {
  if (num === null || num === undefined) return "N/A";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return String(num);
}

function getScoreColor(score) {
  if (score >= 68) return "#e5484d";
  if (score >= 38) return "#f59e0b";
  return "#30a46c";
}

playlistUrlInput.addEventListener("input", () => {
  if (playlistUrlInput.value.trim().length > 0) {
    clearInputBtn.classList.remove("hidden");
  } else {
    clearInputBtn.classList.add("hidden");
  }
});

clearInputBtn.addEventListener("click", () => {
  playlistUrlInput.value = "";
  clearInputBtn.classList.add("hidden");
  playlistUrlInput.focus();
});

document.querySelectorAll(".sample-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const url = btn.getAttribute("data-url");
    const sampleMode = btn.getAttribute("data-mode") || "auto";
    setInspectionMode(sampleMode);
    playlistUrlInput.value = url;
    clearInputBtn.classList.remove("hidden");
    runAnalysis(url, sampleMode);
  });
});

analyzeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = playlistUrlInput.value.trim();
  if (url) runAnalysis(url, activeMode);
});

async function runAnalysis(url, mode = activeMode) {
  errorAlert.classList.add("hidden");
  resultsSection.classList.add("hidden");
  loadingSection.classList.remove("hidden");
  analyzeBtn.disabled = true;

  previewAudioPlayer.pause();
  activePlayingUrl = null;
  expandedRows.clear();

  const steps = [
    { pct: 25, text: "Resolving target (playlist, single track, or artist catalog)..." },
    { pct: 52, text: "Cross-referencing MusicBrainz artist registry & known synthetic index..." },
    { pct: 78, text: "Calculating release velocity, single-to-album ratio & copyright strings (iTunes/Deezer)..." },
    { pct: 92, text: "Measuring audio stream byte entropy (H), zero-crossing rate & compiling report..." },
  ];

  let stepIdx = 0;
  loadingBar.style.width = "15%";
  const stepTimer = setInterval(() => {
    if (stepIdx < steps.length) {
      loadingBar.style.width = `${steps[stepIdx].pct}%`;
      loadingStep.textContent = steps[stepIdx].text;
      stepIdx++;
    }
  }, 650);

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, mode }),
    });

    const data = await res.json();
    clearInterval(stepTimer);

    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to inspect playlist.");
    }

    loadingBar.style.width = "100%";
    loadingSection.classList.add("hidden");
    renderResults(data);
  } catch (err) {
    clearInterval(stepTimer);
    loadingSection.classList.add("hidden");
    errorText.textContent = err.message;
    errorAlert.classList.remove("hidden");
  } finally {
    analyzeBtn.disabled = false;
  }
}

function renderResults(data) {
  currentTracks = data.tracks || [];
  activeFilter = "all";
  trackFilterInput.value = "";
  sortSelect.value = "index";

  // Automatically expand forensics metrics drawer when inspecting a single track!
  if (currentTracks.length === 1) {
    expandedRows.add(currentTracks[0].id);
  }

  document.querySelectorAll(".filter-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-filter") === "all");
  });

  playlistPlatformBadge.textContent = (data.platformName || data.platform || "PLAYLIST").toUpperCase();
  playlistTitle.textContent = data.title || "Untitled Playlist";
  playlistSubtitle.textContent = `${data.owner || "Public"} // ${data.summary.totalTracks} items`;

  if (data.coverUrl) {
    playlistCoverWrap.innerHTML = `<img src="${escapeHtml(data.coverUrl)}" alt="Cover" />`;
  } else {
    playlistCoverWrap.innerHTML = `<span class="thumb-fallback">RAW</span>`;
  }

  const s = data.summary;
  statTotal.textContent = s.totalTracks;
  statAi.textContent = s.aiCount;
  statAiPct.textContent = `${s.aiPercentage}% of playlist`;
  statSuspicious.textContent = s.suspiciousCount;
  statHuman.textContent = s.humanCount;
  statAvgRisk.textContent = `${s.avgAiScore}%`;
  statPreAi.textContent = `${s.preAiPercentage ?? 0}%`;
  statMbVerified.textContent = `${s.mbVerifiedPercentage ?? 0}%`;
  statHighVelocity.textContent = s.highVelocityCount ?? 0;

  tabCountAll.textContent = s.totalTracks;
  tabCountAi.textContent = s.aiCount;
  tabCountSuspicious.textContent = s.suspiciousCount;
  tabCountHuman.textContent = s.humanCount;

  // Composition bar segments
  const total = Math.max(1, s.totalTracks);
  const aiW = ((s.aiCount / total) * 100).toFixed(1);
  const warnW = ((s.suspiciousCount / total) * 100).toFixed(1);
  const safeW = ((s.humanCount / total) * 100).toFixed(1);

  barSegAi.style.width = `${aiW}%`;
  barSegSuspicious.style.width = `${warnW}%`;
  barSegHuman.style.width = `${safeW}%`;

  verdictPercent.textContent = `${s.aiPercentage}% FLAGGED AI (${s.aiCount}/${s.totalTracks}) // MEAN RISK: ${s.avgAiScore}%`;

  const avgDurFormatted = s.avgDurationSec
    ? `${Math.floor(s.avgDurationSec / 60)}:${String(s.avgDurationSec % 60).padStart(2, "0")}`
    : "N/A";
  statExtraTelemetry.textContent = `MEDIAN FOLLOWERS: ${formatCompactNumber(
    s.medianFollowers
  )} // MEAN DURATION: ${avgDurFormatted} // POST-2024 DEBUTS: ${s.post2024Count ?? 0}`;

  // Verdict Banner
  overallVerdictBanner.className = "verdict-summary-box";
  if (s.aiCount > 0) {
    overallVerdictBanner.classList.add("status-danger");
    verdictHeadline.textContent = `${s.aiCount} SYNTHETIC / AI TRACK${s.aiCount === 1 ? "" : "S"} DETECTED`;
    verdictDescription.textContent =
      s.suspiciousCount > 0
        ? `Plus ${s.suspiciousCount} unverified track(s) showing post-2024 high-velocity single patterns.`
        : "Flagged items match known synthetic generators (Suno/Udio) or confirmed AI artist catalogs.";
  } else if (s.suspiciousCount > 0) {
    overallVerdictBanner.classList.add("status-warn");
    verdictHeadline.textContent = `0 CONFIRMED AI // ${s.suspiciousCount} UNVERIFIED / SUSPICIOUS`;
    verdictDescription.textContent =
      "No explicit AI tags, but several tracks lack pre-2024 history or MusicBrainz records.";
  } else {
    overallVerdictBanner.classList.add("status-safe");
    verdictHeadline.textContent = "100% VERIFIED HUMAN CATALOG";
    verdictDescription.textContent =
      "All tracks passed discography timeline, MusicBrainz registry, and release cadence checks.";
  }

  renderTracksList();
  resultsSection.classList.remove("hidden");
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getSortedAndFilteredTracks() {
  const query = trackFilterInput.value.trim().toLowerCase();
  const sortMode = sortSelect.value;

  const filtered = currentTracks.filter((t) => {
    if (activeFilter !== "all" && t.verdict !== activeFilter) return false;
    if (query) {
      const hay = `${t.title} ${t.artist} ${t.channelName || ""} ${
        t.forensics?.primaryDistributor || ""
      }`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  return filtered.sort((a, b) => {
    if (sortMode === "risk-desc") return b.aiProbability - a.aiProbability;
    if (sortMode === "risk-asc") return a.aiProbability - b.aiProbability;
    if (sortMode === "velocity-desc") {
      return (
        (b.forensics?.releasesLast12Mo || 0) -
        (a.forensics?.releasesLast12Mo || 0)
      );
    }
    if (sortMode === "fans-asc") {
      const fa = a.forensics?.deezerFans ?? 999999999;
      const fb = b.forensics?.deezerFans ?? 999999999;
      return fa - fb;
    }
    return a.index - b.index;
  });
}

function renderTracksList() {
  const rows = getSortedAndFilteredTracks();

  if (rows.length === 0) {
    tracksList.innerHTML = `
      <div style="padding: 28px; text-align: center; font-family: var(--mono); font-size: 0.8rem; color: var(--text-muted);">
        NO TRACKS MATCH CURRENT FILTER CRITERIA.
      </div>
    `;
    return;
  }

  tracksList.innerHTML = rows
    .map((track) => {
      const f = track.forensics || {};
      const sub = track.subScores || {};
      const color = getScoreColor(track.aiProbability);
      const dur = formatDuration(track.durationMs);
      const isExpanded = expandedRows.has(track.id);

      const debutStr = f.earliestYear ? String(f.earliestYear) : "UNLISTED";
      const spanStr = f.careerSpanYears
        ? `${f.careerSpanYears} yr span`
        : "No prior catalog";

      const velocityStr = `${f.releasesLast12Mo ?? 0} rel / 12m`;
      const cadenceStr = f.releaseCadencePerYear
        ? `${f.releaseCadencePerYear}/yr avg`
        : "N/A";

      const singleRatioStr =
        f.singleToAlbumRatio !== null && f.singleToAlbumRatio !== undefined
          ? `${f.singleToAlbumRatio}% singles`
          : "N/A";
      const catalogSubStr = `${f.singleCount ?? 0}S / ${f.albumCount ?? 0}A`;

      const followersStr = formatCompactNumber(f.deezerFans);
      const rankStr = f.deezerTrackRank
        ? `Rank ${formatCompactNumber(f.deezerTrackRank)}`
        : `${f.deezerAlbums ?? 0} releases`;

      const registryStr = f.musicBrainzVerified ? "MB VERIFIED" : "UNVERIFIED";
      const registrySubStr = f.musicBrainzVerified
        ? `${f.mbType || "Artist"}${f.mbCountry ? " · " + f.mbCountry : ""}`
        : "No MBID entry";

      const signalsHtml = (track.signals || [])
        .map(
          (sig) => `
          <span class="sig-tag ${escapeHtml(sig.type)}">
            <strong>[${escapeHtml(sig.category)}]</strong> ${escapeHtml(sig.text)}
          </span>
        `
        )
        .join("");

      const previewBtnHtml = track.previewUrl
        ? `<button type="button" class="play-btn" data-preview="${escapeHtml(
            track.previewUrl
          )}" title="Play 30s audio sample">▶</button>`
        : `<span class="play-btn" style="opacity:0.3;cursor:default" title="No audio stream available">–</span>`;

      return `
        <div class="track-row-wrap row-${escapeHtml(track.verdict)}" data-track-id="${escapeHtml(track.id)}">
          <div class="track-row">
            <div class="col-idx cell-mono">#${String(track.index).padStart(2, "0")}</div>

            <div class="col-track track-Identity">
              ${previewBtnHtml}
              <div style="min-width:0">
                <div style="display:flex;align-items:center;gap:6px">
                  <a href="${escapeHtml(track.externalUrl)}" target="_blank" rel="noopener" class="track-title-link">
                    ${escapeHtml(track.title)}
                  </a>
                  <span class="cell-mono" style="font-size:0.68rem">(${dur})</span>
                </div>
                <div class="track-artist-line">
                  ${escapeHtml(track.artist)}
                  <span style="color:var(--text-muted)"> // ${escapeHtml(f.primaryDistributor || "Unlisted Label")}</span>
                </div>
              </div>
            </div>

            <div class="col-debut cell-mono">
              <span style="color:${f.verifiedPreAiEra ? "var(--safe)" : f.earliestYear >= 2024 ? "var(--warn)" : "var(--text-primary)"}">
                ${escapeHtml(debutStr)}
              </span>
              <span class="cell-sub">${escapeHtml(spanStr)}</span>
            </div>

            <div class="col-cadence cell-mono">
              <span style="color:${(f.releasesLast12Mo || 0) >= 12 ? "var(--danger)" : "var(--text-primary)"}">
                ${escapeHtml(velocityStr)}
              </span>
              <span class="cell-sub">${escapeHtml(cadenceStr)}</span>
            </div>

            <div class="col-catalog cell-mono">
              <span>${escapeHtml(singleRatioStr)}</span>
              <span class="cell-sub">${escapeHtml(catalogSubStr)}</span>
            </div>

            <div class="col-audience cell-mono">
              <span>${escapeHtml(followersStr)}</span>
              <span class="cell-sub">${escapeHtml(rankStr)}</span>
            </div>

            <div class="col-registry cell-mono">
              <span style="color:${f.musicBrainzVerified ? "var(--safe)" : "var(--text-muted)"}">
                ${escapeHtml(registryStr)}
              </span>
              <span class="cell-sub">${escapeHtml(registrySubStr)}</span>
            </div>

            <div class="col-risk risk-cell">
              <div class="risk-top">
                <span style="color:${color}">${track.aiProbability}%</span>
                <span style="font-size:0.64rem;color:${color}">${escapeHtml(track.verdictLabel)}</span>
              </div>
              <div class="risk-bar">
                <div class="risk-fill" style="width:${track.aiProbability}%;background:${color}"></div>
              </div>
            </div>

            <div class="col-actions action-group">
              <button type="button" class="inspect-btn" data-toggle-id="${escapeHtml(track.id)}">
                ${isExpanded ? "HIDE" : "METRICS"}
              </button>
              <button
                type="button"
                class="flag-btn"
                data-artist="${escapeHtml(track.artist)}"
                data-title="${escapeHtml(track.title)}"
                title="Submit to synthetic database"
              >
                FLAG
              </button>
            </div>
          </div>

          <div class="signals-strip">
            ${signalsHtml}
          </div>

          <div id="drawer-${escapeHtml(track.id)}" class="forensics-drawer ${isExpanded ? "" : "hidden"}">
            <div class="drawer-col">
              <div class="drawer-heading">SUB-VECTOR RISK SCORES</div>
              <div class="drawer-kv"><span>Metadata / Tags:</span><strong>${sub.metadataScore ?? 0}/100</strong></div>
              <div class="drawer-kv"><span>Catalog Velocity:</span><strong>${sub.catalogVelocityScore ?? 0}/100</strong></div>
              <div class="drawer-kv"><span>Footprint Deficit:</span><strong>${sub.footprintRiskScore ?? 0}/100</strong></div>
              <div class="drawer-kv"><span>Distribution Risk:</span><strong>${sub.distributionRiskScore ?? 0}/100</strong></div>
            </div>

            <div class="drawer-col">
              <div class="drawer-heading">DISCOGRAPHY METRICS</div>
              <div class="drawer-kv"><span>First Release Year:</span><strong>${f.earliestYear || "N/A"}</strong></div>
              <div class="drawer-kv"><span>Latest Release Year:</span><strong>${f.latestYear || "N/A"}</strong></div>
              <div class="drawer-kv"><span>Avg Tracks / Release:</span><strong>${f.avgTrackCountPerRelease ?? "N/A"}</strong></div>
              <div class="drawer-kv"><span>Singles vs Albums:</span><strong>${f.singleCount ?? 0} / ${f.albumCount ?? 0}</strong></div>
            </div>

            <div class="drawer-col">
              <div class="drawer-heading">REGISTRY &amp; LICENSING</div>
              <div class="drawer-kv"><span>MusicBrainz Match:</span><strong>${f.musicBrainzVerified ? "Yes (" + (f.mbType || "Entity") + ")" : "No"}</strong></div>
              <div class="drawer-kv"><span>Origin / Area:</span><strong>${escapeHtml(f.mbCountry || "Unlisted")}</strong></div>
              <div class="drawer-kv"><span>Distributor / ℗:</span><strong>${escapeHtml(f.primaryDistributor || "Unlisted")}</strong></div>
              <div class="drawer-kv"><span>Deezer Followers:</span><strong>${f.deezerFans !== null ? f.deezerFans.toLocaleString("en-US") : "Unlisted"}</strong></div>
            </div>

            <div class="drawer-col">
              <div class="drawer-heading">AUDIO STREAM TELEMETRY</div>
              <div class="drawer-kv"><span>Duration Sec:</span><strong>${f.durationSeconds ? f.durationSeconds + "s" : "N/A"}</strong></div>
              <div class="drawer-kv"><span>2m/4m AI Window:</span><strong>${f.matchesGeneratorWindow ? "MATCH (Yes)" : "No"}</strong></div>
              <div class="drawer-kv"><span>Shannon Entropy (H):</span><strong>${f.shannonEntropy ? f.shannonEntropy + " b/B" : "No stream"}</strong></div>
              <div class="drawer-kv"><span>Zero-Crossing / σ²:</span><strong>${f.zeroCrossRatio ? f.zeroCrossRatio + " / " + f.byteVariance : "N/A"}</strong></div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  // Bind audio preview buttons
  tracksList.querySelectorAll("button.play-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-preview");
      if (!url) return;
      if (activePlayingUrl === url && !previewAudioPlayer.paused) {
        previewAudioPlayer.pause();
        btn.textContent = "▶";
        activePlayingUrl = null;
      } else {
        document.querySelectorAll("button.play-btn").forEach((b) => (b.textContent = "▶"));
        previewAudioPlayer.src = url;
        previewAudioPlayer.play();
        btn.textContent = "⏸";
        activePlayingUrl = url;
      }
    });
  });

  // Bind drawer toggle buttons
  tracksList.querySelectorAll(".inspect-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-toggle-id");
      const drawer = document.getElementById(`drawer-${id}`);
      if (!drawer) return;
      if (expandedRows.has(id)) {
        expandedRows.delete(id);
        drawer.classList.add("hidden");
        btn.textContent = "METRICS";
      } else {
        expandedRows.add(id);
        drawer.classList.remove("hidden");
        btn.textContent = "HIDE";
      }
    });
  });

  // Bind flag buttons
  tracksList.querySelectorAll(".flag-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("reportArtist").value = btn.getAttribute("data-artist") || "";
      document.getElementById("reportTitle").value = btn.getAttribute("data-title") || "";
      reportModal.classList.remove("hidden");
    });
  });
}

document.querySelectorAll(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeFilter = tab.getAttribute("data-filter");
    renderTracksList();
  });
});

trackFilterInput.addEventListener("input", renderTracksList);
sortSelect.addEventListener("change", renderTracksList);

// Modals
openReportBtn.addEventListener("click", () => reportModal.classList.remove("hidden"));
closeReportModal.addEventListener("click", () => reportModal.classList.add("hidden"));
cancelReportBtn.addEventListener("click", () => reportModal.classList.add("hidden"));

reportForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    artist: document.getElementById("reportArtist").value.trim(),
    title: document.getElementById("reportTitle").value.trim(),
    platform: document.getElementById("reportPlatform").value,
    reason: document.getElementById("reportReason").value.trim(),
  };

  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      reportForm.reset();
      reportModal.classList.add("hidden");
      await refreshDatabaseBadge();
      if (playlistUrlInput.value.trim()) {
        runAnalysis(playlistUrlInput.value.trim());
      }
    }
  } catch {
    // ignore
  }
});

openDbBtn.addEventListener("click", async () => {
  dbModal.classList.remove("hidden");
  await loadDatabaseModal();
});
closeDbModal.addEventListener("click", () => dbModal.classList.add("hidden"));

async function refreshDatabaseBadge() {
  try {
    const res = await fetch("/api/database");
    const db = await res.json();
    dbCountBadge.textContent = (db.knownAiArtists || []).length;
  } catch {
    // ignore
  }
}

async function loadDatabaseModal() {
  dbModalContent.innerHTML = `<p style="font-family:var(--mono);font-size:0.78rem;color:var(--text-muted)">Loading index...</p>`;
  try {
    const res = await fetch("/api/database");
    const db = await res.json();
    const list = db.knownAiArtists || [];
    dbCountBadge.textContent = list.length;

    dbModalContent.innerHTML = list
      .map(
        (item) => `
        <div class="db-item">
          <div>
            <div class="db-item-title">${escapeHtml(item.name)}</div>
            <div class="db-item-reason">${escapeHtml(item.reason)}</div>
          </div>
          <span class="mono-tag">${escapeHtml(item.platform)}</span>
        </div>
      `
      )
      .join("");
  } catch {
    dbModalContent.innerHTML = `<p style="color:var(--danger)">Failed to load index.</p>`;
  }
}

refreshDatabaseBadge();
