const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Identify platform and extract playlist ID or canonical URL
 */
function detectPlatform(rawUrl) {
  const input = (rawUrl || "").trim();
  if (!input) {
    throw new Error("Zadej prosím odkaz na playlist.");
  }

  // Demo modes for quick testing
  if (input.startsWith("demo:")) {
    return { platform: "demo", id: input.replace("demo:", ""), url: input };
  }

  // Handle spotify:playlist:URI
  if (input.startsWith("spotify:playlist:")) {
    const id = input.split(":")[2];
    return {
      platform: "spotify",
      id,
      url: `https://open.spotify.com/playlist/${id}`,
    };
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(
      "Neplatná URL adresa. Vlož prosím celý odkaz (např. https://open.spotify.com/playlist/...)."
    );
  }

  const host = parsed.hostname.toLowerCase();

  // Spotify
  if (host.includes("spotify.com") || host.includes("spotify.link")) {
    const match = parsed.pathname.match(/\/(?:playlist|album)\/([a-zA-Z0-9]+)/);
    const isAlbum = parsed.pathname.includes("/album/");
    if (!match) {
      throw new Error(
        "Nepodařilo se najít ID Spotify playlistu v odkazu. Ujisti se, že jde o odkaz na playlist (open.spotify.com/playlist/...)."
      );
    }
    return {
      platform: "spotify",
      entityType: isAlbum ? "album" : "playlist",
      id: match[1],
      url: input,
    };
  }

  // Apple Music
  if (host.includes("music.apple.com")) {
    const match = parsed.pathname.match(/\/(playlist|album)\/[^/]+\/(pl\.[a-zA-Z0-9._-]+|[0-9]+)/);
    return {
      platform: "apple",
      id: match ? match[2] : parsed.pathname,
      url: input,
    };
  }

  // YouTube / YouTube Music
  if (
    host.includes("youtube.com") ||
    host.includes("youtu.be") ||
    host.includes("music.youtube.com")
  ) {
    const listId = parsed.searchParams.get("list");
    const videoId = parsed.searchParams.get("v") || (host.includes("youtu.be") ? parsed.pathname.slice(1) : null);
    if (!listId && !videoId) {
      throw new Error(
        "V odkazu na YouTube chybí parametr playlistu (?list=...). Vlož odkaz na veřejný YouTube nebo YouTube Music playlist."
      );
    }
    return {
      platform: "youtube",
      id: listId || videoId,
      isSingleVideo: !listId && !!videoId,
      url: input,
    };
  }

  throw new Error(
    "Nepodporovaná platforma. Podporujeme veřejné playlisty ze Spotify, Apple Music a YouTube / YouTube Music."
  );
}

/**
 * Fetch Spotify public playlist via Embed SSR JSON (__NEXT_DATA__)
 */
async function fetchSpotifyPlaylist(info) {
  const type = info.entityType || "playlist";
  const embedUrl = `https://open.spotify.com/embed/${type}/${info.id}`;

  const res = await fetch(embedUrl, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Spotify vrátil chybu (${res.status}). Zkontroluj, zda je playlist nastavený jako veřejný.`
    );
  }

  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );

  if (!match) {
    throw new Error(
      "Nepodařilo se načíst data ze Spotify playlistu. Playlist je pravděpodobně soukromý nebo neexistuje."
    );
  }

  const data = JSON.parse(match[1]);
  const entity = data?.props?.pageProps?.state?.data?.entity;
  if (!entity || !Array.isArray(entity.trackList)) {
    throw new Error(
      "Tento Spotify playlist neobsahuje žádné veřejně dostupné skladby."
    );
  }

  const coverImage =
    entity.coverArt?.sources?.[0]?.url ||
    entity.visualIdentity?.image?.[0]?.url ||
    null;

  const tracks = entity.trackList.map((item, idx) => {
    const trackId = item.uri ? item.uri.split(":").pop() : `sp-${idx}`;
    return {
      id: trackId,
      index: idx + 1,
      title: item.title || "Neznámá skladba",
      artist: (item.subtitle || "Neznámý interpret").replace(/\u00a0/g, " "),
      durationMs: item.duration || 0,
      isExplicit: !!item.isExplicit,
      previewUrl: item.audioPreview?.url || null,
      externalUrl: `https://open.spotify.com/track/${trackId}`,
      platform: "spotify",
    };
  });

  return {
    platform: "spotify",
    platformName: "Spotify",
    playlistId: info.id,
    title: entity.name || entity.title || "Spotify Playlist",
    owner: entity.subtitle || "Spotify User",
    coverUrl: coverImage,
    totalTracks: tracks.length,
    tracks,
  };
}

/**
 * Fetch Apple Music public playlist via serialized-server-data
 */
async function fetchAppleMusicPlaylist(info) {
  const res = await fetch(info.url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Apple Music vrátil chybu (${res.status}). Ujisti se, že je playlist veřejný.`
    );
  }

  const html = await res.text();
  const match = html.match(
    /<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/
  );

  if (!match) {
    throw new Error(
      "Nepodařilo se načíst data z Apple Music. Zkontroluj, zda je odkaz správný a playlist veřejný."
    );
  }

  const data = JSON.parse(match[1]);

  let playlistTitle = "Apple Music Playlist";
  let playlistSubtitle = "Apple Music";
  let coverUrl = null;
  const rawItems = [];

  function walk(obj) {
    if (!obj || typeof obj !== "object") return;

    if (obj.itemKind === "containerDetailHeaderLockup" && obj.title) {
      playlistTitle = obj.title;
      if (obj.subtitleLinks?.[0]?.title) {
        playlistSubtitle = obj.subtitleLinks[0].title;
      }
      if (obj.artwork?.dictionary?.url) {
        coverUrl = obj.artwork.dictionary.url
          .replace("{w}", "400")
          .replace("{h}", "400")
          .replace("{f}", "jpg");
      }
    }

    if (obj.itemKind === "trackLockup" && Array.isArray(obj.items)) {
      rawItems.push(...obj.items);
      return;
    }

    for (const k of Object.keys(obj)) {
      walk(obj[k]);
    }
  }

  walk(data);

  // Fallback title from <title> tag
  if (playlistTitle === "Apple Music Playlist") {
    const titleTag = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (titleTag) {
      playlistTitle = titleTag[1].replace(/\s*on Apple Music.*$/i, "");
    }
  }

  if (rawItems.length === 0) {
    throw new Error(
      "V tomto Apple Music playlistu se nepodařilo najít žádné skladby."
    );
  }

  const tracks = rawItems.map((item, idx) => {
    const artistFromLinks = Array.isArray(item.subtitleLinks)
      ? item.subtitleLinks.map((s) => s.title).filter(Boolean).join(", ")
      : "";
    const artist = item.artistName || artistFromLinks || "Neznámý interpret";
    const album = item.tertiaryLinks?.[0]?.title || null;
    const adamId =
      item.contentDescriptor?.identifiers?.storeAdamID || `am-${idx}`;
    const itemUrl =
      item.contentDescriptor?.url || info.url;

    // Extract preview asset if present in playAction
    let previewUrl = null;
    try {
      const assets =
        item.playAction?.items?.[0]?.assets ||
        item.playAction?.actionDetails?.assets;
      if (Array.isArray(assets) && assets[0]?.url) {
        previewUrl = assets[0].url;
      }
    } catch {
      // ignore
    }

    return {
      id: String(adamId),
      index: idx + 1,
      title: item.title || "Neznámá skladba",
      artist,
      album,
      composer: item.composer || null,
      durationMs: item.duration || 0,
      isExplicit: !!item.showExplicitBadge,
      previewUrl,
      externalUrl: itemUrl,
      platform: "apple",
    };
  });

  return {
    platform: "apple",
    platformName: "Apple Music",
    playlistId: info.id,
    title: playlistTitle,
    owner: playlistSubtitle,
    coverUrl,
    totalTracks: tracks.length,
    tracks,
  };
}

/**
 * Helper to parse Artist - Title from YouTube video titles when channel is a label/uploader
 */
function parseYouTubeTitleAndArtist(rawTitle, channelName) {
  let cleanChannel = (channelName || "Neznámý kanál")
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s*VEVO$/i, "")
    .trim();

  let title = rawTitle || "Neznámé video";
  let artist = cleanChannel;

  // Common pattern: "Artist - Song Title (Official Video)"
  const dashSplit = title.split(/\s+[-–—]\s+/);
  if (dashSplit.length >= 2) {
    const candidateArtist = dashSplit[0].trim();
    const candidateTitle = dashSplit.slice(1).join(" - ").trim();
    if (candidateArtist.length >= 2 && candidateArtist.length <= 50) {
      artist = candidateArtist;
      title = candidateTitle;
    }
  }

  return {
    title,
    rawTitle: rawTitle || title,
    artist,
    channelName: channelName || cleanChannel,
  };
}

/**
 * Fetch YouTube / YouTube Music public playlist via ytInitialData
 */
async function fetchYouTubePlaylist(info) {
  const targetUrl = info.isSingleVideo
    ? `https://www.youtube.com/watch?v=${info.id}`
    : `https://www.youtube.com/playlist?list=${info.id}`;

  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      Cookie:
        "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnPpwY; CONSENT=YES+cb.20210328-17-p0.en+FX+410",
    },
  });

  if (!res.ok) {
    throw new Error(
      `YouTube vrátil chybu (${res.status}). Zkontroluj, zda je playlist veřejný.`
    );
  }

  const html = await res.text();
  const match = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!match) {
    throw new Error(
      "Nepodařilo se načíst data z YouTube playlistu. Ujisti se, že je playlist nastavený jako Veřejný nebo Neveřejný (s odkazem)."
    );
  }

  const data = JSON.parse(match[1]);
  const playlistTitle =
    data?.metadata?.playlistMetadataRenderer?.title ||
    data?.header?.playlistHeaderRenderer?.title?.simpleText ||
    data?.header?.pageHeaderRenderer?.pageTitle ||
    "YouTube Playlist";

  const coverUrl =
    data?.microformat?.microformatDataRenderer?.thumbnail?.thumbnails?.[0]
      ?.url || null;

  const extracted = [];
  const seenIds = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== "object") return;

    // Classic playlistVideoRenderer
    if (obj.playlistVideoRenderer) {
      const v = obj.playlistVideoRenderer;
      const vid = v.videoId;
      if (vid && !seenIds.has(vid)) {
        seenIds.add(vid);
        const rawTitle =
          v.title?.runs?.[0]?.text || v.title?.simpleText || "Neznámá skladba";
        const channel =
          v.shortBylineText?.runs?.[0]?.text || "Neznámý kanál";
        const durationSec = parseInt(v.lengthSeconds || "0", 10);
        const parsed = parseYouTubeTitleAndArtist(rawTitle, channel);

        extracted.push({
          id: vid,
          index: extracted.length + 1,
          title: parsed.title,
          rawTitle: parsed.rawTitle,
          artist: parsed.artist,
          channelName: parsed.channelName,
          durationMs: durationSec * 1000,
          isExplicit: false,
          previewUrl: null,
          externalUrl: `https://www.youtube.com/watch?v=${vid}`,
          platform: "youtube",
        });
      }
      return;
    }

    // Modern lockupViewModel (used by YouTube Music / Charts playlists)
    if (obj.lockupViewModel && obj.lockupViewModel.contentId) {
      const l = obj.lockupViewModel;
      const vid = l.contentId;
      if (vid && !seenIds.has(vid)) {
        seenIds.add(vid);
        const meta = l.metadata?.lockupMetadataViewModel;
        const rawTitle = meta?.title?.content || "Neznámá skladba";
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows;
        const channel =
          rows?.[0]?.metadataParts?.[0]?.text?.content || "Neznámý kanál";
        const parsed = parseYouTubeTitleAndArtist(rawTitle, channel);

        extracted.push({
          id: vid,
          index: extracted.length + 1,
          title: parsed.title,
          rawTitle: parsed.rawTitle,
          artist: parsed.artist,
          channelName: parsed.channelName,
          durationMs: 0,
          isExplicit: false,
          previewUrl: null,
          externalUrl: `https://www.youtube.com/watch?v=${vid}`,
          platform: "youtube",
        });
      }
      return;
    }

    for (const k of Object.keys(obj)) {
      walk(obj[k]);
    }
  }

  walk(data);

  if (extracted.length === 0) {
    throw new Error(
      "Tento YouTube playlist je prázdný nebo je nastavený jako Soukromý."
    );
  }

  return {
    platform: "youtube",
    platformName: "YouTube / YT Music",
    playlistId: info.id,
    title: playlistTitle,
    owner: "YouTube Playlist",
    coverUrl,
    totalTracks: extracted.length,
    tracks: extracted,
  };
}

/**
 * Built-in Demo Playlists so the user can test AI detection immediately with 1 click
 */
function getDemoPlaylist(demoType) {
  if (demoType === "mixed") {
    return {
      platform: "spotify",
      platformName: "Spotify (Ukázkový Mix)",
      playlistId: "demo-mixed",
      title: "Late Night Vibes & Viral Hits 2026 (Testovací Playlist)",
      owner: "Testovací profil",
      coverUrl: null,
      totalTracks: 8,
      tracks: [
        {
          id: "demo-1",
          index: 1,
          title: "Dust on the Wind",
          artist: "The Velvet Sundown",
          durationMs: 194000,
          isExplicit: false,
          previewUrl: null,
          externalUrl: "https://open.spotify.com",
          platform: "spotify",
        },
        {
          id: "demo-2",
          index: 2,
          title: "The Less I Know The Better",
          artist: "Tame Impala",
          durationMs: 216000,
          isExplicit: false,
          previewUrl: null,
          externalUrl: "https://open.spotify.com",
          platform: "spotify",
        },
        {
          id: "demo-3",
          index: 3,
          title: "Neon Cybernetic Dreams [Suno v4 AI]",
          artist: "Neon Synth AI",
          durationMs: 158000,
          isExplicit: false,
          previewUrl: null,
          externalUrl: "https://open.spotify.com",
          platform: "spotify",
        },
        {
          id: "demo-4",
          index: 4,
          title: "Blinding Lights",
          artist: "The Weeknd",
          durationMs: 200000,
          isExplicit: false,
          previewUrl: null,
          externalUrl: "https://open.spotify.com",
          platform: "spotify",
        },
        {
          id: "demo-5",
          index: 5,
          title: "Heart on My Sleeve (AI Cover)",
          artist: "Ghostwriter977",
          durationMs: 134000,
          isExplicit: true,
          previewUrl: null,
          externalUrl: "https://www.youtube.com",
          platform: "youtube",
        },
        {
          id: "demo-6",
          index: 6,
          title: "Midnight Study Rain Lo-Fi",
          artist: "Breezeway Cocktail",
          durationMs: 121000,
          isExplicit: false,
          previewUrl: null,
          externalUrl: "https://open.spotify.com",
          platform: "spotify",
        },
        {
          id: "demo-7",
          index: 7,
          title: "Starboy",
          artist: "Daft Punk",
          durationMs: 230000,
          isExplicit: false,
          previewUrl: null,
          externalUrl: "https://open.spotify.com",
          platform: "spotify",
        },
        {
          id: "demo-8",
          index: 8,
          title: "Deep Focus Alpha Waves",
          artist: "Endel",
          durationMs: 185000,
          isExplicit: false,
          previewUrl: null,
          externalUrl: "https://music.apple.com",
          platform: "apple",
        },
      ],
    };
  }

  throw new Error("Neznámý demo playlist.");
}

async function fetchPlaylist(rawUrl) {
  const info = detectPlatform(rawUrl);

  if (info.platform === "demo") {
    return getDemoPlaylist(info.id);
  }
  if (info.platform === "spotify") {
    return await fetchSpotifyPlaylist(info);
  }
  if (info.platform === "apple") {
    return await fetchAppleMusicPlaylist(info);
  }
  if (info.platform === "youtube") {
    return await fetchYouTubePlaylist(info);
  }

  throw new Error("Nepodporovaná platforma.");
}

module.exports = {
  detectPlatform,
  fetchPlaylist,
};
