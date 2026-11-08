import {
  getSpotifyClientId,
  getSpotifyTokens,
  redirectUri,
  setLastSpotifySync,
  setSpotifyProfile,
  setSpotifyTokens,
} from "./config.js";
import { createPkcePair } from "./pkce.js";

const SCOPES = [
  "user-read-recently-played",
  "user-top-read",
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-email",
  "user-read-private",
].join(" ");

const PKCE_VERIFIER_KEY = "mes_spotify_pkce_verifier";
const OAUTH_STATE_KEY = "mes_spotify_oauth_state";

export function isSpotifyConnected() {
  const t = getSpotifyTokens();
  return !!(t && t.access_token);
}

/** Token scope string’inde istenen OAuth scope’lar var mı? */
export function hasSpotifyScopes(...needed) {
  const t = getSpotifyTokens();
  const granted = new Set(String(t?.scope || "").split(/\s+/).filter(Boolean));
  return needed.every((s) => granted.has(s));
}

export const PLAYBACK_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
];

export function hasPlaybackScopes() {
  return hasSpotifyScopes(...PLAYBACK_SCOPES);
}

export async function beginSpotifyLogin() {
  const clientId = getSpotifyClientId();
  if (!clientId) {
    throw new Error("SPOTIFY_CLIENT_ID boş. js/config.js içine Client ID yaz (README).");
  }

  const { verifier, challenge } = await createPkcePair();
  const state = crypto.randomUUID();
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function handleSpotifyCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (!code && !error) return false;
  if (error) throw new Error(`Spotify OAuth hata: ${error}`);

  const expected = sessionStorage.getItem(OAUTH_STATE_KEY);
  if (!state || state !== expected) throw new Error("OAuth state uyuşmuyor.");

  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!verifier) throw new Error("PKCE verifier bulunamadı. Tekrar bağlan.");

  const clientId = getSpotifyClientId();
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Token alınamadı");
  }

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    token_type: data.token_type,
    scope: data.scope,
  };
  setSpotifyTokens(tokens);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  // clean query from URL
  window.history.replaceState({}, "", redirectUri());

  const profile = await spotifyFetch("/me");
  setSpotifyProfile(profile);
  setLastSpotifySync(new Date().toISOString());
  return true;
}

async function refreshAccessToken() {
  const tokens = getSpotifyTokens();
  if (!tokens?.refresh_token) throw new Error("Refresh token yok; yeniden bağlan.");

  const body = new URLSearchParams({
    client_id: getSpotifyClientId(),
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    setSpotifyTokens(null);
    throw new Error(data.error_description || "Token yenilenemedi; yeniden bağlan.");
  }

  const next = {
    ...tokens,
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    refresh_token: data.refresh_token || tokens.refresh_token,
    scope: data.scope || tokens.scope,
  };
  setSpotifyTokens(next);
  return next.access_token;
}

export async function getValidAccessToken() {
  const tokens = getSpotifyTokens();
  if (!tokens?.access_token) throw new Error("Spotify bağlı değil.");
  if (Date.now() < (tokens.expires_at || 0) - 60_000) return tokens.access_token;
  return refreshAccessToken();
}

export async function spotifyFetch(path, options = {}) {
  const { data } = await spotifyFetchDetailed(path, options);
  return data;
}

/** status + body; 204 → data null. Log için currently-playing’de kullanılır. */
export async function spotifyFetchDetailed(path, options = {}) {
  const token = await getValidAccessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) {
    return { status: 204, ok: true, data: null };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `Spotify API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return { status: res.status, ok: true, data };
}

export function disconnectSpotify() {
  setSpotifyTokens(null);
  setSpotifyProfile(null);
}
