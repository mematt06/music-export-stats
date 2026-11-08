import { isSpotifyConnected, spotifyFetch } from "../auth/spotify.js";
import { norm } from "../utils.js";

const CACHE_KEY = "mes_track_covers_v1";
const ALBUM_CACHE_KEY = "mes_album_covers_v1";
const MAX_RESOLVE = 24;
const CONCURRENCY = 4;

export function trackCoverKey(name, artist = "") {
  return `${norm(name)}|||${norm(artist)}`;
}

export function albumCoverKey(name, artist = "") {
  return `${norm(name)}|||${norm(artist)}`;
}

function loadCache(key = CACHE_KEY) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
}

function saveCache(cache, key = CACHE_KEY) {
  try {
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      for (const k of keys.slice(0, keys.length - 400)) delete cache[k];
    }
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    /* quota */
  }
}

function pickThumb(images) {
  if (!images?.length) return null;
  // Prefer ~64px thumb when present (Spotify returns largest first)
  return images[images.length - 1]?.url || images[0]?.url || null;
}

/** Seed covers from live top-tracks / recently-played payloads. */
export function coversFromLive(live) {
  const out = {};
  const add = (t) => {
    if (!t?.name || !t.image) return;
    const key = trackCoverKey(t.name, t.artist || "");
    if (!key || out[key]?.image) return;
    out[key] = {
      name: t.name,
      artist: t.artist || "",
      image: t.image,
      id: t.id || null,
    };
  };
  for (const term of Object.keys(live?.topTracks || {})) {
    for (const t of live.topTracks[term] || []) add(t);
  }
  for (const t of live?.recentlyPlayed || []) add(t);
  return out;
}

async function searchTrackCover(name, artist) {
  const q = artist ? `track:${name} artist:${artist}` : `track:${name}`;
  const data = await spotifyFetch(`/search?type=track&limit=1&q=${encodeURIComponent(q)}`);
  const t = data?.tracks?.items?.[0];
  if (!t) return { name, artist, image: null, id: null };
  return {
    name: t.name || name,
    artist: artist || (t.artists || []).map((a) => a.name).join(", "),
    image: pickThumb(t.album?.images),
    id: t.id || null,
  };
}

async function searchAlbumCover(name, artist) {
  const q = artist ? `album:${name} artist:${artist}` : `album:${name}`;
  const data = await spotifyFetch(`/search?type=album&limit=1&q=${encodeURIComponent(q)}`);
  const a = data?.albums?.items?.[0];
  if (!a) return { name, artist, image: null, id: null };
  return {
    name: a.name || name,
    artist: artist || (a.artists || []).map((x) => x.name).join(", "),
    image: pickThumb(a.images),
    id: a.id || null,
  };
}

/** Seed album covers from live top-tracks / recently-played (album name + art). */
export function albumCoversFromLive(live) {
  const out = {};
  const add = (t) => {
    const album = t?.album;
    if (!album || !t.image) return;
    const key = albumCoverKey(album, t.artist || "");
    if (!key || out[key]?.image) return;
    out[key] = {
      name: album,
      artist: t.artist || "",
      image: t.image,
      id: null,
    };
  };
  for (const term of Object.keys(live?.topTracks || {})) {
    for (const t of live.topTracks[term] || []) add(t);
  }
  for (const t of live?.recentlyPlayed || []) add(t);
  return out;
}

/**
 * Resolve track+artist pairs → album cover URLs.
 * Uses localStorage cache + optional known map; searches Spotify when connected.
 * @param {{ name: string, artist?: string }[]} pairs
 */
export async function resolveTrackCovers(pairs, { known = {} } = {}) {
  const cache = { ...loadCache(), ...known };
  const unique = [];
  const seen = new Set();
  for (const raw of pairs || []) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;
    const artist = String(raw?.artist || "").trim();
    const key = trackCoverKey(name, artist);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ name, artist, key });
    if (unique.length >= MAX_RESOLVE) break;
  }

  const result = {};
  const missing = [];
  for (const row of unique) {
    if (cache[row.key] && ("image" in cache[row.key])) {
      result[row.key] = cache[row.key];
    } else {
      missing.push(row);
    }
  }

  if (missing.length && isSpotifyConnected()) {
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const batch = missing.slice(i, i + CONCURRENCY);
      const resolved = await Promise.all(
        batch.map(async ({ name, artist, key }) => {
          try {
            const cover = await searchTrackCover(name, artist);
            cache[key] = cover;
            return [key, cover];
          } catch {
            const fallback = { name, artist, image: null, id: null };
            cache[key] = fallback;
            return [key, fallback];
          }
        })
      );
      for (const [key, cover] of resolved) result[key] = cover;
    }
    saveCache(cache);
  } else {
    for (const { name, artist, key } of missing) {
      result[key] = cache[key] || { name, artist, image: null, id: null };
    }
  }

  return result;
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paintCoverThumbs(root, selector, nameAttr, artistAttr, keyFn, coversByKey) {
  if (!root) return;
  root.querySelectorAll(selector).forEach((el) => {
    const name = el.getAttribute(nameAttr) || "";
    const artist = el.getAttribute(artistAttr) || "";
    const cover = coversByKey[keyFn(name, artist)];
    if (!cover?.image) return;
    const thumb = el.querySelector(".track-cover");
    if (!thumb) return;
    if (thumb.tagName === "IMG") {
      if (thumb.getAttribute("src") !== cover.image) thumb.setAttribute("src", cover.image);
      return;
    }
    const img = document.createElement("img");
    img.className = "track-cover";
    img.src = cover.image;
    img.alt = "";
    img.width = 36;
    img.height = 36;
    img.loading = "lazy";
    img.setAttribute("data-cover-src", escapeAttr(cover.image));
    thumb.replaceWith(img);
  });
}

/** Swap placeholders for resolved cover images inside [data-track-name] nodes. */
export function paintTrackCovers(root, coversByKey) {
  paintCoverThumbs(
    root,
    "[data-track-name]",
    "data-track-name",
    "data-track-artist",
    trackCoverKey,
    coversByKey
  );
}

/**
 * Resolve album+artist pairs → cover URLs (Spotify album search when connected).
 * @param {{ name: string, artist?: string }[]} pairs
 */
export async function resolveAlbumCovers(pairs, { known = {} } = {}) {
  const cache = { ...loadCache(ALBUM_CACHE_KEY), ...known };
  const unique = [];
  const seen = new Set();
  for (const raw of pairs || []) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;
    const artist = String(raw?.artist || "").trim();
    const key = albumCoverKey(name, artist);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ name, artist, key });
    if (unique.length >= MAX_RESOLVE) break;
  }

  const result = {};
  const missing = [];
  for (const row of unique) {
    if (cache[row.key] && "image" in cache[row.key]) {
      result[row.key] = cache[row.key];
    } else {
      missing.push(row);
    }
  }

  if (missing.length && isSpotifyConnected()) {
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const batch = missing.slice(i, i + CONCURRENCY);
      const resolved = await Promise.all(
        batch.map(async ({ name, artist, key }) => {
          try {
            const cover = await searchAlbumCover(name, artist);
            cache[key] = cover;
            return [key, cover];
          } catch {
            const fallback = { name, artist, image: null, id: null };
            cache[key] = fallback;
            return [key, fallback];
          }
        })
      );
      for (const [key, cover] of resolved) result[key] = cover;
    }
    saveCache(cache, ALBUM_CACHE_KEY);
  } else {
    for (const { name, artist, key } of missing) {
      result[key] = cache[key] || { name, artist, image: null, id: null };
    }
  }

  return result;
}

/** Swap placeholders for resolved album covers inside [data-album-name] nodes. */
export function paintAlbumCovers(root, coversByKey) {
  paintCoverThumbs(
    root,
    "[data-album-name]",
    "data-album-name",
    "data-album-artist",
    albumCoverKey,
    coversByKey
  );
}
