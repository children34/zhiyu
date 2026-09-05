/* Template library wrapper: provides read/write functions for template storage. */
(function () {
  const DB_NAME = 'NotionCloneOCDB';
  const DB_VERSION = 2;
  const TEMPLATE_STORE = 'templates';
  const LIBRARY_KEY = 'library';

  function openTemplateLibraryDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('app_state')) db.createObjectStore('app_state');
        if (!db.objectStoreNames.contains(TEMPLATE_STORE)) db.createObjectStore(TEMPLATE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function readLegacyTemplates() {
    try {
      const raw = localStorage.getItem('templates');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  // Expose global APIs
  window.readTemplateLibrary = async function () {
    try {
      const db = await openTemplateLibraryDB();
      const templates = await new Promise((resolve, reject) => {
        const tx = db.transaction(TEMPLATE_STORE, 'readonly');
        const request = tx.objectStore(TEMPLATE_STORE).get(LIBRARY_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (Array.isArray(templates)) return templates;

      // One‑time migration from localStorage
      const legacy = readLegacyTemplates();
      if (legacy.length) {
        await window.writeTemplateLibrary(legacy);
      }
      return legacy;
    } catch (e) {
      console.warn('IndexedDB unavailable; falling back to localStorage', e);
      return readLegacyTemplates();
    }
  };

  window.writeTemplateLibrary = async function (templates) {
    const snapshot = JSON.parse(JSON.stringify(templates));
    try {
      const db = await openTemplateLibraryDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(TEMPLATE_STORE, 'readwrite');
        tx.objectStore(TEMPLATE_STORE).put(snapshot, LIBRARY_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      // Clean up legacy storage
      localStorage.removeItem('templates');
    } catch (e) {
      console.warn('IndexedDB write failed; using localStorage', e);
      localStorage.setItem('templates', JSON.stringify(snapshot));
    }
  };
})();