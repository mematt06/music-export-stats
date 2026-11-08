import { isSpotifyConnected, spotifyFetch } from "../auth/spotify.js";
import { foldTr, norm } from "../utils.js";

const CACHE_KEY = "mes_artist_profiles_v1";
const MAX_RESOLVE = 20;
const CONCURRENCY = 4;

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    const keys = Object.keys(cache);
    if (keys.length > 400) {
      for (const k of keys.slice(0, keys.length - 300)) delete cache[k];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota */
  }
}

function searchUrl(name) {
  return `https://open.spotify.com/search/${encodeURIComponent(name)}`;
}

function artistUrl(id) {
  return `https://open.spotify.com/artist/${id}`;
}

/** Seed from live top-artists payloads (already have id + image). */
export function profilesFromLive(live) {
  const out = {};
  const buckets = live?.topArtists || {};
  for (const term of Object.keys(buckets)) {
    for (const a of buckets[term] || []) {
      if (!a?.name) continue;
      const key = norm(a.name);
      if (!key || out[key]?.id) continue;
      out[key] = {
        name: a.name,
        id: a.id || null,
        image: a.image || null,
        url: a.id ? artistUrl(a.id) : searchUrl(a.name),
      };
    }
  }
  return out;
}

async function searchArtist(name) {
  const q = encodeURIComponent(name);
  const data = await spotifyFetch(`/search?type=artist&limit=1&q=${q}`);
  const a = data?.artists?.items?.[0];
  if (!a) {
    return { name, id: null, image: null, url: searchUrl(name) };
  }
  return {
    name: a.name || name,
    id: a.id,
    image: a.images?.[a.images.length - 1]?.url || a.images?.[0]?.url || null,
    url: artistUrl(a.id),
  };
}

/**
 * Live Spotify artist search (multi-hit) for the Sanatçı field when export is missing.
 * @param {string} query
 * @param {number} [limit=8]
 */
export async function searchArtists(query, limit = 8) {
  const q = String(query || "").trim();
  if (!q || !isSpotifyConnected()) return [];
  const n = Math.max(1, Math.min(Number(limit) || 8, 10));
  const data = await spotifyFetch(
    `/search?type=artist&limit=${n}&q=${encodeURIComponent(q)}`
  );
  return (data?.artists?.items || [])
    .filter((a) => a?.name)
    .map((a) => ({
      key: a.id || norm(a.name),
      name: a.name,
      fold: foldTr(a.name),
      value: null,
      plays: null,
      first: "—",
      source: "live",
      id: a.id || null,
      image: a.images?.[a.images.length - 1]?.url || a.images?.[0]?.url || null,
      url: a.id ? artistUrl(a.id) : searchUrl(a.name),
    }));
}

/**
 * Resolve up to MAX_RESOLVE artist names → { id, image, url }.
 * Uses localStorage cache + optional known map; searches Spotify when connected.
 */
export async function resolveArtistProfiles(names, { known = {} } = {}) {
  const cache = { ...loadCache(), ...known };
  const unique = [];
  const seen = new Set();
  for (const raw of names || []) {
    const name = String(raw || "").trim();
    if (!name) continue;
    const key = norm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ name, key });
    if (unique.length >= MAX_RESOLVE) break;
  }

  const result = {};
  const missing = [];
  for (const { name, key } of unique) {
    if (cache[key]?.url) {
      result[key] = cache[key];
    } else {
      missing.push({ name, key });
    }
  }

  if (missing.length && isSpotifyConnected()) {
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const batch = missing.slice(i, i + CONCURRENCY);
      const resolved = await Promise.all(
        batch.map(async ({ name, key }) => {
          try {
            const profile = await searchArtist(name);
            cache[key] = profile;
            return [key, profile];
          } catch {
            const fallback = { name, id: null, image: null, url: searchUrl(name) };
            cache[key] = fallback;
            return [key, fallback];
          }
        })
      );
      for (const [key, profile] of resolved) result[key] = profile;
    }
    saveCache(cache);
  } else {
    for (const { name, key } of missing) {
      result[key] = { name, id: null, image: null, url: searchUrl(name) };
    }
  }

  return result;
}

const ICON_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.18c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14 4.38-1.32 9.78-.66 13.5 1.62.42.24.54.84.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72 1.02.42 1.56-.3.48-1.02.66-1.56.36z"/></svg>`;

export function artistLinkHtml(name, profile) {
  const url = profile?.url || searchUrl(name);
  const title = escapeAttr(`Spotify'da aç: ${name}`);
  const img = profile?.image
    ? `<img class="artist-avatar" src="${escapeAttr(profile.image)}" alt="" width="22" height="22" loading="lazy" />`
    : `<span class="artist-avatar placeholder" aria-hidden="true">${ICON_SVG}</span>`;
  return `<a class="artist-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" title="${title}" data-artist-key="${escapeAttr(norm(name))}">${img}<span class="artist-link-name">${escapeHtml(name)}</span></a>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/** Fill/update [data-artist-name] nodes after profiles resolve. */
export function paintArtistLinks(root, profilesByKey) {
  if (!root) return;
  root.querySelectorAll("[data-artist-name]").forEach((el) => {
    const name = el.getAttribute("data-artist-name") || el.textContent || "";
    const key = norm(name);
    const profile = profilesByKey[key];
    el.innerHTML = artistLinkHtml(name, profile);
  });
}
