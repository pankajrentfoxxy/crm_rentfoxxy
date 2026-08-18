const DB_NAME = 'support-v2-offline';
const STORE = 'queue';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOffline({ url, method, body, idempotencyKey, blobs }) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({
      url, method: method || 'POST', body: body || {}, idempotencyKey, createdAt: Date.now(), blobs: blobs || [],
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listOffline() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearOfflineId(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function flushOffline(api) {
  const rows = await listOffline();
  for (const row of rows) {
    await api.request({
      url: row.url,
      method: row.method,
      data: row.body,
      headers: row.idempotencyKey ? { 'Idempotency-Key': row.idempotencyKey } : {},
    });
    await clearOfflineId(row.id);
  }
  return rows.length;
}

export function listenOfflineFlush(api, onChange) {
  const run = () => {
    flushOffline(api)
      .then((n) => onChange && onChange())
      .catch(() => onChange && onChange());
  };
  window.addEventListener('online', run);
  window.addEventListener('focus', run);
  return () => {
    window.removeEventListener('online', run);
    window.removeEventListener('focus', run);
  };
}
