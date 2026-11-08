import { foldMatch, foldTr, fmt, norm } from "../utils.js";
import { PASTEL, brandTitle, logoSpotify } from "./brands.js";
import { LIVE_PERIOD_DEFS, formatMsClock } from "../live/spotify.js";
import { isSpotifyConnected } from "../auth/spotify.js";
import {
  artistLinkHtml,
  paintArtistLinks,
  profilesFromLive,
  resolveArtistProfiles,
  searchArtists,
} from "../live/artistProfiles.js";
import {
  albumCoversFromLive,
  coversFromLive,
  paintAlbumCovers,
  paintTrackCovers,
  resolveAlbumCovers,
  resolveTrackCovers,
} from "../live/trackCovers.js";

function artistNameCell(name) {
  return `<span data-artist-name="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
}

function trackNameCell(name, artist = "") {
  return `<span class="track-cell" data-track-name="${escapeHtml(name)}" data-track-artist="${escapeHtml(
    artist || ""
  )}"><span class="track-cover placeholder" aria-hidden="true"></span><span class="track-cell-name">${escapeHtml(
    name
  )}</span></span>`;
}

function albumNameCell(name, artist = "") {
  return `<span class="track-cell" data-album-name="${escapeHtml(name)}" data-album-artist="${escapeHtml(
    artist || ""
  )}"><span class="track-cover placeholder" aria-hidden="true"></span><span class="track-cell-name">${escapeHtml(
    name
  )}</span></span>`;
}

async function enhanceArtistProfiles(root, live, names) {
  if (!root) return;
  const known = profilesFromLive(live);
  const list =
    names ||
    [...root.querySelectorAll("[data-artist-name]")]
      .map((n) => n.getAttribute("data-artist-name"))
      .filter(Boolean);
  try {
    const profiles = await resolveArtistProfiles(list.slice(0, 20), { known });
    paintArtistLinks(root, { ...known, ...profiles });
  } catch {
    paintArtistLinks(root, known);
  }
}

async function enhanceTrackCovers(root, live) {
  if (!root) return;
  const nodes = [...root.querySelectorAll("[data-track-name]")];
  if (!nodes.length) return;
  const pairs = nodes.map((n) => ({
    name: n.getAttribute("data-track-name") || "",
    artist: n.getAttribute("data-track-artist") || "",
  }));
  const known = coversFromLive(live);
  try {
    const covers = await resolveTrackCovers(pairs, { known });
    paintTrackCovers(root, { ...known, ...covers });
  } catch {
    paintTrackCovers(root, known);
  }
}

async function enhanceAlbumCovers(root, live) {
  if (!root) return;
  const nodes = [...root.querySelectorAll("[data-album-name]")];
  if (!nodes.length) return;
  const pairs = nodes.map((n) => ({
    name: n.getAttribute("data-album-name") || "",
    artist: n.getAttribute("data-album-artist") || "",
  }));
  const known = albumCoversFromLive(live);
  try {
    const covers = await resolveAlbumCovers(pairs, { known });
    paintAlbumCovers(root, { ...known, ...covers });
  } catch {
    paintAlbumCovers(root, known);
  }
}

const charts = [];

function destroyCharts() {
  while (charts.length) {
    const c = charts.pop();
    try {
      c.destroy();
    } catch {
      /* */
    }
  }
}

function el(id) {
  return document.getElementById(id);
}

function setStats(items) {
  const box = el("stats");
  box.innerHTML = items
    .map(
      (s) =>
        `<div class="stat${s.provider ? ` provider-${s.provider}` : ""}"><div class="label">${s.label}</div><div class="value">${s.value}</div></div>`
    )
    .join("");
}

function colClass(header) {
  const map = {
    "#": "col-rank",
    Sanatçı: "col-artist",
    Albüm: "col-title",
    Şarkı: "col-title",
    Parça: "col-title",
    Dk: "col-mins",
    Oynatma: "col-plays",
    Zaman: "col-time",
  };
  return map[header] || "";
}

function table(headers, rows, numIdx = []) {
  const th = headers
    .map((h, i) => {
      const classes = [numIdx.includes(i) ? "num" : "", colClass(h)].filter(Boolean).join(" ");
      return `<th class="${classes}">${h}</th>`;
    })
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => {
            const classes = [numIdx.includes(i) ? "num" : "", colClass(headers[i])]
              .filter(Boolean)
              .join(" ");
            const label = escapeHtml(headers[i] || "");
            return `<td class="${classes}" data-label="${label}">${c ?? "—"}</td>`;
          })
          .join("")}</tr>`
    )
    .join("");
  return `<div class="table-scroll"><table class="data-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function barChart(canvasId, labels, datasets, opts = {}) {
  const ctx = el(canvasId);
  if (!ctx) return;
  const horizontal = opts.horizontal ?? labels.length > 8;
  const stacked = !!opts.stacked;
  const chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? "y" : "x",
      plugins: {
        legend: { display: datasets.length > 1 },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.raw;
              const extra = opts.tooltipExtra?.(ctx) || "";
              return `${fmt(v)} dk${extra}`;
            },
          },
        },
      },
      scales: {
        x: { stacked, ticks: { color: PASTEL.axis }, grid: { color: PASTEL.grid } },
        y: { stacked, ticks: { color: PASTEL.axis }, grid: { color: PASTEL.grid } },
      },
    },
  });
  charts.push(chart);
}

function artistChartLabels(artists) {
  return artists.map((a) => `${a.name} · ${fmt(a.value)} dk`);
}

function streamSummaryCard(spotify) {
  if (!spotify) return "";
  return `
  <section class="card stream-summary provider-spotify" id="sec-stream-summary">
    ${brandTitle("spotify", "Toplam stream özeti")}
    <p class="hint">Export’taki tüm dinlemeler</p>
    <div class="stream-summary-grid">
      <div class="stream-metric">
        <div class="label">Toplam dinleme</div>
        <div class="value">${fmt(spotify.totalMin)} <span class="unit">dk</span></div>
      </div>
      <div class="stream-metric">
        <div class="label">Toplam oynatma</div>
        <div class="value">${fmt(spotify.plays)}</div>
      </div>
    </div>
  </section>`;
}

function nowHead(extra = "", { showRefresh = true } = {}) {
  const refresh = showRefresh
    ? `<button type="button" class="now-refresh" id="btn-now-refresh" title="Yenile" aria-label="Yenile">↻</button>`
    : "";
  return `
    <div class="now-head">
      <div class="now-head-left">${logoSpotify}<h2>Şu an çalıyor</h2>${extra}</div>
      ${refresh}
    </div>`;
}

function nowSyncActions({ connected = false, needsReconnect = false } = {}) {
  if (needsReconnect) {
    return `<div class="now-card-actions">
      <button type="button" class="primary" id="btn-now-reconnect">Yeniden bağlan</button>
    </div>`;
  }
  if (!connected) {
    return `<div class="now-card-actions">
      <button type="button" class="primary" id="btn-now-reconnect">Spotify bağla</button>
      <button type="button" id="btn-sync-all" disabled>Canlı sync yenile</button>
    </div>`;
  }
  return `<div class="now-card-actions">
    <button type="button" id="btn-sync-all">Canlı sync yenile</button>
  </div>`;
}

function nowPlayingCard(np, { connected = false } = {}) {
  if (!np || np.status === "offline") {
    return `
    <section class="card now-playing provider-spotify idle" id="sec-now-playing">
      ${nowHead("", { showRefresh: false })}
      <p class="hint now-idle">Spotify bağlandığında burada görünür.</p>
      ${nowSyncActions({ connected: false })}
    </section>`;
  }

  if (np.needsReconnect || np.status === "need_reconnect") {
    return `
    <section class="card now-playing provider-spotify" id="sec-now-playing">
      ${nowHead()}
      <p class="hint now-idle warn-text">Yeniden bağlan — çalma durumu için ek izin gerekli.</p>
      ${nowSyncActions({ connected, needsReconnect: true })}
    </section>`;
  }

  if (np.error && !np.name) {
    return `
    <section class="card now-playing provider-spotify" id="sec-now-playing">
      ${nowHead()}
      <p class="hint now-idle error-inline">${escapeHtml(np.message || np.error)}</p>
      ${nowSyncActions({ connected })}
    </section>`;
  }

  if (!np.playing && !np.isPlaying && !np.name) {
    return `
    <section class="card now-playing provider-spotify idle" id="sec-now-playing">
      ${nowHead()}
      <p class="hint now-idle">Şu an bir şey çalmıyor.</p>
      ${nowSyncActions({ connected })}
    </section>`;
  }

  const paused = np.playing === false || np.isPlaying === false;
  const statusPill = paused
    ? `<span class="now-status paused"><span class="now-dot"></span>duraklatıldı</span>`
    : `<span class="now-status live"><span class="now-dot"></span>çalıyor</span>`;
  const art = np.image
    ? `<img class="now-art" src="${np.image}" alt="" width="88" height="88" />`
    : `<div class="now-art placeholder" aria-hidden="true"></div>`;
  const prog =
    np.durationMs > 0
      ? `<div class="now-progress" data-progress-root
            data-progress-ms="${Number(np.progressMs) || 0}"
            data-duration-ms="${Number(np.durationMs) || 0}"
            data-playing="${paused ? "0" : "1"}"
            data-fetched-at="${escapeHtml(np.fetchedAt || new Date().toISOString())}">
          <div class="now-bar"><span style="width:${np.progressPct || 0}%"></span></div>
          <div class="now-times"><span data-progress-clock>${formatMsClock(np.progressMs)}</span><span>${formatMsClock(np.durationMs)}</span></div>
        </div>`
      : "";
  const device = np.device
    ? `<div class="now-device">${escapeHtml(np.device)}</div>`
    : "";

  return `
  <section class="card now-playing provider-spotify" id="sec-now-playing" data-track-key="${escapeHtml(np.uri || np.name || "")}">
    ${nowHead(statusPill)}
    <div class="now-body">
      ${art}
      <div class="now-meta">
        <div class="now-title">${escapeHtml(np.name)}</div>
        <div class="now-artist">${escapeHtml(np.artist || "")}</div>
        <div class="now-album">${escapeHtml(np.album || "")}</div>
        ${device}
        ${prog}
      </div>
    </div>
    ${nowSyncActions({ connected })}
  </section>`;
}

let progressTickTimer = null;

function stopLocalProgressTick() {
  if (progressTickTimer) {
    clearInterval(progressTickTimer);
    progressTickTimer = null;
  }
}

function startLocalProgressTick() {
  stopLocalProgressTick();
  const root = document.querySelector("#sec-now-playing [data-progress-root]");
  if (!root || root.dataset.playing !== "1") return;

  const bar = root.querySelector(".now-bar span");
  const clock = root.querySelector("[data-progress-clock]");
  const baseMs = Number(root.dataset.progressMs) || 0;
  const duration = Number(root.dataset.durationMs) || 0;
  const fetchedAt = Date.parse(root.dataset.fetchedAt || "") || Date.now();
  if (!duration) return;

  const paint = () => {
    const elapsed = Date.now() - fetchedAt;
    const cur = Math.min(duration, baseMs + elapsed);
    const pct = Math.min(100, (cur / duration) * 100);
    if (bar) bar.style.width = `${pct}%`;
    if (clock) clock.textContent = formatMsClock(cur);
  };
  paint();
  progressTickTimer = setInterval(paint, 400);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Always-visible Dönem strip: export ts windows, or live recently-played approx.
 * @param {{ spotify?: object, livePeriods?: { periods: object, periodDefs: object[] }|null }} args
 */
function periodPanel({ spotify, livePeriods }) {
  const fromExport = !!(spotify?.periods);
  const defs =
    spotify?.periodDefs ||
    livePeriods?.periodDefs ||
    LIVE_PERIOD_DEFS;
  const periods = spotify?.periods || livePeriods?.periods || {};
  const sourceLabel = fromExport ? "Export dinleme geçmişi" : "";

  const available = defs.filter((d) => periods[d.id] && !periods[d.id].empty);
  const active =
    available.find((d) => d.id === "1d")?.id ||
    available[0]?.id ||
    defs[0].id;

  const tabs = defs
    .map((d) => {
      const p = periods[d.id];
      const empty = !p || p.empty;
      const title = empty ? "Bu aralıkta kayıt yok" : p?.needsExport ? "Yaklaşık veri" : "";
      return `<button type="button" data-period="${d.id}" class="period-tab ${
        d.id === active ? "active" : ""
      }${empty ? " is-empty" : ""}" title="${escapeHtml(title)}">${escapeHtml(
        d.label
      )}</button>`;
    })
    .join("");

  return `
  <section class="card provider-spotify range-hero" id="sec-periods">
    ${brandTitle("spotify", "Dönem")}
    ${sourceLabel ? `<p class="hint">${sourceLabel}</p>` : ""}
    <div class="term-tabs range-tabs" data-period-tabs>${tabs}</div>
    <div id="period-body"></div>
  </section>`;
}

/**
 * Standalone artist lookup — always visible; export optional.
 * @param {{ spotify?: object, connected?: boolean }} args
 */
function artistSearchSection({ spotify, connected = false }) {
  const hasExport = !!(spotify?.artistCatalog?.length || spotify?.artists?.length);
  let note = "";
  if (!hasExport && connected) {
    note = `<p class="hint meta-quiet" id="artist-search-note">Export yok — bazı bilgiler eksik olabilir</p>`;
  } else if (!hasExport && !connected) {
    note = `<p class="hint meta-quiet" id="artist-search-note">Export veya Spotify bağlantısı istatistikleri doldurur</p>`;
  }
  return `
  <section class="card provider-spotify range-hero" id="sec-artist-search">
    ${brandTitle("spotify", "Sanatçı")}
    ${note}
    <div class="artist-search" id="artist-search">
      <input type="search" id="artist-search-input" placeholder="Sanatçı ara…" autocomplete="off" />
      <ul class="artist-suggest" id="artist-suggest" role="listbox"></ul>
      <div id="artist-detail" hidden></div>
    </div>
  </section>`;
}

function renderPeriodBody(periods, periodId) {
  const box = el("period-body");
  if (!box || !periods) return;
  const p = periods[periodId];
  if (!p || p.empty) {
    box.innerHTML = `<p class="hint meta-quiet">Bu aralıkta veri yok.</p>`;
    return;
  }

  const artists = (p.artists || []).map((a, i) => [
    i + 1,
    artistNameCell(a.name),
    fmt(a.value),
    fmt(a.plays),
  ]);
  const tracks = (p.tracks || []).map((t, i) => [
    i + 1,
    trackNameCell(t.name, t.artist || ""),
    t.artist || "",
    fmt(t.plays),
    fmt(t.value),
  ]);
  const albums = (p.albums || [])
    .filter((a) => a.value > 0)
    .map((a, i) => [
      i + 1,
      albumNameCell(a.name, a.artist || ""),
      a.artist || "",
      fmt(a.value),
      fmt(a.plays),
    ]);

  box.innerHTML = `
    <div class="period-stats">
      <div><span class="muted">Toplam dk</span><strong>${fmt(p.totalMin)}</strong></div>
      <div><span class="muted">Oynatma</span><strong>${fmt(p.plays)}</strong></div>
    </div>
    ${
      (p.artists || []).length
        ? `<div class="chart-wrap"><canvas id="period-artists"></canvas></div>
    <h3>Top sanatçılar</h3>
    ${table(["#", "Sanatçı", "Dk", "Oynatma"], artists, [0, 2, 3])}`
        : ""
    }
    <h3>Top albümler</h3>
    ${
      albums.length
        ? table(["#", "Albüm", "Sanatçı", "Dk", "Oynatma"], albums, [0, 3, 4])
        : `<p class="hint">Bu aralıkta albüm verisi yok.</p>`
    }
    <h3>Top şarkılar</h3>
    ${
      tracks.length
        ? table(["#", "Şarkı", "Sanatçı", "Oynatma", "Dk"], tracks, [0, 3, 4])
        : `<p class="hint">Bu aralıkta şarkı yok.</p>`
    }
  `;

  if (!(p.artists || []).length) return;

  requestAnimationFrame(() => {
    barChart(
      "period-artists",
      artistChartLabels(p.artists),
      [
        {
          label: "Dk",
          data: p.artists.map((a) => a.value),
          backgroundColor: PASTEL.spotify.soft,
        },
      ],
      {
        horizontal: true,
        tooltipExtra: (ctx) => {
          const plays = p.artists[ctx.dataIndex]?.plays;
          return plays != null ? ` · ${fmt(plays)} oynatma` : "";
        },
      }
    );
  });
}

function platformSection(id, provider, title, summary) {
  if (!summary) return "";
  const artists = summary.artists.map((a, i) => [
    i + 1,
    artistNameCell(a.name),
    fmt(a.value),
    fmt(a.plays),
  ]);
  const tracks = summary.tracks.map((t, i) => [
    i + 1,
    trackNameCell(t.name, t.artist || ""),
    t.artist || "",
    fmt(t.plays),
    fmt(t.value),
  ]);
  const albums = (summary.albums || [])
    .filter((a) => a.value > 0)
    .map((a, i) => [
      i + 1,
      albumNameCell(a.name, a.artist || ""),
      a.artist || "",
      fmt(a.value),
      fmt(a.plays),
    ]);

  const filesNote =
    summary.filesProcessed?.length
      ? `<p class="hint meta-quiet">${summary.filesProcessed.length} Audio JSON</p>`
      : "";

  return `
  <section class="card provider-${provider}" id="${id}">
    ${brandTitle(provider, title)}
    <p class="hint">Sanatçılar, albümler, şarkılar ve yıllık dağılım</p>
    ${filesNote}
    <div class="chart-wrap tall"><canvas id="${id}-artists"></canvas></div>
    <h3>Top sanatçılar</h3>
    ${table(["#", "Sanatçı", "Dk", "Oynatma"], artists, [0, 2, 3])}
    <h3>Top albümler</h3>
    ${
      albums.length
        ? table(["#", "Albüm", "Sanatçı", "Dk", "Oynatma"], albums, [0, 3, 4])
        : `<p class="hint">Albüm verisi yok.</p>`
    }
    <h3>Top şarkılar</h3>
    ${table(["#", "Şarkı", "Sanatçı", "Oynatma", "Dk"], tracks, [0, 3, 4])}
    <h3>Yıllık</h3>
    <div class="chart-wrap"><canvas id="${id}-years"></canvas></div>
  </section>`;
}

/**
 * İlk dinleme block under Dönem — tops ranked by selected Dönem, dates from lifetime export.
 */
function topsSectionShell({ hasExport, hasLive }) {
  if (!hasExport && !hasLive) return "";
  const tabs = hasExport
    ? `<div class="term-tabs range-tabs" data-tops-entity-tabs>
        <button type="button" data-tops-entity="artists" class="active">Sanatçılar</button>
        <button type="button" data-tops-entity="tracks">Şarkılar</button>
        <button type="button" data-tops-entity="albums">Albümler</button>
      </div>`
    : "";
  return `
  <section class="card provider-spotify range-hero" id="sec-tops">
    ${brandTitle("spotify", "İlk dinleme")}
    ${tabs}
    <div id="tops-body"></div>
  </section>`;
}

function resolveFirstDate(item, indexMap) {
  if (item?.first && item.first !== "—") return String(item.first).slice(0, 10);
  if (item?.key && indexMap?.[item.key]) return indexMap[item.key];
  return "—";
}

function firstListenList(
  items,
  {
    showArtist = false,
    indexMap = null,
    linkArtists = false,
    withCovers = false,
    withAlbumCovers = false,
  } = {}
) {
  if (!items?.length) {
    return `<p class="hint meta-quiet">Bu aralıkta veri yok.</p>`;
  }
  const rows = items
    .map((item) => {
      const date = resolveFirstDate(item, indexMap);
      const artist =
        showArtist && item.artist
          ? `<div class="fl-artist">${escapeHtml(item.artist)}</div>`
          : "";
      const nameHtml = linkArtists
        ? `<div class="fl-name">${artistNameCell(item.name)}</div>`
        : `<div class="fl-name">${escapeHtml(item.name)}</div>`;
      let coverAttrs = "";
      let cover = "";
      if (withAlbumCovers) {
        coverAttrs = ` data-album-name="${escapeHtml(item.name)}" data-album-artist="${escapeHtml(
          item.artist || ""
        )}"`;
        cover = `<span class="track-cover placeholder" aria-hidden="true"></span>`;
      } else if (withCovers) {
        coverAttrs = ` data-track-name="${escapeHtml(item.name)}" data-track-artist="${escapeHtml(
          item.artist || ""
        )}"`;
        cover = `<span class="track-cover placeholder" aria-hidden="true"></span>`;
      }
      return `<li class="fl-row"${coverAttrs}>
        ${cover}
        <div class="fl-main">
          ${nameHtml}
          ${artist}
        </div>
        <div class="fl-date" title="İlk dinleme">${escapeHtml(date)}</div>
      </li>`;
    })
    .join("");
  return `<ul class="fl-list">${rows}</ul>`;
}

function renderTopsBody(periods, periodId, live, spotify, entity = "artists") {
  const box = el("tops-body");
  if (!box) return;

  const p = periods?.[periodId];
  const index = spotify?.firstListenIndex || {};

  if (p && !p.empty) {
    if (entity === "tracks") {
      box.innerHTML = firstListenList(p.tracks, {
        showArtist: true,
        indexMap: index.tracks,
        withCovers: true,
      });
      return;
    }
    if (entity === "albums") {
      const albums = (p.albums || []).filter((a) => a.value > 0);
      box.innerHTML = firstListenList(albums, {
        showArtist: true,
        indexMap: index.albums,
        withAlbumCovers: true,
      });
      return;
    }
    box.innerHTML = firstListenList(p.artists, {
      indexMap: index.artists,
      linkArtists: true,
    });
    return;
  }

  // Lifetime tops when period map missing but export exists
  if (spotify && (spotify.artists?.length || spotify.tracks?.length)) {
    if (entity === "tracks") {
      box.innerHTML = firstListenList(spotify.tracks, {
        showArtist: true,
        indexMap: index.tracks,
        withCovers: true,
      });
      return;
    }
    if (entity === "albums") {
      box.innerHTML = firstListenList(
        (spotify.albums || []).filter((a) => a.value > 0),
        { showArtist: true, indexMap: index.albums, withAlbumCovers: true }
      );
      return;
    }
    box.innerHTML = firstListenList(spotify.artists, {
      indexMap: index.artists,
      linkArtists: true,
    });
    return;
  }

  const recentRows = (live?.recentlyPlayed || []).slice(0, 15).map((r) => [
    trackNameCell(r.name, r.artist || ""),
    r.artist || "",
    r.playedAt ? new Date(r.playedAt).toLocaleString("tr-TR") : "—",
  ]);

  if (recentRows.length) {
    box.innerHTML = `
    <p class="hint meta-quiet">İlk dinleme için export gerekli — son çalınanlar</p>
    ${table(["Parça", "Sanatçı", "Zaman"], recentRows)}`;
    return;
  }

  box.innerHTML = `<p class="hint meta-quiet">Bu aralıkta veri yok.</p>`;
}

function bindNowPlayingActions(onNowRefresh, onReconnect) {
  el("btn-now-refresh")?.addEventListener("click", () => onNowRefresh?.());
  el("btn-now-reconnect")?.addEventListener("click", () => onReconnect?.());
}

function artistCatalog(spotify) {
  if (!spotify) return [];
  if (spotify.artistCatalog?.length) return spotify.artistCatalog;
  return (spotify.artists || []).map((a) => ({
    key: a.key || norm(a.name),
    name: a.name,
    fold: foldTr(a.name),
    value: a.value,
    plays: a.plays,
    first: a.first || spotify?.firstListenIndex?.artists?.[a.key] || "—",
    source: "export",
  }));
}

/** Seed suggestions from live top-artists when export is absent. */
function liveArtistCatalog(live) {
  const out = [];
  const seen = new Set();
  const buckets = live?.topArtists || {};
  for (const term of Object.keys(buckets)) {
    for (const a of buckets[term] || []) {
      if (!a?.name) continue;
      const key = norm(a.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: a.id || key,
        name: a.name,
        fold: foldTr(a.name),
        value: null,
        plays: null,
        first: "—",
        source: "live",
        id: a.id || null,
        image: a.image || null,
      });
    }
  }
  return out;
}

function mergeArtistHits(primary, secondary, limit = 8) {
  const out = [];
  const seen = new Set();
  for (const list of [primary, secondary]) {
    for (const a of list || []) {
      const key = norm(a?.name) || a?.key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(a);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function suggestMeta(artist) {
  if (artist?.value != null) return `${fmt(artist.value)} dk`;
  return "Spotify";
}

function renderArtistDetail(spotify, live, artist, periodId) {
  const box = el("artist-detail");
  if (!box || !artist) return;
  const period = spotify?.periods?.[periodId];
  const periodHit = (period?.artists || []).find(
    (a) => a.key === artist.key || norm(a.name) === norm(artist.name)
  );
  const tracks = (spotify?.trackPool || spotify?.tracks || [])
    .filter(
      (t) =>
        (t.key && artist.key && t.key.endsWith(`|||${artist.key}`)) ||
        norm(t.artist) === norm(artist.name)
    )
    .slice(0, 5);
  const albums = (spotify?.albumPool || spotify?.albums || [])
    .filter(
      (a) =>
        (a.key && artist.key && a.key.endsWith(`|||${artist.key}`)) ||
        norm(a.artist) === norm(artist.name)
    )
    .slice(0, 5);

  const known = profilesFromLive(live);
  const profile =
    known[norm(artist.name)] ||
    (artist.id || artist.url
      ? {
          name: artist.name,
          id: artist.id || null,
          image: artist.image || null,
          url: artist.url || null,
        }
      : null);
  const head = profile
    ? artistLinkHtml(artist.name, profile)
    : artistNameCell(artist.name);

  const hasExportStats = artist.value != null || !!spotify;
  const limitedNote = !hasExportStats
    ? `<p class="hint meta-quiet">Export yok — dinleme istatistikleri sınırlı</p>`
    : "";

  box.hidden = false;
  box.className = "artist-detail";
  box.innerHTML = `
    <div class="artist-detail-head">
      <h3>${head}</h3>
      <button type="button" class="btn-quiet" data-artist-clear>Kapat</button>
    </div>
    ${limitedNote}
    <div class="artist-detail-stats">
      <div><span class="muted">Toplam dk</span><strong>${
        artist.value != null ? fmt(artist.value) : "—"
      }</strong></div>
      <div><span class="muted">Oynatma</span><strong>${
        artist.plays != null ? fmt(artist.plays) : "—"
      }</strong></div>
      <div><span class="muted">İlk dinleme</span><strong>${escapeHtml(artist.first || "—")}</strong></div>
      <div><span class="muted">Bu dönem</span><strong>${
        periodHit ? fmt(periodHit.value) : "—"
      }</strong></div>
    </div>
    ${
      tracks.length
        ? `<h4 class="muted-label">Top şarkılar</h4>
    <ul class="mini-list">${tracks
      .map(
        (t) =>
          `<li>${trackNameCell(t.name, t.artist || artist.name)}<span class="muted">${fmt(
            t.value
          )} dk</span></li>`
      )
      .join("")}</ul>`
        : ""
    }
    ${
      albums.length
        ? `<h4 class="muted-label">Top albümler</h4>
    <ul class="mini-list">${albums
      .map(
        (a) =>
          `<li>${albumNameCell(a.name, a.artist || artist.name)}<span class="muted">${fmt(
            a.value
          )} dk</span></li>`
      )
      .join("")}</ul>`
        : ""
    }
  `;
  box.querySelector("[data-artist-clear]")?.addEventListener("click", () => {
    box.hidden = true;
    box.innerHTML = "";
  });
  enhanceArtistProfiles(box, live, [artist.name]);
  enhanceTrackCovers(box, live);
  enhanceAlbumCovers(box, live);
}

function bindArtistSearch(spotify, live, getPeriodId) {
  const input = el("artist-search-input");
  const suggest = el("artist-suggest");
  if (!input || !suggest) return;

  const catalog = mergeArtistHits(
    artistCatalog(spotify),
    spotify ? [] : liveArtistCatalog(live),
    500
  );
  let timer = null;
  let active = -1;
  let hits = [];
  let reqId = 0;

  const closeSuggest = () => {
    suggest.classList.remove("open");
    suggest.innerHTML = "";
    active = -1;
  };

  const paintSuggest = () => {
    if (!hits.length) {
      closeSuggest();
      return;
    }
    suggest.innerHTML = hits
      .map(
        (a, i) =>
          `<li><button type="button" role="option" data-idx="${i}" class="${
            i === active ? "active" : ""
          }"><span>${escapeHtml(a.name)}</span><span class="sug-meta">${escapeHtml(
            suggestMeta(a)
          )}</span></button></li>`
      )
      .join("");
    suggest.classList.add("open");
  };

  const selectIdx = (i) => {
    const artist = hits[i];
    if (!artist) return;
    input.value = artist.name;
    closeSuggest();
    renderArtistDetail(spotify, live, artist, getPeriodId?.());
  };

  const runSearch = async () => {
    const q = input.value.trim();
    const myReq = ++reqId;
    if (q.length < 1) {
      hits = [];
      closeSuggest();
      return;
    }

    const local = catalog
      .filter((a) => foldMatch(a.name, q) || foldMatch(a.fold || "", q))
      .slice(0, 8);

    // Export catalog is authoritative when present and has matches
    if (spotify && local.length) {
      if (myReq !== reqId) return;
      hits = local;
      active = 0;
      paintSuggest();
      return;
    }

    let remote = [];
    if (isSpotifyConnected()) {
      try {
        remote = await searchArtists(q, 8);
      } catch {
        remote = [];
      }
    }
    if (myReq !== reqId) return;

    hits = mergeArtistHits(local, remote, 8);
    active = hits.length ? 0 : -1;
    paintSuggest();
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void runSearch();
    }, 160);
  });

  suggest.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-idx]");
    if (!btn) return;
    selectIdx(Number(btn.dataset.idx));
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSuggest();
      return;
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % hits.length;
      paintSuggest();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + hits.length) % hits.length;
      paintSuggest();
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectIdx(active >= 0 ? active : 0);
    }
  });

  document.addEventListener(
    "click",
    (e) => {
      if (!e.target.closest("#artist-search")) closeSuggest();
    },
    { capture: true }
  );
}

/** Mount / refresh the right-hand now-playing card in #now-playing-slot. */
export function renderNowPlayingSlot(
  nowPlaying,
  { onNowRefresh, onReconnect, connected = false } = {}
) {
  const slot = el("now-playing-slot");
  if (!slot) return false;
  const existing = el("sec-now-playing");
  const prevKey = existing?.dataset?.trackKey || "";
  const payload =
    nowPlaying == null && !connected
      ? { status: "offline" }
      : nowPlaying ?? { playing: false };
  slot.innerHTML = nowPlayingCard(payload, { connected });
  const next = el("sec-now-playing");
  if (next && prevKey && next.dataset.trackKey && next.dataset.trackKey !== prevKey) {
    next.classList.add("track-fade");
    requestAnimationFrame(() => next.classList.add("track-fade-in"));
  }
  bindNowPlayingActions(onNowRefresh, onReconnect);
  startLocalProgressTick();
  return true;
}

/** Soft-update only the now-playing card (avoids chart flicker on poll). */
export function patchNowPlaying(nowPlaying, onNowRefresh, onReconnect, connected = false) {
  if (!el("now-playing-slot")) return false;
  return renderNowPlayingSlot(nowPlaying, { onNowRefresh, onReconnect, connected });
}

/**
 * @param {{ spotify?: object, live?: object, livePeriods?: object|null, nowPlaying?: object|null, onNowRefresh?: () => void, onReconnect?: () => void, connected?: boolean }} args
 */
export function renderDashboard({
  spotify,
  live,
  livePeriods,
  nowPlaying,
  onNowRefresh,
  onReconnect,
  connected = false,
}) {
  destroyCharts();
  stopLocalProgressTick();
  const root = el("dashboard");
  root.classList.remove("hidden");

  // Totals live in Toplam stream özeti — keep the top stats strip empty to avoid duplication
  setStats([]);

  const realWarnings = (spotify?.warnings || []).filter(
    (w) => !/video history atlandı|podcast.*atlandı|isim Audio değil|içerik kontrol/i.test(String(w))
  );
  const warnHtml =
    realWarnings.length
      ? `<div class="error warn-block">${realWarnings.map(escapeHtml).join("<br>")}</div>`
      : "";

  const showPeriods = !!(spotify || livePeriods || live?.spotify);
  const periodSource = {
    spotify,
    livePeriods: spotify?.periods ? null : livePeriods,
  };
  const periodsMap = spotify?.periods || livePeriods?.periods || null;
  const showTops = !!(spotify || live?.spotify);

  renderNowPlayingSlot(nowPlaying, { onNowRefresh, onReconnect, connected });

  root.innerHTML = `
    ${warnHtml}
    ${streamSummaryCard(spotify)}
    ${showPeriods ? periodPanel(periodSource) : ""}
    ${artistSearchSection({ spotify, connected })}
    ${topsSectionShell({ hasExport: !!spotify?.periods, hasLive: !!live?.spotify })}
    ${platformSection("sec-spotify", "spotify", "Detaylı analiz", spotify)}
  `;

  let activeTopsEntity = "artists";
  const topsEntityTabs = root.querySelector("[data-tops-entity-tabs]");

  const paintTops = (periodId) => {
    renderTopsBody(periodsMap, periodId, live?.spotify, spotify, activeTopsEntity);
    enhanceArtistProfiles(el("tops-body"), live?.spotify);
    enhanceTrackCovers(el("tops-body"), live?.spotify);
    enhanceAlbumCovers(el("tops-body"), live?.spotify);
  };

  const applyPeriod = (periodId) => {
    if (!periodId) return;
    destroyChartsMatching("period-artists");
    if (periodsMap) renderPeriodBody(periodsMap, periodId);
    paintTops(periodId);
    enhanceArtistProfiles(el("period-body"), live?.spotify);
    enhanceTrackCovers(el("period-body"), live?.spotify);
    enhanceAlbumCovers(el("period-body"), live?.spotify);
  };

  const currentPeriodId = () => {
    const periodTabs = root.querySelector("[data-period-tabs]");
    return (
      periodTabs?.querySelector("button.active")?.dataset.period ||
      periodTabs?.querySelector("button[data-period]")?.dataset.period ||
      null
    );
  };

  const periodTabs = root.querySelector("[data-period-tabs]");
  if (periodTabs && periodsMap) {
    const activeBtn =
      periodTabs.querySelector("button.active") ||
      periodTabs.querySelector("button[data-period]");
    const initial = activeBtn?.dataset.period;
    if (initial) applyPeriod(initial);

    periodTabs.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-period]");
      if (!btn) return;
      periodTabs.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      applyPeriod(btn.dataset.period);
    });
  } else if (showTops) {
    paintTops(null);
  }

  topsEntityTabs?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tops-entity]");
    if (!btn) return;
    topsEntityTabs.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeTopsEntity = btn.dataset.topsEntity || "artists";
    paintTops(currentPeriodId());
  });

  bindArtistSearch(spotify, live?.spotify, currentPeriodId);

  requestAnimationFrame(() => {
    paintLifetimeCharts(spotify);
    enhanceArtistProfiles(el("sec-spotify"), live?.spotify);
    enhanceTrackCovers(el("sec-spotify"), live?.spotify);
    enhanceAlbumCovers(el("sec-spotify"), live?.spotify);
  });
}

function destroyChartsMatching(canvasId) {
  for (let i = charts.length - 1; i >= 0; i--) {
    const c = charts[i];
    if (c?.canvas?.id === canvasId) {
      try {
        c.destroy();
      } catch {
        /* */
      }
      charts.splice(i, 1);
    }
  }
}

function paintLifetimeCharts(spotify) {
  if (!spotify) return;
  barChart(
    "sec-spotify-artists",
    artistChartLabels(spotify.artists),
    [
      {
        label: "Dk",
        data: spotify.artists.map((a) => a.value),
        backgroundColor: PASTEL.spotify.soft,
      },
    ],
    {
      horizontal: true,
      tooltipExtra: (ctx) => {
        const plays = spotify.artists[ctx.dataIndex]?.plays;
        return plays != null ? ` · ${fmt(plays)} oynatma` : "";
      },
    }
  );
  barChart(
    "sec-spotify-years",
    spotify.years.map((y) => y.year),
    [
      {
        label: "Dk",
        data: spotify.years.map((y) => y.value),
        backgroundColor: PASTEL.spotify.solid,
      },
    ],
    { horizontal: false }
  );
}
