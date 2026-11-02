const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Identify input type:
 * - Direct URL (Spotify / Apple Music / YouTube — Playlist, Album, Single Track, or Artist/Channel)
 * - Plain text query (Artist name or "Artist - Track Title"), governed by optional modeHint ('auto' | 'playlist' | 'track' | 'artist')
 */
function detectInputTarget(rawInput, modeHint = "auto") {
  const input = (rawInput || "").trim();
  if (!input) {
    throw new Error("Please enter a URL, artist name, or song title.");
  }

  // Demo vectors
  if (input.startsWith("demo:")) {
    return { platform: "demo", targetType: "demo", id: input.replace("demo:", ""), url: input };
  }

  // Handle spotify: URI scheme
  if (input.startsWith("spotify:")) {
    const parts = input.split(":");
    const entityType = parts[1] || "playlist"; // playlist | track | artist | album
    const id = parts[2];
    return {
      platform: "spotify",
      entityType,
      id,
      url: `https://open.spotify.com/${entityType}/${id}`,
    };
  }

  // Check if input looks like a URL (or contains a URL inside shared text like "Check out this playlist https://...")
  const urlMatch = input.match(/https?:\/\/[^\s]+/i);
  const candidateUrl = urlMatch ? urlMatch[0] : input;

  const isUrl =
    /^https?:\/\//i.test(candidateUrl) ||
    /^(open\.spotify\.com|music\.apple\.com|www\.youtube\.com|youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(
      candidateUrl
    );

  if (isUrl) {
    const normalizedUrl = /^https?:\/\//i.test(candidateUrl)
      ? candidateUrl
      : `https://${candidateUrl}`;
    let parsed;
    try {
      parsed = new URL(normalizedUrl);
    } catch {
      throw new Error("Invalid URL format. Please paste a valid link.");
    }

    const host = parsed.hostname.toLowerCase();

    // 1. Spotify URL (playlist, track, artist, album)
    if (host.includes("spotify.com") || host.includes("spotify.link")) {
      const match = parsed.pathname.match(/\/(playlist|track|artist|album)\/([a-zA-Z0-9]+)/);
      if (!match) {
        throw new Error(
          "Could not recognize Spotify URL. Supported links: /playlist/..., /track/..., /artist/..., or /album/..."
        );
      }
      return {
        platform: "spotify",
        entityType: match[1], // 'playlist' | 'track' | 'artist' | 'album'
        id: match[2],
        url: normalizedUrl,
      };
    }

    // 2. Apple Music URL (playlist, album, artist, song/track)
    if (host.includes("music.apple.com")) {
      const songParamId = parsed.searchParams.get("i");
      if (songParamId) {
        return {
          platform: "apple",
          entityType: "track",
          id: songParamId,
          url: normalizedUrl,
        };
      }
      const match = parsed.pathname.match(/\/(playlist|album|artist|song)\/(?:[^/]+\/)?(pl\.[a-zA-Z0-9._-]+|[0-9]+)/);
      const entityType = match ? (match[1] === "song" ? "track" : match[1]) : "playlist";
      return {
        platform: "apple",
        entityType,
        id: match ? match[2] : parsed.pathname,
        url: normalizedUrl,
      };
    }

    // 3. YouTube / YouTube Music URL (playlist, single video/song, or channel/artist)
    if (
      host.includes("youtube.com") ||
      host.includes("youtu.be") ||
      host.includes("music.youtube.com")
    ) {
      const listId = parsed.searchParams.get("list");
      const videoId =
        parsed.searchParams.get("v") ||
        (host.includes("youtu.be") ? parsed.pathname.slice(1) : null) ||
        (parsed.pathname.startsWith("/shorts/") ? parsed.pathname.split("/")[2] : null);

      // If modeHint is explicitly 'track' and videoId is present, treat as single track even if list param is in URL
      if (videoId && (!listId || modeHint === "track")) {
        return {
          platform: "youtube",
          entityType: "track",
          id: videoId,
          url: normalizedUrl,
        };
      }

      if (listId) {
        return {
          platform: "youtube",
          entityType: "playlist",
          id: listId,
          url: normalizedUrl,
        };
      }

      // YouTube Channel / Artist handle (/@handle or /channel/UC...)
      if (
        parsed.pathname.startsWith("/@") ||
        parsed.pathname.startsWith("/channel/") ||
        parsed.pathname.startsWith("/c/")
      ) {
        return {
          platform: "youtube",
          entityType: "artist",
          id: parsed.pathname,
          url: normalizedUrl,
        };
      }

      throw new Error(
        "Unrecognized YouTube URL. Paste a playlist (?list=...), video (?v=...), or channel (/@...) link."
      );
    }

    throw new Error(
      "Unsupported URL domain. We support Spotify, Apple Music, and YouTube / YouTube Music."
    );
  }

  // Plain-text search query (Artist name or Song query)
  let queryType = modeHint;
  if (queryType === "auto" || queryType === "playlist") {
    // If contains " - " or " by ", likely a specific song query; otherwise artist/song auto-resolve
    queryType = /\s+[-–—]\s+|\s+by\s+/i.test(input) ? "track" : "artist";
  }

  return {
    platform: "search",
    entityType: queryType, // 'artist' | 'track'
    query: input,
    url: input,
  };
}

/**
 * Fetch Spotify Entity via Embed SSR JSON (__NEXT_DATA__)
 * Supports: playlist, album, artist (top tracks), and single track!
 */
async function fetchSpotifyEntity(info) {
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
      `Spotify returned an error (${res.status}). Make sure the ${type} is public.`
    );
  }

  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );

  if (!match) {
    throw new Error(`Could not load data from Spotify ${type}.`);
  }

  const data = JSON.parse(match[1]);
  const entity = data?.props?.pageProps?.state?.data?.entity;
  if (!entity) {
    throw new Error(`Spotify ${type} data was empty.`);
  }

  const coverImage =
    entity.coverArt?.sources?.[0]?.url ||
    entity.visualIdentity?.image?.[0]?.url ||
    null;

  // Case A: Single Track
  if (type === "track" || entity.type === "track") {
    const artistNames = Array.isArray(entity.artists)
      ? entity.artists.map((a) => a.name).filter(Boolean).join(", ")
      : entity.subtitle || "Unknown Artist";

    const trackObj = {
      id: entity.id || info.id,
      index: 1,
      title: entity.title || entity.name || "Unknown Track",
      artist: artistNames.replace(/\u00a0/g, " "),
      durationMs: entity.duration || 0,
      isExplicit: !!entity.isExplicit,
      previewUrl: entity.audioPreview?.url || null,
      externalUrl: `https://open.spotify.com/track/${entity.id || info.id}`,
      platform: "spotify",
    };

    return {
      platform: "spotify",
      platformName: "Spotify (Single Track)",
      targetType: "track",
      playlistId: info.id,
      title: `${trackObj.title} — ${trackObj.artist}`,
      owner: `Single Track Inspection`,
      coverUrl: coverImage,
      totalTracks: 1,
      tracks: [trackObj],
    };
  }

  // Case B: Playlist, Album, or Artist Top Tracks
  if (!Array.isArray(entity.trackList) || entity.trackList.length === 0) {
    throw new Error(`No public tracks found in this Spotify ${type}.`);
  }

  const defaultArtist =
    type === "artist" ? entity.name || entity.title || "Unknown Artist" : null;

  const tracks = entity.trackList.map((item, idx) => {
    const trackId = item.uri ? item.uri.split(":").pop() : `sp-${idx}`;
    return {
      id: trackId,
      index: idx + 1,
      title: item.title || "Unknown Track",
      artist: (item.subtitle || defaultArtist || "Unknown Artist").replace(
        /\u00a0/g,
        " "
      ),
      durationMs: item.duration || 0,
      isExplicit: !!item.isExplicit,
      previewUrl: item.audioPreview?.url || null,
      externalUrl: `https://open.spotify.com/track/${trackId}`,
      platform: "spotify",
    };
  });

  const labelMap = {
    artist: "Spotify (Artist Profile)",
    album: "Spotify (Album)",
    playlist: "Spotify (Playlist)",
  };

  return {
    platform: "spotify",
    platformName: labelMap[type] || "Spotify",
    targetType: type,
    playlistId: info.id,
    title: entity.name || entity.title || `Spotify ${type}`,
    owner:
      type === "artist"
        ? `Artist Top Catalog (${tracks.length} tracks)`
        : entity.subtitle || "Spotify",
    coverUrl: coverImage,
    totalTracks: tracks.length,
    tracks,
  };
}

/**
 * Fetch Apple Music Entity (Playlist, Album, Artist, or Single Track)
 */
async function fetchAppleMusicEntity(info) {
  // If single track ID via ?i= or /song/..., use iTunes Lookup API first for clean metadata + previewUrl
  if (info.entityType === "track" && /^[0-9]+$/.test(String(info.id))) {
    const lookupRes = await fetch(
      `https://itunes.apple.com/lookup?id=${info.id}`
    );
    if (lookupRes.ok) {
      const lData = await lookupRes.json();
      const item = lData?.results?.find((r) => r.wrapperType === "track") || lData?.results?.[0];
      if (item && item.trackName) {
        return {
          platform: "apple",
          platformName: "Apple Music (Single Track)",
          targetType: "track",
          playlistId: String(info.id),
          title: `${item.trackName} — ${item.artistName}`,
          owner: item.collectionName || "Single Track Inspection",
          coverUrl: item.artworkUrl100
            ? item.artworkUrl100.replace("100x100bb", "400x400bb")
            : null,
          totalTracks: 1,
          tracks: [
            {
              id: String(item.trackId || info.id),
              index: 1,
              title: item.trackName,
              artist: item.artistName || "Unknown Artist",
              album: item.collectionName || null,
              durationMs: item.trackTimeMillis || 0,
              isExplicit: item.trackExplicitness === "explicit",
              previewUrl: item.previewUrl || null,
              externalUrl: item.trackViewUrl || info.url,
              platform: "apple",
            },
          ],
        };
      }
    }
  }

  // If Apple Music Artist ID (/artist/name/123456), use iTunes Lookup API with entity=song
  if (info.entityType === "artist" && /^[0-9]+$/.test(String(info.id))) {
    const lookupRes = await fetch(
      `https://itunes.apple.com/lookup?id=${info.id}&entity=song&limit=25`
    );
    if (lookupRes.ok) {
      const lData = await lookupRes.json();
      const artistEntry = lData?.results?.find((r) => r.wrapperType === "artist");
      const songEntries = (lData?.results || []).filter(
        (r) => r.wrapperType === "track"
      );
      if (songEntries.length > 0) {
        const artistName =
          artistEntry?.artistName || songEntries[0].artistName || "Apple Music Artist";
        const tracks = songEntries.map((item, idx) => ({
          id: String(item.trackId || idx),
          index: idx + 1,
          title: item.trackName || "Unknown Track",
          artist: item.artistName || artistName,
          album: item.collectionName || null,
          durationMs: item.trackTimeMillis || 0,
          isExplicit: item.trackExplicitness === "explicit",
          previewUrl: item.previewUrl || null,
          externalUrl: item.trackViewUrl || info.url,
          platform: "apple",
        }));

        return {
          platform: "apple",
          platformName: "Apple Music (Artist Profile)",
          targetType: "artist",
          playlistId: String(info.id),
          title: artistName,
          owner: `Artist Catalog Sample (${tracks.length} tracks)`,
          coverUrl: songEntries[0]?.artworkUrl100
            ? songEntries[0].artworkUrl100.replace("100x100bb", "400x400bb")
            : null,
          totalTracks: tracks.length,
          tracks,
        };
      }
    }
  }

  // Otherwise scrape Apple Music SSR serialized-server-data (works for playlists, albums, etc.)
  const res = await fetch(info.url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Apple Music returned an error (${res.status}). Make sure the link is public.`
    );
  }

  const html = await res.text();
  const match = html.match(
    /<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/
  );

  if (!match) {
    throw new Error("Could not parse Apple Music page data.");
  }

  const data = JSON.parse(match[1]);

  let pageTitle = "Apple Music";
  let pageSubtitle = "Apple Music";
  let coverUrl = null;
  const rawItems = [];

  function walk(obj) {
    if (!obj || typeof obj !== "object") return;

    if (obj.itemKind === "containerDetailHeaderLockup" && obj.title) {
      pageTitle = obj.title;
      if (obj.subtitleLinks?.[0]?.title) {
        pageSubtitle = obj.subtitleLinks[0].title;
      }
      if (obj.artwork?.dictionary?.url) {
        coverUrl = obj.artwork.dictionary.url
          .replace("{w}", "400")
          .replace("{h}", "400")
          .replace("{f}", "jpg");
      }
    }

    if (
      (obj.itemKind === "trackLockup" || obj.itemKind === "shelf") &&
      Array.isArray(obj.items)
    ) {
      for (const it of obj.items) {
        if (it.title && (it.duration || it.artistName || it.subtitleLinks)) {
          rawItems.push(it);
        }
      }
      return;
    }

    for (const k of Object.keys(obj)) {
      walk(obj[k]);
    }
  }

  walk(data);

  if (pageTitle === "Apple Music") {
    const titleTag = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (titleTag) {
      pageTitle = titleTag[1].replace(/\s*on Apple Music.*$/i, "");
    }
  }

  if (rawItems.length === 0) {
    throw new Error("No playable tracks found on this Apple Music page.");
  }

  const tracks = rawItems.map((item, idx) => {
    const artistFromLinks = Array.isArray(item.subtitleLinks)
      ? item.subtitleLinks.map((s) => s.title).filter(Boolean).join(", ")
      : "";
    const artist = item.artistName || artistFromLinks || pageSubtitle || "Unknown Artist";
    const adamId =
      item.contentDescriptor?.identifiers?.storeAdamID || `am-${idx}`;
    const itemUrl = item.contentDescriptor?.url || info.url;

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
      title: item.title || "Unknown Track",
      artist,
      durationMs: item.duration || 0,
      isExplicit: !!item.showExplicitBadge,
      previewUrl,
      externalUrl: itemUrl,
      platform: "apple",
    };
  });

  return {
    platform: "apple",
    platformName: `Apple Music (${info.entityType || "Playlist"})`,
    targetType: info.entityType || "playlist",
    playlistId: info.id,
    title: pageTitle,
    owner: pageSubtitle,
    coverUrl,
    totalTracks: tracks.length,
    tracks,
  };
}

/**
 * Helper to parse Artist - Title from YouTube video titles
 */
function parseYouTubeTitleAndArtist(rawTitle, channelName) {
  const cleanChannel = (channelName || "Unknown Channel")
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s*VEVO$/i, "")
    .replace(/\s*Official$/i, "")
    .trim();

  let title = rawTitle || "Unknown Video";
  let artist = cleanChannel;

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
 * Fetch YouTube Entity (Playlist, Single Video/Song, or Channel/Artist)
 */
async function fetchYouTubeEntity(info) {
  let targetUrl = info.url;
  if (info.entityType === "track") {
    targetUrl = `https://www.youtube.com/watch?v=${info.id}`;
  } else if (info.entityType === "playlist") {
    targetUrl = `https://www.youtube.com/playlist?list=${info.id}`;
  } else if (info.entityType === "artist" && !targetUrl.endsWith("/videos")) {
    targetUrl = targetUrl.replace(/\/$/, "") + "/videos";
  }

  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      Cookie:
        "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnPpwY; CONSENT=YES+cb.20210328-17-p0.en+FX+410",
    },
  });

  if (!res.ok) {
    throw new Error(`YouTube returned an error (${res.status}).`);
  }

  const html = await res.text();

  // Case A: Single YouTube Video / Track
  if (info.entityType === "track") {
    const prMatch = html.match(
      /var ytInitialPlayerResponse = (\{[\s\S]*?\});<\/script>/
    );
    if (prMatch) {
      const pr = JSON.parse(prMatch[1]);
      const vd = pr.videoDetails;
      if (vd && vd.videoId) {
        const parsed = parseYouTubeTitleAndArtist(vd.title, vd.author);
        const thumb =
          vd.thumbnail?.thumbnails?.[vd.thumbnail.thumbnails.length - 1]?.url ||
          null;

        return {
          platform: "youtube",
          platformName: "YouTube (Single Track)",
          targetType: "track",
          playlistId: vd.videoId,
          title: `${parsed.title} — ${parsed.artist}`,
          owner: `Channel: ${vd.author}`,
          coverUrl: thumb,
          totalTracks: 1,
          tracks: [
            {
              id: vd.videoId,
              index: 1,
              title: parsed.title,
              rawTitle: parsed.rawTitle,
              artist: parsed.artist,
              channelName: vd.author,
              durationMs: parseInt(vd.lengthSeconds || "0", 10) * 1000,
              isExplicit: false,
              previewUrl: null,
              externalUrl: `https://www.youtube.com/watch?v=${vd.videoId}`,
              platform: "youtube",
            },
          ],
        };
      }
    }
  }

  // Case B: YouTube Playlist or Channel Videos
  const match = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!match) {
    throw new Error("Could not extract YouTube data from page.");
  }

  const data = JSON.parse(match[1]);
  const pageTitle =
    data?.metadata?.playlistMetadataRenderer?.title ||
    data?.metadata?.channelMetadataRenderer?.title ||
    data?.header?.playlistHeaderRenderer?.title?.simpleText ||
    data?.header?.pageHeaderRenderer?.pageTitle ||
    "YouTube Inspection";

  const coverUrl =
    data?.microformat?.microformatDataRenderer?.thumbnail?.thumbnails?.[0]
      ?.url ||
    data?.metadata?.channelMetadataRenderer?.avatar?.thumbnails?.[0]?.url ||
    null;

  const defaultChannel =
    data?.metadata?.channelMetadataRenderer?.title || "YouTube Channel";

  const extracted = [];
  const seenIds = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== "object") return;

    if (obj.playlistVideoRenderer) {
      const v = obj.playlistVideoRenderer;
      const vid = v.videoId;
      if (vid && !seenIds.has(vid)) {
        seenIds.add(vid);
        const rawTitle =
          v.title?.runs?.[0]?.text || v.title?.simpleText || "Unknown Track";
        const channel =
          v.shortBylineText?.runs?.[0]?.text || defaultChannel;
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

    // Channel videoRenderer (for YouTube Artist / Channel URLs)
    if (obj.videoRenderer && obj.videoRenderer.videoId) {
      const v = obj.videoRenderer;
      const vid = v.videoId;
      if (vid && !seenIds.has(vid) && extracted.length < 30) {
        seenIds.add(vid);
        const rawTitle =
          v.title?.runs?.[0]?.text || v.title?.simpleText || "Unknown Video";
        const channel =
          v.ownerText?.runs?.[0]?.text || defaultChannel;
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

    if (obj.lockupViewModel && obj.lockupViewModel.contentId) {
      const l = obj.lockupViewModel;
      const vid = l.contentId;
      if (vid && !seenIds.has(vid)) {
        seenIds.add(vid);
        const meta = l.metadata?.lockupMetadataViewModel;
        const rawTitle = meta?.title?.content || "Unknown Track";
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows;
        const channel =
          rows?.[0]?.metadataParts?.[0]?.text?.content || defaultChannel;
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
    throw new Error("No public videos/tracks found at this YouTube URL.");
  }

  return {
    platform: "youtube",
    platformName:
      info.entityType === "artist"
        ? "YouTube (Channel / Artist)"
        : "YouTube / YT Music",
    targetType: info.entityType || "playlist",
    playlistId: info.id,
    title: pageTitle,
    owner:
      info.entityType === "artist"
        ? `Channel Uploads (${extracted.length} items)`
        : "YouTube Playlist",
    coverUrl,
    totalTracks: extracted.length,
    tracks: extracted,
  };
}

/**
 * Resolve Direct Text Query for an Artist Name or Single Song Title
 * Uses Deezer + Apple iTunes Search APIs to build a tracklist or single-track target
 */
async function fetchBySearchQuery(info, dbKnownArtists = []) {
  const rawQuery = (info.query || "").trim();
  const isTrackMode = info.entityType === "track";

  // Check if query matches an entry in our Known AI Artists DB first
  const matchedKnownAi = dbKnownArtists.find(
    (a) => a.name.toLowerCase() === rawQuery.toLowerCase()
  );

  // 1. Single Track Search Mode (or "Artist - Song" query)
  if (isTrackMode) {
    const [dRes, iRes] = await Promise.allSettled([
      fetch(
        `https://api.deezer.com/search?q=${encodeURIComponent(rawQuery)}&limit=1`
      ).then((r) => (r.ok ? r.json() : null)),
      fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(
          rawQuery
        )}&entity=song&limit=1`
      ).then((r) => (r.ok ? r.json() : null)),
    ]);

    const dTrack =
      dRes.status === "fulfilled" ? dRes.value?.data?.[0] : null;
    const iTrack =
      iRes.status === "fulfilled" ? iRes.value?.results?.[0] : null;

    if (dTrack || iTrack) {
      const title = dTrack?.title || iTrack?.trackName || rawQuery;
      const artist =
        dTrack?.artist?.name || iTrack?.artistName || "Unknown Artist";
      const durationMs = dTrack?.duration
        ? dTrack.duration * 1000
        : iTrack?.trackTimeMillis || 0;
      const previewUrl = dTrack?.preview || iTrack?.previewUrl || null;
      const coverUrl =
        dTrack?.album?.cover_medium ||
        (iTrack?.artworkUrl100
          ? iTrack.artworkUrl100.replace("100x100bb", "400x400bb")
          : null);
      const externalUrl =
        dTrack?.link || iTrack?.trackViewUrl || "https://www.deezer.com";

      return {
        platform: "search",
        platformName: "Direct Track Lookup",
        targetType: "track",
        playlistId: `track-search-${Date.now()}`,
        title: `${title} — ${artist}`,
        owner: `Single Track Inspection`,
        coverUrl,
        totalTracks: 1,
        tracks: [
          {
            id: String(dTrack?.id || iTrack?.trackId || "track-1"),
            index: 1,
            title,
            artist,
            durationMs,
            isExplicit: !!(
              dTrack?.explicit_lyrics ||
              iTrack?.trackExplicitness === "explicit"
            ),
            previewUrl,
            externalUrl,
            platform: "search",
          },
        ],
      };
    }

    // If not found in catalogs at all, still allow inspecting the raw title/artist string!
    const parts = rawQuery.split(/\s+[-–—]\s+/);
    const fallbackArtist = parts.length >= 2 ? parts[0].trim() : rawQuery;
    const fallbackTitle =
      parts.length >= 2 ? parts.slice(1).join(" - ").trim() : rawQuery;

    return {
      platform: "search",
      platformName: "Direct Track Lookup (Unindexed)",
      targetType: "track",
      playlistId: `track-raw-${Date.now()}`,
      title: `${fallbackTitle} — ${fallbackArtist}`,
      owner: "Unindexed Track Query",
      coverUrl: null,
      totalTracks: 1,
      tracks: [
        {
          id: "raw-track-1",
          index: 1,
          title: fallbackTitle,
          artist: fallbackArtist,
          durationMs: 0,
          isExplicit: false,
          previewUrl: null,
          externalUrl: "#",
          platform: "search",
        },
      ],
    };
  }

  // 2. Artist Inspection Mode (fetches top tracks by this artist to run full catalog forensics)
  const [dArtistRes, iSongsRes] = await Promise.allSettled([
    fetch(
      `https://api.deezer.com/search?q=artist:${encodeURIComponent(
        `"${rawQuery}"`
      )}&limit=15`
    ).then((r) => (r.ok ? r.json() : null)),
    fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(
        rawQuery
      )}&entity=song&limit=15`
    ).then((r) => (r.ok ? r.json() : null)),
  ]);

  const dTracks =
    dArtistRes.status === "fulfilled" && Array.isArray(dArtistRes.value?.data)
      ? dArtistRes.value.data
      : [];
  const iTracks =
    iSongsRes.status === "fulfilled" && Array.isArray(iSongsRes.value?.results)
      ? iSongsRes.value.results.filter(
          (r) =>
            r.artistName &&
            r.artistName.toLowerCase().includes(rawQuery.toLowerCase())
        )
      : [];

  if (dTracks.length > 0) {
    const canonicalArtist = dTracks[0].artist?.name || rawQuery;
    const coverUrl =
      dTracks[0].artist?.picture_medium ||
      dTracks[0].album?.cover_medium ||
      null;

    const tracks = dTracks.map((t, idx) => ({
      id: String(t.id || idx),
      index: idx + 1,
      title: t.title || "Track",
      artist: t.artist?.name || canonicalArtist,
      durationMs: (t.duration || 0) * 1000,
      isExplicit: !!t.explicit_lyrics,
      previewUrl: t.preview || null,
      externalUrl: t.link || "https://www.deezer.com",
      platform: "search",
    }));

    return {
      platform: "search",
      platformName: "Artist Catalog Inspection",
      targetType: "artist",
      playlistId: `artist-${canonicalArtist}`,
      title: canonicalArtist,
      owner: `Artist Top Tracks (${tracks.length} tracks inspected)`,
      coverUrl,
      totalTracks: tracks.length,
      tracks,
    };
  }

  if (iTracks.length > 0) {
    const canonicalArtist = iTracks[0].artistName || rawQuery;
    const coverUrl = iTracks[0].artworkUrl100
      ? iTracks[0].artworkUrl100.replace("100x100bb", "400x400bb")
      : null;

    const tracks = iTracks.map((t, idx) => ({
      id: String(t.trackId || idx),
      index: idx + 1,
      title: t.trackName || "Track",
      artist: t.artistName || canonicalArtist,
      durationMs: t.trackTimeMillis || 0,
      isExplicit: t.trackExplicitness === "explicit",
      previewUrl: t.previewUrl || null,
      externalUrl: t.trackViewUrl || "https://music.apple.com",
      platform: "search",
    }));

    return {
      platform: "search",
      platformName: "Artist Catalog Inspection",
      targetType: "artist",
      playlistId: `artist-${canonicalArtist}`,
      title: canonicalArtist,
      owner: `Artist Catalog (${tracks.length} tracks inspected)`,
      coverUrl,
      totalTracks: tracks.length,
      tracks,
    };
  }

  // Fallback for known AI artist or unindexed ghost artist
  return {
    platform: "search",
    platformName: "Artist Identity Inspection",
    targetType: "artist",
    playlistId: `artist-raw-${Date.now()}`,
    title: matchedKnownAi ? matchedKnownAi.name : rawQuery,
    owner: "Direct Artist Forensics",
    coverUrl: null,
    totalTracks: 1,
    tracks: [
      {
        id: "artist-probe-1",
        index: 1,
        title: "Catalog & Identity Probe",
        artist: matchedKnownAi ? matchedKnownAi.name : rawQuery,
        durationMs: 0,
        isExplicit: false,
        previewUrl: null,
        externalUrl: "#",
        platform: "search",
      },
    ],
  };
}

/**
 * Built-in Demo Vectors
 */
function getDemoPlaylist(demoType) {
  if (demoType === "mixed") {
    return {
      platform: "spotify",
      platformName: "Spotify (Test Vector)",
      targetType: "playlist",
      playlistId: "demo-mixed",
      title: "Late Night Vibes & Viral Hits 2026 (Test Vector)",
      owner: "Test Profile",
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
          durationMs: 120000,
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

  throw new Error("Unknown demo vector.");
}

async function fetchPlaylist(rawInput, modeHint = "auto", dbKnownArtists = []) {
  const info = detectInputTarget(rawInput, modeHint);

  if (info.platform === "demo") {
    return getDemoPlaylist(info.id);
  }
  if (info.platform === "spotify") {
    return await fetchSpotifyEntity(info);
  }
  if (info.platform === "apple") {
    return await fetchAppleMusicEntity(info);
  }
  if (info.platform === "youtube") {
    return await fetchYouTubeEntity(info);
  }
  if (info.platform === "search") {
    return await fetchBySearchQuery(info, dbKnownArtists);
  }

  throw new Error("Unsupported input target.");
}

module.exports = {
  detectInputTarget,
  fetchPlaylist,
};
