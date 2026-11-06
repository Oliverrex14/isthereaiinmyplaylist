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
const reportUserBadgeName = document.getElementById("reportUserBadgeName");

const loginModal = document.getElementById("loginModal");
const closeLoginModal = document.getElementById("closeLoginModal");
const authLoginBtn = document.getElementById("authLoginBtn");
const authUserMenu = document.getElementById("authUserMenu");
const authUserAvatar = document.getElementById("authUserAvatar");
const authUserName = document.getElementById("authUserName");
const authLogoutBtn = document.getElementById("authLogoutBtn");

const spotifyUserBar = document.getElementById("spotifyUserBar");
const userBarPill = document.getElementById("userBarPill");
const spotifyLoginHint = document.getElementById("spotifyLoginHint");
const spotifyUserGreeting = document.getElementById("spotifyUserGreeting");
const openMyPlaylistsBtn = document.getElementById("openMyPlaylistsBtn");
const myPlaylistsBtnLabel = document.getElementById("myPlaylistsBtnLabel");
const myPlaylistsCountBadge = document.getElementById("myPlaylistsCountBadge");
const spotifyHintLoginBtn = document.getElementById("spotifyHintLoginBtn");

const myPlaylistsModal = document.getElementById("myPlaylistsModal");
const myPlaylistsProviderBadge = document.getElementById("myPlaylistsProviderBadge");
const myPlaylistsModalTitle = document.getElementById("myPlaylistsModalTitle");
const myPlaylistsModalDesc = document.getElementById("myPlaylistsModalDesc");
const myPlaylistsSpinner = document.getElementById("myPlaylistsSpinner");
const myPlaylistsLoadingText = document.getElementById("myPlaylistsLoadingText");
const closeMyPlaylistsModal = document.getElementById("closeMyPlaylistsModal");
const myPlaylistsSearchInput = document.getElementById("myPlaylistsSearchInput");
const refreshMyPlaylistsBtn = document.getElementById("refreshMyPlaylistsBtn");
const myPlaylistsLoading = document.getElementById("myPlaylistsLoading");
const myPlaylistsContainer = document.getElementById("myPlaylistsContainer");

const cleanPlaylistCard = document.getElementById("cleanPlaylistCard");
const cleanCardDesc = document.getElementById("cleanCardDesc");
const createCleanPlaylistBtn = document.getElementById("createCleanPlaylistBtn");

const cleanSuccessModal = document.getElementById("cleanSuccessModal");
const cleanSuccessTitle = document.getElementById("cleanSuccessTitle");
const cleanSuccessDesc = document.getElementById("cleanSuccessDesc");
const cleanSuccessOpenBtn = document.getElementById("cleanSuccessOpenBtn");
const closeCleanSuccessModal = document.getElementById("closeCleanSuccessModal");

let currentUser = null;
let userPlaylistsCache = [];
let lastScanResult = null;

async function checkAuthState() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      const data = await res.json();
      currentUser = data.authenticated ? data.user : null;
      const localSec = document.getElementById("authLocalSection");
      if (localSec) {
        if (data.providers?.localDev === false) {
          localSec.classList.add("hidden");
        } else {
          localSec.classList.remove("hidden");
        }
      }
      const googleBtn = document.getElementById("loginGoogleBtn");
      if (googleBtn) {
        if (data.providers && data.providers.google === false && !data.providers.localDev) {
          googleBtn.classList.add("hidden");
        } else {
          googleBtn.classList.remove("hidden");
        }
      }
      const spotifyBtn = document.getElementById("loginSpotifyBtn");
      if (spotifyBtn) {
        if (data.providers && data.providers.spotify === false && !data.providers.localDev) {
          spotifyBtn.classList.add("hidden");
        } else {
          spotifyBtn.classList.remove("hidden");
        }
      }
      updateAuthUI();
    }
  } catch {}
}

function updateAuthUI() {
  if (currentUser) {
    if (authLoginBtn) authLoginBtn.classList.add("hidden");
    if (authUserMenu) authUserMenu.classList.remove("hidden");
    if (authUserName) authUserName.textContent = currentUser.name || "Reviewer";
    if (authUserAvatar) {
      authUserAvatar.src =
        currentUser.avatar ||
        (currentUser.provider === "google"
          ? "https://www.gstatic.com/images/branding/product/1x/avatar_square_grey_512dp.png"
          : "https://open.spotifycdn.com/cdn/images/favicon32.8e66b099.png");
    }
    if (reportUserBadgeName) {
      reportUserBadgeName.textContent = `${currentUser.name} (${(
        currentUser.provider || "AUTH"
      ).toUpperCase()})`;
    }

    if (currentUser.provider === "spotify") {
      if (spotifyUserBar) {
        spotifyUserBar.classList.remove("hidden");
        spotifyUserBar.classList.remove("youtube-mode");
      }
      if (userBarPill) userBarPill.textContent = "SPOTIFY CONNECTED";
      if (myPlaylistsBtnLabel) myPlaylistsBtnLabel.textContent = "📂 SCAN MY SPOTIFY PLAYLISTS";
      if (spotifyLoginHint) spotifyLoginHint.classList.add("hidden");
      if (spotifyUserGreeting) {
        const prod = currentUser.product ? ` [${currentUser.product.toUpperCase()}]` : "";
        spotifyUserGreeting.innerHTML = `Connected as <strong>${escapeHtml(currentUser.name)}</strong>${prod}`;
      }
      fetchMyPlaylistsBadge();
    } else if (currentUser.provider === "google") {
      if (spotifyUserBar) {
        spotifyUserBar.classList.remove("hidden");
        spotifyUserBar.classList.add("youtube-mode");
      }
      if (userBarPill) userBarPill.textContent = "YOUTUBE MUSIC CONNECTED";
      if (myPlaylistsBtnLabel) myPlaylistsBtnLabel.textContent = "📂 SCAN MY YOUTUBE PLAYLISTS";
      if (spotifyLoginHint) spotifyLoginHint.classList.add("hidden");
      if (spotifyUserGreeting) {
        spotifyUserGreeting.innerHTML = `Connected as <strong>${escapeHtml(currentUser.name)}</strong> [GOOGLE / YTM]`;
      }
      fetchMyPlaylistsBadge();
    } else {
      if (spotifyUserBar) spotifyUserBar.classList.add("hidden");
      if (spotifyLoginHint) spotifyLoginHint.classList.add("hidden");
    }
  } else {
    if (authLoginBtn) authLoginBtn.classList.remove("hidden");
    if (authUserMenu) authUserMenu.classList.add("hidden");
    if (reportUserBadgeName) {
      reportUserBadgeName.textContent = "Community Contributor";
    }
    if (spotifyUserBar) spotifyUserBar.classList.add("hidden");
    if (spotifyLoginHint) spotifyLoginHint.classList.remove("hidden");
  }
}

async function fetchMyPlaylistsBadge() {
  if (!currentUser) return;
  const isSpotify = currentUser.provider === "spotify";
  const isGoogle = currentUser.provider === "google";
  if (!isSpotify && !isGoogle) return;

  const endpoint = isGoogle ? "/api/youtube/playlists" : "/api/spotify/playlists";
  try {
    const res = await fetch(endpoint);
    if (res.ok) {
      const data = await res.json();
      userPlaylistsCache = data.playlists || [];
      if (myPlaylistsCountBadge) {
        myPlaylistsCountBadge.textContent = `${userPlaylistsCache.length}`;
      }
    }
  } catch (_) {}
}

async function openMyPlaylistsModalHandler() {
  if (
    !currentUser ||
    (currentUser.provider !== "spotify" && currentUser.provider !== "google")
  ) {
    if (loginModal) loginModal.classList.remove("hidden");
    return;
  }

  const isGoogle = currentUser.provider === "google";

  if (myPlaylistsProviderBadge) {
    if (isGoogle) {
      myPlaylistsProviderBadge.textContent = "YOUTUBE USER LIBRARY";
      myPlaylistsProviderBadge.style.background = "#ff0000";
      myPlaylistsProviderBadge.style.color = "#ffffff";
    } else {
      myPlaylistsProviderBadge.textContent = "SPOTIFY USER LIBRARY";
      myPlaylistsProviderBadge.style.background = "#1db954";
      myPlaylistsProviderBadge.style.color = "#000000";
    }
  }

  if (myPlaylistsModalTitle) {
    myPlaylistsModalTitle.textContent = isGoogle
      ? "📂 My YouTube Music Playlists"
      : "📂 My Spotify Playlists";
  }

  if (myPlaylistsModalDesc) {
    myPlaylistsModalDesc.textContent = isGoogle
      ? "Select any personal, unlisted, or private playlist from your YouTube / YouTube Music library to scan for synthetic AI tracks with 1-click."
      : "Select any personal or followed playlist from your Spotify library to scan for synthetic AI tracks with 1-click. Supports both public and private playlists.";
  }

  if (myPlaylistsSpinner) {
    if (isGoogle) {
      myPlaylistsSpinner.style.borderTopColor = "#ff0000";
    } else {
      myPlaylistsSpinner.style.borderTopColor = "#1db954";
    }
  }

  if (myPlaylistsModal) myPlaylistsModal.classList.remove("hidden");
  if (myPlaylistsSearchInput) myPlaylistsSearchInput.value = "";

  if (userPlaylistsCache.length === 0) {
    await reloadMyPlaylists();
  } else {
    renderMyPlaylists(userPlaylistsCache);
  }
}

async function reloadMyPlaylists() {
  if (!currentUser) return;
  const isGoogle = currentUser.provider === "google";
  const endpoint = isGoogle ? "/api/youtube/playlists" : "/api/spotify/playlists";
  const providerLabel = isGoogle ? "YouTube" : "Spotify";
  const loginUrl = isGoogle
    ? "/api/auth/login?provider=google"
    : "/api/auth/login?provider=spotify";

  if (myPlaylistsLoading) myPlaylistsLoading.classList.remove("hidden");
  if (myPlaylistsLoadingText) {
    myPlaylistsLoadingText.textContent = `Loading your ${providerLabel} playlists...`;
  }
  if (myPlaylistsContainer) myPlaylistsContainer.innerHTML = "";

  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Could not load ${providerLabel} playlists.`);
    }
    const data = await res.json();
    userPlaylistsCache = data.playlists || [];
    if (myPlaylistsCountBadge) {
      myPlaylistsCountBadge.textContent = `${userPlaylistsCache.length}`;
    }
    renderMyPlaylists(userPlaylistsCache);
  } catch (err) {
    if (myPlaylistsContainer) {
      myPlaylistsContainer.innerHTML = `
        <div style="grid-column:1/-1;padding:24px;text-align:center;color:var(--danger)">
          <p style="font-weight:700;margin-bottom:6px">⚠️ ${escapeHtml(err.message)}</p>
          <a href="${loginUrl}" class="btn btn-outline" style="font-size:0.75rem">Re-Authenticate ${providerLabel}</a>
        </div>
      `;
    }
  } finally {
    if (myPlaylistsLoading) myPlaylistsLoading.classList.add("hidden");
  }
}

function renderMyPlaylists(playlists) {
  if (!myPlaylistsContainer) return;
  const isGoogle = currentUser && currentUser.provider === "google";
  const filterQuery = (myPlaylistsSearchInput?.value || "").trim().toLowerCase();

  const filtered = (playlists || []).filter((p) => {
    if (!filterQuery) return true;
    return (
      (p.name || "").toLowerCase().includes(filterQuery) ||
      (p.owner || "").toLowerCase().includes(filterQuery) ||
      (p.description || "").toLowerCase().includes(filterQuery)
    );
  });

  if (filtered.length === 0) {
    const providerName = isGoogle ? "YouTube Music" : "Spotify";
    myPlaylistsContainer.innerHTML = `
      <div style="grid-column:1/-1;padding:36px;text-align:center;color:var(--text-muted);font-family:var(--mono);font-size:0.8rem">
        ${filterQuery ? `No playlists matching "${escapeHtml(filterQuery)}".` : `No playlists found in your ${providerName} library.`}
      </div>
    `;
    return;
  }

  myPlaylistsContainer.innerHTML = filtered
    .map((p) => {
      const coverHtml = p.imageUrl
        ? `<img class="playlist-thumb" src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" loading="lazy" />`
        : `<div class="playlist-thumb-fallback">${isGoogle ? "▶️" : "🎵"}</div>`;

      let privacyBadge = "";
      if (p.privacyStatus === "private" || (!p.public && p.privacyStatus !== "unlisted")) {
        privacyBadge = `<span class="pl-badge pl-badge-private">🔒 Private</span>`;
      } else if (p.privacyStatus === "unlisted") {
        privacyBadge = `<span class="pl-badge pl-badge-unlisted">🔗 Unlisted</span>`;
      } else {
        privacyBadge = `<span class="pl-badge pl-badge-public">🌐 Public</span>`;
      }

      const collBadge = p.collaborative
        ? `<span class="pl-badge">👥 Collab</span>`
        : "";

      const defaultOwner = isGoogle ? "You" : "Spotify";
      const ownerBadge = p.isOwner
        ? `<span class="pl-badge">👤 By you</span>`
        : `<span class="pl-badge">By ${escapeHtml(p.owner || defaultOwner)}</span>`;

      const platformBadge = isGoogle
        ? `<span class="pl-badge" style="color:#ff4e45">YouTube</span>`
        : `<span class="pl-badge" style="color:#1db954">Spotify</span>`;

      return `
        <div class="playlist-card" data-url="${escapeHtml(p.url)}">
          <div class="playlist-card-top">
            ${coverHtml}
            <div class="playlist-title-wrap">
              <div class="playlist-card-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
              <div class="playlist-card-owner">${p.trackCount} tracks • ${p.isOwner ? "Created by you" : escapeHtml(p.owner || defaultOwner)}</div>
            </div>
          </div>
          <div class="playlist-card-badges">
            <span class="pl-badge">${p.trackCount} tracks</span>
            ${platformBadge}
            ${privacyBadge}
            ${collBadge}
            ${ownerBadge}
          </div>
          <button type="button" class="btn-scan-pl" data-url="${escapeHtml(p.url)}">
            <span>⚡ SCAN PLAYLIST</span>
          </button>
        </div>
      `;
    })
    .join("");

  // Attach click listeners to scan buttons
  myPlaylistsContainer.querySelectorAll(".btn-scan-pl").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = btn.getAttribute("data-url");
      if (!url) return;
      if (myPlaylistsModal) myPlaylistsModal.classList.add("hidden");
      if (playlistUrlInput) {
        playlistUrlInput.value = url;
      }
      // Switch active inspection mode to playlist
      setInspectionMode("playlist");
      // Automatically trigger inspect
      if (analyzeForm) {
        analyzeForm.dispatchEvent(new Event("submit"));
      }
    });
  });
}

if (authLoginBtn) {
  authLoginBtn.addEventListener("click", () => {
    if (loginModal) loginModal.classList.remove("hidden");
  });
}
if (closeLoginModal) {
  closeLoginModal.addEventListener("click", () => {
    if (loginModal) loginModal.classList.add("hidden");
  });
}
if (authLogoutBtn) {
  authLogoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    currentUser = null;
    updateAuthUI();
  });
}

checkAuthState();

const dbModal = document.getElementById("dbModal");
const openDbBtn = document.getElementById("openDbBtn");
const closeDbModal = document.getElementById("closeDbModal");
const dbModalContent = document.getElementById("dbModalContent");
const dbCountBadge = document.getElementById("dbCountBadge");

// Theme Toggle
const themeToggleBtn = document.getElementById("themeToggleBtn");
const themeToggleLabel = themeToggleBtn?.querySelector(".theme-toggle-label");

function updateThemeToggleUI(theme) {
  if (!themeToggleBtn) return;
  const isDark = theme === "dark";
  if (themeToggleLabel) themeToggleLabel.textContent = isDark ? "LIGHT" : "DARK";
  const label = isDark ? "Přepnout na světlý motiv" : "Přepnout na tmavý motiv";
  themeToggleBtn.setAttribute("aria-label", label);
  themeToggleBtn.setAttribute("title", label);
}

function applyTheme(theme, save = true) {
  document.documentElement.setAttribute("data-theme", theme);
  if (save) {
    try {
      localStorage.setItem("theme", theme);
    } catch {}
  }
  updateThemeToggleUI(theme);
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });
}

try {
  const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
  updateThemeToggleUI(currentTheme);

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (!localStorage.getItem("theme")) {
        applyTheme(e.matches ? "dark" : "light", false);
      }
    });
  }
} catch {}

// Active Design: Humanist (Anti-AI Craft)
try {
  document.documentElement.setAttribute("data-design", "cyber");
} catch {}

let currentTracks = [];
let activeReportingTrack = null;
let activeReportingArtist = null;
const sessionFlaggedArtists = new Set();
let activeFilter = "all";
let activeMode = "auto";
let activePlayingUrl = null;
const expandedRows = new Set();
const queryPrefix = document.getElementById("queryPrefix");

function normalizeArtistKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getPrimaryArtist(artistStr) {
  if (!artistStr) return "";
  return artistStr
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0]
    .trim();
}

function isArtistFlaggedInSession(artistName) {
  if (!artistName) return false;
  const prim = normalizeArtistKey(getPrimaryArtist(artistName));
  const full = normalizeArtistKey(artistName);
  return (
    sessionFlaggedArtists.has(prim) ||
    sessionFlaggedArtists.has(full) ||
    Array.from(sessionFlaggedArtists).some(
      (a) => a && (prim.includes(a) || full.includes(a) || a.includes(prim))
    )
  );
}

function getTracksByArtist(artistName) {
  if (!artistName) return [];
  const normTarget = normalizeArtistKey(artistName);
  const primTarget = normalizeArtistKey(getPrimaryArtist(artistName));
  return currentTracks.filter((t) => {
    const tNorm = normalizeArtistKey(t.artist);
    const tPrim = normalizeArtistKey(getPrimaryArtist(t.artist));
    return (
      tNorm === normTarget ||
      tPrim === primTarget ||
      (primTarget && (tNorm.includes(primTarget) || tPrim.includes(primTarget))) ||
      (normTarget && (tNorm.includes(normTarget) || normTarget.includes(tNorm)))
    );
  });
}

const MODE_CONFIG = {
  auto: {
    prefix: "URL //",
    placeholder:
      "Paste any Spotify, Apple Music, or YouTube link (playlist, album, track, or artist)...",
  },
  playlist: {
    prefix: "PLAYLIST //",
    placeholder:
      "https://open.spotify.com/playlist/... or music.apple.com/.../playlist/... or youtube.com/playlist?list=...",
  },
  track: {
    prefix: "TRACK //",
    placeholder:
      "https://open.spotify.com/track/... or music.apple.com/.../album/... or youtube.com/watch?v=...",
  },
  artist: {
    prefix: "ARTIST //",
    placeholder:
      "https://open.spotify.com/artist/... or music.apple.com/.../artist/... or youtube.com/@...",
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
  if (score >= 68) return "#d91b1b";
  if (score >= 38) return "#c76a00";
  return "#0b7a3e";
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

function isSupportedLink(input) {
  const str = (input || "").trim();
  if (!str) return false;
  if (str.startsWith("demo:")) return true;
  if (/^spotify:(playlist|track|artist|album):/i.test(str)) return true;
  const match = str.match(/https?:\/\/[^\s]+/i);
  const cand = match ? match[0] : str;
  return (
    /^https?:\/\//i.test(cand) ||
    /^(open\.spotify\.com|spotify\.link|music\.apple\.com|www\.youtube\.com|m\.youtube\.com|youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(
      cand
    )
  );
}

analyzeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = playlistUrlInput.value.trim();
  if (!url) {
    errorText.textContent = "Please paste a link to inspect.";
    errorAlert.classList.remove("hidden");
    return;
  }
  if (!isSupportedLink(url)) {
    errorText.textContent =
      "Please enter a valid link. We support Spotify (playlist, track, artist, album), Apple Music, and YouTube links.";
    errorAlert.classList.remove("hidden");
    playlistUrlInput.focus();
    return;
  }
  runAnalysis(url, activeMode);
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
    { pct: 25, text: "Paginating full playlist (Spotify Pathfinder / YouTube Continuation / Apple Music)..." },
    { pct: 52, text: "Cross-referencing 9,500+ artists in Soul Over AI, Spotify AI Blocker & MusicBrainz AI..." },
    { pct: 78, text: "Analyzing release velocity, single-to-album ratio, ISNI/IPI rights & copyright lines..." },
    { pct: 92, text: "Measuring stream telemetry, duration windows & compiling full playlist report..." },
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

    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(
        `Server returned an unexpected response (HTTP ${res.status}).`
      );
    }
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
    const msg = err.message || "Failed to inspect playlist.";
    if (
      msg.includes("sign out and sign in again") ||
      msg.includes("403") ||
      msg.includes("permissions")
    ) {
      errorText.innerHTML = `${escapeHtml(msg)}<div style="margin-top:10px"><a href="/api/auth/login?provider=spotify" class="btn btn-outline" style="font-size:0.75rem;padding:6px 12px;display:inline-block">🔑 RE-AUTHENTICATE SPOTIFY (NEW PERMISSIONS)</a></div>`;
    } else {
      errorText.textContent = msg;
    }
    errorAlert.classList.remove("hidden");
  } finally {
    analyzeBtn.disabled = false;
  }
}

function renderResults(data) {
  currentTracks = data.tracks || [];
  currentTracks.forEach((t) => {
    t._originalState = {
      aiProbability: t.aiProbability,
      verdict: t.verdict,
      verdictLabel: t.verdictLabel,
      signals: Array.isArray(t.signals) ? [...t.signals] : [],
      forensics: t.forensics ? { ...t.forensics } : {},
    };
    if (isArtistFlaggedInSession(t.artist)) {
      t.flaggedBySession = true;
      t.artistFlaggedBySession = true;
      t.aiProbability = Math.max(t.aiProbability || 0, 95);
      t.verdict = "ai";
      t.verdictLabel = "SYNTHETIC AI";
      t.signals = [
        {
          type: "danger",
          category: "COMMUNITY AI REGISTRY",
          text: `Entire artist flagged as AI-generated by community: ${t.artist}`,
        },
        ...(t.signals || []).filter(
          (s) => s.category !== "PASS" && s.category !== "COMMUNITY AI REGISTRY"
        ),
      ];
    }
  });
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
    verdictHeadline.textContent = `0 CONFIRMED AI // ${s.suspiciousCount} INSUFFICIENT EVIDENCE`;
    verdictDescription.textContent =
      "No confirmed synthetic matches; items have sparse public registry data or conflicting catalog signals.";
  } else {
    overallVerdictBanner.classList.add("status-safe");
    verdictHeadline.textContent = "100% VERIFIED HUMAN CATALOG";
    verdictDescription.textContent =
      "All tracks passed discography timeline, MusicBrainz registry, and release cadence checks.";
  }

  lastScanResult = data;

  // Clean Playlist in Spotify Banner logic
  if (cleanPlaylistCard) {
    const isSpotifyTarget =
      data.platform === "spotify" ||
      (data.platformName && data.platformName.toLowerCase().includes("spotify"));
    const hasDetectedAi = s.aiCount > 0 || s.suspiciousCount > 0;
    const isSpotifyUser = Boolean(currentUser && currentUser.provider === "spotify");

    if (isSpotifyTarget && hasDetectedAi && isSpotifyUser) {
      cleanPlaylistCard.classList.remove("hidden");
      if (cleanCardDesc) {
        cleanCardDesc.textContent = `We detected ${s.aiCount} AI-generated song(s) in "${data.title || "this playlist"}". Create a clean version with ${s.humanCount} verified human tracks directly in your Spotify library with 1-click.`;
      }
    } else {
      cleanPlaylistCard.classList.add("hidden");
    }
  }

  renderTracksList();
  resultsSection.classList.remove("hidden");
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleCreateCleanPlaylist() {
  if (!lastScanResult || !currentUser || currentUser.provider !== "spotify") return;
  if (!createCleanPlaylistBtn) return;

  const humanTracks = currentTracks.filter(
    (t) => t.verdict === "human" || (t.verdict !== "ai" && (t.aiProbability || 0) < 60)
  );
  const trackUris = humanTracks
    .map((t) => t.spotifyUri || (t.id ? `spotify:track:${t.id}` : null))
    .filter(Boolean);

  if (trackUris.length === 0) {
    alert("No verified human tracks were found to create a clean playlist.");
    return;
  }

  createCleanPlaylistBtn.disabled = true;
  const origHtml = createCleanPlaylistBtn.innerHTML;
  createCleanPlaylistBtn.innerHTML = `<span>⏳ Creating in Spotify...</span>`;

  try {
    const res = await fetch("/api/spotify/clean-playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: lastScanResult.title || "Playlist",
        description: `Cleaned by isthereaiinmyplaylist.tech — ${humanTracks.length} human verified songs (removed ${lastScanResult.summary.aiCount} AI tracks).`,
        trackUris,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to create clean playlist on Spotify.");
    }

    const data = await res.json();
    if (cleanSuccessTitle) {
      cleanSuccessTitle.textContent = `Created "${data.playlistName}"!`;
    }
    if (cleanSuccessDesc) {
      cleanSuccessDesc.textContent = `Successfully added ${data.tracksAdded} verified human tracks to your Spotify account. All AI tracks were removed.`;
    }
    if (cleanSuccessOpenBtn) {
      cleanSuccessOpenBtn.href = data.playlistUrl || "#";
    }
    if (cleanSuccessModal) {
      cleanSuccessModal.classList.remove("hidden");
    }
  } catch (err) {
    const msg = err.message || "Failed to create clean playlist on Spotify.";
    if (
      msg.includes("403") ||
      msg.includes("permissions") ||
      msg.includes("sign out and sign in again")
    ) {
      if (
        confirm(
          `${msg}\n\nDo you want to re-authenticate with Spotify now to grant playlist creation permissions?`
        )
      ) {
        window.location.href = "/api/auth/login?provider=spotify";
      }
    } else {
      alert(`Could not create playlist: ${msg}`);
    }
  } finally {
    createCleanPlaylistBtn.disabled = false;
    createCleanPlaylistBtn.innerHTML = origHtml;
  }
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
      const rankStr = f.spotifyPlaycount
        ? `${formatCompactNumber(f.spotifyPlaycount)} SP streams`
        : f.deezerTrackRank
        ? `Rank ${formatCompactNumber(f.deezerTrackRank)}`
        : `${f.deezerAlbums ?? 0} releases`;

      const registryStr = f.mbAiFlagged
        ? "MB AI FLAGGED"
        : f.musicBrainzVerified
        ? "MB VERIFIED"
        : "UNVERIFIED";
      const registrySubStr = f.mbAiFlagged
        ? "AI Tag in MB"
        : f.musicBrainzVerified
        ? `${f.mbType || "Artist"}${f.mbCountry ? " · " + f.mbCountry : ""}${f.mbHasRightsCodes ? " · IPI" : ""}`
        : "No MBID entry";

      const isArtistFlagged =
        isArtistFlaggedInSession(track.artist) || Boolean(track.artistFlaggedBySession);
      const artistSongCount = getTracksByArtist(track.artist).length;

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
                  <span class="track-artist-name">${escapeHtml(track.artist)}</span>
                  ${isArtistFlagged ? '<span class="artist-flag-badge" title="Entire artist is flagged as AI">AI ARTIST</span>' : ''}
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
              <span style="color:${f.mbAiFlagged ? "var(--danger)" : f.musicBrainzVerified ? "var(--safe)" : "var(--text-muted)"}">
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
                class="flag-btn ${track.flaggedBySession && !track.artistFlaggedBySession ? "flagged" : ""}"
                data-track-id="${escapeHtml(track.id)}"
                data-artist="${escapeHtml(track.artist)}"
                data-title="${escapeHtml(track.title)}"
                data-platform="${escapeHtml(track.platform || "Spotify")}"
                title="${track.flaggedBySession ? "Click to remove AI flag &amp; restore original scan" : "Report this track as suspected AI"}"
              >
                ${track.flaggedBySession && !track.artistFlaggedBySession ? "UNFLAG ↺" : "FLAG"}
              </button>
              <button
                type="button"
                class="flag-artist-btn ${isArtistFlagged ? "flagged" : ""}"
                data-artist="${escapeHtml(track.artist)}"
                data-platform="${escapeHtml(track.platform || "Spotify")}"
                data-track-count="${artistSongCount}"
                title="${
                  isArtistFlagged
                    ? `Click to remove AI flag for artist "${escapeHtml(track.artist)}" &amp; restore all ${artistSongCount} songs`
                    : `Flag entire artist "${escapeHtml(track.artist)}" and all ${artistSongCount} song${artistSongCount > 1 ? "s" : ""} in playlist as AI`
                }"
              >
                ${isArtistFlagged ? "UNFLAG ARTIST ↺" : (artistSongCount > 1 ? `FLAG ARTIST (${artistSongCount})` : "FLAG ARTIST")}
              </button>
            </div>
          </div>

          <div class="signals-strip">
            ${signalsHtml}
          </div>

          <div class="mobile-metrics-bar">
            <span class="mob-pill">DEBUT: <strong>${escapeHtml(debutStr)}</strong></span>
            <span class="mob-pill">12M: <strong>${escapeHtml(velocityStr)}</strong></span>
            <span class="mob-pill">SINGLES: <strong>${escapeHtml(
              f.singleToAlbumRatio !== null && f.singleToAlbumRatio !== undefined
                ? f.singleToAlbumRatio + "%"
                : "N/A"
            )}</strong></span>
            <span class="mob-pill">FANS: <strong>${escapeHtml(followersStr)}</strong></span>
            <span class="mob-pill ${f.musicBrainzVerified ? "mob-verified" : ""}">
              ${f.musicBrainzVerified ? "MB VERIFIED" : "NO MBID"}
            </span>
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
              <div class="drawer-kv"><span>Online AI Index:</span><strong>${escapeHtml(f.matchedDbSource || "Clean (Not Listed)")}</strong></div>
              <div class="drawer-kv"><span>Artist Status:</span><strong style="color:${isArtistFlagged ? "var(--danger)" : "inherit"}">${isArtistFlagged ? "FLAGGED AI (ALL SONGS)" : "Normal"}</strong></div>
              <div class="drawer-kv"><span>MusicBrainz Match:</span><strong>${f.mbAiFlagged ? "FLAGGED AI" : f.musicBrainzVerified ? "Yes (" + (f.mbType || "Entity") + (f.mbHasRightsCodes ? ", IPI/ISNI" : "") + ")" : "No"}</strong></div>
              <div class="drawer-kv"><span>Distributor / ℗:</span><strong>${escapeHtml(f.primaryDistributor || "Unlisted")}</strong></div>
              <div class="drawer-kv"><span>Spotify Streams:</span><strong>${f.spotifyPlaycount ? f.spotifyPlaycount.toLocaleString("en-US") : "N/A"}</strong></div>
              <button
                type="button"
                class="flag-artist-btn btn-drawer-artist-flag ${isArtistFlagged ? "flagged" : ""}"
                data-artist="${escapeHtml(track.artist)}"
                data-platform="${escapeHtml(track.platform || "Spotify")}"
                data-track-count="${artistSongCount}"
              >
                ${isArtistFlagged ? "↺ UNFLAG ENTIRE ARTIST & ALL SONGS" : `⚡ FLAG ENTIRE ARTIST & ALL ${artistSongCount} SONG${artistSongCount > 1 ? "S" : ""} AS AI`}
              </button>
            </div>

            <div class="drawer-col">
              <div class="drawer-heading">AUDIO STREAM TELEMETRY</div>
              <div class="drawer-kv"><span>Duration / AI Win:</span><strong>${f.durationSeconds ? f.durationSeconds + "s (" + (f.matchesGeneratorWindow ? "MATCH" : "Normal") + ")" : "N/A"}</strong></div>
              <div class="drawer-kv"><span>BPM / Key:</span><strong>${f.bpm ? f.bpm + " BPM" + (f.musicalKey ? " · " + f.musicalKey : "") : "N/A"}</strong></div>
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

  // Bind flag / unflag buttons: allows opening report modal to confirm or unflagging existing flags
  tracksList.querySelectorAll(".flag-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const trackId = btn.getAttribute("data-track-id");
      const artist = btn.getAttribute("data-artist") || "";
      const title = btn.getAttribute("data-title") || "";
      const rawPlat = (btn.getAttribute("data-platform") || "Spotify").toLowerCase();
      const platform = rawPlat.includes("apple")
        ? "Apple Music"
        : rawPlat.includes("youtube")
        ? "YouTube"
        : "Spotify";

      const targetTrack = currentTracks.find((t) => String(t.id) === String(trackId));
      if (!targetTrack) return;

      // 1. IF ALREADY FLAGGED IN SESSION: allow immediate unflag / undo
      if (targetTrack.flaggedBySession) {
        const confirmUndo = window.confirm(
          `Remove your AI flag for "${title || artist}" and restore its original scan score?`
        );
        if (!confirmUndo) return;

        btn.disabled = true;
        btn.textContent = "REMOVING...";

        try {
          const res = await fetch("/api/unflag", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artist, title, isArtistFlag: false }),
          });

          if (res.ok) {
            targetTrack.flaggedBySession = false;
            targetTrack.individuallyFlagged = false;
            if (!targetTrack.artistFlaggedBySession && targetTrack._originalState) {
              targetTrack.aiProbability = targetTrack._originalState.aiProbability;
              targetTrack.verdict = targetTrack._originalState.verdict;
              targetTrack.verdictLabel = targetTrack._originalState.verdictLabel;
              targetTrack.signals = [...targetTrack._originalState.signals];
              targetTrack.forensics = { ...targetTrack._originalState.forensics };
            }
            updateSummaryCountersFromTracks();
            renderTracksList();
            await refreshDatabaseBadge();
          } else {
            btn.disabled = false;
            btn.textContent = "UNFLAG ↺";
          }
        } catch {
          btn.disabled = false;
          btn.textContent = "UNFLAG ↺";
        }
        return;
      }

      // 2. IF NOT FLAGGED: open report modal pre-filled for this single track
      activeReportingTrack = targetTrack;
      activeReportingArtist = null;
      const artistInput = document.getElementById("reportArtist");
      const titleInput = document.getElementById("reportTitle");
      const flagEntireCheckbox = document.getElementById("reportFlagEntireArtist");
      const platInput = document.getElementById("reportPlatform");
      const reasonInput = document.getElementById("reportReason");
      const submitBtn = reportForm.querySelector("button[type='submit']");

      if (flagEntireCheckbox) flagEntireCheckbox.checked = false;
      if (artistInput) artistInput.value = artist;
      if (titleInput) {
        titleInput.value = title;
        titleInput.disabled = false;
        titleInput.placeholder = "e.g. Dust on the Wind";
      }
      if (platInput) platInput.value = platform;
      if (reasonInput) {
        reasonInput.value = "";
        reasonInput.placeholder = "e.g., Suno/Udio vocal artifacts, mass upload velocity...";
      }
      if (submitBtn) submitBtn.textContent = "SUBMIT REPORT";

      reportModal.classList.remove("hidden");
      if (reasonInput) reasonInput.focus();
    });
  });

  // Bind flag entire artist & all songs buttons
  tracksList.querySelectorAll(".flag-artist-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const artist = btn.getAttribute("data-artist") || "";
      const rawPlat = (btn.getAttribute("data-platform") || "Spotify").toLowerCase();
      const platform = rawPlat.includes("apple")
        ? "Apple Music"
        : rawPlat.includes("youtube")
        ? "YouTube"
        : "Spotify";

      if (!artist) return;
      const matchingTracks = getTracksByArtist(artist);
      const isAlreadyFlagged = isArtistFlaggedInSession(artist);

      // 1. IF ALREADY FLAGGED IN SESSION: allow immediate unflag / undo for the whole artist
      if (isAlreadyFlagged) {
        const confirmUndo = window.confirm(
          `Remove AI flag for entire artist "${artist}" and restore original scan scores for all ${matchingTracks.length} songs in playlist?`
        );
        if (!confirmUndo) return;

        btn.disabled = true;
        btn.textContent = "REMOVING...";

        try {
          const res = await fetch("/api/unflag", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artist, isArtistFlag: true }),
          });

          if (res.ok) {
            const normA = normalizeArtistKey(getPrimaryArtist(artist));
            const fullA = normalizeArtistKey(artist);
            sessionFlaggedArtists.delete(normA);
            sessionFlaggedArtists.delete(fullA);

            for (const t of matchingTracks) {
              t.artistFlaggedBySession = false;
              if (!t.individuallyFlagged) {
                t.flaggedBySession = false;
                if (t._originalState) {
                  t.aiProbability = t._originalState.aiProbability;
                  t.verdict = t._originalState.verdict;
                  t.verdictLabel = t._originalState.verdictLabel;
                  t.signals = Array.isArray(t._originalState.signals)
                    ? [...t._originalState.signals]
                    : [];
                  t.forensics = t._originalState.forensics
                    ? { ...t._originalState.forensics }
                    : {};
                }
              }
            }
            updateSummaryCountersFromTracks();
            renderTracksList();
            await refreshDatabaseBadge();
          } else {
            btn.disabled = false;
            btn.textContent = "UNFLAG ARTIST ↺";
          }
        } catch {
          btn.disabled = false;
          btn.textContent = "UNFLAG ARTIST ↺";
        }
        return;
      }

      // 2. IF NOT FLAGGED: open report modal configured for the entire artist catalog
      activeReportingTrack = null;
      activeReportingArtist = artist;

      const artistInput = document.getElementById("reportArtist");
      const titleInput = document.getElementById("reportTitle");
      const flagEntireCheckbox = document.getElementById("reportFlagEntireArtist");
      const platInput = document.getElementById("reportPlatform");
      const reasonInput = document.getElementById("reportReason");
      const submitBtn = reportForm.querySelector("button[type='submit']");

      if (artistInput) artistInput.value = artist;
      if (flagEntireCheckbox) {
        flagEntireCheckbox.checked = true;
      }
      if (titleInput) {
        titleInput.value = "";
        titleInput.disabled = true;
        titleInput.placeholder = `(All ${matchingTracks.length} tracks by "${artist}" in playlist will be flagged)`;
      }
      if (platInput) platInput.value = platform;
      if (reasonInput) {
        reasonInput.value = "";
        reasonInput.placeholder =
          "e.g., Synthetic AI project, mass upload velocity, Suno/Udio vocal timbre...";
      }
      if (submitBtn) {
        submitBtn.textContent =
          matchingTracks.length > 1
            ? `FLAG ARTIST & ALL ${matchingTracks.length} SONGS`
            : "FLAG ENTIRE ARTIST";
      }

      reportModal.classList.remove("hidden");
      if (reasonInput) reasonInput.focus();
    });
  });
}

function updateSummaryCountersFromTracks() {
  const total = currentTracks.length;
  if (!total) return;
  const aiCount = currentTracks.filter((t) => t.verdict === "ai").length;
  const suspiciousCount = currentTracks.filter((t) => t.verdict === "suspicious").length;
  const humanCount = currentTracks.filter((t) => t.verdict === "human").length;
  const aiPercentage = Math.round((aiCount / total) * 100);
  const avgAiScore = Math.round(
    currentTracks.reduce((sum, t) => sum + (t.aiProbability || 0), 0) / total
  );

  statAi.textContent = aiCount;
  statAiPct.textContent = `${aiPercentage}% of playlist`;
  statSuspicious.textContent = suspiciousCount;
  statHuman.textContent = humanCount;
  statAvgRisk.textContent = `${avgAiScore}%`;

  tabCountAi.textContent = aiCount;
  tabCountSuspicious.textContent = suspiciousCount;
  tabCountHuman.textContent = humanCount;

  barSegAi.style.width = `${((aiCount / total) * 100).toFixed(1)}%`;
  barSegSuspicious.style.width = `${((suspiciousCount / total) * 100).toFixed(1)}%`;
  barSegHuman.style.width = `${((humanCount / total) * 100).toFixed(1)}%`;

  verdictPercent.textContent = `${aiPercentage}% FLAGGED AI (${aiCount}/${total}) // MEAN RISK: ${avgAiScore}%`;

  if (cleanPlaylistCard && lastScanResult) {
    const isSpotifyTarget =
      lastScanResult.platform === "spotify" ||
      (lastScanResult.platformName &&
        lastScanResult.platformName.toLowerCase().includes("spotify"));
    const hasDetectedAi = aiCount > 0 || suspiciousCount > 0;
    const isSpotifyUser = Boolean(currentUser && currentUser.provider === "spotify");

    if (isSpotifyTarget && hasDetectedAi && isSpotifyUser) {
      cleanPlaylistCard.classList.remove("hidden");
      if (cleanCardDesc) {
        cleanCardDesc.textContent = `We detected ${aiCount} AI-generated song(s) in "${
          lastScanResult.title || "this playlist"
        }". Create a clean version with ${humanCount} verified human tracks directly in your Spotify library with 1-click.`;
      }
    } else {
      cleanPlaylistCard.classList.add("hidden");
    }
  }
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
const closeReportModalHandler = () => {
  reportModal.classList.add("hidden");
  activeReportingTrack = null;
  activeReportingArtist = null;
  const flagEntireCheckbox = document.getElementById("reportFlagEntireArtist");
  const reportTitleInput = document.getElementById("reportTitle");
  if (flagEntireCheckbox) flagEntireCheckbox.checked = false;
  if (reportTitleInput) {
    reportTitleInput.disabled = false;
    reportTitleInput.placeholder = "e.g. Dust on the Wind";
  }
  const submitBtn = reportForm.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.textContent = "SAVE TO INDEX";
};

openReportBtn.addEventListener("click", () => {
  activeReportingTrack = null;
  activeReportingArtist = null;
  reportForm.reset();
  const flagEntireCheckbox = document.getElementById("reportFlagEntireArtist");
  const reportTitleInput = document.getElementById("reportTitle");
  if (flagEntireCheckbox) flagEntireCheckbox.checked = false;
  if (reportTitleInput) {
    reportTitleInput.disabled = false;
    reportTitleInput.placeholder = "e.g. Dust on the Wind";
  }
  const submitBtn = reportForm.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.textContent = "SAVE TO INDEX";
  reportModal.classList.remove("hidden");
});
closeReportModal.addEventListener("click", closeReportModalHandler);
cancelReportBtn.addEventListener("click", closeReportModalHandler);

const flagEntireArtistCheckbox = document.getElementById("reportFlagEntireArtist");
if (flagEntireArtistCheckbox) {
  flagEntireArtistCheckbox.addEventListener("change", () => {
    const isChecked = flagEntireArtistCheckbox.checked;
    const titleInput = document.getElementById("reportTitle");
    const artistVal = document.getElementById("reportArtist")?.value.trim() || "";
    const matchingCount = artistVal ? getTracksByArtist(artistVal).length : 0;
    const submitBtn = reportForm.querySelector("button[type='submit']");

    if (titleInput) {
      titleInput.disabled = isChecked;
      if (isChecked) {
        titleInput.value = "";
        titleInput.placeholder =
          matchingCount > 0
            ? `(All ${matchingCount} tracks by "${artistVal}" in playlist will be flagged)`
            : "(Entire artist catalog — all tracks will be flagged)";
      } else {
        titleInput.placeholder = "e.g. Dust on the Wind";
      }
    }
    if (submitBtn) {
      if (isChecked) {
        submitBtn.textContent =
          matchingCount > 1
            ? `FLAG ARTIST & ALL ${matchingCount} SONGS`
            : "FLAG ENTIRE ARTIST";
      } else {
        submitBtn.textContent = "SAVE TO INDEX";
      }
    }
  });
}

reportForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const artist = document.getElementById("reportArtist").value.trim();
  const title = document.getElementById("reportTitle").value.trim();
  const platform = document.getElementById("reportPlatform").value;
  const reason = document.getElementById("reportReason").value.trim();
  const isFlagEntireArtist =
    Boolean(document.getElementById("reportFlagEntireArtist")?.checked) ||
    Boolean(activeReportingArtist) ||
    !title;

  const payload = {
    artist,
    title: isFlagEntireArtist ? "" : title,
    isArtistFlag: isFlagEntireArtist,
    platform,
    reason:
      reason ||
      (isFlagEntireArtist
        ? "Flagged entire artist catalog as AI-generated"
        : "Flagged as AI-generated by community user"),
  };

  const submitBtn = reportForm.querySelector("button[type='submit']");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "SAVING...";
  }

  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let errData = {};
      try {
        errData = await res.json();
      } catch (_) {}
      alert(errData.error || `Could not save report (status ${res.status}). Please try again.`);
      return;
    }
    if (res.ok) {
      if (isFlagEntireArtist && artist) {
        const normA = normalizeArtistKey(getPrimaryArtist(artist));
        const fullA = normalizeArtistKey(artist);
        if (normA) sessionFlaggedArtists.add(normA);
        if (fullA) sessionFlaggedArtists.add(fullA);

        const matchingTracks = getTracksByArtist(artist);
        for (const t of matchingTracks) {
          if (!t._originalState) {
            t._originalState = {
              aiProbability: t.aiProbability,
              verdict: t.verdict,
              verdictLabel: t.verdictLabel,
              signals: Array.isArray(t.signals) ? [...t.signals] : [],
              forensics: t.forensics ? { ...t.forensics } : {},
            };
          }
          t.flaggedBySession = true;
          t.artistFlaggedBySession = true;
          t.aiProbability = Math.max(t.aiProbability || 0, 95);
          t.verdict = "ai";
          t.verdictLabel = "SYNTHETIC AI";
          if (t.forensics) {
            t.forensics.matchedDbSource = "Community Flagged";
          }
          t.signals = [
            {
              type: "danger",
              category: "COMMUNITY AI REGISTRY",
              text: `Entire artist flagged as AI-generated by community: ${artist}${
                reason ? ` (${reason})` : ""
              }`,
            },
            ...(t.signals || []).filter(
              (s) =>
                s.category !== "PASS" &&
                s.category !== "COMMUNITY AI REGISTRY" &&
                s.category !== "COMMUNITY REPORT"
            ),
          ];
        }
        updateSummaryCountersFromTracks();
        renderTracksList();
        activeReportingArtist = null;
        activeReportingTrack = null;
      } else if (activeReportingTrack) {
        activeReportingTrack.flaggedBySession = true;
        activeReportingTrack.individuallyFlagged = true;
        activeReportingTrack.aiProbability = Math.max(
          activeReportingTrack.aiProbability || 0,
          95
        );
        activeReportingTrack.verdict = "ai";
        activeReportingTrack.verdictLabel = "FLAGGED AI";
        if (activeReportingTrack.forensics) {
          activeReportingTrack.forensics.matchedDbSource = "Community Flagged";
        }
        activeReportingTrack.signals = [
          {
            type: "danger",
            category: "COMMUNITY REPORT",
            text: `Flagged by you: "${title || activeReportingTrack.title}" — ${
              artist || activeReportingTrack.artist
            } (Pending moderation)`,
          },
          ...(activeReportingTrack.signals || []).filter(
            (s) => s.category !== "PASS"
          ),
        ];
        updateSummaryCountersFromTracks();
        renderTracksList();
        activeReportingTrack = null;
      }
      reportForm.reset();
      reportModal.classList.add("hidden");
      await refreshDatabaseBadge();
      if (dbModal && !dbModal.classList.contains("hidden")) {
        loadDatabaseModal();
      }
    }
  } catch (err) {
    alert("Network error: Could not reach the server to submit report.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "SAVE TO INDEX";
    }
  }
});

const dbSearchInput = document.getElementById("dbSearchInput");
const dbSourceSelect = document.getElementById("dbSourceSelect");
const dbModalSummary = document.getElementById("dbModalSummary");
let dbSearchTimer = null;

openDbBtn.addEventListener("click", async () => {
  dbModal.classList.remove("hidden");
  await loadDatabaseModal();
});
closeDbModal.addEventListener("click", () => dbModal.classList.add("hidden"));

if (dbSearchInput) {
  dbSearchInput.addEventListener("input", () => {
    clearTimeout(dbSearchTimer);
    dbSearchTimer = setTimeout(() => loadDatabaseModal(), 220);
  });
}
if (dbSourceSelect) {
  dbSourceSelect.addEventListener("change", () => loadDatabaseModal());
}

async function refreshDatabaseBadge() {
  try {
    const res = await fetch("/api/database?limit=1");
    const db = await res.json();
    const total = db.totalIndexed || (db.knownAiArtists || []).length;
    dbCountBadge.textContent = total.toLocaleString("en-US");
  } catch {
    // ignore
  }
}

async function loadDatabaseModal() {
  dbModalContent.innerHTML = `<p style="font-family:var(--mono);font-size:0.78rem;color:var(--text-muted)">Syncing live internet AI music databases...</p>`;
  try {
    const q = dbSearchInput ? dbSearchInput.value.trim() : "";
    const source = dbSourceSelect ? dbSourceSelect.value : "all";
    const params = new URLSearchParams({ q, source, limit: "200" });
    const res = await fetch(`/api/database?${params.toString()}`);
    const db = await res.json();
    const list = db.knownAiArtists || [];
    const total = db.totalIndexed || list.length;
    dbCountBadge.textContent = total.toLocaleString("en-US");

    if (dbModalSummary && db.sources) {
      const s = db.sources;
      dbModalSummary.innerHTML = `Total Indexed: <strong>${total.toLocaleString(
        "en-US"
      )}</strong> — Community Flagged: <strong style="color:var(--danger)">${(
        s.community || 0
      ).toLocaleString("en-US")}</strong> · Soul Over AI: <strong>${(
        s.soulOverAi || 0
      ).toLocaleString("en-US")}</strong> · Spotify AI Blocker: <strong>${(
        s.spotifyAiBlocker || 0
      ).toLocaleString("en-US")}</strong> · MusicBrainz AI: <strong>${
        s.musicBrainzAi || 0
      }</strong>`;
    }

    if (list.length === 0) {
      dbModalContent.innerHTML = `<p style="font-family:var(--mono);font-size:0.78rem;color:var(--text-muted)">No indexed AI artists match your search filter.</p>`;
      return;
    }

    dbModalContent.innerHTML = list
      .map((item) => {
        const isComm = String(item.source || "").includes("Community");
        return `
        <div class="db-item ${isComm ? "db-item-community" : ""}">
          <div style="min-width:0;padding-right:10px">
            <div class="db-item-title">${escapeHtml(item.name)}</div>
            <div class="db-item-reason">${escapeHtml(item.reason)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
            <span class="mono-tag ${isComm ? "mono-tag-community" : ""}">${escapeHtml(item.source || item.platform)}</span>
            <span style="font-family:var(--mono);font-size:0.65rem;color:var(--text-muted)">${escapeHtml(item.platform)}</span>
          </div>
        </div>
      `;
      })
      .join("");
  } catch {
    dbModalContent.innerHTML = `<p style="color:var(--danger)">Failed to load index.</p>`;
  }
}

refreshDatabaseBadge();

// Legal & Compliance Modal Controller
const legalModal = document.getElementById("legalModal");
const closeLegalModal = document.getElementById("closeLegalModal");
const closeLegalModalBtn = document.getElementById("closeLegalModalBtn");
const openLegalModalBtn = document.getElementById("openLegalModalBtn");
const openTrademarkModalBtn = document.getElementById("openTrademarkModalBtn");
const openPrivacyModalBtn = document.getElementById("openPrivacyModalBtn");
const openDisputeModalBtn = document.getElementById("openDisputeModalBtn");
const legalTabBtns = document.querySelectorAll(".legal-tab-btn");
const legalSectionBlocks = document.querySelectorAll(".legal-section-block");

function switchLegalTab(targetTabId) {
  legalTabBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === targetTabId);
  });
  legalSectionBlocks.forEach((block) => {
    block.classList.toggle("active", block.id === targetTabId);
  });
}

function openLegalModalWithTab(tabId) {
  if (!legalModal) return;
  switchLegalTab(tabId);
  legalModal.classList.remove("hidden");
}

if (openLegalModalBtn) {
  openLegalModalBtn.addEventListener("click", () => openLegalModalWithTab("tab-heuristics"));
}
if (openTrademarkModalBtn) {
  openTrademarkModalBtn.addEventListener("click", () => openLegalModalWithTab("tab-trademarks"));
}
if (openPrivacyModalBtn) {
  openPrivacyModalBtn.addEventListener("click", () => openLegalModalWithTab("tab-privacy"));
}
if (openDisputeModalBtn) {
  openDisputeModalBtn.addEventListener("click", () => openLegalModalWithTab("tab-dispute"));
}

if (closeLegalModal) {
  closeLegalModal.addEventListener("click", () => legalModal.classList.add("hidden"));
}
if (closeLegalModalBtn) {
  closeLegalModalBtn.addEventListener("click", () => legalModal.classList.add("hidden"));
}

legalTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabId = btn.getAttribute("data-tab");
    if (tabId) switchLegalTab(tabId);
  });
});

// Spotify User Bar & Personal Playlists Event Listeners
if (openMyPlaylistsBtn) {
  openMyPlaylistsBtn.addEventListener("click", openMyPlaylistsModalHandler);
}
if (spotifyHintLoginBtn) {
  spotifyHintLoginBtn.addEventListener("click", () => {
    if (loginModal) loginModal.classList.remove("hidden");
  });
}
if (closeMyPlaylistsModal) {
  closeMyPlaylistsModal.addEventListener("click", () => {
    if (myPlaylistsModal) myPlaylistsModal.classList.add("hidden");
  });
}
if (refreshMyPlaylistsBtn) {
  refreshMyPlaylistsBtn.addEventListener("click", reloadMyPlaylists);
}
if (myPlaylistsSearchInput) {
  myPlaylistsSearchInput.addEventListener("input", () => {
    renderMyPlaylists(userPlaylistsCache);
  });
}
if (createCleanPlaylistBtn) {
  createCleanPlaylistBtn.addEventListener("click", handleCreateCleanPlaylist);
}
if (closeCleanSuccessModal) {
  closeCleanSuccessModal.addEventListener("click", () => {
    if (cleanSuccessModal) cleanSuccessModal.classList.add("hidden");
  });
}

// Close modals when clicking backdrop or pressing Escape
[reportModal, dbModal, legalModal, loginModal, myPlaylistsModal, cleanSuccessModal].forEach((m) => {
  if (!m) return;
  m.addEventListener("click", (e) => {
    if (e.target === m) m.classList.add("hidden");
  });
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (reportModal) reportModal.classList.add("hidden");
    if (dbModal) dbModal.classList.add("hidden");
    if (legalModal) legalModal.classList.add("hidden");
    if (loginModal) loginModal.classList.add("hidden");
    if (myPlaylistsModal) myPlaylistsModal.classList.add("hidden");
    if (cleanSuccessModal) cleanSuccessModal.classList.add("hidden");
  }
});

// Real-time visitor ping for Vercel Runtime Logs
(function recordVisitorPing() {
  try {
    const payload = JSON.stringify({
      referrer: document.referrer || "direct",
      screen: `${window.innerWidth}x${window.innerHeight}`,
      lang: navigator.language || "unknown",
      path: window.location.pathname,
    });
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/visit", blob);
    } else {
      fetch("/api/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch (_) {}
})();
