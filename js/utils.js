export function mins(ms) {
  return Math.round((ms / 60000) * 10) / 10;
}

export function fmt(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("tr-TR");
}

export function norm(s) {
  if (!s) return "";
  let t = String(s).replace(/\u00a0/g, " ").trim().toLowerCase();
  t = t.normalize("NFKC");
  t = t.replace(/\s*-\s*(remaster(ed)?(\s*\d+)?|live|akustik|acoustic|radio edit).*$/i, "");
  t = t.replace(/\s+/g, " ");
  return t;
}

/**
 * TR/EN keyboard-tolerant fold for search: aşkın ↔ askin, İ/I/ı → i, strip accents.
 */
export function foldTr(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Substring match on folded text; multi-word query requires all tokens. */
export function foldMatch(haystack, needle) {
  const h = foldTr(haystack);
  const n = foldTr(needle);
  if (!n) return false;
  const parts = n.split(" ").filter(Boolean);
  return parts.every((p) => h.includes(p));
}

export async function readAsText(file) {
  return file.text();
}

/** Recursively list files from a JSZip instance */
export function zipFiles(zip) {
  const out = [];
  zip.forEach((path, entry) => {
    if (!entry.dir) out.push({ path, entry });
  });
  return out;
}

export function matchName(path, patterns) {
  const p = path.replace(/\\/g, "/").toLowerCase();
  return patterns.some((rx) => rx.test(p));
}

export function emptyPlatform() {
  return {
    source: null,
    period: null,
    totalMs: 0,
    plays: 0,
    artists: new Map(),
    tracks: new Map(),
    albums: new Map(),
    artistMeta: new Map(),
    trackMeta: new Map(),
    albumMeta: new Map(),
    byYear: new Map(),
    byMonth: new Map(),
    byHour: new Map(),
    byDow: new Map(),
    firstListen: new Map(),
    firstListenArtist: new Map(),
    firstListenAlbum: new Map(),
  };
}
