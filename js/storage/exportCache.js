/**
 * Persist summarized Spotify export in IndexedDB, keyed by Spotify user id.
 * Uses "local" when no account is connected yet; bindLocalToAccount migrates on connect.
 */

const DB_NAME = "mes_export_cache";
const DB_VERSION = 1;
const STORE = "exports";
export const LOCAL_ACCOUNT_KEY = "local";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "accountId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB açılamadı"));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB abort"));
  });
}

/**
 * @param {string|null|undefined} accountId
 * @param {object} summary - summarizeSpotifyExport result
 */
export async function saveExportSummary(accountId, summary) {
  if (!summary) return;
  const key = accountId || LOCAL_ACCOUNT_KEY;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({
    accountId: key,
    savedAt: new Date().toISOString(),
    summary,
  });
  await txDone(tx);
  db.close();
}

/**
 * @param {string|null|undefined} accountId
 * @returns {Promise<{ accountId: string, savedAt: string, summary: object }|null>}
 */
export async function loadExportSummary(accountId) {
  const key = accountId || LOCAL_ACCOUNT_KEY;
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).get(key);
  const row = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return row?.summary ? row : null;
}

/** @param {string|null|undefined} accountId */
export async function clearExportSummary(accountId) {
  const key = accountId || LOCAL_ACCOUNT_KEY;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(key);
  await txDone(tx);
  db.close();
}

/**
 * If user analyzed before connecting, attach that cache to their Spotify id once.
 * Does not overwrite an existing per-account export.
 * @param {string} accountId
 */
export async function bindLocalToAccount(accountId) {
  if (!accountId) return null;
  const existing = await loadExportSummary(accountId);
  if (existing) {
    await clearExportSummary(LOCAL_ACCOUNT_KEY);
    return existing;
  }
  const local = await loadExportSummary(LOCAL_ACCOUNT_KEY);
  if (!local) return null;
  await saveExportSummary(accountId, local.summary);
  await clearExportSummary(LOCAL_ACCOUNT_KEY);
  return loadExportSummary(accountId);
}

/**
 * Load the right export for the current session account.
 * @param {string|null|undefined} accountId
 */
export async function resolveExportForAccount(accountId) {
  if (accountId) return bindLocalToAccount(accountId);
  return loadExportSummary(LOCAL_ACCOUNT_KEY);
}
