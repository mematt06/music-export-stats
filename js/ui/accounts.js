import { getSpotifyClientId, getSpotifyProfile } from "../auth/config.js";
import {
  beginSpotifyLogin,
  disconnectSpotify,
  isSpotifyConnected,
} from "../auth/spotify.js";
import { logoSpotify } from "./brands.js";

function displayName(profile) {
  const name = String(profile?.displayName || profile?.display_name || "").trim();
  if (name) return name;
  return "";
}

export function renderAccountsPanel() {
  const root = document.getElementById("accounts-panel");
  if (!root) return;

  const connected = isSpotifyConnected();
  const profile = getSpotifyProfile();
  const configured = !!getSpotifyClientId();
  const name = displayName(profile);
  const avatarUrl = String(profile?.image || "").trim();

  const identity =
    connected && (name || avatarUrl)
      ? `<div class="account-identity">
          ${
            avatarUrl
              ? `<img class="account-avatar" src="${escapeHtml(avatarUrl)}" alt="" width="60" height="60" />`
              : `<span class="account-avatar placeholder" aria-hidden="true"></span>`
          }
          <div class="account-identity-text">
            ${name ? `<p class="account-name">${escapeHtml(name)}</p>` : `<p class="account-name muted">Spotify hesabı</p>`}
          </div>
        </div>`
      : "";

  root.innerHTML = `
    <section class="card accounts provider-spotify accounts-compact">
      <div class="account-head">
        <div class="account-head-left">${logoSpotify}<h2>Spotify ile bağlan</h2></div>
        <span class="pill ${connected ? "ok" : ""}">${connected ? "Bağlı" : "Bağlı değil"}</span>
      </div>
      ${identity}
      ${
        !configured
          ? `<p class="error" id="accounts-error">Spotify Client ID yapılandırılmamış.</p>`
          : `<div class="error" id="accounts-error"></div>`
      }
      <div class="row-actions">
        ${
          connected
            ? `<button type="button" class="btn-sync-quiet" id="btn-spotify-sync">Şimdi sync</button>
               <button type="button" class="btn-quiet" id="btn-spotify-disconnect">Çıkış</button>`
            : `<button type="button" class="primary" id="btn-spotify-connect" ${
                configured ? "" : "disabled"
              }>Spotify ile bağlan</button>`
        }
      </div>
    </section>
  `;

  document.getElementById("btn-spotify-connect")?.addEventListener("click", async () => {
    try {
      await beginSpotifyLogin();
    } catch (e) {
      showErr(e.message);
    }
  });
  document.getElementById("btn-spotify-disconnect")?.addEventListener("click", () => {
    disconnectSpotify();
    renderAccountsPanel();
    document.dispatchEvent(new CustomEvent("mes:spotify-disconnected"));
  });
  document.getElementById("btn-spotify-sync")?.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("mes:spotify-sync"));
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showErr(msg) {
  const el = document.getElementById("accounts-error");
  if (el) el.textContent = msg;
}
