// Share (Read‑only) functionality for Notion‑clone (Supabase version)
// ---------------------------------------------------
// 1. When the URL contains "?share=TOKEN", the app loads the
//    snapshot stored in Supabase table "shared_pages" and
//    renders it in a read‑only view (editing UI is hidden).
// 2. When editing a page, a "分享只讀連結" button is injected next
//    to the page title. Clicking it stores the current page data
//    under a unique token and shows the user a prompt with the URL.
// ---------------------------------------------------
(function () {
  // ----- Helper: get URL query param -----
  const urlParams = new URLSearchParams(window.location.search);
  const shareToken = urlParams.get('share');

  // ----- Load shared page (read‑only) -----
  async function loadSharedPage(token) {
    try {
      // Retrieve shared page from Supabase
      const { data, error } = await supabase.from('shared_pages').select('page').eq('token', token).single();
      if (error) {
        console.error('載入共享頁面失敗', error);
        alert('分享的頁面不存在或已被移除。');
        return;
      }
      const { page } = data;
      // Force read‑only mode
      state.previewMode = true;
      // Replace pages with the shared page only (簡化呈現)
      state.previewPage = page;
      state.activePageId = page.id;
      // Hide UI that belongs to editing (sidebar, block menu, etc.)
      document.body.classList.add('preview-mode');
      // Re‑render the UI – `renderSidebar` will render a minimal list
      // (or be hidden by CSS), `renderMain` shows the page content.
      if (typeof renderSidebar === 'function') renderSidebar();
      if (typeof renderMain === 'function') renderMain();
    } catch (e) {
      console.error('載入共享頁面失敗', e);
      alert('載入共享頁面失敗，請稍後再試。');
    }
  }

  // If a share token is present, load the page and stop further init.
  if (shareToken) {
    loadSharedPage(shareToken);
    return;
  }

  // ----- UI: Inject "分享只讀連結" button -----
  function injectShareButton() {
    const titleInput = document.getElementById('page-title-input');
    if (!titleInput || document.getElementById('share-readonly-btn')) return;
    const container = document.getElementById('redo-btn')?.parentNode || titleInput.parentNode;
    const btn = document.createElement('button');
    btn.id = 'share-readonly-btn';
    btn.innerHTML = '<svg class="w-4 h-4 mr-1 inline-block" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .105 5.751.75.75 0 0 0 1.06-1.06 2.5 2.5 0 0 1-.084-3.537l1.979-1.979zm-4.464 11.536a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.105-5.751.75.75 0 0 0-1.06 1.06 2.5 2.5 0 0 1 .084 3.537l-1.979 1.979z" clip-rule="evenodd"/></svg>';
    btn.type = 'button';
    btn.className = 'ml-2 px-2 py-1 text-xs bg-gray-200 text-gray-800 rounded hover:bg-gray-300';
    container.appendChild(btn);
    console.log('分享只讀連結按鈕已注入');
    btn.addEventListener('click', async () => {
      if (!state.activePageId) {
        alert('請先選擇或建立頁面。');
        return;
      }
      const page = state.pages.find(p => p.id === state.activePageId);
      if (!page) {
        alert('找不到當前頁面資料。');
        return;
      }
      const token = generateId() + '_' + Date.now();
      try {
        const { error } = await supabase.from('shared_pages').insert({ token, page });
        if (error) throw error;
        const shareUrl = `${window.location.origin}${window.location.pathname}?share=${token}`;
        console.log('生成共享連結 URL:', shareUrl);
        prompt('已產生只讀分享連結，請複製以下網址：', shareUrl);
      } catch (e) {
        console.error('產生共享連結失敗', e);
        alert('無法產生共享連結，請稍後再試。');
      }
    });
  }

  // ----- Observe DOM changes so the button appears after renderMain -----
  const observer = new MutationObserver(() => {
    if (document.getElementById('page-title-input')) {
      injectShareButton();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
