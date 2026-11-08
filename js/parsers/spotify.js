import {
  emptyPlatform,
  matchName,
  mins,
  norm,
  readAsText,
  zipFiles,
} from "../utils.js";

/** Extended Streaming History audio JSON (basename or nested zip path). */
const AUDIO_RX = [
  /(^|\/)streaming_history_audio[^/]*\.json$/i,
  /(^|\/)endsong[^/]*\.json$/i, // older GDPR export naming
];

const PERIOD_DEFS = [
  { id: "1d", label: "1 gün", short: "1G", ms: 1 * 24 * 3600 * 1000 },
  { id: "1w", label: "1 hafta", short: "1H", ms: 7 * 24 * 3600 * 1000 },
  { id: "1m", label: "1 ay", short: "1A", ms: 30 * 24 * 3600 * 1000 },
  { id: "6m", label: "6 ay", short: "6A", ms: 180 * 24 * 3600 * 1000 },
  { id: "1y", label: "1 yıl", short: "1Y", ms: 365 * 24 * 3600 * 1000 },
  { id: "all", label: "tüm zamanlar", short: "Tümü", ms: null },
];

function emptyBucket() {
  const s = emptyPlatform();
  s._seen = null; // shared seen lives on root
  return s;
}

function bumpAgg(map, key, ms) {
  const cur = map.get(key) || { ms: 0, plays: 0 };
  cur.ms += ms;
  cur.plays += 1;
  map.set(key, cur);
}

function addPlay(bucket, { ms, artist, track, album, dt, trackKey, na, nt }) {
  bucket.totalMs += ms;
  bucket.plays += 1;

  bumpAgg(bucket.artists, na, ms);
  bucket.artistMeta.set(na, artist);
  bumpAgg(bucket.tracks, trackKey, ms);
  bucket.trackMeta.set(trackKey, { name: track, artist });

  let albumKey = null;
  if (album) {
    albumKey = `${norm(album)}|||${na}`;
    bumpAgg(bucket.albums, albumKey, ms);
    bucket.albumMeta.set(albumKey, { name: album, artist });
  }

  // TR UTC+3 for hour/dow/year/month display consistency
  const local = new Date(dt.getTime() + 3 * 3600 * 1000);
  const y = local.getUTCFullYear();
  const m = `${y}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
  const hour = local.getUTCHours();
  const dow = local.getUTCDay();
  const dowMon0 = (dow + 6) % 7;

  bucket.byYear.set(y, (bucket.byYear.get(y) || 0) + ms);
  bucket.byMonth.set(m, (bucket.byMonth.get(m) || 0) + ms);
  bucket.byHour.set(hour, (bucket.byHour.get(hour) || 0) + ms);
  bucket.byDow.set(dowMon0, (bucket.byDow.get(dowMon0) || 0) + ms);

  // Earliest play in this bucket (lifetime root = full-export ilk dinleme)
  const prev = bucket.firstListen.get(trackKey);
  if (!prev || dt < prev) bucket.firstListen.set(trackKey, dt);
  const prevArtist = bucket.firstListenArtist.get(na);
  if (!prevArtist || dt < prevArtist) bucket.firstListenArtist.set(na, dt);
  if (albumKey) {
    const prevAlbum = bucket.firstListenAlbum.get(albumKey);
    if (!prevAlbum || dt < prevAlbum) bucket.firstListenAlbum.set(albumKey, dt);
  }

  if (!bucket._minTs || dt < bucket._minTs) bucket._minTs = dt;
  if (!bucket._maxTs || dt > bucket._maxTs) bucket._maxTs = dt;
}

function finalizeBucket(bucket) {
  if (bucket._minTs && bucket._maxTs) {
    bucket.period = `${isoDate(bucket._minTs)} — ${isoDate(bucket._maxTs)}`;
  }
  bucket.totalMin = mins(bucket.totalMs);
  delete bucket._seen;
  delete bucket._minTs;
  delete bucket._maxTs;
  return bucket;
}

function isoDate(dt) {
  return dt.toISOString().slice(0, 10);
}

function yieldTick() {
  return new Promise((r) => setTimeout(r, 0));
}

async function parseJsonRecords(text, root, playsOut) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON parse hatası: ${e.message || e}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("Beklenen dizi (array) değil — Audio streaming history değil.");
  }

  let added = 0;
  for (const r of data) {
    const ms = Number(r.ms_played) || 0;
    const artist = r.master_metadata_album_artist_name;
    const track = r.master_metadata_track_name;
    const album = r.master_metadata_album_album_name;
    const ts = r.ts;
    if (!artist || !track || !ts) continue;

    const dedupe = `${ts}|${r.spotify_track_uri || ""}|${ms}|${r.platform || ""}|${r.reason_start || ""}|${r.reason_end || ""}`;
    if (root._seen.has(dedupe)) continue;
    root._seen.add(dedupe);

    const dt = new Date(ts);
    if (Number.isNaN(dt.getTime())) continue;

    const na = norm(artist);
    const nt = norm(track);
    const trackKey = `${nt}|||${na}`;
    const play = { ms, artist, track, album, dt, trackKey, na, nt };

    // Lifetime only here — Dönem windows filled after we know export max ts
    addPlay(root, play);
    playsOut.push(play);
    added += 1;
  }
  return { records: data.length, added };
}

/** Rolling windows relative to latest play in the export (not wall-clock now). */
function fillPeriodBuckets(root, plays, anchorMs) {
  const cutoffs = Object.fromEntries(
    PERIOD_DEFS.map((p) => [p.id, p.ms == null ? 0 : anchorMs - p.ms])
  );
  for (const play of plays) {
    const t = play.dt.getTime();
    for (const p of PERIOD_DEFS) {
      if (p.ms == null || t >= cutoffs[p.id]) addPlay(root.periods[p.id], play);
    }
  }
  root.periodAnchor = isoDate(new Date(anchorMs));
}

function isAudioHistoryPath(path) {
  const p = path.replace(/\\/g, "/");
  // Explicitly skip video / podcast-only dumps
  if (/streaming_history_video/i.test(p)) return false;
  return matchName(p, AUDIO_RX);
}

/**
 * @param {File[]} files
 * @param {typeof JSZip} JSZip
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 */
export async function parseSpotifyFiles(files, JSZip, opts = {}) {
  const onProgress = opts.onProgress || (() => {});

  const state = emptyPlatform();
  state.source = "spotify";
  state._seen = new Set();
  state._minTs = null;
  state._maxTs = null;
  state.periods = Object.fromEntries(PERIOD_DEFS.map((p) => [p.id, emptyBucket()]));
  state.filesProcessed = [];
  state.warnings = [];
  const plays = [];

  const jobs = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      onProgress(`Zip açılıyor: ${file.name}…`);
      let zip;
      try {
        zip = await JSZip.loadAsync(await file.arrayBuffer());
      } catch (e) {
        throw new Error(`Zip açılamadı (${file.name}): ${e.message || e}`);
      }
      const entries = zipFiles(zip).filter(({ path }) => isAudioHistoryPath(path));
      if (!entries.length) {
        state.warnings.push(
          `${file.name}: Streaming_History_Audio_*.json bulunamadı (klasör / nested path tarandı).`
        );
      }
      for (const { path, entry } of entries) {
        jobs.push({
          label: `${file.name} → ${path}`,
          read: () => entry.async("text"),
        });
      }
    } else if (lower.endsWith(".json")) {
      const base = file.name.replace(/\\/g, "/");
      // Expected non-audio dumps — skip silently (no UI noise)
      if (/streaming_history_video/i.test(base) || /streaming_history_podcast/i.test(base)) {
        continue;
      }
      // Accept Audio_* or renamed dumps; parseJsonRecords validates shape
      jobs.push({
        label: file.name,
        read: () => readAsText(file),
      });
    } else {
      // Non zip/json: ignore quietly (user may have selected a whole folder dump)
      continue;
    }
  }

  if (!jobs.length) {
    throw new Error(
      "Audio streaming history bulunamadı. my_spotify_data.zip veya Streaming_History_Audio_*.json yükle."
    );
  }

  let i = 0;
  for (const job of jobs) {
    i += 1;
    onProgress(`${i}/${jobs.length} dosya işleniyor: ${job.label}`);
    try {
      const text = await job.read();
      const { records, added } = await parseJsonRecords(text, state, plays);
      state.filesProcessed.push({ path: job.label, records, added });
    } catch (e) {
      state.warnings.push(`${job.label}: ${e.message || e}`);
    }
    await yieldTick();
  }

  if (!state.plays) {
    const detail = state.warnings.length ? ` ${state.warnings.join(" · ")}` : "";
    throw new Error(`Hiç geçerli dinleme kaydı çıkmadı.${detail}`);
  }

  const anchorMs = state._maxTs ? state._maxTs.getTime() : Date.now();
  onProgress("Dönem pencereleri hesaplanıyor…");
  fillPeriodBuckets(state, plays, anchorMs);

  finalizeBucket(state);
  state.periodDefs = PERIOD_DEFS.map((p) => ({
    id: p.id,
    label: p.label,
    short: p.short || p.label,
  }));
  for (const p of PERIOD_DEFS) {
    finalizeBucket(state.periods[p.id]);
  }

  onProgress(
    `Tamam: ${state.plays.toLocaleString("tr-TR")} oynatma · ${mins(state.totalMs).toLocaleString("tr-TR")} dk · ${jobs.length} dosya`
  );
  return state;
}

export { PERIOD_DEFS };
