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
 * Create a mock local development user session (for testing on local server)
 */
function createLocalDevUser(options = {}) {
  const provider = options.provider || "spotify";
  const name = options.name || (provider === "spotify" ? "Spotify Community Reviewer" : "Google Reviewer");
  const email = options.email || `reviewer@local-${provider}.dev`;
  const randId = Math.random().toString(36).substring(2, 9);
  
  const user = {
    userId: `usr_local_${provider}_${randId}`,
    name,
    email,
    provider,
    avatar:
      options.avatar ||
      (provider === "spotify"
        ? "https://open.spotifycdn.com/cdn/images/favicon32.8e66b099.png"
        : "https://www.gstatic.com/images/branding/product/1x/avatar_square_grey_512dp.png"),
    isLocalDev: true,
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
    const scope = encodeURIComponent("user-read-private user-read-email");
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
    return {
      userId: `sp_${p.id}`,
      name: p.display_name || p.id,
      email: p.email || null,
      avatar,
      provider: "spotify",
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

module.exports = {
  signSession,
  verifySession,
  parseCookies,
  getUserFromRequest,
  serializeSessionCookie,
  createLocalDevUser,
  getOAuthUrl,
  exchangeOAuthCode,
};
