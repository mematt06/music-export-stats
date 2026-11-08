import { SPOTIFY_CLIENT_ID } from "../config.js";

const KEYS = {
  spotifyTokens: "mes_spotify_tokens",
  spotifyProfile: "mes_spotify_profile",
  lastSpotifySync: "mes_spotify_last_sync",
};

/** Site sahibinin `js/config.js` içine yazdığı Client ID (localStorage yok). */
export function getSpotifyClientId() {
  return String(SPOTIFY_CLIENT_ID || "").trim();
}

export function getSpotifyTokens() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.spotifyTokens) || "null");
  } catch {
    return null;
  }
}

export function setSpotifyTokens(tokens) {
  if (!tokens) {
    localStorage.removeItem(KEYS.spotifyTokens);
    return;
  }
  localStorage.setItem(KEYS.spotifyTokens, JSON.stringify(tokens));
}

export function getSpotifyProfile() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.spotifyProfile) || "null");
  } catch {
    return null;
  }
}

export function setSpotifyProfile(profile) {
  if (!profile) {
    localStorage.removeItem(KEYS.spotifyProfile);
    return;
  }
  // Normalize API shape so UI never falls back to raw user id for labels
  const normalized = {
    id: profile.id || null,
    displayName: profile.displayName || profile.display_name || "",
    display_name: profile.display_name || profile.displayName || "",
    email: profile.email || null,
    product: profile.product || null,
    country: profile.country || null,
    image: profile.image || profile.images?.[0]?.url || null,
  };
  localStorage.setItem(KEYS.spotifyProfile, JSON.stringify(normalized));
}

export function getLastSpotifySync() {
  return localStorage.getItem(KEYS.lastSpotifySync) || null;
}

export function setLastSpotifySync(iso) {
  localStorage.setItem(KEYS.lastSpotifySync, iso);
}

export function redirectUri() {
  // Must match Spotify Developer Dashboard exactly
  return `${window.location.origin}${window.location.pathname}`;
}
