import { foldTr, mins } from "../utils.js";

function aggMs(entry) {
  if (entry == null) return 0;
  return typeof entry === "object" ? Number(entry.ms) || 0 : Number(entry) || 0;
}

function aggPlays(entry) {
  if (entry == null) return 0;
  return typeof entry === "object" ? Number(entry.plays) || 0 : 0;
}

function topFromAggMap(map, metaMap, n) {
  return [...map.entries()]
    .sort((a, b) => aggMs(b[1]) - aggMs(a[1]))
    .slice(0, n)
    .map(([key, entry]) => {
      const raw = aggMs(entry);
      const plays = aggPlays(entry);
      const meta = metaMap.get(key) || {};
      if (typeof meta === "string") {
        return {
          key,
          name: meta,
          value: mins(raw),
          plays,
          raw,
        };
      }
      return {
        key,
        name: meta.name || key.split("|||")[0],
        artist: meta.artist || key.split("|||")[1] || "",
        value: mins(raw),
        plays,
        raw,
      };
    });
}

/** Format UTC instant in TR (UTC+3) wall clock (date + time). */
function formatDateTR(dt) {
  const local = new Date(dt.getTime() + 3 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** Calendar date only in TR (UTC+3) — for İlk dinleme lists. */
function formatDateOnlyTR(dt) {
  const local = new Date(dt.getTime() + 3 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

function firstFromMap(map, key) {
  if (!map || key == null) return null;
  const dt = map instanceof Map ? map.get(key) : map[key];
  if (!dt) return null;
  return dt instanceof Date ? dt : new Date(dt);
}

function withFirstListen(items, map) {
  return (items || []).map((item) => {
    const dt = firstFromMap(map, item.key);
    return {
      ...item,
      first: dt ? formatDateOnlyTR(dt) : item.first || "—",
    };
  });
}

function indexFirstListen(map) {
  const out = {};
  if (!map) return out;
  const entries = map instanceof Map ? map.entries() : Object.entries(map);
  for (const [key, dt] of entries) {
    const d = dt instanceof Date ? dt : new Date(dt);
    if (!Number.isNaN(d.getTime())) out[key] = formatDateOnlyTR(d);
  }
  return out;
}

export function summarizePlatform(state, opts = {}) {
  if (!state) return null;
  const topN = opts.topN || 15;
  const albumN = opts.albumN || 12;

  // Prefer lifetime maps when summarizing a Dönem bucket (ilk dinleme = full export)
  const flTracks = opts.lifetimeFirst?.tracks || state.firstListen;
  const flArtists = opts.lifetimeFirst?.artists || state.firstListenArtist;
  const flAlbums = opts.lifetimeFirst?.albums || state.firstListenAlbum;

  const artists = withFirstListen(
    topFromAggMap(state.artists, state.artistMeta, topN),
    flArtists
  );
  const tracks = withFirstListen(
    topFromAggMap(state.tracks, state.trackMeta, topN),
    flTracks
  );
  const albums = withFirstListen(
    topFromAggMap(state.albums, state.albumMeta, albumN),
    flAlbums
  );

  const years = [...state.byYear.entries()].sort((a, b) => a[0] - b[0]);
  const months = [...state.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: String(h).padStart(2, "0"),
    value: mins(state.byHour.get(h) || 0),
  }));
  const dowNames = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  const dow = dowNames.map((day, i) => ({
    day,
    value: mins(state.byDow.get(i) || 0),
  }));

  const firstTop = tracks.slice(0, 10).map((t) => {
    const dt = firstFromMap(flTracks, t.key) || state.firstListen?.get?.(t.key);
    return {
      name: t.name,
      artist: t.artist || "",
      first: dt ? formatDateTR(dt) : t.first && t.first !== "—" ? t.first : "—",
    };
  });

  const earliestSource = state.firstListen || flTracks;
  const earliestEntries =
    earliestSource instanceof Map
      ? [...earliestSource.entries()]
      : Object.entries(earliestSource || {}).map(([k, v]) => [k, new Date(v)]);

  const earliest = earliestEntries
    .sort((a, b) => a[1] - b[1])
    .slice(0, 8)
    .map(([key, dt]) => {
      const meta = state.trackMeta.get(key) || {};
      const d = dt instanceof Date ? dt : new Date(dt);
      return {
        name: meta.name || key.split("|||")[0],
        artist: meta.artist || "",
        first: formatDateTR(d),
      };
    });

  const artistCount =
    state.artists instanceof Map
      ? state.artists.size
      : Array.isArray(state.artists)
        ? state.artists.length
        : Number(state.artistCount) || 0;
  const trackCount =
    state.tracks instanceof Map
      ? state.tracks.size
      : Array.isArray(state.tracks)
        ? state.tracks.length
        : Number(state.trackCount) || 0;

  return {
    source: state.source,
    period: state.period,
    totalMin: state.totalMin || mins(state.totalMs || 0),
    totalMs: state.totalMs || 0,
    plays: state.plays || 0,
    artistCount,
    trackCount,
    unit: state.unit || "minutes",
    artists,
    tracks,
    albums,
    years: years.map(([y, v]) => ({ year: String(y), value: mins(v) })),
    months: months.slice(-36).map(([m, v]) => ({ month: m, value: mins(v) })),
    hours,
    dow,
    firstTop,
    earliest,
    filesProcessed: state.filesProcessed || null,
    warnings: state.warnings || null,
  };
}

/**
 * Summarize lifetime + rolling windows produced by parseSpotifyFiles.
 */
export function summarizeSpotifyExport(state) {
  if (!state) return null;
  const lifetimeFirst = {
    tracks: state.firstListen,
    artists: state.firstListenArtist,
    albums: state.firstListenAlbum,
  };
  const base = summarizePlatform(state, { topN: 15, albumN: 15, lifetimeFirst });
  const periodDefs = state.periodDefs || [
    { id: "1d", label: "1 gün", short: "1G" },
    { id: "1w", label: "1 hafta", short: "1H" },
    { id: "1m", label: "1 ay", short: "1A" },
    { id: "6m", label: "6 ay", short: "6A" },
    { id: "1y", label: "1 yıl", short: "1Y" },
    { id: "all", label: "tüm zamanlar", short: "Tümü" },
  ];
  const periods = {};
  for (const def of periodDefs) {
    const bucket = state.periods?.[def.id];
    if (!bucket || !bucket.plays) {
      periods[def.id] = { id: def.id, label: def.label, empty: true, plays: 0, totalMin: 0 };
      continue;
    }
    periods[def.id] = {
      id: def.id,
      label: def.label,
      empty: false,
      ...summarizePlatform(bucket, { topN: 8, albumN: 8, lifetimeFirst }),
    };
  }
  const artistCatalog = [...(state.artists?.entries?.() || [])]
    .map(([key, entry]) => {
      const name =
        typeof state.artistMeta.get(key) === "string"
          ? state.artistMeta.get(key)
          : state.artistMeta.get(key)?.name || key;
      const dt = firstFromMap(state.firstListenArtist, key);
      return {
        key,
        name,
        fold: foldTr(name),
        value: mins(aggMs(entry)),
        plays: aggPlays(entry),
        first: dt ? formatDateOnlyTR(dt) : "—",
      };
    })
    .sort((a, b) => b.value - a.value);

  // Pools for artist-detail top lists (bounded for IndexedDB)
  const trackPool = withFirstListen(
    topFromAggMap(state.tracks, state.trackMeta, 400),
    state.firstListen
  );
  const albumPool = withFirstListen(
    topFromAggMap(state.albums, state.albumMeta, 200),
    state.firstListenAlbum
  );

  return {
    ...base,
    periods,
    periodDefs,
    periodAnchor: state.periodAnchor || null,
    artistCatalog,
    trackPool,
    albumPool,
    // Serializable lookup for UI / cache (lifetime ilk dinleme)
    firstListenIndex: {
      tracks: indexFirstListen(state.firstListen),
      artists: indexFirstListen(state.firstListenArtist),
      albums: indexFirstListen(state.firstListenAlbum),
    },
  };
}
