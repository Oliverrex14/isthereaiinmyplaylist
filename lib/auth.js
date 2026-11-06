const crypto = require("crypto");

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (process.env.NODE_ENV === "production"
    ? crypto.randomBytes(32).toString("hex")
    : "isthereaiinmyplaylist-secret-auth-key-2026-fallback-local");
const COOKIE_NAME = "ai_auth_session";
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

/**
 * Sign user payload into a tamper-proof session token (HMAC-SHA256)
 */
function signSession(userPayload) {
  const payload = {
    ...userPayload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC,
  };
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(b64Payload)
    .digest("base64url");
  return `${b64Payload}.${signature}`;
}

/**
 * Verify and decode session token
 */
function verifySession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [b64Payload, signature] = parts;
  const expectedSig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(b64Payload)
    .digest("base64url");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const jsonStr = Buffer.from(b64Payload, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr);
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Parse cookies from incoming HTTP request
 */
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;

  rc.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const name = parts.shift().trim();
    if (name) {
      list[name] = decodeURIComponent(parts.join("="));
    }
  });
  return list;
}

/**
 * Extract authenticated user from request cookie (or Bearer Authorization header)
 */
function getUserFromRequest(req) {
  // 1. Check Authorization Bearer header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7).trim();
    const user = verifySession(bearerToken);
    if (user) return user;
  }

  // 2. Check HTTP-only session cookie
  const cookies = parseCookies(req);
  const sessionToken = cookies[COOKIE_NAME];
  if (!sessionToken) return null;

  return verifySession(sessionToken);
}

/**
 * Build Set-Cookie header for session
 */
function serializeSessionCookie(token, isLogout = false) {
  if (isLogout) {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
  const isSecure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${isSecure}`;
}

/**
 * Mock local playlists for local development simulator
 */
const MOCK_LOCAL_PLAYLISTS = [
  {
    id: "local_pl_1",
    name: "Late Night Lo-Fi & Beats (Personal Mix)",
    description: "Curated ambient and chill beats for late night coding sessions.",
    trackCount: 38,
    public: false,
    collaborative: false,
    owner: "You",
    imageUrl: "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=300&h=300&fit=crop",
    url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
  },
  {
    id: "local_pl_2",
    name: "Indie Rock & Workout Heat ⚡",
    description: "High energy human indie rock and alternative anthems.",
    trackCount: 52,
    public: true,
    collaborative: false,
    owner: "You",
    imageUrl: "https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=300&h=300&fit=crop",
    url: "https://open.spotify.com/playlist/37i9dQZF1DXd9rSDyQguIk",
    uri: "spotify:playlist:37i9dQZF1DXd9rSDyQguIk",
  },
  {
    id: "local_pl_3",
    name: "Acoustic Coffeehouse Favorites ☕",
    description: "Verified singer-songwriter acoustic folk tracks.",
    trackCount: 29,
    public: false,
    collaborative: true,
    owner: "You",
    imageUrl: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop",
    url: "https://open.spotify.com/playlist/37i9dQZF1DX6ziVCJnEm59",
    uri: "spotify:playlist:37i9dQZF1DX6ziVCJnEm59",
  },
];

/**
 * Create a mock local development user session (for testing on local server)
 */
function createLocalDevUser(options = {}) {
  const provider = options.provider || "spotify";
  const name =
    options.name ||
    (provider === "spotify" ? "Spotify Community Reviewer" : "Google Reviewer");
  const email = options.email || `reviewer@local-${provider}.dev`;
  const randId = Math.random().toString(36).substring(2, 9);

  const user = {
    userId: `usr_local_${provider}_${randId}`,
    spotifyRawId: "mock_spotify_user",
    name,
    email,
    provider,
    avatar:
      options.avatar ||
      (provider === "spotify"
        ? "https://open.spotifycdn.com/cdn/images/favicon32.8e66b099.png"
        : "https://www.gstatic.com/images/branding/product/1x/avatar_square_grey_512dp.png"),
    isLocalDev: true,
    followers: 128,
    product: "premium",
    country: "CZ",
    spotifyAccessToken: provider === "spotify" ? "mock-dev-spotify-token" : null,
    spotifyRefreshToken: provider === "spotify" ? "mock-dev-refresh-token" : null,
    spotifyTokenExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  const token = signSession(user);
  return { user, token };
}

/**
 * Get OAuth Authorization URL for configured provider
 */
function getOAuthUrl(provider, redirectUri, state) {
  if (provider === "spotify") {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    if (!clientId) return null;
    const scopes = [
      "user-read-private",
      "user-read-email",
      "playlist-read-private",
      "playlist-read-collaborative",
      "playlist-modify-public",
      "playlist-modify-private",
    ].join(" ");
    const scope = encodeURIComponent(scopes);
    return `https://accounts.spotify.com/authorize?response_type=code&client_id=${clientId}&scope=${scope}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${encodeURIComponent(state)}`;
  }

  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return null;
    const scope = encodeURIComponent("openid profile email");
    return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&scope=${scope}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${encodeURIComponent(state)}`;
  }

  return null;
}

/**
 * Exchange OAuth authorization code for user profile
 */
async function exchangeOAuthCode(provider, code, redirectUri) {
  if (provider === "spotify") {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("Spotify OAuth credentials not configured on server.");
    }

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Failed to exchange Spotify code: ${errText}`);
    }

    const tokenData = await tokenRes.json();
    const profileRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      throw new Error("Failed to fetch Spotify profile.");
    }

    const p = await profileRes.json();
    const avatar = p.images?.[0]?.url || null;
    const expiresInSec = parseInt(tokenData.expires_in, 10) || 3600;

    return {
      userId: `sp_${p.id}`,
      spotifyRawId: p.id,
      name: p.display_name || p.id,
      email: p.email || null,
      avatar,
      country: p.country || null,
      followers: p.followers?.total || 0,
      product: p.product || null,
      provider: "spotify",
      spotifyAccessToken: tokenData.access_token || null,
      spotifyRefreshToken: tokenData.refresh_token || null,
      spotifyTokenExpiresAt: Date.now() + expiresInSec * 1000,
    };
  }

  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("Google OAuth credentials not configured on server.");
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      throw new Error("Failed to exchange Google OAuth code.");
    }

    const tokenData = await tokenRes.json();
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      }
    );

    if (!profileRes.ok) {
      throw new Error("Failed to fetch Google profile.");
    }

    const p = await profileRes.json();
    return {
      userId: `goog_${p.sub}`,
      name: p.name || p.email,
      email: p.email || null,
      avatar: p.picture || null,
      provider: "google",
    };
  }

  throw new Error(`Unsupported OAuth provider: ${provider}`);
}

/**
 * Get active, non-expired Spotify Access Token for the user (auto-refreshes if needed)
 */
async function getFreshSpotifyToken(user) {
  if (!user || user.provider !== "spotify") return null;
  if (user.isLocalDev) return "mock-dev-spotify-token";

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Buffer: refresh 60 seconds before expiration
  const isExpiringSoon =
    user.spotifyTokenExpiresAt &&
    Date.now() > user.spotifyTokenExpiresAt - 60000;

  if (user.spotifyAccessToken && !isExpiringSoon) {
    return user.spotifyAccessToken;
  }

  if (user.spotifyRefreshToken) {
    try {
      const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(
            `${clientId}:${clientSecret}`
          ).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: user.spotifyRefreshToken,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        user.spotifyAccessToken = data.access_token;
        if (data.refresh_token) user.spotifyRefreshToken = data.refresh_token;
        const expiresInSec = parseInt(data.expires_in, 10) || 3600;
        user.spotifyTokenExpiresAt = Date.now() + expiresInSec * 1000;
        return user.spotifyAccessToken;
      }
    } catch (err) {
      console.error("[SPOTIFY REFRESH ERROR]", err.message || err);
    }
  }

  return user.spotifyAccessToken || null;
}

/**
 * Fetch all Spotify playlists belonging to or followed by the authenticated user
 */
async function getUserSpotifyPlaylists(user) {
  if (!user || user.provider !== "spotify") {
    throw new Error("Spotify authentication required to access personal playlists.");
  }

  if (user.isLocalDev) {
    return MOCK_LOCAL_PLAYLISTS;
  }

  const token = await getFreshSpotifyToken(user);
  if (!token) {
    throw new Error(
      "Spotify session expired. Please sign in again with Spotify."
    );
  }

  const allPlaylists = [];
  let nextUrl = "https://api.spotify.com/v1/me/playlists?limit=50";
  let pageCount = 0;

  while (nextUrl && pageCount < 3) {
    pageCount++;
    const res = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("Spotify authorization revoked. Please sign in again.");
      }
      const errText = await res.text();
      throw new Error(`Spotify API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];

    for (const item of items) {
      if (!item || !item.id) continue;
      const imageUrl =
        item.images?.[0]?.url ||
        item.images?.[1]?.url ||
        null;
      const trackCount = item.tracks?.total ?? 0;
      const isOwner =
        item.owner?.id === user.spotifyRawId ||
        item.owner?.display_name === user.name;

      allPlaylists.push({
        id: item.id,
        name: item.name || "Untitled Playlist",
        description: item.description || "",
        trackCount,
        public: Boolean(item.public),
        collaborative: Boolean(item.collaborative),
        isOwner,
        owner: item.owner?.display_name || item.owner?.id || "Spotify",
        imageUrl,
        url:
          item.external_urls?.spotify ||
          `https://open.spotify.com/playlist/${item.id}`,
        uri: item.uri || `spotify:playlist:${item.id}`,
      });
    }

    nextUrl = data.next || null;
  }

  return allPlaylists;
}

/**
 * Create a clean, verified human playlist directly in user's Spotify account
 * (Removes detected AI tracks and preserves authentic human music)
 */
async function createCleanSpotifyPlaylist(
  user,
  { name, description, trackUris = [] }
) {
  if (!user || user.provider !== "spotify") {
    throw new Error("Spotify authentication required to create playlists.");
  }

  const cleanName = `${(name || "Playlist").trim()} [AI-Free]`;
  const cleanDesc =
    description ||
    "Created by IsThereAIInMyPlaylist.tech — 100% human verified tracks without AI generation.";

  if (user.isLocalDev) {
    return {
      success: true,
      playlistId: `local_clean_${Date.now()}`,
      playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
      playlistName: cleanName,
      tracksAdded: trackUris.length,
      isLocalDev: true,
    };
  }

  const token = await getFreshSpotifyToken(user);
  if (!token) {
    throw new Error(
      "Spotify session expired. Please sign in again to create the playlist."
    );
  }

  // 1. Get raw Spotify User ID
  let spotifyUserId = user.spotifyRawId;
  if (!spotifyUserId) {
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) {
      throw new Error("Failed to fetch user Spotify ID.");
    }
    const meData = await meRes.json();
    spotifyUserId = meData.id;
  }

  // 2. Create the empty playlist in the user's Spotify library
  const createRes = await fetch(
    `https://api.spotify.com/v1/users/${encodeURIComponent(spotifyUserId)}/playlists`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: cleanName,
        description: cleanDesc,
        public: false,
      }),
    }
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create playlist on Spotify: ${errText}`);
  }

  const newPlaylist = await createRes.json();
  const playlistId = newPlaylist.id;
  const playlistUrl =
    newPlaylist.external_urls?.spotify ||
    `https://open.spotify.com/playlist/${playlistId}`;

  // 3. Populate human tracks in chunks of 100 (Spotify API limit per call)
  const validUris = (trackUris || []).filter(
    (u) => typeof u === "string" && u.startsWith("spotify:track:")
  );

  const BATCH_SIZE = 100;
  for (let i = 0; i < validUris.length; i += BATCH_SIZE) {
    const batch = validUris.slice(i, i + BATCH_SIZE);
    try {
      const addRes = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uris: batch }),
        }
      );
      if (!addRes.ok) {
        console.warn("[SPOTIFY ADD TRACKS WARN]", await addRes.text());
      }
    } catch (err) {
      console.warn("[SPOTIFY ADD TRACKS ERROR]", err.message);
    }
  }

  return {
    success: true,
    playlistId,
    playlistUrl,
    playlistName: cleanName,
    tracksAdded: validUris.length,
  };
}

module.exports = {
  signSession,
  verifySession,
  parseCookies,
  getUserFromRequest,
  serializeSessionCookie,
  createLocalDevUser,
  getOAuthUrl,
  exchangeOAuthCode,
  getFreshSpotifyToken,
  getUserSpotifyPlaylists,
  createCleanSpotifyPlaylist,
};
