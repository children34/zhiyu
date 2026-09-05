/* --- Database & Storage Wrapper (IndexedDB to bypass localStorage limits) --- */
if (!('indexedDB' in window)) {
    console.warn('IndexedDB not supported in this environment. Falling back to localStorage.');
}

const DB_NAME = 'NotionCloneOCDB';
const STORE_NAME = 'app_state';
const DB_VERSION = 2;

function openDB() {
    if (!('indexedDB' in window)) {
        return Promise.reject(new Error('IndexedDB not supported'));
    }
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
            if (!database.objectStoreNames.contains('templates')) database.createObjectStore('templates');
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => {
            console.error('Database initialization failed:', e.target.error);
            reject(e.target.error);
        };
    });
}

async function setItem(key, value) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.warn('IndexedDB setItem error, falling back to localStorage', e);
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (lsErr) {
            console.error('localStorage setItem failed', lsErr);
        }
        return Promise.resolve();
    }
}

async function getItem(key) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.warn('IndexedDB getItem error, falling back to localStorage', e);
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch (lsErr) {
            console.error('localStorage getItem failed', lsErr);
            return null;
        }
    }
}

/* --- Application State --- */
if (typeof window.state === 'undefined') {
  window.state = {};
}
const defaultState = {
  categories: [],
  pages: [],
  activePageId: null,
  bgm: null,
  bgmYT: null,
  bgImage: null,
  banner: null,
  bgImageOpacity: 1,
  avatar: null,
  avatarAlign: 'center',
  fontFamily: 'Inter, sans-serif',
  customFont: null,
  layout: 'single',
  previewMode: false,
	hasUnsavedChanges: false,
  layouts: ['single']
};
window.state = Object.assign({}, defaultState, window.state);
if (!Array.isArray(window.state.categories)) window.state.categories = defaultState.categories;
if (!Array.isArray(window.state.pages)) window.state.pages = defaultState.pages;
if (!Array.isArray(window.state.layouts)) window.state.layouts = defaultState.layouts;
if (typeof window.state.activePageId === 'undefined') window.state.activePageId = defaultState.activePageId;
if (typeof window.state.layout === 'undefined') window.state.layout = defaultState.layout;

var state = window.state;

// Simple deep clone utility for plain objects.
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Unified error filtering
(function(){
  function shouldIgnore(args) {
    for (const a of args) {
      if (typeof a === 'string') {
        if (a.includes('WebSocket connection') && a.includes('Page entered Back-Forward Cache')) return true;
        if (a.includes('Cannot read properties of undefined') && a.includes('startTime')) return true;
      }
      if (a && typeof a.message === 'string') {
        if (a.message.includes('WebSocket connection') && a.message.includes('Page entered Back-Forward Cache')) return true;
        if (a.message.includes('Cannot read properties of undefined') && a.message.includes('startTime')) return true;
      }
    }
    return false;
  }

  const origError = console.error;
  console.error = function(...args){
    if (shouldIgnore(args)) return;
    return origError.apply(this, args);
  };
  const origWarn = console.warn;
  console.warn = function(...args){
    if (shouldIgnore(args)) return;
    return origWarn.apply(this, args);
  };

  window.onerror = function(){ return true; };
  window.addEventListener('error', function(e){
    const msg = e.message || '';
    if ((msg.includes('WebSocket connection') && msg.includes('Page entered Back-Forward Cache')) ||
        (msg.includes('Cannot read properties of undefined') && msg.includes('startTime'))) {
      e.stopPropagation();
      e.preventDefault();
      console.debug('Ignored error via global handler');
    }
  }, true);

  window.addEventListener('unhandledrejection', function(e){
    if (shouldIgnore([e.reason])) {
      e.preventDefault();
      console.debug('Ignored unhandled promise rejection');
    }
  });
})();

if (typeof DOMPurify === 'undefined') {
  window.DOMPurify = {
    sanitize: function(dirty) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(dirty, 'text/html');
      doc.querySelectorAll('script,style').forEach(el => el.remove());
      const all = doc.body.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        const attrs = all[i].attributes;
        for (let j = attrs.length - 1; j >= 0; j--) {
          const name = attrs[j].name;
          if (name.startsWith('on')) {
            all[i].removeAttribute(name);
          }
        }
      }
      return doc.body.innerHTML;
    }
  };
}

function closeOpenWebSockets() {
  for (const key in window) {
    try {
      const obj = window[key];
      if (obj instanceof WebSocket && obj.readyState === WebSocket.OPEN) {
        obj.close();
      }
    } catch (_) {}
  }
}
window.addEventListener('pagehide', closeOpenWebSockets);
window.addEventListener('pageshow', e => {
  if (e.persisted) {
    window.location.reload();
  }
});
window.addEventListener('beforeunload', closeOpenWebSockets);
window.addEventListener('beforeunload', (e) => {
    if (state.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
    }
});

const MAX_HISTORY = 5;
const undoStack = [];
const redoStack = [];
undoStack.push(JSON.parse(JSON.stringify(state)));

let saveTimeout;
// A blank workspace is intentionally memory-only until the user explicitly saves it.
let templateSessionIsPersisted = false;

function shouldUseCloudSync() {
    return !!(state.user && state.user.uid && typeof supabase !== 'undefined' && !window.firestoreSyncDisabled);
}

function disableCloudSync(error) {
    window.firestoreSyncDisabled = true;
    console.warn('Firestore 雲端同步目前不可用，已改為僅使用本機儲存。', error);
}

async function saveState(recordHistory = true) {
    clearTimeout(saveTimeout);
    if (recordHistory) {
        if (undoStack.length >= MAX_HISTORY) undoStack.shift();
        undoStack.push(JSON.parse(JSON.stringify(state)));
        redoStack.length = 0;
        if (typeof updateUndoRedoButtons === 'function') {
            updateUndoRedoButtons();
        }
    }
    // Do not create an IndexedDB/localStorage/Firestore draft for an unsaved template.
    if (!templateSessionIsPersisted) {
    state.hasUnsavedChanges = true;
    return;
}
    try {
        await setItem('oc_editor_state', state);
			state.hasUnsavedChanges = false;
    } catch (e) {
        console.error("Local save error:", e);
    }
    if (shouldUseCloudSync()) {
        try {
            await supabase.from('users').upsert({ id: state.user.uid, state });
			state.hasUnsavedChanges = false;
        } catch (e) {
            disableCloudSync(e);
        }
    }
}

/* Helpers */
let ytPlayer = null;
let ytAPIReady = false;

function loadYouTubeAPI() {
    if (ytAPIReady) return Promise.resolve();
    return new Promise((resolve) => {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        window.onYouTubeIframeAPIReady = () => {
            ytAPIReady = true;
            resolve();
        };
    });
}

async function playYouTubeVideo(videoId) {
    await loadYouTubeAPI();
    if (ytPlayer) {
        ytPlayer.loadVideoById({ videoId });
    } else {
        ytPlayer = new YT.Player('bgm-youtube-iframe', {
            videoId,
            playerVars: {
                autoplay: 1,
                loop: 1,
                playlist: videoId,
                controls: 0,
                origin: window.location.protocol === 'file:' ? 'http://localhost' : location.origin
            },
            events: {
                onReady: (event) => {
                    event.target.playVideo();
                },
                onError: (event) => {
                    const ytContainer = document.getElementById('bgm-youtube-container');
                    const empty = document.getElementById('bgm-empty');
                    ytContainer.classList.add('hidden');
                    empty.textContent = '此影片無法嵌入，請選擇其他影片或上傳音檔';
                    empty.classList.remove('hidden');
                    state.bgmYT = null;
                    const clearYTBtn = document.getElementById('clear-yt-btn');
                    if (clearYTBtn) clearYTBtn.classList.add('hidden');
                    saveState().then(() => loadBGM());
                }
            }
        });
    }
}

function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return `tpl_${window.crypto.randomUUID()}`;
    }
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function getTemplateName(templates, fallbackName = '') {
    const firstPage = state.pages[0];
    return (firstPage && firstPage.title && firstPage.title.trim()) || fallbackName || `新模板 ${templates.length + 1}`;
}

// A template owns every editable presentation setting, not just its text blocks.
// Runtime-only values are deliberately excluded so they cannot leak into another template.
function createTemplateStateSnapshot() {
    const snapshot = JSON.parse(JSON.stringify(state));
    delete snapshot.user;
    delete snapshot.previewMode;
    delete snapshot.previewPage;
    return snapshot;
}

function createTemplateRecord(id, templates, fallbackName = '') {
    const firstPage = state.pages[0];
    const textBlock = firstPage && Array.isArray(firstPage.blocks)
        ? firstPage.blocks.find(block => block && block.type === 'text')
        : null;

    return {
        id,
        name: getTemplateName(templates, fallbackName),
        isBlank: false,
        content: textBlock ? (textBlock.content || '') : '', // Backward compatibility for older records.
        pages: JSON.parse(JSON.stringify(state.pages)),
        editorState: createTemplateStateSnapshot()
    };
}

async function saveCurrentPageToTemplate() {
    // 儲存當前頁面的區塊狀態
    syncBlocksToState();

    if (!Array.isArray(state.pages) || state.pages.length === 0) {
        alert('當前沒有任何頁面可儲存。');
        return;
    }

    try {
        const templates = await readTemplateLibrary();

        // 每一個頁面都屬於同一份模板；以目前開啟的模板 ID 為唯一寫入目標。
        const activePage = state.pages.find(p => p.id === state.activePageId);
        let templateId = activePage ? activePage.templateId : null;

        if (!templateId) {
            // 空白模板直到此刻才取得正式 ID 並出現在大廳。
            const newTemplateId = generateId();
            state.pages.forEach(p => p.templateId = newTemplateId);
            templateId = newTemplateId;
            templates.push(createTemplateRecord(templateId, templates));
        } else {
            // 修改既有模板：只覆寫完全相同 ID 的那一筆資料。
            const idx = templates.findIndex(t => t && t.id === templateId);
            if (idx === -1) {
                // 已被刪除的舊連結不會覆寫任何其他模板，改為建立獨立新紀錄。
                const newTemplateId = generateId();
                state.pages.forEach(p => p.templateId = newTemplateId);
                templateId = newTemplateId;
                templates.push(createTemplateRecord(templateId, templates));
            } else {
                templates[idx] = {
                    ...templates[idx],
                    ...createTemplateRecord(templateId, templates, templates[idx].name)
                };
            }
        }

        await writeTemplateLibrary(templates);
        templateSessionIsPersisted = true; state.hasUnsavedChanges = false; // Reset flag after save
        localStorage.setItem('lastTemplateId', templateId);
        localStorage.removeItem('selectedTemplateId');

        window.location.replace('template.html');
    } catch (e) {
        console.error('儲存至模板失敗', e);
        alert('儲存失敗，請稍後再試。');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rgb2hex(rgb) {
    if (!rgb) return "#374151";
    if (rgb.startsWith('#')) return rgb;
    const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!match) return "#374151";
    return "#" + ("0" + parseInt(match[1]).toString(16)).slice(-2) +
                 ("0" + parseInt(match[2]).toString(16)).slice(-2) +
                 ("0" + parseInt(match[3]).toString(16)).slice(-2);
}

function extractYouTubeID(url) {
    const reg = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|.*[?&]v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
    const match = url.match(reg);
    return match ? match[1] : null;
}

async function validateYouTubeVideo(videoId) {
    try {
        const resp = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const data = await resp.json();
        return !data.error;
    } catch (e) {
        console.warn('YouTube validation error', e);
        return false;
    }
}

function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    const isClosed = sidebar.classList.contains('-translate-x-full');
    if (isClosed) {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.remove('opacity-0'), 10);
    } else {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
}

/* --- Sidebar Logic --- */
function editPageTitle(pageId) {
    const page = state.pages.find(p => p.id === pageId);
    if (!page) return;
    const current = page.title || '';
    const title = prompt('請輸入此頁面的標題（留空則使用「無標題」）', current);
    if (title === null) return;
    const trimmed = title.trim();
    if (trimmed) {
        const duplicate = state.pages.some(p => p.id !== pageId && p.title && p.title.trim() === trimmed);
        if (duplicate) {
            alert('此頁面的標題已被其他頁面使用，請選擇其他標題。');
            return;
        }
        page.title = trimmed;
    } else {
        page.title = '';
    }
    saveState();
    renderSidebar();
    if (state.activePageId === pageId) {
        renderMain();
    }
}

function closeSidebars() {
    const overlay = document.getElementById('mobile-overlay');
    const leftSidebar = document.getElementById('sidebar');
    if (leftSidebar && !leftSidebar.classList.contains('-translate-x-full')) {
        leftSidebar.classList.add('-translate-x-full');
    }
    overlay.classList.add('opacity-0');
    setTimeout(() => overlay.classList.add('hidden'), 300);
}
let draggedPageId = null; let draggedCategoryId = null;

function renderSidebar() { 
    if (!document.getElementById('sidebar-pages')) return;
    const container = document.getElementById('sidebar-pages');
    container.innerHTML = '';
    const uncatPages = state.pages.filter(p => !p.categoryId);
    if (uncatPages.length > 0) {
        const uncatEl = document.createElement('div');
        uncatEl.className = 'mb-4 space-y-0.5';
        uncatPages.forEach(p => uncatEl.appendChild(createSidebarPageEl(p)));
        container.appendChild(uncatEl);
    }
    state.categories.forEach(cat => {
        const catWrapper = document.createElement('div');
        catWrapper.className = 'mb-4';
        catWrapper.innerHTML = `
            <div class="flex justify-between items-center px-3 py-1.5 group text-[11px] font-bold text-gray-400 uppercase tracking-widest rounded-lg transition-colors hover:bg-gray-200/50">
                <span class="truncate flex-1 cursor-pointer transition-colors group-hover:text-gray-700" onclick="renameCategory('${cat.id}')">${escapeHtml(cat.name)}</span>
                <div class="flex gap-1">
                    <button class="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-all" title="新增頁面至此分類" onclick="addPage('${cat.id}')">
                        <svg width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7 7V2h2v5h5v2H9v5H7V9H2V7h5z"/></svg>
                    </button>
                    <button class="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-all" title="刪除分類" onclick="deleteCategory('${cat.id}')">
                        <svg width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M3 4h10v1H3V4zm2 2h6v8H5V6zm1 1v6h1V7H6zm3 0h1v6H9V7zM5 2h6v1H5V2z"/></svg>
                    </button>
                </div>
            </div>
            <div class="cat-pages min-h-[16px] pl-2 relative space-y-0.5 mt-0.5" data-cat-id="${cat.id}">
                <div class="absolute left-[9px] top-1 bottom-1 w-px bg-gray-200/60 rounded-full"></div>
            </div>
        `;
        const pagesContainer = catWrapper.querySelector('.cat-pages');
        setupSidebarDropZone(pagesContainer, cat.id);
        const header = catWrapper.firstElementChild;
        header.draggable = true;
        header.style.cursor = 'move';
        header.addEventListener('dragstart', (e) => {
            draggedCategoryId = cat.id;
            header.classList.add('opacity-50');
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.setData('text/plain', 'category');
        });
        header.addEventListener('dragend', () => {
            header.classList.remove('opacity-50');
            draggedCategoryId = null;
        });
        catWrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (draggedCategoryId && draggedCategoryId !== cat.id) {
                catWrapper.style.borderTop = '2px solid #e5e7eb';
            }
        });
        catWrapper.addEventListener('dragleave', () => {
            catWrapper.style.borderTop = '';
        });
        catWrapper.addEventListener('drop', (e) => {
            e.preventDefault();
            catWrapper.style.borderTop = '';
            if (draggedCategoryId && draggedCategoryId !== cat.id) {
                const fromIdx = state.categories.findIndex(c => c.id === draggedCategoryId);
                const toIdx = state.categories.findIndex(c => c.id === cat.id);
                if (fromIdx !== -1 && toIdx !== -1) {
                    const [movedCat] = state.categories.splice(fromIdx, 1);
                    const insertIdx = toIdx > fromIdx ? toIdx : toIdx;
                    state.categories.splice(insertIdx, 0, movedCat);
                    saveState();
                    renderSidebar();
                }
            }
        });
        const pages = state.pages.filter(p => p.categoryId === cat.id);
        pages.forEach(p => pagesContainer.appendChild(createSidebarPageEl(p)));
        container.appendChild(catWrapper);
    });
}

function createSidebarPageEl(page) {
    const el = document.createElement('div');
    const isActive = state.activePageId === page.id;
    el.className = `flex justify-between items-center px-3 py-1.5 rounded-lg cursor-pointer group transition-all text-sm relative z-10 ${isActive ? 'bg-white shadow-sm font-semibold text-gray-900 border border-gray-200/60' : 'text-gray-600 hover:bg-gray-200/60 border border-transparent font-medium hover:text-gray-900'}`;
    el.draggable = true;
    el.innerHTML = `
        <div class="flex items-center gap-2 flex-1 min-w-0 pointer-events-none">
            <svg width="14" height="14" viewBox="0 0 16 16" class="shrink-0 ${isActive ? 'text-gray-800' : 'text-gray-400'}"><path fill="currentColor" fill-rule="evenodd" d="M14 3v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h7.5L14 4.5V3zM8 6v2H6v1h2v2h1V9h2V8H9V6H8z"/></svg>
            <span class="truncate block pt-px">${escapeHtml(page.title) }</span>
        </div>
        <button class="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-md transition-all shrink-0" title="編輯標題" onclick="event.stopPropagation(); editPageTitle('${page.id}')">✎</button>
        <button class="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all shrink-0" title="刪除頁面" onclick="event.stopPropagation(); deletePage('${page.id}')">
            <svg width="12" height="12" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M3 4h10v1H3V4zm2 2h6v8H5V6zm1 1v6h1V7H6zm3 0v6h1V7H9zM5 2h6v1H5V2z"/></svg>
        </button>
    `;
    el.onclick = () => {
        if(state.activePageId !== page.id) {
            state.activePageId = page.id;
            saveState();
            renderSidebar();
            renderMain();
            if(window.innerWidth < 768) toggleMobileMenu();
        }
    };
    el.addEventListener('dragstart', (e) => {
        draggedPageId = page.id;
        e.stopPropagation();
        setTimeout(() => el.classList.add('opacity-50'), 0);
    });
    el.addEventListener('dragend', () => {
        el.classList.remove('opacity-50');
        el.style.borderBottom = '';
        draggedPageId = null;
    });
    el.addEventListener('dragover', (e) => {
        e.preventDefault();
        if(!draggedPageId || draggedPageId === page.id) return;
        el.style.borderBottom = '2px solid #e5e7eb';
    });
    el.addEventListener('dragleave', () => {
        el.style.borderBottom = '';
    });
    el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.style.borderBottom = '';
        if(!draggedPageId || draggedPageId === page.id) return;
        const draggedIdx = state.pages.findIndex(p => p.id === draggedPageId);
        const [draggedPage] = state.pages.splice(draggedIdx, 1);
        draggedPage.categoryId = page.categoryId;
        const newTargetIdx = state.pages.findIndex(p => p.id === page.id);
        state.pages.splice(newTargetIdx + 1, 0, draggedPage);
        saveState();
        renderSidebar();
    });
    return el;
}

function setupSidebarDropZone(container, catId) {
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        if(e.target === container && container.children.length === 0) {
            container.classList.add('bg-gray-100', 'rounded-lg');
        }
    });
    container.addEventListener('dragleave', (e) => {
        container.classList.remove('bg-gray-100', 'rounded-lg');
    });
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        container.classList.remove('bg-gray-100', 'rounded-lg');
        if(draggedPageId && e.target === container && container.children.length === 0) {
            const idx = state.pages.findIndex(p => p.id === draggedPageId);
            if(idx !== -1) {
                const [page] = state.pages.splice(idx, 1);
                page.categoryId = catId;
                state.pages.push(page);
                saveState();
                renderSidebar();
            }
        }
    });
}

function addCategory() {
    if (state.previewMode) { return; }
    const name = prompt('請輸入新分類名稱:');
    if(name && name.trim()) {
        state.categories.push({ id: generateId(), name: name.trim() });
        saveState();
        renderSidebar();
    }
}
function renameCategory(id) {
    if (state.previewMode) { return; }
    const cat = state.categories.find(c => c.id === id);
    const name = prompt('重新命名分類:', cat.name);
    if(name && name.trim()) {
        cat.name = name.trim();
        saveState();
        renderSidebar();
    }
}
function deleteCategory(id) {
    if (state.previewMode) { return; }
    if(confirm('確定要刪除此分類嗎？分類內的頁面將會被移出。')) {
        state.categories = state.categories.filter(c => c.id !== id);
        state.pages.forEach(p => { if(p.categoryId === id) p.categoryId = null; });
        saveState();
        renderSidebar();
    }
}
function addPage(categoryId = null) {
    if (state.previewMode) { return; }
    const layoutOptions = ['double', 'card', 'single'];
    const layoutIndex = (state.pages && Array.isArray(state.pages) ? state.pages.length : 0) % layoutOptions.length;
    const newPageLayout = layoutOptions[layoutIndex];
    // New pages remain in the currently open template branch.
    const templateId = (state.pages || []).find(page => page && page.templateId)?.templateId || null;
    const newPage = {
        id: generateId(),
        categoryId,
        title: '',
        layout: newPageLayout || 'single',
        templateId,
        blocks: [ { id: generateId(), type: 'text', content: '', color: '#374151', align: 'left', heading: 'p', animate: '', layout: (Array.isArray(state.layouts) && state.layouts.length ? state.layouts[0] : 'single') } ]
    };
    state.pages.push(newPage);
    state.activePageId = newPage.id;
    saveState();
    renderSidebar();
    renderMain();
    setTimeout(() => {
        const titleInput = document.getElementById('page-title-input');
        if(titleInput) titleInput.focus();
    }, 50);
}
function deletePage(id) {
    if (state.previewMode) { return; }
    if(confirm('確定要刪除這個頁面嗎？資料將無法恢復。')) {
        state.pages = state.pages.filter(p => p.id !== id);
        if(state.activePageId === id) {
            state.activePageId = state.pages.length > 0 ? state.pages[0].id : null;
        }
        saveState();
        renderSidebar();
        renderMain();
    }
}

/* --- Main Editor Logic --- */
function copyLayoutClasses(sourceEl, targetEl) {
    if (!sourceEl || !targetEl) return;
    const layoutClasses = Array.from(sourceEl.classList).filter(c => c.startsWith('col-span-') || ['bg-white', 'border', 'border-gray-100', 'rounded-xl', 'shadow-sm', 'p-4', 'hover:shadow-md'].includes(c));
    if (layoutClasses.length > 0) {
        targetEl.classList.add(...layoutClasses);
    } else {
        targetEl.classList.add('col-span-12');
    }
}

function syncBlocksToState() {
    if(!state.activePageId) return;
    let page = state.pages.find(p => p.id === state.activePageId);
    if (state.previewMode && state.previewPage && state.previewPage.id === state.activePageId) {
        page = state.previewPage;
    }
    if (!page) return;
    const blockEls = document.querySelectorAll('.block-wrapper');
    page.blocks = Array.from(blockEls).map(el => {
        const type = el.dataset.type;
        let content = '';
        if (type === 'text') {
            const textEl = el.querySelector('.text-content');
            content = textEl ? textEl.textContent : '';
        } else if (type === 'image') {
            content = el.dataset.content || '';
        } else if (type === 'button') {
            const btn = el.querySelector('button');
            content = btn ? btn.textContent : '';
        } else if (type === 'table') {
            const tableDiv = el.querySelector('.content');
            content = tableDiv ? tableDiv.innerHTML : '';
        } else if (type === 'nav') {
            content = '';
        } else if (type === 'todo') {
            const todoDiv = el.querySelector('.content');
            content = todoDiv ? todoDiv.innerHTML : '';
        }
        return {
            id: el.dataset.id,
            type: type,
            content: content,
            color: el.dataset.color,
            align: el.dataset.align,
            txtColor: el.dataset.txtColor || null,
            heading: el.dataset.heading || 'p',
            layout: el.dataset.layout || null,
            scale: el.dataset.scale || null,
            animate: el.dataset.animate || '',
            link: el.dataset.link || null,
            radius: el.dataset.radius || null,
            size: el.dataset.size || null,
            style: el.dataset.style || null,
            nav: el.dataset.nav || null
        };
    });
    saveState();
}
let syncDebounce;
function syncBlocksToStateDebounced() {
    clearTimeout(syncDebounce);
    syncDebounce = setTimeout(() => {
        syncBlocksToState();
    }, 300);
}

function setupTextBlockListeners(el) {
    el.addEventListener('input', () => syncBlocksToStateDebounced());
    el.addEventListener('blur', () => syncBlocksToState());
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const wrapper = el.closest('.block-wrapper');
            if (!wrapper) return;
            const newBlock = { id: generateId(), type: 'text', content: '', color: wrapper.dataset.color, align: wrapper.dataset.align, heading: 'p', layout: 'single', animate: '' };
            const newEl = createBlockElement(newBlock);
            copyLayoutClasses(wrapper, newEl);
            wrapper.parentNode.insertBefore(newEl, wrapper.nextSibling);
            const newText = newEl.querySelector('.text-content');
            if (newText) newText.focus();
            syncBlocksToState();
        } else if (e.key === 'Backspace') {
            if (el.textContent.trim().length === 0) {
                e.preventDefault();
                const wrapper = el.closest('.block-wrapper');
                if (!wrapper) return;
                const prev = wrapper.previousElementSibling;
                if (prev && prev.classList.contains('block-wrapper')) {
                    wrapper.remove();
                    const prevText = prev.querySelector('.text-content');
                    if (prevText) {
                        prevText.focus();
                        const selection = window.getSelection();
                        const range = document.createRange();
                        range.selectNodeContents(prevText);
                        range.collapse(false);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                    syncBlocksToState();
                }
            }
        }
    });
}

function renderMain() {
    const tmplParam = new URLSearchParams(window.location.search).get('tmpl');
    if (tmplParam === 'sample') {
        let samplePage = state.pages.find(p => p.id === state.activePageId);
        if (samplePage && !samplePage.isSample) {
            samplePage.title = '';
            samplePage.blocks = [{ id: generateId(), type: 'text', content: '', color: '#374151', align: 'left', heading: 'p' }];
            samplePage.isSample = true;
            saveState();
        }
    }

    const main = document.getElementById('main-content');
    if(!state.activePageId) {
        main.innerHTML = `
            <div class="flex flex-col items-center justify-center h-[70vh] text-gray-400 gap-5">
                <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center border border-gray-100 shadow-sm">
                    <svg width="24" height="24" viewBox="0 0 16 16" class="text-gray-300"><path fill="currentColor" fill-rule="evenodd" d="M14 3v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h7.5L14 4.5V3zM8 6v2H6v1h2v2h1V9h2V8H9V6H8z"/></svg>
                </div>
                <p class="text-sm font-medium tracking-wide">請從側邊欄選擇頁面，或建立新頁面</p>
            </div>`;
        return;
    }
    let page = state.pages.find(p => p.id === state.activePageId);
    if (state.previewMode && state.previewPage && state.previewPage.id === state.activePageId) {
        page = state.previewPage;
    }
    if(!page) return;

    if (!Array.isArray(page.blocks)) {
        page.blocks = [];
    }

    let mtClass = '';

    main.innerHTML = `
        <div class="w-full px-0 py-12 transition-all duration-500 relative">
            <div class="group relative mb-12 ${mtClass} transition-all duration-300">
                ${state.previewMode
                    ? `<div id="page-title-display" class="text-4xl md:text-5xl font-bold w-full text-gray-900 leading-tight tracking-tight break-words pl-10 md:pl-3">${escapeHtml(page.title) }</div>`
                    : `<input type="text" id="page-title-input" class="text-4xl md:text-5xl font-bold w-full outline-none bg-transparent placeholder-gray-200 text-gray-900 leading-tight tracking-tight transition-colors border-b border-transparent focus:border-gray-200 pb-2 pl-10 md:pl-10" placeholder="無標題頁面" value="${escapeHtml(page.title)}">`}
            </div>
        </div>
    `;

    const titleInput = document.getElementById('page-title-input');
    if (titleInput) {
        let previousTitle = page.title || '';
        titleInput.addEventListener('focus', () => {
            previousTitle = titleInput.value;
        });
        titleInput.addEventListener('input', (e) => {
            const newTitle = e.target.value.trim();
            if (newTitle && state.pages.some(p => p.id !== page.id && p.title && p.title.trim() === newTitle)) {
                alert('此頁面的標題已被其他頁面使用，請選擇其他標題。');
                titleInput.value = previousTitle;
                return;
            }
            page.title = newTitle;
            previousTitle = newTitle;
            saveState();
            renderSidebar();
        });
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const firstBlock = document.querySelector('.text-content');
                if (firstBlock) firstBlock.focus();
            }
        });
    }

    if(page.blocks.length === 0) {
        page.blocks.push({ id: generateId(), type: 'text', content: '', color: '#374151', align: 'left', heading: 'p' });
    }

    const layoutOptions = Array.isArray(state.layouts) && state.layouts.length ? state.layouts : ['single'];
    const container = document.createElement('div');
    container.className = 'grid grid-cols-12 gap-x-6 gap-y-3';

    page.blocks.forEach((block, idx) => {
        const blockLayout = block.layout || layoutOptions[idx % layoutOptions.length];
        const blockEl = createBlockElement(block);

        blockEl.classList.remove('bg-white','border','border-gray-100','rounded-xl','shadow-sm','p-4','hover:shadow-md');

        let colSpanClass = ['col-span-12'];
        if (blockLayout === 'double') colSpanClass.push('md:col-span-6');
        else if (blockLayout === 'card') colSpanClass.push('md:col-span-4');

        blockEl.classList.add(...colSpanClass);
        if (blockLayout === 'card' && block.type !== 'separator') {
            blockEl.classList.add('bg-white','border','border-gray-100','rounded-xl','shadow-sm','p-4','hover:shadow-md','transition-shadow','duration-300');
            blockEl.classList.add('card-layout');
        }
        container.appendChild(blockEl);
    });
    main.appendChild(container);

    const banner = document.getElementById('banner-container');
    if (banner) {
        const strayNavs = document.querySelectorAll('.block-wrapper[data-type="nav"]');
        strayNavs.forEach(nav => {
            if (!container.contains(nav)) {
                nav.remove();
            }
        });

        const currentNavs = container.querySelectorAll('.block-wrapper[data-type="nav"]');
        currentNavs.forEach(navEl => {
            banner.parentNode.insertBefore(navEl, banner.nextSibling);
            navEl.classList.add('z-10');
        });
    }

    if (typeof applyPreviewUI === 'function') {
        applyPreviewUI();
    }
}
/* Block Drag State */
let draggedBlock = null;
let dropBlockPlaceholder = document.createElement('div');
dropBlockPlaceholder.className = 'drop-placeholder';
let dragTargetBlock = null;
let currentCell = null;

function createBlockElement(block) {
    const wrapper = document.createElement('div');
    let wrapperClass = `block-wrapper group flex items-start md:ml-0 md:pl-2 py-1 relative rounded-lg hover:bg-gray-50/60 transition-colors ${block.animate || ''}`;
    wrapper.className = wrapperClass;
    wrapper.dataset.id = block.id;
    wrapper.dataset.type = block.type;
    wrapper.dataset.layout = block.layout || '';
    wrapper.dataset.animate = block.animate || '';

    if (block.layout === 'card' && block.type !== 'separator') {
        wrapper.classList.add('bg-white','border','border-gray-100','rounded-xl','shadow-sm','p-4','hover:shadow-md','transition-shadow','duration-300','card-layout');
    }

    wrapper.dataset.color = block.color || '#374151';
    wrapper.dataset.txtColor = block.txtColor || '#000000';
    wrapper.dataset.align = block.align || 'left';
    wrapper.dataset.heading = block.heading || 'p';
    wrapper.dataset.link = block.link || '';
    wrapper.dataset.radius = block.radius !== undefined ? block.radius : '0';
    wrapper.dataset.size = block.size !== undefined ? block.size : '100';
    if (block.type === 'nav') {
        wrapper.dataset.nav = block.nav || '';
        wrapper.classList.add('mt-24');
    }

    if(block.type === 'image' && block.content) {
        wrapper.dataset.content = block.content;
    }

    if (block.type === 'separator') {
        wrapper.dataset.style = block.style || 'dashed';
        wrapper.dataset.scale = block.scale || '1';
    }

    const alignClasses = wrapper.dataset.align === 'left' ? 'mr-auto ml-0' : wrapper.dataset.align === 'right' ? 'ml-auto mr-0' : 'mx-auto';

    const headingStyles = {
        'h1': 'text-3xl font-bold mt-6 mb-2 tracking-tight text-gray-900',
        'h2': 'text-2xl font-semibold mt-5 mb-2 tracking-tight text-gray-800 border-b border-gray-100 pb-1',
        'h3': 'text-xl font-medium mt-4 mb-1.5 text-gray-800',
        'h4': 'text-lg font-medium mt-3 mb-1 text-gray-700',
        'p': 'text-base font-normal leading-relaxed mb-1'
    };

    const hClass = headingStyles[block.heading || 'p'];

    wrapper.innerHTML = `
        <div class="controls pointer-events-none opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto flex gap-0.5 w-10 md:w-8 mt-1.5 justify-end items-center cursor-pointer select-none transition-opacity shrink-0 absolute left-0 md:static bg-white/90 backdrop-blur md:bg-transparent rounded-md px-1 shadow-sm md:shadow-none z-20 border border-gray-100 md:border-none">
            <div class="add-btn text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1 rounded transition-colors hidden md:flex items-center justify-center" title="向下新增區塊">
                <svg width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7 7V2h2v5h5v2H9v5H7V9H2V7h5z"/></svg>
            </div>
            <div class="drag-handle text-gray-600 bg-gray-200 hover:text-gray-700 hover:bg-gray-300 p-1 rounded cursor-grab active:cursor-grabbing transition-colors flex items-center justify-center" draggable="true" title="拖曳以排序，點擊開啟設定">
                <svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>
            </div>
        </div>
        <div class="content flex-1 w-full min-w-0 pl-10 md:pl-3">
            ${block.type === 'text'
                ? `<${block.heading || 'p'} class="text-content ${hClass} outline-none min-h-[1.5em] px-1 py-0.5 rounded transition-colors focus:bg-gray-100/50 break-words" contenteditable="${!state.previewMode}" data-placeholder="${state.previewMode ? '' : '輸入內容或點擊左側 ⋮ 更改設定'}" style="color: ${wrapper.dataset.color}; text-align: ${wrapper.dataset.align};">${DOMPurify.sanitize(block.content || '')}</${block.heading || 'p'}>`
                : `<div class="image-content rounded-xl overflow-hidden flex items-center justify-center relative group/img cursor-pointer transition-all ${block.content ? 'bg-transparent' : 'bg-gray-50 border-2 border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-100/50 min-h-[160px]'}" style="text-align: ${wrapper.dataset.align}">
                    ${block.content
                        ? `<img src="${(block.content && /^(data:|https?:\/\/)/.test(block.content) ? block.content : '')}" class="max-w-full rounded-xl block object-contain ${alignClasses} shadow-sm" style="max-height: 70vh; border-radius: ${block.radius || 0}%" alt="Image Block" />
                       ${!state.previewMode ? `<div class="absolute inset-0 bg-gray-900/40 opacity-0 group-hover/img:opacity-100 flex items-center justify-center transition-opacity rounded-xl ${alignClasses}" style="width: max-content;">
                           <span class="bg-white/90 backdrop-blur px-3 py-1.5 rounded-full text-xs font-medium text-gray-700 shadow-sm">更換圖片</span>
                       </div>` : ''}`
                        : `<div class="text-gray-400 text-sm flex flex-col items-center gap-3 font-medium">
                               <div class="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center text-gray-400 group-hover/img:text-gray-600 transition-colors">
                                   <svg width="20" height="20" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M14 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zm-1 10H3v-2l2-2 1.5 1.5L9 7l4 4v1zm0-3.5L9.5 5 7 7.5 5 5.5 3 7.5V3h10v5.5z"/></svg>
                               </div>
                               點擊上傳圖片
                           </div>`
                    }
                    <input type="file" class="file-input" accept="image/*" style="position:absolute; left:-9999px;" ${state.previewMode ? 'disabled' : ''} />
                </div>`
            }
        </div>
    `;

    if (block.type === 'button') {
        const contentDiv = wrapper.querySelector('.content');
        if (contentDiv) {
            contentDiv.innerHTML = '';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `user-button ${hClass} px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded`;
            btn.style.backgroundColor = wrapper.dataset.color;
            btn.style.color = wrapper.dataset.txtColor || '#000000';
            btn.style.textAlign = wrapper.dataset.align;
            btn.textContent = block.content || '按鈕';
            if (wrapper.dataset.link) btn.dataset.link = wrapper.dataset.link;
            contentDiv.appendChild(btn);
        }
    }
    if (block.type === 'table') {
        const contentDiv = wrapper.querySelector('.content');
        if (contentDiv) {
            contentDiv.innerHTML = block.content || '';
            if (state.previewMode) {
                contentDiv.querySelectorAll('td, th, a').forEach(el => el.setAttribute('contenteditable', 'false'));
            };
            const table = contentDiv.querySelector('table');
            if (table) {
                table.style.backgroundColor = wrapper.dataset.color;
                if (wrapper.dataset.txtColor) {
                    table.style.color = wrapper.dataset.txtColor;
                }
                const cells = table.querySelectorAll('td, th');
                cells.forEach(cell => {
                    cell.addEventListener('click', (e) => {
                        if (state.previewMode) return;
                        e.stopPropagation();
                        showCellColorPicker(cell);
                    });
                });
            }
        }
    }
    if (block.type === 'nav') {
        const contentDiv = wrapper.querySelector('.content');
        if (contentDiv) {
            contentDiv.innerHTML = renderNav(wrapper);
            const links = contentDiv.querySelectorAll('a');
            links.forEach(a => a.addEventListener('input', syncBlocksToStateDebounced));
            links.forEach(a => {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    const link = a.dataset.link;
                    if (!link) return;
                    if (state.pages.some(p => p.id === link)) {
                        state.activePageId = link;
                        saveState();
                        renderSidebar();
                        renderMain();
                        return;
                    }
                    if (/^\d+$/.test(link)) {
                        const numeric = Number(link);
                        if (numeric > 0 && numeric <= state.pages.length) {
                            state.activePageId = state.pages[numeric - 1].id;
                            saveState();
                            renderSidebar();
                            renderMain();
                            return;
                        }
                        const matched = state.pages.find(p => p.id.includes(link));
                        if (matched) {
                            state.activePageId = matched.id;
                            saveState();
                            renderSidebar();
                            renderMain();
                            return;
                        }
                    }
                    const isValid = /^(https?:\/\/|mailto:|tel:)/i.test(link);
                    if (isValid) {
                        window.open(link, '_blank', 'noopener,noreferrer');
                    }
                });
            });
        }
    }
    if (block.type === 'table' && !state.previewMode) {
        const contentDiv = wrapper.querySelector('.content');
        if (contentDiv) {
            const cells = contentDiv.querySelectorAll('td');
            cells.forEach(cell => cell.addEventListener('input', syncBlocksToStateDebounced));
        }
    }
    if (block.type === 'todo') {
        const contentDiv = wrapper.querySelector('.content');
        if (contentDiv) {
            if (block.content) {
                contentDiv.innerHTML = block.content;
                if (state.previewMode) {
                    contentDiv.querySelectorAll('.todo-text, td, th, a').forEach(el => el.setAttribute('contenteditable', 'false'));
                }
            } else {
                contentDiv.innerHTML = `<ul class="todo-list"><li class="flex items-center"><input type="checkbox" class="mr-1"><span class="todo-text" contenteditable="${!state.previewMode}" data-placeholder="輸入代辦項目"></span></li></ul>`;
            }
            if (!state.previewMode) {
                const attachTodoListeners = (li) => {
                    const span = li.querySelector('.todo-text');
                    const checkbox = li.querySelector('input[type="checkbox"]');
                    if (span) {
                        span.addEventListener('input', syncBlocksToStateDebounced);
                        span.addEventListener('keydown', (e) => { if (state.previewMode) return;
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                const newLi = document.createElement('li');
                                newLi.className = 'flex items-center';
                                newLi.innerHTML = `<input type="checkbox" class="mr-1"><span class="todo-text" contenteditable="${!state.previewMode}" data-placeholder="輸入代辦項目"></span>`;
                                li.parentNode.insertBefore(newLi, li.nextSibling);
                                attachTodoListeners(newLi);
                                const newSpan = newLi.querySelector('.todo-text');
                                if (newSpan) newSpan.focus();
                                syncBlocksToStateDebounced();
                            } else if (e.key === 'Backspace' && span.textContent.trim() === '' && li.parentNode.children.length > 1) {
                                const prevLi = li.previousElementSibling;
                                li.remove();
                                if (prevLi) {
                                    const prevSpan = prevLi.querySelector('.todo-text');
                                    if (prevSpan) prevSpan.focus();
                                }
                                syncBlocksToStateDebounced();
                            }
                        });
                    }
                    if (checkbox) {
                        checkbox.addEventListener('change', (e) => {
                            if (span) {
                                if (e.target.checked) {
                                    span.classList.add('line-through', 'text-gray-400');
                                } else {
                                    span.classList.remove('line-through', 'text-gray-400');
                                }
                            }
                            syncBlocksToStateDebounced();
                        });
                    }
                };
                const listItems = contentDiv.querySelectorAll('.todo-list li');
                listItems.forEach(li => attachTodoListeners(li));
            }
        }
    }
    if (block.type === 'separator') {
        const contentDiv = wrapper.querySelector('.content');
        if (contentDiv) {
            contentDiv.innerHTML = '';
            const hr = document.createElement('hr');
            let styleClass = '';
            let borderThickness = 'border-t-2';
            if (block.style === 'dotted') {
                styleClass = 'border-dotted';
                borderThickness = 'border-t-4';
            } else if (block.style === 'dashed') {
                styleClass = 'border-dashed';
                borderThickness = 'border-t-2';
            } else {
                styleClass = 'border-solid';
                borderThickness = 'border-t-2';
            }
            hr.className = `separator-line ${borderThickness} border-gray-300 ${styleClass} my-4`;
            if (block.scale && block.scale !== '1') {
                hr.style.transform = `scaleY(${block.scale})`;
                hr.style.transformOrigin = 'center top';
            }
            contentDiv.appendChild(hr);
        }
    }
    if (block.type === 'text') {
        const textEl = wrapper.querySelector('.text-content');
        if (!state.previewMode) {
            setupTextBlockListeners(textEl);
        }
    } else {
        if (!state.previewMode) {
            const imgContainer = wrapper.querySelector('.image-content');
            const fileInput = wrapper.querySelector('.file-input');
            if (imgContainer) imgContainer.addEventListener('click', () => fileInput.click());
            if (fileInput) fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    if(file.size > 5 * 1024 * 1024) {
                        alert("圖片檔案過大，請選擇小於 5MB 的圖片以保持效能。");
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const result = ev.target.result;
                        wrapper.dataset.content = result;
                        const newBlock = { id: block.id, type: 'image', content: result, color: wrapper.dataset.color, align: wrapper.dataset.align, link: wrapper.dataset.link, radius: wrapper.dataset.radius || '0', size: wrapper.dataset.size || '100' };
                        const newEl = createBlockElement(newBlock);
                        copyLayoutClasses(wrapper, newEl);
                        wrapper.replaceWith(newEl);
                        syncBlocksToState();
                    };
                    reader.readAsDataURL(file);
                }
            });
        }
    }

    if (!state.previewMode) {
        const addBtn = wrapper.querySelector('.add-btn');
        if(addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newBlock = { id: generateId(), type: 'text', content: '', color: '#374151', align: 'left', heading: 'p', layout: 'single', animate: '' };
                const newEl = createBlockElement(newBlock);
                copyLayoutClasses(wrapper, newEl);
                wrapper.parentNode.insertBefore(newEl, wrapper.nextSibling);
                const textEl = newEl.querySelector('.text-content');
                if(textEl) textEl.focus();
                syncBlocksToState();
            });
        }

        const dragHandle = wrapper.querySelector('.drag-handle');
        if(dragHandle) {
            dragHandle.addEventListener('click', (e) => {
                e.stopPropagation();
                showBlockMenu(wrapper, e.currentTarget);
            });
            setupBlockDrag(wrapper, dragHandle);
        }
    }

    wrapper.addEventListener('click', (e) => {
        let link = wrapper.dataset.link;
        if (link) {
            if (e.target.closest('.text-content') && !state.previewMode) {
                return;
            }
            let isInternal = state.pages.some(p => p.id === link);
            if (!isInternal && /^\d+$/.test(link)) {
                const numeric = Number(link);
                if (numeric > 0 && numeric <= state.pages.length) {
                    isInternal = true;
                    link = state.pages[numeric - 1].id;
                } else {
                    const matched = state.pages.find(p => p.id.includes(link));
                    if (matched) {
                        isInternal = true;
                        link = matched.id;
                    }
                }
            }
            if (isInternal) {
                e.preventDefault();
                e.stopPropagation();
                state.activePageId = link;
                saveState();
                renderSidebar();
                renderMain();
                return;
            }
            const isValid = /^(https?:\/\/|mailto:|tel:)/i.test(link);
            if (!isValid) {
                console.warn('Ignored invalid link:', link);
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            window.open(link, '_blank', 'noopener,noreferrer');
        }
    });

    if (state.previewMode && wrapper.dataset.link) {
        wrapper.classList.add('cursor-pointer', 'hover:shadow-md', 'transition-shadow');
    }

    return wrapper;
}

function setupBlockDrag(el, handle) {
    handle.addEventListener('dragstart', (e) => {
        draggedBlock = el;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setDragImage(el, 20, 20); } catch(err){}
        setTimeout(() => el.classList.add('opacity-30', 'bg-gray-100', 'scale-[0.99]'), 0);
        document.getElementById('block-menu').classList.add('hidden');
    });
    handle.addEventListener('dragend', () => {
        el.classList.remove('opacity-30', 'bg-gray-100', 'scale-[0.99]');
        if (dropBlockPlaceholder.parentNode) dropBlockPlaceholder.parentNode.removeChild(dropBlockPlaceholder);
        draggedBlock = null;
        dragTargetBlock = null;
    });
    el.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedBlock || draggedBlock === el) return;
        const rect = el.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
            dropBlockPlaceholder.style.top = '-2px';
            dropBlockPlaceholder.style.bottom = 'auto';
            el.appendChild(dropBlockPlaceholder);
            dragTargetBlock = { el, position: 'before' };
        } else {
            dropBlockPlaceholder.style.top = 'auto';
            dropBlockPlaceholder.style.bottom = '-2px';
            el.appendChild(dropBlockPlaceholder);
            dragTargetBlock = { el, position: 'after' };
        }
    });
    el.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && !el.contains(e.relatedTarget)) {
            if (dropBlockPlaceholder.parentNode === el) {
                el.removeChild(dropBlockPlaceholder);
            }
        }
    });
    el.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dropBlockPlaceholder.parentNode) dropBlockPlaceholder.parentNode.removeChild(dropBlockPlaceholder);
        if (!draggedBlock || draggedBlock === el || !dragTargetBlock) return;
        if (dragTargetBlock.position === 'before') {
            el.parentNode.insertBefore(draggedBlock, el);
        } else {
            el.parentNode.insertBefore(draggedBlock, el.nextSibling);
        }
        syncBlocksToState();
    });
}

/* --- Block Menu Logic --- */
let currentMenuBlock = null;
function showBlockMenu(blockEl, handleEl) {
    const delBtn = document.getElementById('menu-delete');
    if (delBtn) {
        const allBlocks = document.querySelectorAll('.block-wrapper');
        const imageBlocks = document.querySelectorAll('.block-wrapper[data-type="image"]');
        const buttonBlocks = document.querySelectorAll('.block-wrapper[data-type="button"]');
        const todoBlocks = document.querySelectorAll('.block-wrapper[data-type="todo"]');
        // Hide delete for the sole remaining text block, or for the last image, button, or todo block
        if ((allBlocks.length === 1 && blockEl.dataset.type === 'text') ||
            (imageBlocks.length === 1 && blockEl.dataset.type === 'image') ||
            (buttonBlocks.length === 1 && blockEl.dataset.type === 'button') ||
            (todoBlocks.length === 1 && blockEl.dataset.type === 'todo')) {
            delBtn.classList.add('hidden');
        } else {
            delBtn.classList.remove('hidden');
        }
    }
    currentMenuBlock = blockEl;
    const menu = document.getElementById('block-menu');
    if (blockEl.dataset.type === 'button' || blockEl.dataset.type === 'table' || blockEl.dataset.type === 'nav') {
        const txtColor = rgb2hex(blockEl.dataset.txtColor || '#000000');
        const txtPicker = document.getElementById('menu-text-color-picker');
        const txtHex = document.getElementById('menu-text-color-hex');
        if (txtPicker) txtPicker.value = txtColor;
        if (txtHex) txtHex.value = txtColor;
    } else {
        const colorHex = rgb2hex(blockEl.dataset.color);
        const txtPicker = document.getElementById('menu-text-color-picker');
        const txtHex = document.getElementById('menu-text-color-hex');
        if (txtPicker) txtPicker.value = colorHex;
        if (txtHex) txtHex.value = colorHex;
    }
    const bgSection = document.getElementById('menu-button-bg-section');
    const navBgSection = document.getElementById('menu-nav-bg-section');
    if (bgSection) bgSection.classList.remove('hidden');
    if (blockEl.dataset.type === 'button') {
        const bgColor = rgb2hex(blockEl.dataset.color || '#374151');
        const bgPicker = document.getElementById('menu-button-bg-picker');
        const bgHex = document.getElementById('menu-button-bg-hex');
        if (bgPicker) bgPicker.value = bgColor;
        if (bgHex) bgHex.value = bgColor;
        if (bgSection) bgSection.classList.remove('hidden');
        if (navBgSection) navBgSection.classList.add('hidden');
    } else if (blockEl.dataset.type === 'nav') {
        const navColor = rgb2hex(blockEl.dataset.color || '#374151');
        const navPicker = document.getElementById('menu-nav-bg-picker');
        const navHex = document.getElementById('menu-nav-bg-hex');
        if (navPicker) navPicker.value = navColor;
        if (navHex) navHex.value = navColor;
        if (navBgSection) navBgSection.classList.remove('hidden');
    } else {
        if (navBgSection) navBgSection.classList.add('hidden');
    }
    const rect = handleEl.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 5;
    let left = rect.left + window.scrollX;

    menu.classList.remove('hidden');
    menu.classList.add('animate-fade-in');

    const menuRect = menu.getBoundingClientRect();
    if (left + menuRect.width > window.innerWidth) {
        left = window.innerWidth - menuRect.width - 10;
    }
    if (top + menuRect.height > window.innerHeight) {
        top = rect.top + window.scrollY - menuRect.height - 5;
        if (top < 0) top = 0;
    }
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    
    const radiusGroup = document.getElementById('menu-image-radius');
    const radiusSlider = document.getElementById('menu-radius-slider');
    const radiusVal = document.getElementById('menu-radius-value');
    if (blockEl.dataset.type === 'image') {
        if (radiusGroup) radiusGroup.classList.remove('hidden');
        if (radiusSlider) {
            radiusSlider.parentElement.classList.remove('hidden');
            radiusSlider.parentElement.classList.add('flex');
            radiusSlider.max = '100';
            radiusSlider.value = blockEl.dataset.radius || '0';
            radiusVal.textContent = `${radiusSlider.value}%`;
            radiusSlider.oninput = function () {
                const val = this.value;
                radiusVal.textContent = `${val}%`;
                blockEl.dataset.radius = val;
                const img = blockEl.querySelector('img');
                if (img) img.style.borderRadius = `${val}%`;
                syncBlocksToStateDebounced();
            };
        }
    } else {
        if (radiusGroup) radiusGroup.classList.add('hidden');
        if (radiusSlider) {
            radiusSlider.parentElement.classList.add('hidden');
            radiusSlider.parentElement.classList.remove('flex');
        }
    }
    
    const sizeGroup = document.getElementById('menu-image-size');
    const sizeSlider = document.getElementById('menu-size-slider');
    const sizeVal = document.getElementById('menu-size-value');
    if (sizeGroup) sizeGroup.classList.remove('hidden');
    if (sizeSlider) {
        sizeSlider.parentElement.classList.remove('hidden');
        sizeSlider.parentElement.classList.add('flex');
        sizeSlider.min = '10';
        sizeSlider.max = '100';
    }
    if (blockEl.dataset.type === 'image') {
        sizeSlider.value = blockEl.dataset.size || '100';
        sizeVal.textContent = `${sizeSlider.value}%`;
        sizeSlider.oninput = function () {
            let val = this.value;
            if (Number(val) > 100) val = '100';
            sizeVal.textContent = `${val}%`;
            blockEl.dataset.size = val;
            const img = blockEl.querySelector('img');
            if (img) img.style.width = `${val}%`;
            syncBlocksToStateDebounced();
        };
    } else {
        sizeSlider.value = '100';
        sizeVal.textContent = '100%';
        sizeSlider.oninput = null;
    }
    
    const cropBtn = document.getElementById('menu-crop-image');
    if (cropBtn) {
        cropBtn.classList.remove('hidden');
    }
    const scaleGroup = document.getElementById('separator-scale-container');
    const scaleSlider = document.getElementById('menu-separator-scale');
    if (blockEl.dataset.type === 'separator') {
        if (scaleGroup) scaleGroup.classList.remove('hidden');
        if (scaleSlider) {
            scaleSlider.value = blockEl.dataset.scale || '1';
            scaleSlider.oninput = function () {
                const val = this.value;
                blockEl.dataset.scale = val;
                const hr = blockEl.querySelector('hr');
                if (hr) {
                    hr.style.transform = `scaleY(${val})`;
                    hr.style.transformOrigin = 'center top';
                }
                syncBlocksToStateDebounced();
            };
        }
    } else {
        const navControls = document.getElementById('menu-nav-controls');
        if (blockEl.dataset.type === 'nav') {
            if (navControls) navControls.classList.remove('hidden');
        }
    }
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('block-menu');
    if (!menu.contains(e.target)) {
        menu.classList.add('hidden');
        menu.classList.remove('animate-fade-in');
        currentMenuBlock = null;
    }
});

function applyBlockColor(color) {
    if (!currentMenuBlock) return;
    const type = currentMenuBlock.dataset.type;
    if (type === 'text') {
        currentMenuBlock.dataset.color = color;
        const textEl = currentMenuBlock.querySelector('.text-content');
        if (textEl) textEl.style.color = color;
    } else if (type === 'button') {
        currentMenuBlock.dataset.txtColor = color;
        const btn = currentMenuBlock.querySelector('button');
        if (btn) btn.style.color = color;
    } else if (type === 'table') {
        currentMenuBlock.dataset.txtColor = color;
        const table = currentMenuBlock.querySelector('table');
        if (table) table.style.color = color;
    } else if (type === 'nav') {
        currentMenuBlock.dataset.color = color;
        const nav = currentMenuBlock.querySelector('nav');
        if (nav) nav.style.backgroundColor = color;
    }
    syncBlocksToStateDebounced();
}

function applyButtonBgColor(color) {
    if (!currentMenuBlock) return;
    const type = currentMenuBlock.dataset.type;
    if (type === 'button') {
        currentMenuBlock.dataset.color = color;
        const btn = currentMenuBlock.querySelector('button');
        if (btn) btn.style.backgroundColor = color;
    }
    syncBlocksToStateDebounced();
}

function applyNavLinkColor(color) {
    if (!currentMenuBlock) return;
    if (currentMenuBlock.dataset.type !== 'nav') {
        applyBlockColor(color);
        return;
    }
    currentMenuBlock.dataset.txtColor = color;
    const links = currentMenuBlock.querySelectorAll('a');
    links.forEach(a => a.style.color = color);
    syncBlocksToStateDebounced();
}

document.getElementById('menu-text-color-picker').addEventListener('input', (e) => {
    const color = e.target.value;
    document.getElementById('menu-text-color-hex').value = color;
    if (currentMenuBlock && currentMenuBlock.dataset.type === 'nav') {
        applyNavLinkColor(color);
    } else {
        applyBlockColor(color);
    }
});

document.getElementById('menu-text-color-hex').addEventListener('input', (e) => {
    const color = e.target.value;
    if (/^#[0-9A-Fa-f]{6}$/i.test(color)) {
        document.getElementById('menu-text-color-picker').value = color;
        if (currentMenuBlock && currentMenuBlock.dataset.type === 'nav') {
            applyNavLinkColor(color);
        } else {
            applyBlockColor(color);
        }
    }
});

document.getElementById('menu-button-bg-picker').addEventListener('input', (e) => {
    const color = e.target.value;
    document.getElementById('menu-button-bg-hex').value = color;
    applyButtonBgColor(color);
});

document.getElementById('menu-button-bg-hex').addEventListener('input', (e) => {
    const color = e.target.value;
    if (/^#[0-9A-Fa-f]{6}$/i.test(color)) {
        document.getElementById('menu-button-bg-picker').value = color;
        applyButtonBgColor(color);
    }
});

document.getElementById('menu-nav-bg-picker').addEventListener('input', (e) => {
    const color = e.target.value;
    document.getElementById('menu-nav-bg-hex').value = color;
    applyBlockColor(color);
});

document.getElementById('menu-nav-bg-hex').addEventListener('input', (e) => {
    const color = e.target.value;
    if (/^#[0-9A-Fa-f]{6}$/i.test(color)) {
        document.getElementById('menu-nav-bg-picker').value = color;
        applyBlockColor(color);
    }
});

['left', 'center', 'right'].forEach(align => {
    document.getElementById(`menu-align-${align}`).addEventListener('click', () => {
        if (!currentMenuBlock) return;
        currentMenuBlock.dataset.align = align;
        const type = currentMenuBlock.dataset.type;
        if(type === 'text') {
            const textEl = currentMenuBlock.querySelector('.text-content');
            if (textEl) textEl.style.textAlign = align;
        } else if(type === 'image') {
            const imgEl = currentMenuBlock.querySelector('img');
            if(imgEl) {
                imgEl.className = `max-w-full rounded block object-contain ${align === 'left' ? 'mr-auto ml-0' : align === 'right' ? 'ml-auto mr-0' : 'mx-auto'} shadow-sm`;
            }
            const container = currentMenuBlock.querySelector('.image-content');
            if(container) container.style.textAlign = align;
        }
        syncBlocksToStateDebounced();
    });
});

document.getElementById('menu-delete').addEventListener('click', () => {
    if (!currentMenuBlock) return;
    if (state.previewMode) return;
    const allBlocks = document.querySelectorAll('.block-wrapper');
    const imageBlocks = document.querySelectorAll('.block-wrapper[data-type="image"]');
    const buttonBlocks = document.querySelectorAll('.block-wrapper[data-type="button"]');
    const todoBlocks = document.querySelectorAll('.block-wrapper[data-type="todo"]');
    // Prevent deleting the only remaining text block
    if (allBlocks.length === 1 && currentMenuBlock.dataset.type === 'text') {
        return;
    }
    // Prevent deleting the last image block
    if (imageBlocks.length === 1 && currentMenuBlock.dataset.type === 'image') {
        alert('此頁面只能保留最後一張圖片，無法刪除。');
        return;
    }
    // Prevent deleting the last button block
    if (buttonBlocks.length === 1 && currentMenuBlock.dataset.type === 'button') {
        alert('此頁面只能保留最後一個按鈕，無法刪除。');
        return;
    }
    // Prevent deleting the last todo block
    if (todoBlocks.length === 1 && currentMenuBlock.dataset.type === 'todo') {
        alert('此頁面只能保留最後一個代辦事項，無法刪除。');
        return;
    }
    currentMenuBlock.remove();
    document.getElementById('block-menu').classList.add('hidden');
    syncBlocksToState();
});

(() => {
  const turnImageBtn = document.getElementById('menu-turn-image');
  if (turnImageBtn && !document.getElementById('menu-crop-image')) {
    const cropBtn = document.createElement('button');
    cropBtn.id = 'menu-crop-image';
    cropBtn.className = 'px-2 py-1.5 hover:bg-gray-50 rounded-md text-gray-600 flex items-center justify-center gap-1.5 transition-colors';
    cropBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" class="text-gray-400"><path fill="currentColor" d="M2 2h12v2H2V2zm0 4h12v2H2V6zm0 4h12v2H2v-2z"/></svg> 裁切';
    turnImageBtn.insertAdjacentElement('afterend', cropBtn);
  }
})();

document.getElementById('menu-crop-image')?.addEventListener('click', () => {
  if (!currentMenuBlock) return;
  if (currentMenuBlock.dataset.type !== 'image') return;
  const img = currentMenuBlock.querySelector('img');
  if (img) openCropModal(img);
});

function openCropModal(imgEl) {
  let overlay = document.getElementById('crop-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'crop-overlay';
    overlay.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 hidden';
    overlay.innerHTML = `
        <div class="bg-white p-4 rounded-md flex flex-col items-center relative">
          <div id="crop-dimensions" class="absolute top-2 left-2 text-xs bg-black/60 text-white px-1 rounded hidden"></div>
          <canvas id="crop-canvas" class="max-w-full max-h-[80vh] border border-gray-300"></canvas>
          <div class="flex mt-2 gap-2">
            <button id="crop-confirm" class="px-3 py-1 bg-blue-600 text-white rounded">裁切</button>
            <button id="crop-cancel" class="px-3 py-1 bg-gray-300 text-black rounded">取消</button>
            <button id="crop-reset" class="px-3 py-1 bg-yellow-600 text-white rounded">重設</button>
            <button id="crop-lock" class="px-3 py-1 bg-gray-300 text-black rounded">鎖定比例</button>
          </div>
        </div>`;
    document.body.appendChild(overlay);
  }
  const canvas = overlay.querySelector('#crop-canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.crossOrigin = 'anonymous';

  const MAX_DIM = 800;
  let imageScale = 1;

  img.onload = () => {
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    imageScale = Math.min(1, MAX_DIM / naturalW, MAX_DIM / naturalH);
    canvas.width = Math.round(naturalW * imageScale);
    canvas.height = Math.round(naturalH * imageScale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    selection = null;
  };
  img.src = imgEl.src;

  let isDrawing = false;
  let isMoving = false;
  let isResizing = false;
  let startX = 0, startY = 0;
  let moveOffsetX = 0, moveOffsetY = 0;
  let resizeCorner = null;
  let orig = null;
  let selection = null;
  let lockAspect = false;

  const HANDLE_SIZE = 8;

  function constrainSelection() {
    if (!selection) return;
    if (selection.x < 0) selection.x = 0;
    if (selection.y < 0) selection.y = 0;
    if (selection.x + selection.w > canvas.width) selection.x = canvas.width - selection.w;
    if (selection.y + selection.h > canvas.height) selection.y = canvas.height - selection.h;
    if (selection.w > canvas.width) selection.w = canvas.width;
    if (selection.h > canvas.height) selection.h = canvas.height;
  }

  function drawSelection() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (selection) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(selection.x, selection.y, selection.w, selection.h);
      ctx.fill('evenodd');
      ctx.restore();

      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      ctx.fillStyle = 'rgba(255,0,0,0.2)';
      ctx.fillRect(selection.x, selection.y, selection.w, selection.h);

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 1;
      const half = HANDLE_SIZE / 2;
      const corners = [
        { x: selection.x, y: selection.y },
        { x: selection.x + selection.w, y: selection.y },
        { x: selection.x, y: selection.y + selection.h },
        { x: selection.x + selection.w, y: selection.y + selection.h },
      ];
      corners.forEach(c => {
        ctx.fillRect(c.x - half, c.y - half, HANDLE_SIZE, HANDLE_SIZE);
        ctx.strokeRect(c.x - half, c.y - half, HANDLE_SIZE, HANDLE_SIZE);
      });
      // 更新尺寸顯示 (原始影像尺寸)
      const dimEl = overlay.querySelector('#crop-dimensions');
      if (dimEl) {
        const origW = Math.round(selection.w / imageScale);
        const origH = Math.round(selection.h / imageScale);
        dimEl.textContent = `${origW}×${origH}`;
        dimEl.classList.remove('hidden');
      }
    } else {
        const dimEl = overlay.querySelector('#crop-dimensions');
        if (dimEl) dimEl.classList.add('hidden');
    }
  }

  canvas.onmousedown = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (selection) {
      const half = HANDLE_SIZE / 2;
      const corners = {
        nw: { x: selection.x, y: selection.y },
        ne: { x: selection.x + selection.w, y: selection.y },
        sw: { x: selection.x, y: selection.y + selection.h },
        se: { x: selection.x + selection.w, y: selection.y + selection.h },
      };
      for (const [corner, pos] of Object.entries(corners)) {
        if (Math.abs(x - pos.x) <= half && Math.abs(y - pos.y) <= half) {
          isResizing = true;
          resizeCorner = corner;
          orig = { x: selection.x, y: selection.y, w: selection.w, h: selection.h };
          return;
        }
      }

      if (x >= selection.x && x <= selection.x + selection.w && y >= selection.y && y <= selection.y + selection.h) {
        isMoving = true;
        moveOffsetX = x - selection.x;
        moveOffsetY = y - selection.y;
        return;
      }
    }

    isDrawing = true;
    startX = x;
    startY = y;
    selection = { x: startX, y: startY, w: 0, h: 0 };
  };

  canvas.onmousemove = (e) => {
    if (!isDrawing && !isMoving && !isResizing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isDrawing) {
      let w = x - startX;
      let h = y - startY;
      if (e.shiftKey || lockAspect) {
        const side = Math.max(Math.abs(w), Math.abs(h));
        w = w < 0 ? -side : side;
        h = h < 0 ? -side : side;
      }
      selection.w = w;
      selection.h = h;
    } else if (isMoving) {
      selection.x = x - moveOffsetX;
      selection.y = y - moveOffsetY;
    } else if (isResizing && orig) {
      switch (resizeCorner) {
        case 'nw':
          selection.x = x;
          selection.y = y;
          selection.w = orig.x + orig.w - x;
          selection.h = orig.y + orig.h - y;
          break;
        case 'ne':
          selection.y = y;
          selection.w = x - orig.x;
          selection.h = orig.y + orig.h - y;
          break;
        case 'sw':
          selection.x = x;
          selection.w = orig.x + orig.w - x;
          selection.h = y - orig.y;
          break;
        case 'se':
          selection.w = x - orig.x;
          selection.h = y - orig.y;
          break;
      }
    }

    if (selection.w < 0) {
      selection.x += selection.w;
      selection.w = Math.abs(selection.w);
    }
    if (selection.h < 0) {
      selection.y += selection.h;
      selection.h = Math.abs(selection.h);
    }

    constrainSelection();
    drawSelection();
  };

  canvas.onmouseup = () => {
    isDrawing = false;
    isMoving = false;
    isResizing = false;
    resizeCorner = null;
    orig = null;
  };

  canvas.onmouseleave = () => {
    if (isDrawing) isDrawing = false;
    if (isMoving) isMoving = false;
    if (isResizing) isResizing = false;
  };

  overlay.querySelector('#crop-confirm').onclick = () => {
    if (!selection || selection.w === 0 || selection.h === 0) {
      alert('請先選取裁切範圍');
      return;
    }
    const srcX = Math.round(selection.x / imageScale);
    const srcY = Math.round(selection.y / imageScale);
    const srcW = Math.round(selection.w / imageScale);
    const srcH = Math.round(selection.h / imageScale);
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = srcW;
    tempCanvas.height = srcH;
    const tctx = tempCanvas.getContext('2d');
    tctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
    const croppedData = tempCanvas.toDataURL();
    imgEl.src = croppedData;
    if (currentMenuBlock) {
      currentMenuBlock.dataset.content = croppedData;
    }
    syncBlocksToStateDebounced();
    closeCropOverlay();
  };

  overlay.querySelector('#crop-cancel').onclick = closeCropOverlay;
  overlay.querySelector('#crop-reset').onclick = () => {
    selection = null;
    drawSelection();
  };
  // 鎖定比例切換
  overlay.querySelector('#crop-lock').onclick = () => {
    lockAspect = !lockAspect;
    const btn = overlay.querySelector('#crop-lock');
    if (lockAspect) {
      btn.classList.remove('bg-gray-300','text-black');
      btn.classList.add('bg-blue-600','text-white');
    } else {
      btn.classList.remove('bg-blue-600','text-white');
      btn.classList.add('bg-gray-300','text-black');
    }
  };

  function closeCropOverlay() {
    overlay.classList.add('hidden');
    canvas.onmousedown = null;
    canvas.onmousemove = null;
    canvas.onmouseup = null;
    canvas.onmouseleave = null;
  }

  overlay.classList.remove('hidden');
}

const cellTextPicker = document.getElementById('cell-text-color-picker');
if (cellTextPicker) {
    cellTextPicker.addEventListener('input', (e) => {
        if (currentCell) {
            const color = e.target.value;
            document.getElementById('cell-text-color-hex').value = color;
            currentCell.style.color = color;
            syncBlocksToStateDebounced();
        }
    });
    const cellTextHex = document.getElementById('cell-text-color-hex');
    if (cellTextHex) {
        cellTextHex.addEventListener('input', (e) => {
            const color = e.target.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(color) && currentCell) {
                document.getElementById('cell-text-color-picker').value = color;
                currentCell.style.color = color;
                syncBlocksToStateDebounced();
            }
        });
    }
}

const cellBgPicker = document.getElementById('cell-bg-color-picker');
if (cellBgPicker) {
    cellBgPicker.addEventListener('input', (e) => {
        if (currentCell) {
            const color = e.target.value;
            document.getElementById('cell-bg-color-hex').value = color;
            currentCell.style.backgroundColor = color;
            syncBlocksToStateDebounced();
        }
    });
    const cellBgHex = document.getElementById('cell-bg-color-hex');
    if (cellBgHex) {
        cellBgHex.addEventListener('input', (e) => {
            const color = e.target.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(color) && currentCell) {
                document.getElementById('cell-bg-color-picker').value = color;
                currentCell.style.backgroundColor = color;
                syncBlocksToStateDebounced();
            }
        });
    }
}

document.addEventListener('click', (e) => {
    const picker = document.getElementById('cell-color-picker');
    if (!picker) return;
    if (!picker.contains(e.target) && (!currentCell || !currentCell.contains(e.target))) {
        picker.classList.add('hidden');
        currentCell = null;
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const picker = document.getElementById('cell-color-picker');
        if (picker) picker.classList.add('hidden');
        currentCell = null;
    }
});

function showCellColorPicker(cell) {
    currentCell = cell;
    const picker = document.getElementById('cell-color-picker');
    if (!picker) return;
    picker.classList.remove('hidden');
    picker.style.display = 'block';
    picker.style.minWidth = '150px';
    picker.style.minHeight = '80px';
    picker.style.width = '150px';
    picker.style.height = '80px';
    picker.offsetWidth;
    setTimeout(() => {
        const rect = cell.getBoundingClientRect();
        let top = rect.bottom + 5;
        let left = rect.left;
        picker.style.top = `${top}px`;
        picker.style.left = `${left}px`;
        let pickerRect = picker.getBoundingClientRect();
        if (top + pickerRect.height > window.innerHeight) {
            top = Math.max(0, rect.top - pickerRect.height - 5);
            picker.style.top = `${top}px`;
        }
        if (left + pickerRect.width > window.innerWidth) {
            left = Math.max(0, window.innerWidth - pickerRect.width - 5);
            picker.style.left = `${left}px`;
        }
        const txtPicker = document.getElementById('cell-text-color-picker');
        const txtHex = document.getElementById('cell-text-color-hex');
        const bgPicker = document.getElementById('cell-bg-color-picker');
        const bgHex = document.getElementById('cell-bg-color-hex');
        const computed = window.getComputedStyle(cell);
        const txtColor = rgb2hex(computed.color);
        const bgColor = rgb2hex(computed.backgroundColor);
        if (txtPicker) txtPicker.value = txtColor;
        if (txtHex) txtHex.value = txtColor;
        if (bgPicker) bgPicker.value = bgColor;
        if (bgHex) bgHex.value = bgColor;
    });
}

document.getElementById('menu-set-id').addEventListener('click', () => {
    if (!currentMenuBlock) return;
    const current = currentMenuBlock.dataset.id || '';
    const id = prompt('請輸入此區塊的 ID（留空則取消）', current);
    if (id !== null) {
        const trimmed = id.trim();
        if (trimmed) {
            currentMenuBlock.dataset.id = trimmed;
            const delBtn = document.getElementById('menu-delete');
            if (delBtn) delBtn.classList.add('hidden');
        } else {
            delete currentMenuBlock.dataset.id;
            const delBtn = document.getElementById('menu-delete');
            if (delBtn) delBtn.classList.remove('hidden');
        }
        syncBlocksToStateDebounced();
    }
});

document.getElementById('menu-layout-single').addEventListener('click', () => {
    if (!currentMenuBlock) return;
    currentMenuBlock.dataset.layout = 'single';
    const classesToRemove = Array.from(currentMenuBlock.classList).filter(c => c.startsWith('col-span-') || ['bg-white','border','border-gray-100','rounded-xl','shadow-sm','p-4','hover:shadow-md','card-layout'].includes(c));
    if (classesToRemove.length) currentMenuBlock.classList.remove(...classesToRemove);
    currentMenuBlock.classList.add('col-span-12');
    syncBlocksToStateDebounced();
    document.getElementById('block-menu').classList.add('hidden');
});

document.getElementById('menu-layout-double').addEventListener('click', () => {
    if (!currentMenuBlock) return;
    currentMenuBlock.dataset.layout = 'double';
    const classesToRemove = Array.from(currentMenuBlock.classList).filter(c => c.startsWith('col-span-') || ['bg-white','border','border-gray-100','rounded-xl','shadow-sm','p-4','hover:shadow-md','card-layout'].includes(c));
    if (classesToRemove.length) currentMenuBlock.classList.remove(...classesToRemove);
    currentMenuBlock.classList.add('col-span-12', 'md:col-span-6');
    syncBlocksToStateDebounced();
    document.getElementById('block-menu').classList.add('hidden');
});

document.getElementById('menu-layout-card').addEventListener('click', () => {
    if (!currentMenuBlock) return;
    currentMenuBlock.dataset.layout = 'card';
    const classesToRemove = Array.from(currentMenuBlock.classList).filter(c => c.startsWith('col-span-') || ['bg-white','border','border-gray-100','rounded-xl','shadow-sm','p-4','hover:shadow-md','card-layout'].includes(c));
    if (classesToRemove.length) currentMenuBlock.classList.remove(...classesToRemove);
    currentMenuBlock.classList.add('col-span-12', 'md:col-span-4', 'bg-white','border','border-gray-100','rounded-xl','shadow-sm','p-4','hover:shadow-md','transition-shadow','card-layout');
    syncBlocksToStateDebounced();
    document.getElementById('block-menu').classList.add('hidden');
});

function getNavItems(blockEl) {
    try {
        return JSON.parse(blockEl.dataset.nav || '[]');
    } catch (e) {
        console.error('Failed to parse nav data', e);
        return [];
    }
}
function setNavItems(blockEl, items) {
    blockEl.dataset.nav = JSON.stringify(items);
    const contentDiv = blockEl.querySelector('.content');
    if (contentDiv) {
        contentDiv.innerHTML = renderNav(blockEl);
        const links = contentDiv.querySelectorAll('a');
        links.forEach(a => a.addEventListener('input', syncBlocksToStateDebounced));
    }
    syncBlocksToStateDebounced();
}
function renderNav(blockEl) {
    let navItems = [];
    try {
        navItems = JSON.parse(blockEl.dataset.nav || '[]');
    } catch (e) {
        console.error('Invalid nav data', e);
    }
    const navHtml = navItems.map((item) => {
        const icon = item.icon ? `<img src="${item.icon}" class="w-4 h-4 inline-block mr-1 align-middle" />` : '';
        const href = item.link ? `href="#" data-link="${escapeHtml(item.link)}"` : 'href="#"';
        const label = escapeHtml(item.label || '');
        const txtStyle = blockEl.dataset.txtColor ? `color:${blockEl.dataset.txtColor};` : '';
        return `<a ${href} class="text-gray-600 hover:text-gray-900 flex items-center space-x-1" style="${txtStyle}" contenteditable="${!state.previewMode}">${icon}<span>${label}</span></a>`;
    }).join('');
    const bgStyle = blockEl.dataset.color ? `background-color:${blockEl.dataset.color};` : '';
    return `<nav class="flex flex-row justify-end space-x-2 items-center py-8" style="${bgStyle}">${navHtml}</nav>`;
}

document.getElementById('menu-nav-add')?.addEventListener('click', () => {
    if (!currentMenuBlock) return;
    let label = prompt('請輸入按鈕文字 (Label)：', '新按鈕');
    if (label === null) return;
    label = label.trim() || '新按鈕';
    const pageInput = prompt('請輸入要連結的頁面標題（或外部網址），留空則無連結：', '');
    let link = '';
    if (pageInput !== null && pageInput.trim() !== '') {
        const raw = pageInput.trim();
        const isExternal = /^(https?:\/\/|mailto:|tel:)/i.test(raw);
        if (isExternal) {
            link = raw;
        } else {
            const lower = raw.toLowerCase();
            const matches = state.pages.filter(p => (p.title || '').toLowerCase().includes(lower));
            if (matches.length === 1) {
                link = matches[0].id;
            } else if (matches.length > 1) {
                alert('找到多個符合的頁面，請輸入更精確的標題。');
            } else {
                alert('找不到對應的頁面，請確認輸入正確。');
            }
        }
    }
    const items = getNavItems(currentMenuBlock);
    items.push({ label, link, icon: '' });
    setNavItems(currentMenuBlock, items);
});
document.getElementById('menu-nav-remove')?.addEventListener('click', () => {
    if (!currentMenuBlock) return;
    const items = getNavItems(currentMenuBlock);
    if (items.length === 0) return;
    if (items.length === 1 && !confirm('這是最後一個導覽按鈕，確定要刪除嗎？')) return;
    items.pop();
    setNavItems(currentMenuBlock, items);
});

document.getElementById('menu-turn-image').addEventListener('click', () => {
    if (!currentMenuBlock || currentMenuBlock.dataset.type === 'image') return;
    const newBlock = { id: currentMenuBlock.dataset.id, type: 'image', content: '', color: currentMenuBlock.dataset.color, align: currentMenuBlock.dataset.align, layout: currentMenuBlock.dataset.layout, link: currentMenuBlock.dataset.link, animate: currentMenuBlock.dataset.animate, radius: currentMenuBlock.dataset.radius || '0', size: currentMenuBlock.dataset.size || '100' };
    const newEl = createBlockElement(newBlock);
    copyLayoutClasses(currentMenuBlock, newEl);
    currentMenuBlock.replaceWith(newEl);
    document.getElementById('block-menu').classList.add('hidden');
    syncBlocksToState();
});

document.getElementById('menu-turn-text').addEventListener('click', () => {
    if (!currentMenuBlock || currentMenuBlock.dataset.type === 'text') return;
    const newBlock = { id: currentMenuBlock.dataset.id, type: 'text', content: '', color: currentMenuBlock.dataset.color, align: currentMenuBlock.dataset.align, layout: currentMenuBlock.dataset.layout, link: currentMenuBlock.dataset.link, animate: currentMenuBlock.dataset.animate };
    const newEl = createBlockElement(newBlock);
    copyLayoutClasses(currentMenuBlock, newEl);
    currentMenuBlock.replaceWith(newEl);
    document.getElementById('block-menu').classList.add('hidden');
    syncBlocksToState();
});

document.getElementById('menu-turn-todo').addEventListener('click', () => {
    if (!currentMenuBlock) return;
    const newBlock = { id: currentMenuBlock.dataset.id, type: 'todo', content: '', color: currentMenuBlock.dataset.color, align: currentMenuBlock.dataset.align, layout: currentMenuBlock.dataset.layout, link: currentMenuBlock.dataset.link, animate: currentMenuBlock.dataset.animate };
    const newEl = createBlockElement(newBlock);
    copyLayoutClasses(currentMenuBlock, newEl);
    currentMenuBlock.replaceWith(newEl);
    document.getElementById('block-menu').classList.add('hidden');
    syncBlocksToState();
});

document.getElementById('menu-turn-divider-dash').addEventListener('click', () => {
    if (currentMenuBlock) {
        const newBlock = { id: currentMenuBlock.dataset.id, type: 'separator', style: 'dashed', color: currentMenuBlock.dataset.color, align: currentMenuBlock.dataset.align, layout: currentMenuBlock.dataset.layout, link: currentMenuBlock.dataset.link, animate: currentMenuBlock.dataset.animate };
        const newEl = createBlockElement(newBlock);
        copyLayoutClasses(currentMenuBlock, newEl);
        currentMenuBlock.replaceWith(newEl);
    } else {
        let page = state.pages.find(p => p.id === state.activePageId);
        if (state.previewMode && state.previewPage && state.previewPage.id === state.activePageId) {
            page = state.previewPage;
        }
        if (!page) return;
        const newId = generateId();
        const newBlock = { id: newId, type: 'separator', style: 'dashed', color: '#374151', align: 'left', layout: state.layout || 'single', link: '', animate: '' };
        page.blocks.push(newBlock);
        saveState();
        renderMain();
    }
    document.getElementById('block-menu').classList.add('hidden');
    syncBlocksToState();
});

document.getElementById('menu-turn-divider-dot').addEventListener('click', () => {
    if (currentMenuBlock) {
        const newBlock = { id: currentMenuBlock.dataset.id, type: 'separator', style: 'dotted', color: currentMenuBlock.dataset.color, align: currentMenuBlock.dataset.align, layout: currentMenuBlock.dataset.layout, link: currentMenuBlock.dataset.link, animate: currentMenuBlock.dataset.animate };
        const newEl = createBlockElement(newBlock);
        copyLayoutClasses(currentMenuBlock, newEl);
        currentMenuBlock.replaceWith(newEl);
    } else {
        let page = state.pages.find(p => p.id === state.activePageId);
        if (state.previewMode && state.previewPage && state.previewPage.id === state.activePageId) {
            page = state.previewPage;
        }
        if (!page) return;
        const newId = generateId();
        const newBlock = { id: newId, type: 'separator', style: 'dotted', color: '#374151', align: 'left', layout: state.layout || 'single', link: '', animate: '' };
        page.blocks.push(newBlock);
        saveState();
        renderMain();
    }
    document.getElementById('block-menu').classList.add('hidden');
    syncBlocksToState();
});

document.getElementById('menu-turn-divider-solid').addEventListener('click', () => {
    if (currentMenuBlock) {
        const newBlock = { id: currentMenuBlock.dataset.id, type: 'separator', style: 'solid', color: currentMenuBlock.dataset.color, align: currentMenuBlock.dataset.align, layout: currentMenuBlock.dataset.layout, link: currentMenuBlock.dataset.link, animate: currentMenuBlock.dataset.animate };
        const newEl = createBlockElement(newBlock);
        copyLayoutClasses(currentMenuBlock, newEl);
        currentMenuBlock.replaceWith(newEl);
    } else {
        let page = state.pages.find(p => p.id === state.activePageId);
        if (state.previewMode && state.previewPage && state.previewPage.id === state.activePageId) {
            page = state.previewPage;
        }
        if (!page) return;
        const newId = generateId();
        const newBlock = { id: newId, type: 'separator', style: 'solid', color: '#374151', align: 'left', layout: state.layout || 'single', link: '', animate: '' };
        page.blocks.push(newBlock);
        saveState();
        renderMain();
    }
    document.getElementById('block-menu').classList.add('hidden');
    syncBlocksToState();
});

document.getElementById('menu-turn-table').addEventListener('click', () => {
    let rows = parseInt(prompt('請輸入表格列數 (rows):', '3'));
    let cols = parseInt(prompt('請輸入表格欄數 (columns):', '3'));
    if (isNaN(rows) || rows <= 0) rows = 1;
    if (isNaN(cols) || cols <= 0) cols = 1;
    let tableHTML = '<table class="w-full border-collapse" style="border:1px solid #e5e7eb;">';
    for (let r = 0; r < rows; r++) {
        tableHTML += '<tr>';
        for (let c = 0; c < cols; c++) {
            tableHTML += `<td class="border p-1 align-top" style="border:1px solid #e5e7eb; min-width:2rem; min-height:1.5rem;" contenteditable="${!state.previewMode}">&nbsp;</td>`;
        }
        tableHTML += '</tr>';
    }
    tableHTML += '</table>';
    if (currentMenuBlock) {
        const newBlock = { id: currentMenuBlock.dataset.id, type: 'table', content: tableHTML, color: currentMenuBlock.dataset.color, align: currentMenuBlock.dataset.align, layout: currentMenuBlock.dataset.layout, link: currentMenuBlock.dataset.link, animate: currentMenuBlock.dataset.animate, txtColor: currentMenuBlock.dataset.txtColor || '#000000' };
        const newEl = createBlockElement(newBlock);
        copyLayoutClasses(currentMenuBlock, newEl);
        currentMenuBlock.replaceWith(newEl);
    } else {
        let page = state.pages.find(p => p.id === state.activePageId);
        if (state.previewMode && state.previewPage && state.previewPage.id === state.activePageId) {
            page = state.previewPage;
        }
        if (!page) return;
        const newId = generateId();
        const newBlock = { id: newId, type: 'table', content: tableHTML, color: '#374151', align: 'left', layout: state.layout || 'single', link: '', animate: '', txtColor: '#000000' };
        page.blocks.push(newBlock);
        saveState();
        renderMain();
    }
    document.getElementById('block-menu').classList.add('hidden');
    syncBlocksToState();
});

document.getElementById('menu-turn-nav').addEventListener('click', () => {
    let page = state.pages.find(p => p.id === state.activePageId);
    if (state.previewMode && state.previewPage && state.previewPage.id === state.activePageId) {
        page = state.previewPage;
    }
    const navExists = page && page.blocks.some(b => b.type === 'nav');
    if (navExists && (!currentMenuBlock || currentMenuBlock.dataset.type !== 'nav')) {
        alert('已經有一個導覽列，請先移除或編輯現有的導覽列。');
        document.getElementById('block-menu').classList.add('hidden');
        return;
    }
    const defaultNavData = JSON.stringify([]);
    if (currentMenuBlock) {
        const newBlock = { id: currentMenuBlock.dataset.id, type: 'nav', content: '', nav: currentMenuBlock.dataset.nav || defaultNavData, color: currentMenuBlock.dataset.color, align: currentMenuBlock.dataset.align, layout: currentMenuBlock.dataset.layout, link: currentMenuBlock.dataset.link, animate: currentMenuBlock.dataset.animate };
        const newEl = createBlockElement(newBlock);
        copyLayoutClasses(currentMenuBlock, newEl);
        currentMenuBlock.replaceWith(newEl);
    } else {
        if (!page) return;
        const newId = generateId();
        const newBlock = { id: newId, type: 'nav', content: '', nav: defaultNavData, color: '#374151', align: 'left', layout: state.layout || 'single', link: '', animate: '' };
        page.blocks.push(newBlock);
        saveState();
        renderMain();
    }
    document.getElementById('block-menu').classList.add('hidden');
    syncBlocksToState();
});

document.getElementById('menu-turn-button').addEventListener('click', () => {
    if (!currentMenuBlock) return;
    const label = prompt('請輸入按鈕文字:', '按鈕');
    if (label === null) return;
    let txtColor = currentMenuBlock.dataset.txtColor || '#000000';
    const current = currentMenuBlock.dataset.link || '';
    const pageList = state.pages
        .filter(p => p.title && p.title.trim())
        .map(p => p.title)
        .join('\n');
    const input = prompt(`請輸入要連結的頁面標題（或關鍵字），或外部網址：\n${pageList}`, current);
    let link = '';
    if (input !== null) {
        const trimmed = input.trim();
        const isExternal = /^(https?:\/\/|mailto:|tel:)/i.test(trimmed);
        if (isExternal) {
            link = trimmed;
        } else {
            const lower = trimmed.toLowerCase();
            const matchedPages = state.pages.filter(p => (p.title || '').toLowerCase().includes(lower));
            if (matchedPages.length === 1) {
                link = matchedPages[0].id;
            } else if (matchedPages.length > 1) {
                alert('找到多個符合的頁面，請輸入更精確的標題。');
                return;
            } else {
                alert('找不到對應的頁面標題，請確認輸入正確。');
                return;
            }
        }
    }
    const newBlock = {
        id: currentMenuBlock.dataset.id,
        type: 'button',
        content: label.trim(),
        color: currentMenuBlock.dataset.color,
        align: currentMenuBlock.dataset.align,
        layout: currentMenuBlock.dataset.layout,
        txtColor: txtColor,
        link: link,
        animate: currentMenuBlock.dataset.animate
    };
    const newEl = createBlockElement(newBlock);
    copyLayoutClasses(currentMenuBlock, newEl);
    currentMenuBlock.replaceWith(newEl);
    document.getElementById('block-menu').classList.add('hidden');
    syncBlocksToState();
    if (link && state.pages.some(p => p.id === link)) {
        state.activePageId = link;
        saveState();
        renderSidebar();
        renderMain();
    }
});

['h1','h2','h3','p'].forEach(tag => {
    const btn = document.getElementById(`menu-heading-${tag}`);
    if (btn) {
        btn.addEventListener('click', () => {
            if (!currentMenuBlock) return;
            const contentEl = currentMenuBlock.querySelector('.text-content');
            const content = contentEl ? contentEl.innerHTML : '';
            const newBlock = {
                id: currentMenuBlock.dataset.id,
                type: 'text',
                content: content,
                color: currentMenuBlock.dataset.color,
                align: currentMenuBlock.dataset.align,
                heading: tag, 
                layout: currentMenuBlock.dataset.layout, 
                link: currentMenuBlock.dataset.link, 
                animate: currentMenuBlock.dataset.animate
            };
            const newEl = createBlockElement(newBlock);
            copyLayoutClasses(currentMenuBlock, newEl);
            currentMenuBlock.replaceWith(newEl);
            document.getElementById('block-menu').classList.add('hidden');
            syncBlocksToState();
        });
    }
});

['fade','scale','bounce'].forEach(anim => {
    const btn = document.getElementById(`menu-animate-${anim}`);
    if (btn) {
        btn.addEventListener('click', () => {
            if (!currentMenuBlock) return;
            const mapping = { fade: 'animate-fade-in', scale: 'animate-scale-in', bounce: 'animate-bounce-in' };
            currentMenuBlock.dataset.animate = mapping[anim];
            currentMenuBlock.classList.remove('animate-fade-in', 'animate-scale-in', 'animate-bounce-in');
            void currentMenuBlock.offsetWidth;
            currentMenuBlock.classList.add(mapping[anim]);
            syncBlocksToStateDebounced();
            document.getElementById('block-menu').classList.add('hidden');
        });
    }
});

['bold','italic','underline'].forEach(action => {
    const btn = document.getElementById(`menu-${action}`);
    if (btn) {
        btn.addEventListener('click', () => {
            if (!currentMenuBlock) return;
            if (currentMenuBlock.dataset.type !== 'text') return;
            const textEl = currentMenuBlock.querySelector('.text-content');
            if (!textEl) return;
            textEl.focus();
            if (action === 'bold') {
                document.execCommand('bold');
            } else if (action === 'italic') {
                document.execCommand('italic');
            } else if (action === 'underline') {
                document.execCommand('underline');
            }
            syncBlocksToStateDebounced();
            document.getElementById('block-menu').classList.add('hidden');
        });
    }
});

const linkBtn = document.getElementById('menu-pageid');
if (linkBtn) {
    linkBtn.addEventListener('click', () => {
        if (!currentMenuBlock) return;
        const current = currentMenuBlock.dataset.link || '';
        const defaultVal = /^(https?:\/\/|mailto:|tel:)/i.test(current) ? current : '';
        const input = prompt(`請輸入外部網址：`, defaultVal);
        if (input !== null) {
            const trimmed = input.trim();
            const isValid = /^(https?:\/\/|mailto:|tel:)/i.test(trimmed);
            if (!isValid) {
                alert('請輸入有效的外部連結（http/https、mailto、tel）。');
                return;
            }
            currentMenuBlock.dataset.link = trimmed;
            if (trimmed) {
                currentMenuBlock.classList.add('has-link');
            } else {
                currentMenuBlock.classList.remove('has-link');
            }
            syncBlocksToStateDebounced();
        }
        document.getElementById('block-menu').classList.add('hidden');
    });
}

/* --- BGM Logic --- */
const bgmUpload = document.getElementById('bgm-upload');
if (bgmUpload) {
    bgmUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(file) {
            if(file.size > 10 * 1024 * 1024) {
                alert('音樂檔案過大，請選擇小於 10MB 的檔案。');
                return;
            }
            const reader = new FileReader();
            reader.onload = async (ev) => {
                state.bgm = ev.target.result;
                state.bgmYT = null;
                await saveState();
                loadBGM();
            };
            reader.readAsDataURL(file);
        }
        bgmUpload.value = '';
    });
}

const bgmYTSetBtn = document.getElementById('bgm-youtube-set');
if (bgmYTSetBtn) {
    bgmYTSetBtn.addEventListener('click', async () => {
        const urlInput = document.getElementById('bgm-youtube-input');
        const emptyMsg = document.getElementById('bgm-empty');
        const url = urlInput ? urlInput.value.trim() : '';
        const videoId = extractYouTubeID(url);
        if (!videoId) {
            if (emptyMsg) {
                emptyMsg.textContent = '此影片無法嵌入，請輸入有效的 YouTube 連結';
                emptyMsg.classList.remove('hidden');
            }
            state.bgmYT = null;
            await saveState();
            loadBGM();
            return;
        }

        const originalText = bgmYTSetBtn.textContent;
        bgmYTSetBtn.textContent = '...';
        bgmYTSetBtn.disabled = true;

        const canEmbed = await validateYouTubeVideo(videoId);

        bgmYTSetBtn.textContent = originalText;
        bgmYTSetBtn.disabled = false;

        if (canEmbed) {
            state.bgmYT = videoId;
            state.bgm = null;
            if (urlInput) urlInput.value = '';
            if (emptyMsg) emptyMsg.classList.add('hidden');
            await saveState();
            loadBGM();
        } else {
            if (emptyMsg) {
                emptyMsg.textContent = '此影片不允許嵌入，請更換影片';
                emptyMsg.classList.remove('hidden');
            }
            state.bgmYT = null;
            await saveState();
            loadBGM();
        }
    });
}

const bgmURLLoadBtn = document.getElementById('bgm-url-load');
if (bgmURLLoadBtn) {
    bgmURLLoadBtn.addEventListener('click', async () => {
        const urlInput = document.getElementById('bgm-url-input');
        const emptyMsg = document.getElementById('bgm-empty');
        const url = urlInput ? urlInput.value.trim() : '';
        if (!url) {
            if (emptyMsg) {
                emptyMsg.textContent = '請輸入音訊網址';
                emptyMsg.classList.remove('hidden');
            }
            return;
        }
        const isValid = /^(https?:\/\/|\/)/i.test(url);
        if (!isValid) {
            if (emptyMsg) {
                emptyMsg.textContent = '請輸入有效的音訊網址 (http/https 或相對路徑)';
                emptyMsg.classList.remove('hidden');
            }
            return;
        }
        state.bgm = url;
        state.bgmYT = null;
        if (urlInput) urlInput.value = '';
        if (emptyMsg) emptyMsg.classList.add('hidden');
        await saveState();
        loadBGM();
    });
}

function loadBGM() {
    const audio = document.getElementById('bgm-audio');
    const audioContainer = document.getElementById('bgm-container');
    const ytContainer = document.getElementById('bgm-youtube-container');
    const empty = document.getElementById('bgm-empty');
    if (state.bgm) {
        audio.src = state.bgm;
        audioContainer.classList.remove('hidden');
        ytContainer.classList.add('hidden');
        empty.classList.add('hidden');
        const clearAudioBtn = document.getElementById('clear-audio-btn');
        if (clearAudioBtn) clearAudioBtn.classList.remove('hidden');
        const clearYTBtn = document.getElementById('clear-yt-btn');
        if (clearYTBtn) clearYTBtn.classList.add('hidden');
    } else if (state.bgmYT) {
        playYouTubeVideo(state.bgmYT);
        ytContainer.classList.remove('hidden');
        audioContainer.classList.add('hidden');
        audio.removeAttribute('src');
        empty.classList.add('hidden');
        const clearAudioBtn = document.getElementById('clear-audio-btn');
        if (clearAudioBtn) clearAudioBtn.classList.add('hidden');
        const clearYTBtn = document.getElementById('clear-yt-btn');
        if (clearYTBtn) clearYTBtn.classList.remove('hidden');
    } else {
        audio.removeAttribute('src');
        if (ytPlayer) {
            ytPlayer.destroy();
            ytPlayer = null;
            const newIframeDiv = document.createElement('div');
            newIframeDiv.id = 'bgm-youtube-iframe';
            newIframeDiv.className = 'w-full aspect-video bg-gray-100';
            ytContainer.insertBefore(newIframeDiv, ytContainer.firstChild);
        }
        audioContainer.classList.add('hidden');
        ytContainer.classList.add('hidden');
        empty.classList.remove('hidden');
        const clearAudioBtn = document.getElementById('clear-audio-btn');
        if (clearAudioBtn) {
            if (state.bgm) clearAudioBtn.classList.remove('hidden');
            else clearAudioBtn.classList.add('hidden');
        }
        const clearYTBtn = document.getElementById('clear-yt-btn');
        if (clearYTBtn) {
            if (state.bgmYT) clearYTBtn.classList.remove('hidden');
            else clearYTBtn.classList.add('hidden');
        }
    }
}
function clearBGM() {
    state.bgm = null;
    state.bgmYT = null;
    saveState();
    loadBGM();
}

function clearAudio() {
    const audio = document.getElementById('bgm-audio');
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute('src');
    }
    state.bgm = null;
    saveState();
    loadBGM();
}

function clearYT() {
    state.bgmYT = null;
    saveState();
    loadBGM();
}

/* --- Background Image & Avatar Functions --- */
function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.disabled = undoStack.length <= 1;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}
function undo() {
    if (undoStack.length <= 1) {
        alert('無可撤銷的操作');
        return;
    }
    const currentState = undoStack.pop();
    redoStack.push(JSON.parse(JSON.stringify(currentState)));
    const prevState = undoStack[undoStack.length - 1];
    Object.assign(state, JSON.parse(JSON.stringify(prevState)));
    renderSidebar();
    renderMain();
    saveState(false);
    updateUndoRedoButtons();
}
function redo() {
    if (redoStack.length === 0) {
        alert('無可重做的操作');
        return;
    }
    if (undoStack.length >= MAX_HISTORY) undoStack.shift();
    undoStack.push(JSON.parse(JSON.stringify(state)));
    const nextState = redoStack.pop();
    Object.assign(state, JSON.parse(JSON.stringify(nextState)));
    renderSidebar();
    renderMain();
    saveState(false);
    updateUndoRedoButtons();
}
document.addEventListener('DOMContentLoaded', () => {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.addEventListener('click', undo);
    if (redoBtn) redoBtn.addEventListener('click', redo);
    updateUndoRedoButtons();
});
function applyBackgroundImage() {
    const bg = state.bgImage;
    const bgLabel = document.getElementById('bg-image-label');
    if (bgLabel) {
        bgLabel.textContent = bg ? '更改' : '選擇';
    }
    const clearBtn = document.getElementById('clear-bg-image');
    const opacity = typeof state.bgImageOpacity === 'number' ? state.bgImageOpacity : 1;
    const radius = typeof state.bgImageBorderRadius === 'number' ? state.bgImageBorderRadius : 0;

    let overlay = document.getElementById('bg-image-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'bg-image-overlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '0';
        document.body.appendChild(overlay);
    }

    if (bg) {
        overlay.style.backgroundImage = `url(${bg})`;
        overlay.style.backgroundSize = 'cover';
        overlay.style.backgroundPosition = 'center';
        overlay.style.backgroundAttachment = 'fixed';
        overlay.style.backgroundRepeat = 'no-repeat';
        overlay.style.opacity = opacity;
        overlay.style.borderRadius = radius + 'px';
        overlay.style.display = 'block';
        clearBtn.classList.remove('hidden');
        overlay.style.boxShadow = 'inset 0 0 0 2000px rgba(251, 251, 250, 0.3)';

        const opacitySlider = document.getElementById('bg-opacity-slider');
        const opacityVal = document.getElementById('bg-opacity-value');
        if (opacitySlider) {
            opacitySlider.value = Math.round(opacity * 100);
            opacitySlider.parentElement.classList.remove('hidden');
            opacitySlider.parentElement.classList.add('flex');
        }
        if (opacityVal) opacityVal.textContent = `${Math.round(opacity * 100)}%`;

        const radiusSlider = document.getElementById('bg-radius-slider');
        const radiusVal = document.getElementById('bg-radius-value');
        if (radiusSlider) {
            radiusSlider.value = radius;
            radiusSlider.parentElement.classList.remove('hidden');
            radiusSlider.parentElement.classList.add('flex');
        }
        if (radiusVal) radiusVal.textContent = `${radius}px`;
    } else {
        overlay.style.backgroundImage = '';
        overlay.style.opacity = '0';
        overlay.style.display = 'none';
        clearBtn.classList.add('hidden');

        const opacitySlider = document.getElementById('bg-opacity-slider');
        if (opacitySlider) {
            opacitySlider.parentElement.classList.add('hidden');
            opacitySlider.parentElement.classList.remove('flex');
        }
        const radiusSlider = document.getElementById('bg-radius-slider');
        if (radiusSlider) {
            radiusSlider.parentElement.classList.add('hidden');
            radiusSlider.parentElement.classList.remove('flex');
        }
    }
}
function clearBackgroundImage() {
    state.bgImage = null;
    saveState();
    applyBackgroundImage();
}

function applyAvatar() {
    const img = document.getElementById('avatar-preview');
    const clearBtn = document.getElementById('clear-avatar');
    const container = document.getElementById('avatar-container');
    const alignSelect = document.getElementById('avatar-align-select');
    const avatarLabelSpan = document.getElementById('avatar-label') || (function(){
        const label = document.getElementById('avatar-upload').parentNode;
        const span = document.createElement('span');
        span.id = 'avatar-label';
        span.textContent = '選擇';
        label.insertBefore(span, label.firstChild);
        return span;
    })();

    if (!img || !container) return;

    if (state.avatar) {
        img.src = state.avatar;
        img.classList.remove('hidden');
        if (avatarLabelSpan) avatarLabelSpan.textContent = state.avatar ? '更改' : '選擇';

        if (!state.previewMode) {
            if(clearBtn) clearBtn.classList.remove('hidden');
            if (alignSelect) alignSelect.classList.remove('hidden');
            container.classList.add('group');
        } else {
            if(clearBtn) clearBtn.classList.add('hidden');
            if (alignSelect) alignSelect.classList.add('hidden');
            container.classList.remove('group');
        }

        if (alignSelect) {
            alignSelect.value = state.avatarAlign || 'center';
        }

        container.classList.remove('hidden');
        container.style.justifyContent = 'center';

        const align = state.avatarAlign || 'center';
        if (align === 'left') {
            container.style.justifyContent = 'flex-start';
        } else if (align === 'center') {
            container.style.justifyContent = 'center';
        } else {
            container.style.justifyContent = 'flex-end';
        }

        container.style.marginLeft = '';
        container.style.marginRight = '';
        if (align === 'left') {
            container.style.marginLeft = '-4rem';
        } else if (align === 'right') {
            container.style.marginRight = '-4rem';
        }

        adjustAvatarPosition();
    } else {
        img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wIAAgEB/4yE9dMAAAAASUVORK5CYII=';
        img.classList.add('hidden');
        if(clearBtn) clearBtn.classList.add('hidden');
        if (alignSelect) alignSelect.classList.add('hidden');
        container.classList.add('hidden');
    }
}
function clearAvatar() {
    if (state.previewMode) return;
    state.avatar = null;
    saveState();
    applyAvatar();
    renderMain();
}

function applyBanner() {
    const img = document.getElementById('banner-image');
    const clearBtn = document.getElementById('clear-banner');
    const bannerLabel = document.getElementById('banner-image-label');
    if (bannerLabel) {
        bannerLabel.textContent = state.banner ? '更改' : '選擇';
    }
    const container = document.getElementById('banner-container');
    if (!img || !container) return;
    const radius = 0;

    if (state.banner) {
        img.src = state.banner;
        img.classList.remove('hidden');
        img.style.borderRadius = radius + 'px';
        if (!state.previewMode && clearBtn) clearBtn.classList.remove('hidden');
        else if (clearBtn) clearBtn.classList.add('hidden');
        container.classList.remove('hidden');
    } else {
        img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wIAAgEB/4yE9dMAAAAASUVORK5CYII=';
        img.classList.add('hidden');
        img.style.borderRadius = '';
        if (clearBtn) clearBtn.classList.add('hidden');
        container.classList.add('hidden');
        const radiusSlider = document.getElementById('banner-radius-slider');
        if (radiusSlider) {
            radiusSlider.parentElement.classList.add('hidden');
            radiusSlider.parentElement.classList.remove('flex');
        }
    }

    adjustAvatarPosition();
}

function clearBanner() {
    state.banner = null;
    saveState();
    applyBanner();
    renderMain();
}

function adjustAvatarPosition() {
    const bannerContainer = document.getElementById('banner-container');
    const avatarContainer = document.getElementById('avatar-container');
    if (!avatarContainer) return;

    const isBannerVisible = bannerContainer && !bannerContainer.classList.contains('hidden');

    if (isBannerVisible) {
        avatarContainer.className = avatarContainer.className.replace(/top-\d+/g, '');
        avatarContainer.style.top = '';

        if (window.innerWidth < 768) {
            avatarContainer.style.marginTop = '0';
            avatarContainer.classList.add('top-12');
        } else {
            avatarContainer.style.marginTop = '0';
            avatarContainer.classList.add('top-16');
        }
    } else {
        avatarContainer.className = avatarContainer.className.replace(/top-\d+/g, '');
        avatarContainer.style.top = '';
        avatarContainer.style.marginTop = '0';

        if (window.innerWidth < 768) {
            avatarContainer.classList.add('top-8');
        } else {
            avatarContainer.classList.add('top-4');
        }
    }
}

window.addEventListener('resize', () => {
    if (state.avatar) {
        adjustAvatarPosition();
    }
});

/* --- Font Application --- */
function applyFont() {
    const body = document.body;
    if (!body) return;

    const existingStyle = document.getElementById('custom-font-style');
    if (existingStyle) existingStyle.remove();

    body.classList.remove('font-inter', 'font-roboto', 'font-lxgw');

    if (state.customFont && state.customFont.name && state.customFont.dataUrl) {
        const style = document.createElement('style');
        style.id = 'custom-font-style';
        const type = state.customFont.type || '';
        let format = '';
        if (type.includes('truetype')) format = 'truetype';
        else if (type.includes('opentype')) format = 'opentype';
        else if (type.includes('woff2')) format = 'woff2';
        else if (type.includes('woff')) format = 'woff';
        style.textContent = `@font-face {font-family: '${state.customFont.name}'; src: url(${state.customFont.dataUrl}) format('${format}'); font-weight: normal; font-style: normal;}`;
        document.head.appendChild(style);
        body.style.fontFamily = `'${state.customFont.name}', sans-serif`;
    } else if (state.fontFamily && state.fontFamily !== '') {
        body.style.fontFamily = '';

        if (state.fontFamily === 'Inter') {
            body.classList.add('font-inter');
        } else if (state.fontFamily === 'Roboto') {
            body.classList.add('font-roboto');
        } else if (state.fontFamily.includes('LXGW')) {
            body.classList.add('font-lxgw');
        } else {
            body.style.fontFamily = state.fontFamily;
        }
    } else {
        body.style.fontFamily = '';
        body.classList.add('font-inter');
    }

    const fontSelect = document.getElementById('font-select');
    if (fontSelect) {
        if (state.customFont) {
            fontSelect.value = 'custom';
            const clearBtn = document.getElementById('clear-custom-font');
            if (clearBtn) clearBtn.classList.remove('hidden');
        } else {
            fontSelect.value = state.fontFamily || 'Inter';
            const clearBtn = document.getElementById('clear-custom-font');
            if (clearBtn) clearBtn.classList.add('hidden');
        }
    }
}

/* --- Template Isolation / Migration --- */
function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function makeBlankBlocks() {
    return [{
        id: generateId(),
        type: 'text',
        content: '',
        color: '#374151',
        align: 'left',
        heading: 'p',
        layout: 'single',
        animate: ''
    }];
}

function resetEditorToTemplate(template, templateId) {
    const currentUser = state.user || null;
    const savedTemplateState = template && template.editorState ? deepClone(template.editorState) : {};
    const savedPages = Array.isArray(savedTemplateState.pages) && savedTemplateState.pages.length > 0
        ? savedTemplateState.pages
        : (Array.isArray(template.pages) ? deepClone(template.pages) : []);

    // Reset first so visual settings from the previously opened template cannot leak in.
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, deepClone(defaultState), savedTemplateState, { user: currentUser, previewMode: false });

    if (savedPages.length > 0) {
        state.pages = savedPages.map(page => ({ ...deepClone(page), id: generateId(), templateId }));
    } else if (Array.isArray(template.blocks) && template.blocks.length > 0) {
        state.pages = [{ id: generateId(), title: template.name || '', layout: 'single', templateId, blocks: deepClone(template.blocks) }];
    } else {
        state.pages = [{ id: generateId(), title: template.name || '', layout: 'single', templateId, blocks: makeBlankBlocks() }];
    }
    state.activePageId = state.pages[0].id;
    templateSessionIsPersisted = true; state.hasUnsavedChanges = false; // Reset flag after save
}

function resetEditorToNewTemplate() {
    const currentUser = state.user || null;
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, deepClone(defaultState), { user: currentUser, previewMode: false });
    state.pages = [{ id: generateId(), title: '', layout: 'single', templateId: null, blocks: makeBlankBlocks() }];
    state.activePageId = state.pages[0].id;
    templateSessionIsPersisted = false;
}

async function ensureIndependentPageTemplates() {
    // 模板工作流中不會在載入時建立紀錄；新模板只會在按下儲存時建立。
    return;
}

/* --- Initialization --- */
function initDropdownToggles() {
    const headers = document.querySelectorAll('.dropdown > .flex.cursor-pointer');
    headers.forEach(header => {
        const content = header.nextElementSibling;
        const arrow = header.querySelector('svg');
        header.addEventListener('click', () => {
            if (content) content.classList.toggle('hidden');
            if (arrow) arrow.classList.toggle('rotate-180');
        });
    });
}
window.addEventListener('DOMContentLoaded', async () => {
    const shareToken = new URLSearchParams(window.location.search).get('share');
    if (shareToken) {
        state.previewMode = true;
        document.body.classList.add('bg-white');
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.add('hidden');

        const mobileMenuBtn = document.querySelector('button[onclick="toggleMobileMenu()"]');
        if (mobileMenuBtn) mobileMenuBtn.classList.add('hidden');
        return;
    }

    try {
        const currentUser = state.user || null;
        const storedTemplateId = localStorage.getItem('selectedTemplateId');
        
        const savedState = await getItem('oc_editor_state');
        
        if (savedState) {
            Object.assign(state, savedState, { user: currentUser });
            window.state = state;
            if (currentUser) {
                state.previewMode = false;
            }
            if (!Array.isArray(state.layouts)) {
                state.layouts = ['single'];
            }
            if (!state.layout) {
                state.layout = 'single';
            }
            (state.pages || []).forEach(p => {
                if (!p.layout) p.layout = 'single';
            });
            let navDupFound = false;
            (state.pages || []).forEach(p => {
                if (!Array.isArray(p.blocks)) return;
                let firstNavSeen = false;
                p.blocks = p.blocks.filter(b => {
                    if (b.type !== 'nav') return true;
                    if (!firstNavSeen) {
                        firstNavSeen = true;
                        return true;
                    }
                    navDupFound = true;
                    return false;
                });
            });
            if (navDupFound) {
                alert('已自動移除重複的導覽列，只保留每頁第一個。');
                await saveState(false);
            }
            if (!state.fontFamily) {
                state.fontFamily = 'Inter';
            }
        }

        if (storedTemplateId) {
            const templates = await readTemplateLibrary();
            const sourceTemplate = templates.find(template => template && template.id === storedTemplateId);
            if (sourceTemplate) {
                resetEditorToTemplate(sourceTemplate, storedTemplateId);
            } else {
                // A template may have been deleted in another tab; never redirect edits into another record.
                resetEditorToNewTemplate();
            }
            localStorage.removeItem('selectedTemplateId');
            localStorage.removeItem('selectedTemplate');
        } else {
            // A blank entry always begins from defaults and has no template ID until Save is pressed.
            resetEditorToNewTemplate();
        }
        await saveState(false);

        renderSidebar();
        renderMain();
        loadBGM();
        applyBackgroundImage();
        applyAvatar();
        applyBanner();
        applyFont();
        initDropdownToggles();

        const bgUpload = document.getElementById('bg-image-upload');
        if (bgUpload) {
            bgUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    if (file.size > 5 * 1024 * 1024) {
                        alert('背景圖檔案過大，請選擇小於 5MB 的圖片以保持效能。');
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        state.bgImage = ev.target.result;
                        saveState();
                        applyBackgroundImage();
                    };
                    reader.readAsDataURL(file);
                }
                bgUpload.value = '';
            });
        }

        const clearBgBtn = document.getElementById('clear-bg-image');
        if (clearBgBtn) {
            clearBgBtn.addEventListener('click', clearBackgroundImage);
        }

        const avatarUpload = document.getElementById('avatar-upload');
        if (avatarUpload) {
            avatarUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    if (file.size > 2 * 1024 * 1024) {
                        alert('頭貼檔案過大，請選擇小於 2MB 的圖片以保持效能。');
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        state.avatar = ev.target.result;
                        saveState();
                        applyAvatar();
                        renderMain();
                    };
                    reader.readAsDataURL(file);
                }
                avatarUpload.value = '';
            });
        }

        const bannerUpload = document.getElementById('banner-upload');
        if (bannerUpload) {
            bannerUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    if (file.size > 5 * 1024 * 1024) {
                        alert('橫幅圖片過大，請選擇小於 5MB 的圖片以保持效能。');
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        state.banner = ev.target.result;
                        saveState();
                        applyBanner();
                        renderMain();
                    };
                    reader.readAsDataURL(file);
                }
                bannerUpload.value = '';
            });
        }

        const clearAvatarBtn = document.getElementById('clear-avatar');
        if (clearAvatarBtn) {
            clearAvatarBtn.addEventListener('click', clearAvatar);
        }

        const opacitySlider = document.getElementById('bg-opacity-slider');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                state.bgImageOpacity = val / 100;
                saveState();
                applyBackgroundImage();
            });
        }

        const bgRadiusSlider = document.getElementById('bg-radius-slider');
        if (bgRadiusSlider) {
            bgRadiusSlider.addEventListener('input', (e) => {
                const val = Number(e.target.value);
                state.bgImageBorderRadius = val;
                const radiusVal = document.getElementById('bg-radius-value');
                if (radiusVal) radiusVal.textContent = `${val}px`;
                saveState();
                applyBackgroundImage();
            });
        }

        const bannerRadiusSlider = document.getElementById('banner-radius-slider');
        if (bannerRadiusSlider) {
            bannerRadiusSlider.addEventListener('input', (e) => {
                const val = Number(e.target.value);
                state.bannerBorderRadius = val;
                const radiusVal = document.getElementById('banner-radius-value');
                if (radiusVal) radiusVal.textContent = `${val}px`;
                saveState();
                applyBanner();
            });
        }

        const avatarAlignSelect = document.getElementById('avatar-align-select');
        if (avatarAlignSelect) {
            avatarAlignSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                state.avatarAlign = val;
                saveState();
                applyAvatar();
            });
        }

        const fontSelect = document.getElementById('font-select');
        if (fontSelect) {
            fontSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val === 'custom') {
                    const upload = document.getElementById('custom-font-upload');
                    if (upload) upload.click();
                    return;
                }
                state.fontFamily = val;
                state.customFont = null;
                const clearBtn = document.getElementById('clear-custom-font');
                if (clearBtn) clearBtn.classList.add('hidden');
                const customStyle = document.getElementById('custom-font-style');
                if (customStyle) customStyle.remove();
                saveState();
                applyFont();
            });
        }

        (function addTodoPlaceholderStyle() {
            const styleId = 'todo-placeholder-style';
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.textContent = `.todo-text:empty:before { content: attr(data-placeholder); color: #6b7280; }`;
                document.head.appendChild(style);
            }
        })();

        // Add "儲存至模板" button next to redo button
        (function addSidebarSaveButton() {
            const container = document.getElementById('redo-btn')?.parentNode;
            if (!container) return;
            let btn = document.getElementById('save-to-template');
            if (!btn) {
                btn = document.createElement('button');
                btn.id = 'save-to-template';
                btn.innerHTML = '<svg class="w-4 h-4 mr-1 inline-block" fill="currentColor" viewBox="0 0 20 20"><path d="M4 2h12a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zm2 2v4h8V4H6zm0 6v6h8v-6H6z"/></svg>';
                btn.type = 'button';
                btn.className = 'px-2 py-1 text-xs bg-gray-200 text-gray-800 rounded hover:bg-gray-300';
            }
            btn.addEventListener('click', () => {
                console.log('Save to template button clicked');
                saveCurrentPageToTemplate();
            });
            container.appendChild(btn);
        })();

        const customFontUpload = document.getElementById('custom-font-upload');
        if (customFontUpload) {
            customFontUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) {
                    if (fontSelect) fontSelect.value = state.fontFamily || 'Inter';
                    return;
                }
                if (file.size > 5 * 1024 * 1024) {
                    alert('字體檔案過大，請選擇小於 5MB 的檔案。');
                    if (fontSelect) fontSelect.value = state.fontFamily || 'Inter';
                    return;
                }
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const dataUrl = ev.target.result;
                    const fontName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '');
                    state.customFont = { name: `Custom_${fontName}`, dataUrl: dataUrl, type: file.type };
                    if (fontSelect) fontSelect.value = 'custom';
                    const clearBtn = document.getElementById('clear-custom-font');
                    if (clearBtn) clearBtn.classList.remove('hidden');
                    saveState();
                    applyFont();
                };
                reader.readAsDataURL(file);
            });
        }

        const clearCustomFontBtn = document.getElementById('clear-custom-font');
        if (clearCustomFontBtn) {
            clearCustomFontBtn.addEventListener('click', () => {
                state.customFont = null;
                const customStyle = document.getElementById('custom-font-style');
                if (customStyle) customStyle.remove();
                const fontSelect = document.getElementById('font-select');
                if (fontSelect) fontSelect.value = state.fontFamily || 'Inter';
                clearCustomFontBtn.classList.add('hidden');
                saveState();
                applyFont();
            });
        }

        const layoutSingle = document.getElementById('layout-single');
        const layoutDouble = document.getElementById('layout-double');
        const layoutCard = document.getElementById('layout-card');

        function updateLayoutsFromCheckboxes() {
            const selected = [];
            if (layoutSingle && layoutSingle.checked) selected.push('single');
            if (layoutDouble && layoutDouble.checked) selected.push('double');
            if (layoutCard && layoutCard.checked) selected.push('card');
            if (selected.length === 0) selected.push('single');
            state.layouts = selected;
            state.layout = selected[0];
            saveState();
            renderMain();
        }

        [layoutSingle, layoutDouble, layoutCard].forEach(cb => {
            if (cb) cb.addEventListener('change', updateLayoutsFromCheckboxes);
        });

        if (Array.isArray(state.layouts)) {
            const layouts = state.layouts;
            if (layoutSingle) layoutSingle.checked = layouts.includes('single');
            if (layoutDouble) layoutDouble.checked = layouts.includes('double');
            if (layoutCard) layoutCard.checked = layouts.includes('card');
        } else {
            if (layoutSingle) layoutSingle.checked = true;
        }

    } catch (error) {
        console.error("App Initialization failed:", error);
    }
});
