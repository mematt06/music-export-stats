/* Cache-bust: bump ?v= when shipping UI/parser changes so soft refresh picks them up */
import { parseSpotifyFiles } from "./parsers/spotify.js?v=20261108050825";
import { summarizeSpotifyExport } from "./parsers/combine.js?v=20261108050825";
import {
  patchNowPlaying,
  renderDashboard,
  renderNowPlayingSlot,
} from "./ui/dashboard.js?v=20261108050825";
import { renderAccountsPanel } from "./ui/accounts.js?v=20261108050825";
import {
  beginSpotifyLogin,
  handleSpotifyCallback,
  isSpotifyConnected,
} from "./auth/spotify.js?v=20261108050825";
import { getSpotifyProfile, setSpotifyProfile } from "./auth/config.js?v=20261108050825";
import {
  buildLiveApproxPeriods,
  fetchCurrentlyPlaying,
  fetchSpotifyLive,
} from "./live/spotify.js?v=20261108050825";
import {
  LOCAL_ACCOUNT_KEY,
  clearExportSummary,
  resolveExportForAccount,
  saveExportSummary,
} from "./storage/exportCache.js?v=20261108050825";

const files = { spotify: [] };
const state = {
  export: { spotify: null },
  exportOwner: null,
  live: { spotify: null },
  livePeriods: null,
  nowPlaying: null,
};

const NOW_POLL_MS = 12_000;
let nowTimer = null;

function currentAccountId() {
  const p = getSpotifyProfile();
  return p?.id || state.live?.spotify?.profile?.id || null;
}

function setupDrop(id, key) {
  const box = document.getElementById(id);
  const input = box.querySelector('input[type="file"]');
  const pickBtn = box.querySelector(".file-pick-btn");
  const status = box.querySelector(".status");

  const assign = (list) => {
    files[key] = [...list];
    status.textContent = list.length
      ? `${list.length} dosya: ${[...list].map((f) => f.name).join(", ")}`
      : "";
    updateButtons();
  };

  /** Open native file picker from a real user gesture (required on iOS). */
  const openPicker = (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.click();
  };

  // Whole drop area is tappable; ignore nested buttons / the file input itself
  box.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input")) return;
    openPicker(e);
  });
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target !== box) return;
    openPicker(e);
  });
  pickBtn?.addEventListener("click", openPicker);

  input.addEventListener("change", () => assign(input.files));
  box.addEventListener("dragover", (e) => {
    e.preventDefault();
    box.classList.add("drag");
  });
  box.addEventListener("dragleave", () => box.classList.remove("drag"));
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("drag");
    assign(e.dataTransfer.files);
  });
}

function updateButtons() {
  const ready = files.spotify.length || state.live.spotify || state.export.spotify;
  document.getElementById("btn-analyze").disabled = !ready;
}

function setStatus(msg, isError = false) {
  const err = document.getElementById("error");
  err.textContent = msg || "";
  err.classList.toggle("info", !!msg && !isError);
  err.classList.toggle("is-error", isError);
}

function refreshLivePeriods() {
  if (state.export.spotify?.periods) {
    state.livePeriods = null;
    return;
  }
  if (state.live.spotify?.recentlyPlayed) {
    state.livePeriods = buildLiveApproxPeriods(state.live.spotify.recentlyPlayed);
  } else if (state.live.spotify) {
    state.livePeriods = buildLiveApproxPeriods([]);
  } else {
    state.livePeriods = null;
  }
}

function nowPlayingHandlers() {
  return {
    onNowRefresh: () => refreshNowPlaying(true),
    onReconnect: () => beginSpotifyLogin(),
    connected: isSpotifyConnected(),
  };
}

function mountNowPlaying() {
  renderNowPlayingSlot(state.nowPlaying, nowPlayingHandlers());
}

function redraw() {
  mountNowPlaying();
  refreshLivePeriods();
  // Always paint dashboard so Sanatçı search stays available without export
  renderDashboard({
    spotify: state.export.spotify,
    live: state.live,
    livePeriods: state.livePeriods,
    nowPlaying: state.nowPlaying,
    ...nowPlayingHandlers(),
  });
}

async function persistCurrentExport() {
  if (!state.export.spotify) return;
  const accountId = currentAccountId();
  try {
    await saveExportSummary(accountId, state.export.spotify);
    state.exportOwner = accountId || LOCAL_ACCOUNT_KEY;
  } catch (e) {
    console.warn("[mes] export cache save failed", e);
  }
}

/**
 * Load cached export for the active Spotify user (or local).
 * On account switch, drops in-memory data from a different owner.
 */
async function loadCachedExportForAccount(accountId) {
  const nextOwner = accountId || LOCAL_ACCOUNT_KEY;
  if (
    state.exportOwner &&
    state.exportOwner !== nextOwner &&
    state.exportOwner !== LOCAL_ACCOUNT_KEY
  ) {
    state.export.spotify = null;
  }

  try {
    const row = await resolveExportForAccount(accountId);
    if (row?.summary) {
      state.export.spotify = row.summary;
      state.exportOwner = accountId || LOCAL_ACCOUNT_KEY;
      state.livePeriods = null;
      return true;
    }
  } catch (e) {
    console.warn("[mes] export cache load failed", e);
  }

  if (state.exportOwner && state.exportOwner !== nextOwner) {
    state.export.spotify = null;
    state.exportOwner = null;
  }
  return !!state.export.spotify;
}

async function analyzeExports() {
  const btn = document.getElementById("btn-analyze");
  setStatus("");
  btn.disabled = true;
  btn.textContent = "İşleniyor…";

  try {
    if (!files.spotify.length && !state.export.spotify) {
      if (state.live.spotify) {
        redraw();
        setStatus("Export yok — Dönem yaklaşık.", false);
        return;
      }
      throw new Error("Önce Spotify export yükle.");
    }

    if (files.spotify.length) {
      const spotifyRaw = await parseSpotifyFiles(files.spotify, JSZip, {
        onProgress: (msg) => setStatus(msg, false),
      });
      state.export.spotify = summarizeSpotifyExport(spotifyRaw);
      state.livePeriods = null;
      await persistCurrentExport();
      const realWarnings = (spotifyRaw.warnings || []).filter(
        (w) =>
          !/video history atlandı|podcast.*atlandı|isim Audio değil|içerik kontrol/i.test(
            String(w)
          )
      );
      if (realWarnings.length) {
        setStatus(realWarnings.join(" · "), false);
      } else {
        setStatus(
          `Hazır: ${state.export.spotify.plays.toLocaleString("tr-TR")} oynatma · ${state.export.spotify.totalMin.toLocaleString("tr-TR")} dk`,
          false
        );
      }
      files.spotify = [];
      const dropStatus = document.querySelector("#drop-spotify .status");
      if (dropStatus) dropStatus.textContent = "Kayıtlı export yüklü";
      document.querySelector("#drop-spotify input").value = "";
    }

    redraw();
    document.getElementById("dashboard").scrollIntoView({ behavior: "smooth", block: "start" });
    document
      .getElementById("sec-stream-summary")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Export'u analiz et";
    updateButtons();
  }
}

async function syncSpotifyLive() {
  setStatus("");
  try {
    if (!isSpotifyConnected()) throw new Error("Önce Spotify hesabını bağla.");
    setStatus("Spotify canlı veri çekiliyor…", false);
    state.live.spotify = await fetchSpotifyLive();
    state.live.spotify._term = "medium_term";
    if (state.live.spotify.profile) setSpotifyProfile(state.live.spotify.profile);
    const accountId = state.live.spotify.profile?.id || currentAccountId();
    await loadCachedExportForAccount(accountId);
    refreshLivePeriods();
    setStatus("");
    renderAccountsPanel();
    await refreshNowPlaying(false);
    redraw();
    startNowPlayingPoll();
    document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), true);
  }
}

async function refreshNowPlaying(userTriggered = false) {
  if (!isSpotifyConnected()) {
    state.nowPlaying = null;
    stopNowPlayingPoll();
    mountNowPlaying();
    return;
  }
  try {
    state.nowPlaying = await fetchCurrentlyPlaying();
    const patched = patchNowPlaying(
      state.nowPlaying,
      () => refreshNowPlaying(true),
      () => beginSpotifyLogin(),
      true
    );
    if (!patched && (state.live.spotify || state.export.spotify || userTriggered)) redraw();
  } catch (e) {
    console.error("[mes] now-playing", e);
    if (userTriggered) setStatus(e.message || String(e), true);
    state.nowPlaying = {
      playing: false,
      status: "error",
      error: e.message || String(e),
      message: e.message || String(e),
    };
    const patched = patchNowPlaying(
      state.nowPlaying,
      () => refreshNowPlaying(true),
      () => beginSpotifyLogin(),
      true
    );
    if (!patched) redraw();
  }
}

function stopNowPlayingPoll() {
  if (nowTimer) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
}

function startNowPlayingPoll() {
  stopNowPlayingPoll();
  if (!isSpotifyConnected()) return;
  nowTimer = setInterval(() => {
    if (document.visibilityState === "visible") refreshNowPlaying(false);
  }, NOW_POLL_MS);
}

async function resetAll() {
  files.spotify = [];
  const accountId = currentAccountId();
  try {
    await clearExportSummary(accountId);
    if (!accountId) await clearExportSummary(LOCAL_ACCOUNT_KEY);
  } catch (e) {
    console.warn("[mes] export cache clear failed", e);
  }
  state.export = { spotify: null };
  state.exportOwner = null;
  state.livePeriods = null;
  const dropStatus = document.getElementById("export-status");
  if (dropStatus) dropStatus.textContent = "";
  document.querySelectorAll("#drop-spotify input").forEach((i) => (i.value = ""));
  document.getElementById("stats").innerHTML = "";
  setStatus("");
  updateButtons();
  redraw();
}

async function boot() {
  setupDrop("drop-spotify", "spotify");
  document.getElementById("btn-analyze").addEventListener("click", analyzeExports);
  document.getElementById("btn-reset").addEventListener("click", () => resetAll());
  // Sync button lives inside the now-playing card (recreated on poll) — use delegation
  document.body.addEventListener("click", (e) => {
    if (!e.target.closest("#btn-sync-all")) return;
    if (isSpotifyConnected()) syncSpotifyLive();
  });

  document.addEventListener("mes:spotify-sync", () => syncSpotifyLive());
  document.addEventListener("mes:spotify-disconnected", () => {
    state.live.spotify = null;
    state.livePeriods = null;
    state.nowPlaying = null;
    stopNowPlayingPoll();
    // Keep export in memory if it was local/current; reload local cache for disconnected session
    loadCachedExportForAccount(null).then(() => {
      mountNowPlaying();
      redraw();
      updateButtons();
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isSpotifyConnected()) {
      refreshNowPlaying(false);
      startNowPlayingPoll();
    } else if (document.visibilityState === "hidden") {
      stopNowPlayingPoll();
    }
  });

  renderAccountsPanel();
  mountNowPlaying();

  // Restore export before live sync so dashboard has totals early
  await loadCachedExportForAccount(currentAccountId());
  if (state.export.spotify) {
    const dropStatus = document.querySelector("#drop-spotify .status");
    if (dropStatus) dropStatus.textContent = "Kayıtlı export yüklü";
  }

  try {
    const handled = await handleSpotifyCallback();
    if (handled) {
      renderAccountsPanel();
      await syncSpotifyLive();
    } else if (isSpotifyConnected()) {
      try {
        await syncSpotifyLive();
      } catch {
        /* token may need reconnect */
      }
    }
  } catch (e) {
    setStatus(e.message || String(e), true);
    renderAccountsPanel();
  }

  redraw();
  updateButtons();
}

boot();
