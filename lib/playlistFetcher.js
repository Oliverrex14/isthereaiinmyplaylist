const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// Default Spotify Pathfinder persistedQuery sha256Hash for fetchPlaylistContents / fetchPlaylist
let cachedSpotifyPathfinderHash =
  "21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf";

/**
 * Dynamically refresh Spotify's Pathfinder sha256Hash from open.spotify.com web-player bundle
 * if Spotify rotates the persisted query hash in the future.
 */
async function refreshSpotifyPathfinderHash() {
  try {
    const pageRes = await fetch("https://open.spotify.com", {
      headers: { "User-Agent": UA },
    });
    if (!pageRes.ok) return cachedSpotifyPathfinderHash;
    const html = await pageRes.text();
    const scripts = [...html.matchAll(/src="(https:\/\/[^"]+\.js)"/g)].map(
      (m) => m[1]
    );
    for (const s of scripts) {
      if (s.includes("web-player")) {
        const jsRes = await fetch(s, { headers: { "User-Agent": UA } });
        if (!jsRes.ok) continue;
        const js = await jsRes.text();
        const match = js.match(
          /"fetchPlaylistContents"\s*,\s*"query"\s*,\s*"([a-f0-9]{64})"/
        );
        if (match && match[1]) {
          cachedSpotifyPathfinderHash = match[1];
          return cachedSpotifyPathfinderHash;
        }
      }
    }
  } catch {
    // Keep existing hash
  }
  return cachedSpotifyPathfinderHash;
}

/**
 * Helper to fetch a single page of Spotify playlist tracks from Pathfinder v2
 */
async function fetchSpotifyPathfinderPage(playlistId, accessToken, offset, limit, hash) {
  const res = await fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      variables: {
        uri: `spotify:playlist:${playlistId}`,
        offset,
        limit,
      },
      operationName: "fetchPlaylistContents",
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: hash,
        },
      },
    }),
  });

  if (!res.ok) {
    return null;
  }
  return await res.json();
}

/**
 * Fetch ALL tracks of a Spotify playlist using Pathfinder v2 pagination (500 tracks per page)
 * Removes the 100-track Spotify Embed limit and enriches tracks with artist IDs, playcounts,
 * album release dates, BPM, and key.
 */
async function fetchFullSpotifyPlaylistTracks(playlistId, accessToken, embedPreviewMap) {
  if (!accessToken) return null;

  const PAGE_LIMIT = 500;
  const MAX_TRACKS_SAFETY = 5000;
  let hash = cachedSpotifyPathfinderHash;

  let firstPage = await fetchSpotifyPathfinderPage(
    playlistId,
    accessToken,
    0,
    PAGE_LIMIT,
    hash
  );

  // If persistedQuery hash was rotated by Spotify, refresh and retry once
  if (
    firstPage?.errors?.some((e) =>
      String(e.message || "").includes("PersistedQuery")
    )
  ) {
    hash = await refreshSpotifyPathfinderHash();
    firstPage = await fetchSpotifyPathfinderPage(
      playlistId,
      accessToken,
      0,
      PAGE_LIMIT,
      hash
    );
  }

  const firstContent = firstPage?.data?.playlistV2?.content;
  if (!firstContent || !Array.isArray(firstContent.items)) {
    return null;
  }

  const totalCount = Math.min(
    MAX_TRACKS_SAFETY,
    firstContent.totalCount || firstContent.items.length
  );
  const allRawItems = [...firstContent.items];

  // Fetch remaining pages if playlist has more than PAGE_LIMIT (500) tracks
  const offsets = [];
  for (let offset = allRawItems.length; offset < totalCount; offset += PAGE_LIMIT) {
    offsets.push(offset);
  }

  // Fetch remaining pages in small parallel batches of 3
  for (let i = 0; i < offsets.length; i += 3) {
    const batchOffsets = offsets.slice(i, i + 3);
    const pages = await Promise.all(
      batchOffsets.map((off) =>
        fetchSpotifyPathfinderPage(playlistId, accessToken, off, PAGE_LIMIT, hash)
      )
    );
    for (const p of pages) {
      const items = p?.data?.playlistV2?.content?.items;
      if (Array.isArray(items) && items.length > 0) {
        allRawItems.push(...items);
      }
    }
  }

  const seenTrackIds = new Set();
  const parsedTracks = [];
  const itemsToParse = totalCount ? allRawItems.slice(0, totalCount) : allRawItems;
  for (let idx = 0; idx < itemsToParse.length; idx++) {
    const wrapper = itemsToParse[idx];
    const tData = wrapper?.itemV2?.data;
    if (!tData || tData.__typename === "RestrictedContent" || !tData.name) {
      continue;
    }

    const uri = tData.uri || wrapper?.itemV3?.data?.uri || "";
    if (uri && !uri.includes(":track:") && !uri.includes(":local:")) {
      continue;
    }
    const trackId = uri ? uri.split(":").pop() : `sp-${idx}`;
    if (seenTrackIds.has(trackId)) {
      continue;
    }
    seenTrackIds.add(trackId);

    const artistItems = tData.artists?.items || [];
    const artistNames = artistItems
      .map((a) => a?.profile?.name)
      .filter(Boolean)
      .join(", ");
    const artistIds = artistItems
      .map((a) => (a?.uri ? a.uri.split(":").pop() : null))
      .filter(Boolean);

    const releaseIso = tData.albumOfTrack?.date?.isoString || null;
    let albumReleaseYear = null;
    if (releaseIso) {
      const yr = new Date(releaseIso).getFullYear();
      if (!isNaN(yr) && yr >= 1900) {
        albumReleaseYear = yr;
      }
    }

    const playcountNum =
      tData.playcount !== undefined && tData.playcount !== null
        ? Number(tData.playcount)
        : null;

    const bpm = tData.playlistAudioAttributes?.bpm
      ? Math.round(Number(tData.playlistAudioAttributes.bpm))
      : null;
    const camelotKey =
      tData.playlistAudioAttributes?.key?.camelotKey?.value ||
      tData.playlistAudioAttributes?.key?.key ||
      null;

    parsedTracks.push({
      id: trackId,
      index: parsedTracks.length + 1,
      title: tData.name || "Unknown Track",
      artist: (artistNames || "Unknown Artist").replace(/\u00a0/g, " "),
      artistIds,
      album: tData.albumOfTrack?.name || null,
      albumReleaseDate: releaseIso ? releaseIso.split("T")[0] : null,
      albumReleaseYear,
      spotifyPlaycount: !isNaN(playcountNum) ? playcountNum : null,
      bpm,
      musicalKey: camelotKey,
      addedAt: wrapper?.addedAt?.isoString
        ? wrapper.addedAt.isoString.split("T")[0]
        : null,
      durationMs: tData.trackDuration?.totalMilliseconds || 0,
      isExplicit: tData.contentRating?.label === "EXPLICIT",
      previewUrl: embedPreviewMap.get(trackId) || null,
      externalUrl: `https://open.spotify.com/track/${trackId}`,
      platform: "spotify",
    });
  }

  return parsedTracks.length > 0 ? parsedTracks : null;
}

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
    return {
      platform: "demo",
      targetType: "demo",
      id: input.replace("demo:", ""),
      url: input,
    };
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
    /^(open\.spotify\.com|spotify\.link|music\.apple\.com|www\.youtube\.com|m\.youtube\.com|youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(
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

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Only HTTP/HTTPS URLs are permitted.");
    }

    const host = parsed.hostname.toLowerCase();

    // 1. Spotify URL (playlist, track, artist, album)
    if (host.includes("spotify.com") || host.includes("spotify.link")) {
      const match = parsed.pathname.match(
        /\/(playlist|track|artist|album)\/([a-zA-Z0-9]+)/
      );
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
      const match = parsed.pathname.match(
        /\/(playlist|album|artist|song)\/(?:[^/]+\/)?(pl\.[a-zA-Z0-9._-]+|[0-9]+)/
      );
      const entityType = match
        ? match[1] === "song"
          ? "track"
          : match[1]
        : "playlist";
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
      const isMusicHost = host.includes("music.youtube.com");
      const listId = parsed.searchParams.get("list");
      const videoId =
        parsed.searchParams.get("v") ||
        (host.includes("youtu.be") ? parsed.pathname.slice(1).split("?")[0] : null) ||
        (parsed.pathname.startsWith("/shorts/")
          ? parsed.pathname.split("/")[2]
          : null);

      // Support YouTube Music browse album URLs (/browse/MPREb_...)
      if (parsed.pathname.startsWith("/browse/MPREb_")) {
        return {
          platform: "youtube",
          isMusic: true,
          entityType: "playlist",
          id: parsed.pathname.replace("/browse/", ""),
          url: normalizedUrl,
        };
      }

      // Real curated playlists start with PL, OLAK5uy, RDCLAK, UU, FL, etc.
      // Autogenerated radios / mix playlists start with RD (except RDCLAK), UL, or are WL / LL.
      const isDynamicMix =
        listId &&
        ((listId.startsWith("RD") && !listId.startsWith("RDCLAK")) ||
          listId.startsWith("UL") ||
          listId === "WL" ||
          listId === "LL");

      const isYtmPlaylist =
        isMusicHost ||
        Boolean(
          listId &&
            (listId.startsWith("OLAK") ||
              listId.startsWith("RDCLAK") ||
              listId.startsWith("MPREb_"))
        );

      // If videoId is present and (no playlist, or dynamic auto-mix, or explicit track mode):
      if (
        videoId &&
        (!listId || isDynamicMix || modeHint === "track" || (modeHint === "auto" && isDynamicMix))
      ) {
        return {
          platform: "youtube",
          isMusic: isMusicHost,
          entityType: "track",
          id: videoId,
          url: normalizedUrl,
        };
      }

      if (listId && !isDynamicMix) {
        return {
          platform: "youtube",
          isMusic: isYtmPlaylist,
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
          isMusic: isMusicHost,
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

  // Direct text search disabled; require genuine link from supported platform
  throw new Error(
    "Please enter a valid link. Only public Spotify, Apple Music, and YouTube links are supported."
  );
}

/**
 * Fetch Spotify Entity via Embed SSR JSON (__NEXT_DATA__) + Pathfinder v2 Full Pagination
 * Supports: playlist (unlimited tracks), album, artist (top tracks), and single track!
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
  const accessToken =
    data?.props?.pageProps?.state?.settings?.session?.accessToken || null;

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
      ? entity.artists
          .map((a) => a.name)
          .filter(Boolean)
          .join(", ")
      : entity.subtitle || "Unknown Artist";
    const artistIds = Array.isArray(entity.artists)
      ? entity.artists
          .map((a) => (a.uri ? a.uri.split(":").pop() : null))
          .filter(Boolean)
      : [];

    let albumReleaseYear = null;
    if (entity.releaseDate?.isoString) {
      const yr = new Date(entity.releaseDate.isoString).getFullYear();
      if (!isNaN(yr) && yr >= 1900) albumReleaseYear = yr;
    }

    const trackObj = {
      id: entity.id || info.id,
      index: 1,
      title: entity.title || entity.name || "Unknown Track",
      artist: artistNames.replace(/\u00a0/g, " "),
      artistIds,
      albumReleaseYear,
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
  const embedTrackList = Array.isArray(entity.trackList) ? entity.trackList : [];
  const embedPreviewMap = new Map();
  for (const item of embedTrackList) {
    const tid = item.uri ? item.uri.split(":").pop() : null;
    if (tid && item.audioPreview?.url) {
      embedPreviewMap.set(tid, item.audioPreview.url);
    }
  }

  let tracks = null;

  // If this is a playlist, use Pathfinder v2 to fetch ALL tracks (not capped at 100) + rich metadata
  if (type === "playlist" && accessToken) {
    try {
      tracks = await fetchFullSpotifyPlaylistTracks(
        info.id,
        accessToken,
        embedPreviewMap
      );
    } catch {
      tracks = null;
    }
  }

  // Fallback to embed trackList (for albums, artists, or if Pathfinder failed)
  if (!tracks || tracks.length === 0) {
    if (embedTrackList.length === 0) {
      throw new Error(`No public tracks found in this Spotify ${type}.`);
    }

    const defaultArtist =
      type === "artist" ? entity.name || entity.title || "Unknown Artist" : null;
    const defaultArtistIds = type === "artist" && info.id ? [info.id] : [];

    tracks = embedTrackList.map((item, idx) => {
      const trackId = item.uri ? item.uri.split(":").pop() : `sp-${idx}`;
      return {
        id: trackId,
        index: idx + 1,
        title: item.title || "Unknown Track",
        artist: (item.subtitle || defaultArtist || "Unknown Artist").replace(
          /\u00a0/g,
          " "
        ),
        artistIds: defaultArtistIds,
        durationMs: item.duration || 0,
        isExplicit: !!item.isExplicit,
        previewUrl: item.audioPreview?.url || null,
        externalUrl: `https://open.spotify.com/track/${trackId}`,
        platform: "spotify",
      };
    });
  }

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
      const item =
        lData?.results?.find((r) => r.wrapperType === "track") ||
        lData?.results?.[0];
      if (item && item.trackName) {
        const releaseYr = item.releaseDate
          ? new Date(item.releaseDate).getFullYear()
          : null;
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
              appleArtistIds: item.artistId ? [String(item.artistId)] : [],
              album: item.collectionName || null,
              albumReleaseYear:
                releaseYr && !isNaN(releaseYr) ? releaseYr : null,
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

  // If Apple Music Artist ID (/artist/name/123456), use iTunes Lookup API with entity=song&limit=200
  if (info.entityType === "artist" && /^[0-9]+$/.test(String(info.id))) {
    const lookupRes = await fetch(
      `https://itunes.apple.com/lookup?id=${info.id}&entity=song&limit=200`
    );
    if (lookupRes.ok) {
      const lData = await lookupRes.json();
      const artistEntry = lData?.results?.find(
        (r) => r.wrapperType === "artist"
      );
      const songEntries = (lData?.results || []).filter(
        (r) => r.wrapperType === "track"
      );
      if (songEntries.length > 0) {
        const artistName =
          artistEntry?.artistName ||
          songEntries[0].artistName ||
          "Apple Music Artist";
        const tracks = songEntries.map((item, idx) => {
          const releaseYr = item.releaseDate
            ? new Date(item.releaseDate).getFullYear()
            : null;
          return {
            id: String(item.trackId || idx),
            index: idx + 1,
            title: item.trackName || "Unknown Track",
            artist: item.artistName || artistName,
            appleArtistIds: [String(item.artistId || info.id)],
            album: item.collectionName || null,
            albumReleaseYear: releaseYr && !isNaN(releaseYr) ? releaseYr : null,
            durationMs: item.trackTimeMillis || 0,
            isExplicit: item.trackExplicitness === "explicit",
            previewUrl: item.previewUrl || null,
            externalUrl: item.trackViewUrl || info.url,
            platform: "apple",
          };
        });

        return {
          platform: "apple",
          platformName: "Apple Music (Artist Profile)",
          targetType: "artist",
          playlistId: String(info.id),
          title: artistName,
          owner: `Artist Catalog (${tracks.length} tracks)`,
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
  let officialTrackCount = null;
  let foundPrimaryTracklist = false;
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

    // Parse official track count from footer lockup if available
    if (
      obj.itemKind === "containerDetailTracklistFooterLockup" &&
      Array.isArray(obj.items)
    ) {
      for (const it of obj.items) {
        if (it.description) {
          const m = it.description.match(
            /([\d,.]+)\s*(?:songs?|skladb|tracks?|items?|písní)/i
          );
          if (m) {
            const count = parseInt(m[1].replace(/[,.]/g, ""), 10);
            if (!isNaN(count) && count > 0) {
              officialTrackCount = count;
            }
          }
        }
      }
    }

    // For playlists and albums, only collect tracks from the primary track container.
    // Lock once found so secondary recommendation shelves/lockups ('You Might Also Like') are ignored.
    const isPrimaryTrackContainer =
      !foundPrimaryTracklist &&
      (
        (obj.itemKind === "trackLockup" && (!obj.id || String(obj.id).startsWith("track-list"))) ||
        (obj.itemKind === "shelf" && !rawItems.length)
      );

    if (isPrimaryTrackContainer && Array.isArray(obj.items)) {
      for (const it of obj.items) {
        if (it.title && (it.duration || it.artistName || it.subtitleLinks)) {
          rawItems.push(it);
        }
      }
      if (rawItems.length > 0) {
        foundPrimaryTracklist = true;
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

  // Cap at official track count to ensure no phantom tracks
  const itemsToUse =
    officialTrackCount && officialTrackCount > 0
      ? rawItems.slice(0, officialTrackCount)
      : rawItems;

  if (itemsToUse.length === 0) {
    throw new Error("No playable tracks found on this Apple Music page.");
  }

  const tracks = itemsToUse.map((item, idx) => {
    const artistFromLinks = Array.isArray(item.subtitleLinks)
      ? item.subtitleLinks
          .map((s) => s.title)
          .filter(Boolean)
          .join(", ")
      : "";
    const appleArtistIds = Array.isArray(item.subtitleLinks)
      ? item.subtitleLinks
          .map(
            (s) =>
              s?.segue?.destination?.contentDescriptor?.identifiers
                ?.storeAdamID || null
          )
          .filter(Boolean)
          .map(String)
      : [];
    const artist =
      item.artistName || artistFromLinks || pageSubtitle || "Unknown Artist";
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
      appleArtistIds,
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
    .replace(/\s*Official(?:\s+(?:Video|Channel|Audio|Music))?$/i, "")
    .trim();
  const isTopicChannel = /-\s*Topic$/i.test(channelName || "");

  let title = (rawTitle || "Unknown Video").trim();
  let artist = cleanChannel;

  // Pattern A: "Title by Artist" or "Title // Artist"
  const byMatch = title.match(/^(.+?)\s+(?:by|\/\/)\s+([^(\[]+)(.*)$/i);
  if (byMatch && byMatch[2].trim().length >= 2 && byMatch[2].trim().length <= 50) {
    artist = byMatch[2].trim();
    title = (byMatch[1].trim() + (byMatch[3] ? " " + byMatch[3].trim() : "")).trim();
  } else if (/^([A-Za-z0-9\s._\u00C0-\u024F-]{2,45})\s*:\s*(.+)$/.test(title)) {
    // Pattern B: "Artist: Title"
    const m = title.match(/^([A-Za-z0-9\s._\u00C0-\u024F-]{2,45})\s*:\s*(.+)$/);
    artist = m[1].trim();
    title = m[2].trim();
  } else {
    // Pattern C: Hyphen separator "Part1 - Part2"
    const dashSplit = title.split(/\s+[-–—]\s+/);
    if (dashSplit.length >= 2) {
      const p1 = dashSplit[0].trim();
      const p2 = dashSplit.slice(1).join(" - ").trim();
      const p1MatchesChannel =
        cleanChannel && p1.toLowerCase() === cleanChannel.toLowerCase();
      const p2MatchesChannel =
        cleanChannel && p2.toLowerCase().startsWith(cleanChannel.toLowerCase());

      if (p2MatchesChannel && !p1MatchesChannel) {
        // "Title - Artist" format where artist is at end
        artist = cleanChannel;
        title = p1;
      } else if (isTopicChannel && !p1MatchesChannel) {
        // Topic channel where title has subtitle (e.g. "Album - Track")
        artist = cleanChannel;
        title = title;
      } else {
        // Standard "Artist - Title" format
        if (p1.length >= 2 && p1.length <= 55) {
          artist = p1;
          title = p2;
        }
      }
    }
  }

  // Clean common video metadata noise from end of title
  const cleanTitle = title
    .replace(
      /\s*[(\[](?:Official\s+(?:Music\s+)?Video|Official\s+Audio|Lyric\s+Video|Visualizer|Audio|4K|HD|Full\s+Album|HQ)[)\]]\s*$/i,
      ""
    )
    .replace(
      /\s*[-–—]\s*(?:Official\s+Video|Official\s+Audio|Lyric\s+Video)\s*$/i,
      ""
    )
    .trim();

  return {
    title: cleanTitle || title,
    rawTitle: rawTitle || title,
    artist,
    channelName: channelName || cleanChannel,
  };
}

/**
 * Convert "MM:SS" or "HH:MM:SS" duration string to milliseconds
 */
function parseDurationTextToMs(text) {
  if (!text || typeof text !== "string") return 0;
  const parts = text
    .trim()
    .split(":")
    .map((n) => parseInt(n, 10));
  if (parts.some((n) => isNaN(n))) return 0;
  if (parts.length === 2) {
    return (parts[0] * 60 + parts[1]) * 1000;
  }
  if (parts.length === 3) {
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }
  return 0;
}

const YTM_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";

/**
 * Fetch tracks from YouTube Music via InnerTube WEB_REMIX API
 * Supports user playlists (PL...), albums (OLAK5uy_ / MPREb_...), and mood/genre collections
 */
async function fetchYouTubeMusicTracks(listId) {
  let browseId =
    listId.startsWith("VL") || listId.startsWith("MPREb_")
      ? listId
      : `VL${listId}`;
  let albumArtist = null;
  let albumYear = null;

  // Resolve OLAK album ID to MPREb_
  if (listId.startsWith("OLAK5uy_")) {
    try {
      const pageRes = await fetch(
        `https://music.youtube.com/playlist?list=${listId}`,
        {
          headers: {
            "User-Agent": UA,
            "Accept-Language": "en-US,en;q=0.9",
          },
        }
      );
      if (pageRes.ok) {
        const text = await pageRes.text();
        const decoded = text.replace(
          /\\x([0-9A-Fa-f]{2})/g,
          (m, h) => String.fromCharCode(parseInt(h, 16))
        );
        const m = decoded.match(/"(MPREb_[A-Za-z0-9_-]+)"/);
        if (m) browseId = m[1];
      }
    } catch {}
  }

  let data = null;
  try {
    const res = await fetch(
      `https://music.youtube.com/youtubei/v1/browse?alt=json&key=${YTM_KEY}`,
      {
        method: "POST",
        headers: {
          "user-agent": UA,
          accept: "*/*",
          "content-type": "application/json",
          origin: "https://music.youtube.com",
          referer: "https://music.youtube.com/",
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "WEB_REMIX",
              clientVersion: "1.20241105.01.00",
              hl: "en",
              gl: "US",
            },
            user: {},
          },
          browseId,
        }),
      }
    );
    if (res.ok) {
      data = await res.json();
    }
  } catch {}

  if (!data) return null;

  // Header inspection
  let playlistTitle = "YouTube Music Playlist";
  let owner = "YouTube Music";
  let coverUrl = null;

  function findHeader(o) {
    if (!o || typeof o !== "object") return;
    if (o.musicResponsiveHeaderRenderer || o.musicDetailHeaderRenderer) {
      const h = o.musicResponsiveHeaderRenderer || o.musicDetailHeaderRenderer;
      playlistTitle =
        h.title?.runs?.map((r) => r.text).join("") || playlistTitle;
      albumArtist =
        h.straplineTextOne?.runs?.map((r) => r.text).join("") || null;
      owner =
        albumArtist ||
        h.subtitle?.runs?.map((r) => r.text).join("") ||
        owner;
      const yrMatch = (
        h.subtitle?.runs?.map((r) => r.text).join("") || ""
      ).match(/\b(19\d\d|20\d\d)\b/);
      if (yrMatch) albumYear = parseInt(yrMatch[1], 10);
      const thumbs =
        h.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      if (thumbs.length) coverUrl = thumbs[thumbs.length - 1].url;
      return;
    }
    for (const k of Object.keys(o)) findHeader(o[k]);
  }
  findHeader(data);

  const extracted = [];
  const seenIds = new Set();

  function walk(o) {
    if (!o || typeof o !== "object") return;
    if (o.musicResponsiveListItemRenderer) {
      const item = o.musicResponsiveListItemRenderer;
      const flex = item.flexColumns || [];
      const rawTitle =
        flex[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
          ?.map((r) => r.text)
          .join("")
          .trim() || "Unknown Track";
      const flexArtist =
        flex[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
          ?.map((r) => r.text)
          .join("")
          .trim() || "";
      const channelId =
        flex[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
          ?.navigationEndpoint?.browseEndpoint?.browseId || null;
      const vid =
        item.playlistItemData?.videoId ||
        item.overlay?.musicItemThumbnailOverlayRenderer?.content
          ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
          ?.videoId;
      const durText =
        item.fixedColumns?.[0]
          ?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text ||
        "";
      const durationMs = parseDurationTextToMs(durText);

      if (vid && !seenIds.has(vid)) {
        seenIds.add(vid);
        const resolvedArtist =
          flexArtist || albumArtist || owner || "YouTube Artist";
        const parsed = parseYouTubeTitleAndArtist(rawTitle, resolvedArtist);
        extracted.push({
          id: vid,
          index: extracted.length + 1,
          title: parsed.title,
          rawTitle: parsed.rawTitle,
          artist: parsed.artist,
          channelName: resolvedArtist,
          channelId,
          albumReleaseYear: albumYear,
          durationMs,
          isExplicit: false,
          previewUrl: null,
          externalUrl: `https://music.youtube.com/watch?v=${vid}`,
          platform: "youtube",
        });
      }
      return;
    }
    for (const k of Object.keys(o)) walk(o[k]);
  }

  walk(data);
  if (!extracted.length) return null;

  return {
    platform: "youtube",
    platformName: "YouTube Music",
    targetType: "playlist",
    playlistId: listId,
    title: playlistTitle,
    owner,
    coverUrl,
    totalTracks: extracted.length,
    tracks: extracted,
  };
}

/**
 * Fetch YouTube Entity (Playlist with full continuation pagination, Single Video/Song, or Channel/Artist)
 */
async function fetchYouTubeEntity(info) {
  // If explicitly a YouTube Music playlist/album, try native YTM InnerTube first
  if (
    info.entityType === "playlist" &&
    (info.isMusic ||
      (info.id &&
        (info.id.startsWith("OLAK") ||
          info.id.startsWith("RDCLAK") ||
          info.id.startsWith("MPREb_"))))
  ) {
    try {
      const ytm = await fetchYouTubeMusicTracks(info.id);
      if (ytm && ytm.tracks.length > 0) return ytm;
    } catch {}
  }

  let targetUrl = info.url;
  if (info.entityType === "track") {
    targetUrl = `https://www.youtube.com/watch?v=${info.id}`;
  } else if (info.entityType === "playlist") {
    targetUrl = `https://www.youtube.com/playlist?list=${info.id}`;
  } else if (info.entityType === "artist" && !targetUrl.endsWith("/videos")) {
    targetUrl = targetUrl.replace(/\/$/, "") + "/videos";
  }

  // Case A: Single YouTube Video / Track (try oEmbed first for instant bot-block immunity)
  if (info.entityType === "track") {
    const videoId = info.id;
    let videoTitle = "";
    let channelName = "";
    let channelId = null;
    let thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    let durationMs = 0;
    let albumReleaseYear = null;

    // 1. Try official YouTube oEmbed API first (instant, 100% resilient)
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
        { headers: { "User-Agent": UA } }
      );
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        videoTitle = oembedData.title || "";
        channelName = oembedData.author_name || "";
        if (oembedData.thumbnail_url) thumb = oembedData.thumbnail_url;
      }
    } catch {}

    // 2. Fetch watch page HTML for extra telemetry (duration, release year)
    let html = "";
    try {
      const res = await fetch(targetUrl, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie:
            "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnPpwY; CONSENT=YES+cb.20210328-17-p0.en+FX+410",
        },
      });
      if (res.ok) html = await res.text();
    } catch {}

    // 2. Extract telemetry from watch page HTML (duration, date, channel ID)
    const durIsoMatch = html.match(
      /itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i
    );
    if (durIsoMatch) {
      const hrs = parseInt(durIsoMatch[1] || "0", 10);
      const mins = parseInt(durIsoMatch[2] || "0", 10);
      const secs = parseInt(durIsoMatch[3] || "0", 10);
      durationMs = (hrs * 3600 + mins * 60 + secs) * 1000;
    }

    const uploadDateMatch =
      html.match(/"uploadDate":"([^"]+)"/) ||
      html.match(/"publishDate":"([^"]+)"/) ||
      html.match(/itemprop="datePublished"\s+content="([^"]+)"/);
    if (uploadDateMatch) {
      const yr = parseInt(uploadDateMatch[1].slice(0, 4), 10);
      if (!isNaN(yr) && yr >= 1900) albumReleaseYear = yr;
    }

    // 3. Fallback: Parse ytInitialPlayerResponse if title or channel was missing
    if (!videoTitle || !channelName || !durationMs) {
      let pr = null;
      const prIdx = html.indexOf("ytInitialPlayerResponse = ");
      if (prIdx !== -1) {
        const slice = html.slice(prIdx + "ytInitialPlayerResponse = ".length);
        const m = slice.match(/^(\{[\s\S]*?\});(?:var |<\/script>|\n|$)/);
        if (m) {
          try {
            pr = JSON.parse(m[1]);
          } catch {}
        }
      }
      if (!pr) {
        const fallbackMatch = html.match(
          /(?:var\s+)?ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/
        );
        if (fallbackMatch) {
          try {
            pr = JSON.parse(fallbackMatch[1]);
          } catch {}
        }
      }
      if (pr?.videoDetails) {
        const vd = pr.videoDetails;
        if (!videoTitle) videoTitle = vd.title || "";
        if (!channelName) channelName = vd.author || "";
        if (!channelId) channelId = vd.channelId || null;
        if (!durationMs && vd.lengthSeconds) {
          durationMs = parseInt(vd.lengthSeconds, 10) * 1000;
        }
        if (vd.thumbnail?.thumbnails?.length) {
          thumb =
            vd.thumbnail.thumbnails[vd.thumbnail.thumbnails.length - 1].url;
        }
      }
    }

    // 4. Secondary Fallback: Parse ytInitialData videoPrimaryInfoRenderer
    if (!videoTitle || !channelName) {
      try {
        const dataMatch = html.match(
          /var ytInitialData = (\{[\s\S]*?\});<\/script>/
        );
        if (dataMatch) {
          const ytData = JSON.parse(dataMatch[1]);
          function findPrimary(o) {
            if (!o || typeof o !== "object") return;
            if (o.videoPrimaryInfoRenderer?.title?.runs) {
              videoTitle = o.videoPrimaryInfoRenderer.title.runs
                .map((r) => r.text)
                .join("");
            }
            if (o.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer) {
              const vor = o.videoSecondaryInfoRenderer.owner.videoOwnerRenderer;
              channelName = vor.title?.runs?.[0]?.text || channelName;
              channelId =
                vor.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint
                  ?.browseId || channelId;
            }
            for (const k of Object.keys(o)) findPrimary(o[k]);
          }
          findPrimary(ytData);
        }
      } catch {}
    }

    // 5. Final fallback from HTML <title> tag
    if (!videoTitle) {
      const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleTagMatch) {
        videoTitle = titleTagMatch[1].replace(/\s*-\s*YouTube$/i, "").trim();
      }
    }

    const parsed = parseYouTubeTitleAndArtist(
      videoTitle || "Unknown Video",
      channelName || "Unknown Artist"
    );

    return {
      platform: "youtube",
      platformName: "YouTube (Single Track)",
      targetType: "track",
      playlistId: videoId,
      title: `${parsed.title} — ${parsed.artist}`,
      owner: `Channel: ${channelName || parsed.artist}`,
      coverUrl: thumb,
      totalTracks: 1,
      tracks: [
        {
          id: videoId,
          index: 1,
          title: parsed.title,
          rawTitle: parsed.rawTitle,
          artist: parsed.artist,
          channelName: channelName || parsed.channelName,
          channelId,
          albumReleaseYear,
          durationMs: durationMs || 0,
          isExplicit: false,
          previewUrl: null,
          externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          platform: "youtube",
        },
      ],
    };
  }

  // Case B: YouTube Playlist or Channel Videos
  let html = "";
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Cookie:
          "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnPpwY; CONSENT=YES+cb.20210328-17-p0.en+FX+410",
      },
    });
    if (res.ok) html = await res.text();
  } catch {}

  const match = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!match) {
    if (info.entityType === "playlist") {
      try {
        const ytm = await fetchYouTubeMusicTracks(info.id);
        if (ytm && ytm.tracks.length > 0) return ytm;
      } catch {}
    }
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
  const defaultChannelId =
    data?.metadata?.channelMetadataRenderer?.externalId || null;

  // Detect official video count from sidebar stats or header for playlists
  let officialTrackCount = null;
  if (info.entityType === "playlist") {
    const sidebarItems = data?.sidebar?.playlistSidebarRenderer?.items || [];
    for (const item of sidebarItems) {
      const stats = item?.playlistSidebarPrimaryInfoRenderer?.stats;
      if (Array.isArray(stats)) {
        for (const stat of stats) {
          const text =
            stat?.runs?.map((r) => r.text).join("") || stat?.simpleText || "";
          const m = text.match(
            /([\d\s,.\u00a0]+)\s*(?:videos?|vide[íi]|sklad[by]?|tracks?|songs?|titres?|canciones|film[oó]w|items?|písn[ěí])/i
          );
          if (m) {
            const count = parseInt(m[1].replace(/[\s,.\u00a0]/g, ""), 10);
            if (!isNaN(count) && count > 0 && count <= 10000) {
              officialTrackCount = count;
              break;
            }
          }
        }
      }
      if (officialTrackCount) break;
    }

    if (!officialTrackCount) {
      const headerRows =
        data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.metadata
          ?.contentMetadataViewModel?.metadataRows || [];
      for (const row of headerRows) {
        for (const part of row?.metadataParts || []) {
          const text = part?.text?.content || "";
          const m = text.match(
            /([\d\s,.\u00a0]+)\s*(?:videos?|vide[íi]|sklad[by]?|tracks?|songs?|titres?|canciones|film[oó]w|items?|písn[ěí])/i
          );
          if (m) {
            const count = parseInt(m[1].replace(/[\s,.\u00a0]/g, ""), 10);
            if (!isNaN(count) && count > 0 && count <= 10000) {
              officialTrackCount = count;
              break;
            }
          }
        }
        if (officialTrackCount) break;
      }
    }

    if (!officialTrackCount) {
      const headerText =
        data?.header?.playlistHeaderRenderer?.numVideosText?.runs
          ?.map((r) => r.text)
          .join("") ||
        data?.header?.playlistHeaderRenderer?.numVideosText?.simpleText ||
        "";
      const m = headerText.match(
        /([\d\s,.\u00a0]+)\s*(?:videos?|vide[íi]|sklad[by]?|tracks?|songs?|titres?|canciones|film[oó]w|items?|písn[ěí])/i
      );
      if (m) {
        const count = parseInt(m[1].replace(/[\s,.\u00a0]/g, ""), 10);
        if (!isNaN(count) && count > 0 && count <= 10000) officialTrackCount = count;
      }
    }
  }

  const extracted = [];
  const seenIds = new Set();
  const seenTokens = new Set();

  function extractFromNode(rootObj) {
    const nextTokens = [];

    function walk(obj) {
      if (!obj || typeof obj !== "object") return;

      if (obj.continuationCommand?.token) {
        const tok = obj.continuationCommand.token;
        if (!seenTokens.has(tok)) {
          nextTokens.push(tok);
        }
      }

      if (obj.playlistVideoRenderer) {
        const v = obj.playlistVideoRenderer;
        const vid = v.videoId;
        const isValidVid = vid && /^[A-Za-z0-9_-]{11}$/.test(vid);
        if (isValidVid && !seenIds.has(vid)) {
          seenIds.add(vid);
          const rawTitle =
            v.title?.runs?.map((r) => r.text).join("") ||
            v.title?.simpleText ||
            "Unknown Track";
          const channel =
            v.shortBylineText?.runs?.map((r) => r.text).join("") ||
            v.shortBylineText?.simpleText ||
            defaultChannel;
          const channelId =
            v.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint
              ?.browseId || defaultChannelId;
          const durationSec =
            parseInt(v.lengthSeconds || "0", 10) ||
            Math.round(
              parseDurationTextToMs(v.lengthText?.simpleText || "") / 1000
            );
          const parsed = parseYouTubeTitleAndArtist(rawTitle, channel);

          extracted.push({
            id: vid,
            index: extracted.length + 1,
            title: parsed.title,
            rawTitle: parsed.rawTitle,
            artist: parsed.artist,
            channelName: parsed.channelName,
            channelId,
            durationMs: durationSec * 1000,
            isExplicit: false,
            previewUrl: null,
            externalUrl: `https://www.youtube.com/watch?v=${vid}`,
            platform: "youtube",
          });
        }
        return;
      }

      // Channel videoRenderer (for YouTube Artist / Channel URLs ONLY - do NOT extract sidebar recommendations on playlists)
      if (
        info.entityType === "artist" &&
        obj.videoRenderer &&
        obj.videoRenderer.videoId
      ) {
        const v = obj.videoRenderer;
        const vid = v.videoId;
        const isValidVid = vid && /^[A-Za-z0-9_-]{11}$/.test(vid);
        if (isValidVid && !seenIds.has(vid)) {
          seenIds.add(vid);
          const rawTitle =
            v.title?.runs?.map((r) => r.text).join("") ||
            v.title?.simpleText ||
            "Unknown Video";
          const channel =
            v.ownerText?.runs?.map((r) => r.text).join("") ||
            v.ownerText?.simpleText ||
            defaultChannel;
          const channelId =
            v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint
              ?.browseId || defaultChannelId;
          const durationMs = parseDurationTextToMs(
            v.lengthText?.simpleText ||
              v.thumbnailOverlays?.find(
                (o) => o.thumbnailOverlayTimeStatusRenderer
              )?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText ||
              ""
          );
          const parsed = parseYouTubeTitleAndArtist(rawTitle, channel);

          extracted.push({
            id: vid,
            index: extracted.length + 1,
            title: parsed.title,
            rawTitle: parsed.rawTitle,
            artist: parsed.artist,
            channelName: parsed.channelName,
            channelId,
            durationMs,
            isExplicit: false,
            previewUrl: null,
            externalUrl: `https://www.youtube.com/watch?v=${vid}`,
            platform: "youtube",
          });
        }
        return;
      }

      // Channel lockupViewModel (for YouTube Artist / Channel URLs ONLY)
      if (
        info.entityType === "artist" &&
        obj.lockupViewModel &&
        obj.lockupViewModel.contentId
      ) {
        const l = obj.lockupViewModel;
        const vid = l.contentId;
        const isValidVid = vid && /^[A-Za-z0-9_-]{11}$/.test(vid);
        if (isValidVid && !seenIds.has(vid)) {
          seenIds.add(vid);
          const meta = l.metadata?.lockupMetadataViewModel;
          const rawTitle = meta?.title?.content || "Unknown Track";
          const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows;
          const channelPart = rows?.[0]?.metadataParts?.[0]?.text;
          const channel = channelPart?.content || defaultChannel;
          const channelId =
            channelPart?.commandRuns?.[0]?.onTap?.innertubeCommand
              ?.browseEndpoint?.browseId || defaultChannelId;

          const badgeText =
            l.contentImage?.thumbnailViewModel?.overlays?.[0]
              ?.thumbnailBottomOverlayViewModel?.badges?.[0]
              ?.thumbnailBadgeViewModel?.text || "";
          const durationMs = parseDurationTextToMs(badgeText);
          const parsed = parseYouTubeTitleAndArtist(rawTitle, channel);

          extracted.push({
            id: vid,
            index: extracted.length + 1,
            title: parsed.title,
            rawTitle: parsed.rawTitle,
            artist: parsed.artist,
            channelName: parsed.channelName,
            channelId,
            durationMs,
            isExplicit: false,
            previewUrl: null,
            externalUrl: `https://www.youtube.com/watch?v=${vid}`,
            platform: "youtube",
          });
        }
        return;
      }

      if (obj.musicResponsiveListItemRenderer) {
        const item = obj.musicResponsiveListItemRenderer;
        const flex = item.flexColumns || [];
        const rawTitle =
          flex[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
            ?.map((r) => r.text)
            .join("")
            .trim() || "Unknown Track";
        const flexArtist =
          flex[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
            ?.map((r) => r.text)
            .join("")
            .trim() || defaultChannel;
        const channelId =
          flex[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
            ?.navigationEndpoint?.browseEndpoint?.browseId || defaultChannelId;
        const vid =
          item.playlistItemData?.videoId ||
          item.overlay?.musicItemThumbnailOverlayRenderer?.content
            ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
            ?.videoId;
        const durText =
          item.fixedColumns?.[0]
            ?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]
            ?.text || "";
        const durationMs = parseDurationTextToMs(durText);
        const isValidVid = vid && /^[A-Za-z0-9_-]{11}$/.test(vid);
        if (isValidVid && !seenIds.has(vid)) {
          seenIds.add(vid);
          const parsed = parseYouTubeTitleAndArtist(rawTitle, flexArtist);
          extracted.push({
            id: vid,
            index: extracted.length + 1,
            title: parsed.title,
            rawTitle: parsed.rawTitle,
            artist: parsed.artist,
            channelName: flexArtist,
            channelId,
            durationMs,
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

    walk(rootObj);
    return nextTokens;
  }

  // For playlists, isolate extraction to the primary track section to avoid recommendation shelves
  const secList =
    data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents;

  const playlistRoot =
    info.entityType === "playlist" && Array.isArray(secList)
      ? secList.find((s) =>
          s?.itemSectionRenderer?.contents?.some(
            (c) => c?.lockupViewModel || c?.playlistVideoRenderer
          )
        ) || secList[0]
      : null;

  let pendingTokens = extractFromNode(playlistRoot || data);

  // Follow YouTube continuation pages so playlists > 100 videos are fetched in full
  const MAX_CONTINUATION_PAGES = info.entityType === "artist" ? 3 : 25;
  let pagesFetched = 0;

  while (
    pendingTokens.length > 0 &&
    pagesFetched < MAX_CONTINUATION_PAGES &&
    extracted.length < 2500 &&
    (!officialTrackCount || extracted.length < officialTrackCount)
  ) {
    const token = pendingTokens.shift();
    if (!token || seenTokens.has(token)) continue;
    seenTokens.add(token);
    pagesFetched++;

    try {
      const contRes = await fetch(
        "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": UA,
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: "WEB",
                clientVersion: "2.20240826.01.00",
                hl: "en",
                gl: "US",
              },
            },
            continuation: token,
          }),
        }
      );

      if (!contRes.ok) break;
      const contData = await contRes.json();
      const beforeCount = extracted.length;
      const moreTokens = extractFromNode(contData);
      if (extracted.length > beforeCount && moreTokens.length > 0) {
        pendingTokens.push(...moreTokens);
      }
    } catch {
      break;
    }
  }

  // Cap at official track count to ensure no phantom/recommendation tracks
  const finalTracks =
    info.entityType === "playlist" && officialTrackCount && officialTrackCount > 0
      ? extracted.slice(0, officialTrackCount)
      : extracted;

  finalTracks.forEach((t, i) => {
    t.index = i + 1;
  });

  if (finalTracks.length === 0) {
    if (info.entityType === "playlist") {
      try {
        const ytmFallback = await fetchYouTubeMusicTracks(info.id);
        if (ytmFallback && ytmFallback.tracks.length > 0) return ytmFallback;
      } catch {}
    }
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
        ? `Channel Uploads (${finalTracks.length} items)`
        : "YouTube Playlist",
    coverUrl,
    totalTracks: finalTracks.length,
    tracks: finalTracks,
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
        `https://api.deezer.com/search?q=${encodeURIComponent(
          rawQuery
        )}&limit=1`
      ).then((r) => (r.ok ? r.json() : null)),
      fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(
          rawQuery
        )}&entity=song&limit=1`
      ).then((r) => (r.ok ? r.json() : null)),
    ]);

    const dTrack = dRes.status === "fulfilled" ? dRes.value?.data?.[0] : null;
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
      const releaseYr = iTrack?.releaseDate
        ? new Date(iTrack.releaseDate).getFullYear()
        : null;

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
            appleArtistIds: iTrack?.artistId ? [String(iTrack.artistId)] : [],
            albumReleaseYear:
              releaseYr && !isNaN(releaseYr) ? releaseYr : null,
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
      )}&limit=25`
    ).then((r) => (r.ok ? r.json() : null)),
    fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(
        rawQuery
      )}&entity=song&limit=25`
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
            r.artistName.toLowerCase() === rawQuery.toLowerCase()
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
      artistIds: matchedKnownAi?.spotifyId ? [matchedKnownAi.spotifyId] : [],
      appleArtistIds: matchedKnownAi?.appleId ? [matchedKnownAi.appleId] : [],
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

    const tracks = iTracks.map((t, idx) => {
      const releaseYr = t.releaseDate
        ? new Date(t.releaseDate).getFullYear()
        : null;
      return {
        id: String(t.trackId || idx),
        index: idx + 1,
        title: t.trackName || "Track",
        artist: t.artistName || canonicalArtist,
        appleArtistIds: t.artistId ? [String(t.artistId)] : [],
        albumReleaseYear: releaseYr && !isNaN(releaseYr) ? releaseYr : null,
        durationMs: t.trackTimeMillis || 0,
        isExplicit: t.trackExplicitness === "explicit",
        previewUrl: t.previewUrl || null,
        externalUrl: t.trackViewUrl || "https://music.apple.com",
        platform: "search",
      };
    });

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
        artistIds: matchedKnownAi?.spotifyId ? [matchedKnownAi.spotifyId] : [],
        appleArtistIds: matchedKnownAi?.appleId ? [matchedKnownAi.appleId] : [],
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
          albumReleaseYear: 2015,
          spotifyPlaycount: 1850420000,
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
          albumReleaseYear: 2020,
          spotifyPlaycount: 4620110000,
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
          albumReleaseYear: 2016,
          spotifyPlaycount: 3490000000,
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
