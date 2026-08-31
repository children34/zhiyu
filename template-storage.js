/* Template library storage: IndexedDB avoids the small localStorage quota. */
(function () {
  const DB_NAME = 'NotionCloneOCDB';
  const DB_VERSION = 2;
  const TEMPLATE_STORE = 'templates';
  const LIBRARY_KEY = 'library';

  function openTemplateLibraryDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not supported'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains('app_state')) database.createObjectStore('app_state');
        if (!database.objectStoreNames.contains(TEMPLATE_STORE)) database.createObjectStore(TEMPLATE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function readLegacyTemplates() {
    try {
      const raw = localStorage.getItem('templates');
      const templates = raw ? JSON.parse(raw) : [];
      return Array.isArray(templates) ? templates : [];
    } catch (_) {
      return [];
    }
  }

  window.readTemplateLibrary = async function () {
    try {
      const database = await openTemplateLibraryDB();
      const templates = await new Promise((resolve, reject) => {
        const transaction = database.transaction(TEMPLATE_STORE, 'readonly');
        const request = transaction.objectStore(TEMPLATE_STORE).get(LIBRARY_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      if (Array.isArray(templates)) return templates;

      // One-time migration for templates created by earlier versions.
      const legacyTemplates = readLegacyTemplates();
      if (legacyTemplates.length) {
        await window.writeTemplateLibrary(legacyTemplates);
      }
      return legacyTemplates;
    } catch (error) {
      console.warn('IndexedDB template storage unavailable; using localStorage.', error);
      return readLegacyTemplates();
    }
  };

  window.writeTemplateLibrary = async function (templates) {
    const snapshot = JSON.parse(JSON.stringify(templates));
    try {
      const database = await openTemplateLibraryDB();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(TEMPLATE_STORE, 'readwrite');
        transaction.objectStore(TEMPLATE_STORE).put(snapshot, LIBRARY_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      // The migration source can be removed only after IndexedDB has committed.
      localStorage.removeItem('templates');
    } catch (error) {
      console.warn('IndexedDB template save failed; using localStorage.', error);
      localStorage.setItem('templates', JSON.stringify(snapshot));
    }
  };
})();
