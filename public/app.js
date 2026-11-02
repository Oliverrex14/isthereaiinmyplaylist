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

const statTotal = document.getElementById("statTotal");
const statAi = document.getElementById("statAi");
const statSuspicious = document.getElementById("statSuspicious");
const statHuman = document.getElementById("statHuman");

const overallVerdictBanner = document.getElementById("overallVerdictBanner");
const verdictEmoji = document.getElementById("verdictEmoji");
const verdictHeadline = document.getElementById("verdictHeadline");
const verdictDescription = document.getElementById("verdictDescription");
const verdictPercent = document.getElementById("verdictPercent");
const verdictBarFill = document.getElementById("verdictBarFill");

const tabCountAll = document.getElementById("tabCountAll");
const tabCountAi = document.getElementById("tabCountAi");
const tabCountSuspicious = document.getElementById("tabCountSuspicious");
const tabCountHuman = document.getElementById("tabCountHuman");

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
let activePlayingUrl = null;

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function getScoreColor(score) {
  if (score >= 68) return "#ef4444";
  if (score >= 38) return "#f59e0b";
  return "#10b981";
}

// Show/hide clear button
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

// Preset chips
document.querySelectorAll(".preset-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const url = chip.getAttribute("data-url");
    playlistUrlInput.value = url;
    clearInputBtn.classList.remove("hidden");
    runAnalysis(url);
  });
});

// Analyze form submit
analyzeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = playlistUrlInput.value.trim();
  if (url) {
    runAnalysis(url);
  }
});

async function runAnalysis(url) {
  errorAlert.classList.add("hidden");
  resultsSection.classList.add("hidden");
  loadingSection.classList.remove("hidden");
  analyzeBtn.disabled = true;

  // Stop any playing audio
  previewAudioPlayer.pause();
  activePlayingUrl = null;

  const steps = [
    { pct: 25, text: "Připojuji se k platformě a načítám seznam skladeb..." },
    { pct: 55, text: "Kontroluji klíčová slova (Suno, Udio, RVC) a databázi AI interpretů..." },
    { pct: 82, text: "Ověřuji historii interpretů, komunitu a frekvenci vydávání (Deezer & iTunes API)..." },
    { pct: 94, text: "Vyhodnocuji audio vzorky a počítám výsledné AI skóre..." },
  ];

  let stepIdx = 0;
  loadingBar.style.width = "18%";
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
      body: JSON.stringify({ url }),
    });

    const data = await res.json();
    clearInterval(stepTimer);

    if (!res.ok || data.error) {
      throw new Error(data.error || "Nepodařilo se zanalyzovat playlist.");
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

  // Update active tab UI
  document.querySelectorAll(".filter-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-filter") === "all");
  });

  // Header metadata
  playlistPlatformBadge.textContent = data.platformName || data.platform;
  playlistTitle.textContent = data.title || "Playlist";
  playlistSubtitle.textContent = `${data.owner || ""} • ${data.summary.totalTracks} skladeb`;

  if (data.coverUrl) {
    playlistCoverWrap.innerHTML = `<img src="${escapeHtml(data.coverUrl)}" alt="Cover" />`;
  } else {
    playlistCoverWrap.innerHTML = `<span class="cover-placeholder">🎵</span>`;
  }

  // Stats
  const s = data.summary;
  statTotal.textContent = s.totalTracks;
  statAi.textContent = s.aiCount;
  statSuspicious.textContent = s.suspiciousCount;
  statHuman.textContent = s.humanCount;

  tabCountAll.textContent = s.totalTracks;
  tabCountAi.textContent = s.aiCount;
  tabCountSuspicious.textContent = s.suspiciousCount;
  tabCountHuman.textContent = s.humanCount;

  // Overall verdict banner
  overallVerdictBanner.className = "verdict-banner";
  verdictPercent.textContent = `${s.aiPercentage} % AI (${s.aiCount} z ${s.totalTracks})`;
  verdictBarFill.style.width = `${Math.max(4, s.aiPercentage)}%`;

  if (s.aiCount > 0) {
    overallVerdictBanner.classList.add("verdict-danger");
    verdictEmoji.textContent = "🚨";
    verdictHeadline.textContent = `Pozor! V playlistu jsme odhalili ${s.aiCount} AI ${
      s.aiCount === 1 ? "písničku" : s.aiCount < 5 ? "písničky" : "písniček"
    }.`;
    verdictDescription.textContent =
      s.suspiciousCount > 0
        ? `Navíc dalších ${s.suspiciousCount} skladeb vykazuje podezřelé znaky (nový katalog bez historie nebo anonymní distribuce).`
        : "Tyto skladby nesou přímé stopy AI generátorů (Suno/Udio) nebo patří potvrzeným AI projektům.";
  } else if (s.suspiciousCount > 0) {
    overallVerdictBanner.classList.add("verdict-warn");
    verdictEmoji.textContent = "🧐";
    verdictHeadline.textContent = `Žádné potvrzené AI, ale ${s.suspiciousCount} ${
      s.suspiciousCount === 1 ? "skladba je podezřelá" : "skladby jsou podezřelé"
    }.`;
    verdictDescription.textContent =
      "Někteří interpreti v playlistu nemají dohledatelnou historii před rokem 2024 nebo mají velmi nízkou stopu v hudebních databázích.";
  } else {
    overallVerdictBanner.classList.add("verdict-clean");
    verdictEmoji.textContent = "✅";
    verdictHeadline.textContent = "Skvělá zpráva! Playlist vypadá 100% čistě (lidská tvorba).";
    verdictDescription.textContent =
      "Všechny skladby prošly kontrolou historie interpretů, databází AI projektů i klíčových slov bez nálezu AI.";
  }

  renderTracksList();
  resultsSection.classList.remove("hidden");
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderTracksList() {
  const query = trackFilterInput.value.trim().toLowerCase();

  const filtered = currentTracks.filter((t) => {
    if (activeFilter !== "all" && t.verdict !== activeFilter) return false;
    if (query) {
      const hay = `${t.title} ${t.artist} ${t.channelName || ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tracksList.innerHTML = `
      <div class="track-card" style="text-align:center; padding: 32px; color: var(--text-muted);">
        Žádné skladby neodpovídají zvolenému filtru.
      </div>
    `;
    return;
  }

  tracksList.innerHTML = filtered
    .map((track) => {
      const color = getScoreColor(track.aiProbability);
      const dur = formatDuration(track.durationMs);

      const signalsHtml = (track.signals || [])
        .map(
          (sig) => `
          <span class="signal-chip ${escapeHtml(sig.type)}">
            <strong>${escapeHtml(sig.category)}:</strong> ${escapeHtml(sig.text)}
          </span>
        `
        )
        .join("");

      const previewBtnHtml = track.previewUrl
        ? `<button type="button" class="preview-play-btn" data-preview="${escapeHtml(
            track.previewUrl
          )}" title="Přehrát audio ukázku">▶</button>`
        : "";

      return `
        <div class="track-card track-${escapeHtml(track.verdict)}">
          <div class="track-main-row">
            <div class="track-left">
              <span class="track-index">#${track.index}</span>
              ${previewBtnHtml}
              <div class="track-titles">
                <div class="track-title-line">
                  <a href="${escapeHtml(
                    track.externalUrl
                  )}" target="_blank" rel="noopener" class="track-title">
                    ${escapeHtml(track.title)}
                  </a>
                  ${track.isExplicit ? `<span class="explicit-tag">E</span>` : ""}
                  ${dur ? `<span style="font-size:0.78rem;color:var(--text-muted)">(${dur})</span>` : ""}
                </div>
                <div class="track-artist">
                  ${escapeHtml(track.artist)}
                  ${
                    track.artistMeta?.earliestReleaseYear
                      ? ` • <span style="font-size:0.78rem;">Od r. ${track.artistMeta.earliestReleaseYear}</span>`
                      : ""
                  }
                </div>
              </div>
            </div>

            <div class="track-right">
              <div class="score-pill-wrap">
                <span class="score-number" style="color: ${color}">
                  ${track.aiProbability}% AI riziko
                </span>
                <div class="score-mini-bar">
                  <div class="score-mini-fill" style="width: ${track.aiProbability}%; background: ${color}"></div>
                </div>
              </div>

              <span class="verdict-badge ${escapeHtml(track.verdict)}">
                ${
                  track.verdict === "ai"
                    ? "🤖 AI Detekováno"
                    : track.verdict === "suspicious"
                    ? "⚠️ Podezřelá"
                    : "✅ Člověk"
                }
              </span>

              <button
                type="button"
                class="flag-track-btn"
                data-artist="${escapeHtml(track.artist)}"
                data-title="${escapeHtml(track.title)}"
                title="Nahlásit tuto skladbu jako AI"
              >
                🚩 Nahlásit AI
              </button>
            </div>
          </div>

          <div class="track-signals">
            ${signalsHtml}
          </div>
        </div>
      `;
    })
    .join("");

  // Attach preview audio handlers
  tracksList.querySelectorAll(".preview-play-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-preview");
      if (activePlayingUrl === url && !previewAudioPlayer.paused) {
        previewAudioPlayer.pause();
        btn.textContent = "▶";
        activePlayingUrl = null;
      } else {
        document.querySelectorAll(".preview-play-btn").forEach((b) => (b.textContent = "▶"));
        previewAudioPlayer.src = url;
        previewAudioPlayer.play();
        btn.textContent = "⏸";
        activePlayingUrl = url;
      }
    });
  });

  // Attach quick report handlers
  tracksList.querySelectorAll(".flag-track-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("reportArtist").value = btn.getAttribute("data-artist") || "";
      document.getElementById("reportTitle").value = btn.getAttribute("data-title") || "";
      reportModal.classList.remove("hidden");
    });
  });
}

// Filter tabs click
document.querySelectorAll(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeFilter = tab.getAttribute("data-filter");
    renderTracksList();
  });
});

trackFilterInput.addEventListener("input", () => {
  renderTracksList();
});

// Modals logic
openReportBtn.addEventListener("click", () => {
  reportModal.classList.remove("hidden");
});
closeReportModal.addEventListener("click", () => {
  reportModal.classList.add("hidden");
});
cancelReportBtn.addEventListener("click", () => {
  reportModal.classList.add("hidden");
});

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
closeDbModal.addEventListener("click", () => {
  dbModal.classList.add("hidden");
});

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
  dbModalContent.innerHTML = `<p style="color:var(--text-muted)">Načítám databázi...</p>`;
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
            <div class="db-item-title">🤖 ${escapeHtml(item.name)}</div>
            <div class="db-item-reason">${escapeHtml(item.reason)}</div>
          </div>
          <span class="verdict-badge ai">${escapeHtml(item.platform)}</span>
        </div>
      `
      )
      .join("");
  } catch {
    dbModalContent.innerHTML = `<p style="color:var(--danger)">Nepodařilo se načíst databázi.</p>`;
  }
}

refreshDatabaseBadge();
