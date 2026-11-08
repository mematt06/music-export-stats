import { setLastSpotifySync } from "../auth/config.js";
import {
  hasPlaybackScopes,
  spotifyFetch,
  spotifyFetchDetailed,
} from "../auth/spotify.js";
import { mins } from "../utils.js";

const PERIOD_WINDOW_MS = {
  "1d": 1 * 24 * 3600 * 1000,
  "1w": 7 * 24 * 3600 * 1000,
  "1m": 30 * 24 * 3600 * 1000,
  "6m": 180 * 24 * 3600 * 1000,
  "1y": 365 * 24 * 3600 * 1000,
  all: null,
};

export const LIVE_PERIOD_DEFS = [
  { id: "1d", label: "1 gün", short: "1G" },
  { id: "1w", label: "1 hafta", short: "1H" },
  { id: "1m", label: "1 ay", short: "1A" },
  { id: "6m", label: "6 ay", short: "6A" },
  { id: "1y", label: "1 yıl", short: "1Y" },
  { id: "all", label: "tüm zamanlar", short: "Tümü" },
];

/**
 * Live Spotify snapshot (API) — not lifetime history.
 * - recently played (last ~50)
 * - top artists / tracks for short / medium / long term
 * - currently playing (separate poll)
 */
export async function fetchSpotifyLive() {
  const [recent, topArtistsShort, topArtistsMedium, topArtistsLong, topTracksShort, topTracksMedium, topTracksLong, profile] =
    await Promise.all([
      spotifyFetch("/me/player/recently-played?limit=50"),
      spotifyFetch("/me/top/artists?limit=20&time_range=short_term"),
      spotifyFetch("/me/top/artists?limit=20&time_range=medium_term"),
      spotifyFetch("/me/top/artists?limit=20&time_range=long_term"),
      spotifyFetch("/me/top/tracks?limit=20&time_range=short_term"),
      spotifyFetch("/me/top/tracks?limit=20&time_range=medium_term"),
      spotifyFetch("/me/top/tracks?limit=20&time_range=long_term"),
      spotifyFetch("/me"),
    ]);

  const mapArtists = (payload) =>
    (payload?.items || []).map((a, i) => ({
      rank: i + 1,
      name: a.name,
      id: a.id,
      genres: a.genres || [],
      popularity: a.popularity,
      image: a.images?.[0]?.url || null,
    }));

  const mapTracks = (payload) =>
    (payload?.items || []).map((t, i) => {
      const imgs = t.album?.images || [];
      return {
        rank: i + 1,
        name: t.name,
        artist: (t.artists || []).map((a) => a.name).join(", "),
        album: t.album?.name || "",
        id: t.id,
        durationMs: t.duration_ms,
        popularity: t.popularity,
        playedAt: null,
        image: imgs[imgs.length - 1]?.url || imgs[0]?.url || null,
      };
    });

  const recentItems = (recent?.items || []).map((item) => {
    const imgs = item.track?.album?.images || [];
    return {
      name: item.track?.name || "?",
      artist: (item.track?.artists || []).map((a) => a.name).join(", "),
      album: item.track?.album?.name || "",
      playedAt: item.played_at,
      durationMs: item.track?.duration_ms || 0,
      id: item.track?.id || null,
      image: imgs[imgs.length - 1]?.url || imgs[0]?.url || null,
    };
  });

  const syncedAt = new Date().toISOString();
  setLastSpotifySync(syncedAt);

  return {
    source: "spotify-live",
    syncedAt,
    profile: {
      id: profile?.id,
      displayName: profile?.display_name,
      email: profile?.email,
      product: profile?.product,
      country: profile?.country,
      image: profile?.images?.[0]?.url || null,
    },
    recentlyPlayed: recentItems,
    topArtists: {
      short_term: mapArtists(topArtistsShort),
      medium_term: mapArtists(topArtistsMedium),
      long_term: mapArtists(topArtistsLong),
    },
    topTracks: {
      short_term: mapTracks(topTracksShort),
      medium_term: mapTracks(topTracksMedium),
      long_term: mapTracks(topTracksLong),
    },
    note: "Hesabındaki Spotify top listeleri. Takvim aralıkları için Dönem’e export yükle.",
  };
}

/**
 * Approximate Dönem buckets from recently-played (~50).
 * Longer windows usually need export; marked with needsExport when sparse.
 */
export function buildLiveApproxPeriods(recentlyPlayed = []) {
  const list = recentlyPlayed || [];
  const times = list
    .map((r) => (r.playedAt ? new Date(r.playedAt).getTime() : NaN))
    .filter((t) => !Number.isNaN(t));
  const anchorMs = times.length ? Math.max(...times) : Date.now();
  const periods = {};

  for (const def of LIVE_PERIOD_DEFS) {
    const windowMs = PERIOD_WINDOW_MS[def.id];
    const items = list.filter((r) => {
      const t = r.playedAt ? new Date(r.playedAt).getTime() : NaN;
      if (Number.isNaN(t)) return false;
      if (windowMs == null) return true;
      return t >= anchorMs - windowMs;
    });

    if (!items.length) {
      periods[def.id] = {
        id: def.id,
        label: def.label,
        empty: true,
        plays: 0,
        totalMin: 0,
        source: "live-approx",
        needsExport: def.id !== "1d",
      };
      continue;
    }

    const artistMap = new Map();
    const trackMap = new Map();
    let totalMs = 0;
    let minTs = null;
    let maxTs = null;

    for (const r of items) {
      const ms = Number(r.durationMs) || 0;
      totalMs += ms;
      const t = new Date(r.playedAt).getTime();
      if (!minTs || t < minTs) minTs = t;
      if (!maxTs || t > maxTs) maxTs = t;

      const aKey = (r.artist || "?").toLowerCase();
      const aCur = artistMap.get(aKey) || { name: r.artist || "?", ms: 0, plays: 0 };
      aCur.ms += ms;
      aCur.plays += 1;
      artistMap.set(aKey, aCur);

      const tKey = `${(r.name || "?").toLowerCase()}|||${aKey}`;
      const tCur = trackMap.get(tKey) || {
        name: r.name || "?",
        artist: r.artist || "",
        ms: 0,
        plays: 0,
      };
      tCur.ms += ms;
      tCur.plays += 1;
      trackMap.set(tKey, tCur);
    }

    const artists = [...artistMap.values()]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 8)
      .map((a) => ({ name: a.name, value: mins(a.ms), plays: a.plays }));
    const tracks = [...trackMap.values()]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 8)
      .map((t) => ({
        name: t.name,
        artist: t.artist,
        value: mins(t.ms),
        plays: t.plays,
      }));

    const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
    periods[def.id] = {
      id: def.id,
      label: def.label,
      empty: false,
      plays: items.length,
      totalMin: mins(totalMs),
      period: minTs && maxTs ? `${iso(minTs)} — ${iso(maxTs)}` : "—",
      artists,
      tracks,
      albums: [],
      source: "live-approx",
      needsExport: def.id !== "1d",
    };
  }

  return { periods, periodDefs: LIVE_PERIOD_DEFS };
}

/**
 * Currently playing track (or idle / need_reconnect / error).
 * Falls back to /me/player if currently-playing is empty but a device is active.
 */
export async function fetchCurrentlyPlaying() {
  if (!hasPlaybackScopes()) {
    console.warn(
      "[mes] now-playing: token’da user-read-currently-playing / user-read-playback-state yok → yeniden bağlan"
    );
    return {
      playing: false,
      status: "need_reconnect",
      needsReconnect: true,
      fetchedAt: new Date().toISOString(),
      message:
        "Bu oturumda ‘şu an çalıyor’ scope’ları yok. Yeniden bağlan (user-read-currently-playing + user-read-playback-state).",
    };
  }

  let status = null;
  let data = null;

  try {
    const cp = await spotifyFetchDetailed(
      "/me/player/currently-playing?additional_types=track"
    );
    status = cp.status;
    data = cp.data;
    console.info("[mes] GET /me/player/currently-playing", {
      http: status,
      is_playing: data?.is_playing ?? null,
      type: data?.currently_playing_type ?? null,
      item: data?.item?.name ?? null,
    });
  } catch (e) {
    console.error("[mes] currently-playing hata", e.status || "", e.message || e);
    if (e.status === 403 || /scope|Insufficient/i.test(String(e.message || e))) {
      return {
        playing: false,
        status: "need_reconnect",
        needsReconnect: true,
        fetchedAt: new Date().toISOString(),
        message:
          "Yetki yetersiz. Spotify’ı yeniden bağla (user-read-currently-playing).",
        error: e.message || String(e),
      };
    }
    return {
      playing: false,
      status: "error",
      fetchedAt: new Date().toISOString(),
      message: e.message || String(e),
      error: e.message || String(e),
    };
  }

  if (status === 204 || !data || !data.item) {
    try {
      const player = await spotifyFetchDetailed("/me/player?additional_types=track");
      console.info("[mes] GET /me/player (fallback)", {
        http: player.status,
        is_playing: player.data?.is_playing ?? null,
        device: player.data?.device?.name ?? null,
        item: player.data?.item?.name ?? null,
      });
      if (player.data?.item) {
        data = player.data;
        status = player.status;
      } else {
        return {
          playing: false,
          status: status === 204 ? "204" : "idle",
          fetchedAt: new Date().toISOString(),
          message: "Şu an bir şey çalmıyor.",
        };
      }
    } catch (e) {
      console.warn("[mes] /me/player fallback", e.message || e);
      return {
        playing: false,
        status: status === 204 ? "204" : "idle",
        fetchedAt: new Date().toISOString(),
        message: "Şu an bir şey çalmıyor.",
      };
    }
  }

  if (!data?.item || data.currently_playing_type === "episode") {
    return {
      playing: false,
      status: "idle",
      fetchedAt: new Date().toISOString(),
      message: "Şu an bir şey çalmıyor.",
    };
  }

  const item = data.item;
  const duration = item.duration_ms || 0;
  const progress = data.progress_ms || 0;
  const isPlaying = !!data.is_playing;

  console.info("[mes] now-playing ok", {
    name: item.name,
    artist: (item.artists || []).map((a) => a.name).join(", "),
    isPlaying,
    progressMs: progress,
  });

  return {
    playing: isPlaying,
    isPlaying,
    status: isPlaying ? "playing" : "paused",
    fetchedAt: new Date().toISOString(),
    progressMs: progress,
    durationMs: duration,
    progressPct: duration ? Math.min(100, Math.round((progress / duration) * 1000) / 10) : 0,
    name: item.name || "?",
    artist: (item.artists || []).map((a) => a.name).join(", "),
    album: item.album?.name || "",
    image: item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || null,
    uri: item.uri || null,
    device: data.device?.name || null,
  };
}

export function formatMsClock(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
