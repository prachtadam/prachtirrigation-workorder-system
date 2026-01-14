
const DB_NAME = 'tech-offline-db';
const STORE = 'outbox';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueAction(action, payload) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({
      action,
      payload,
      created_at: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueuedActions() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function removeQueuedAction(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function processOutbox(actionHandlers, notify) {
  const queue = await listQueuedActions();
  if (!queue.length) return;
  for (const item of queue) {
    const handler = actionHandlers[item.action];
    if (!handler) {
      console.warn('No handler for action', item.action);
      continue;
    }
    try {
      await handler(item.payload);
      await removeQueuedAction(item.id);
    } catch (error) {
      console.error('Outbox processing failed', item, error);
      if (notify) notify('Failed to sync offline changes. Will retry.');
      break;
    }
  }
}

export function saveLastScreen(screen, jobId) {
  localStorage.setItem('TECH_LAST_SCREEN', screen || '');
  if (jobId) {
    localStorage.setItem('TECH_LAST_JOB', jobId);
  }
}

export function getLastScreen() {
  return {
    screen: localStorage.getItem('TECH_LAST_SCREEN') || '',
    jobId: localStorage.getItem('TECH_LAST_JOB') || '',
  };
}

export function clearLastScreen() {
  localStorage.removeItem('TECH_LAST_SCREEN');
  localStorage.removeItem('TECH_LAST_JOB');
}
