// auth.js - Handles user authentication via Supabase

// Ensure global `state` exists even on login page (where script.js is not loaded)
if (typeof window.state === 'undefined') {
  window.state = {
    previewMode: true,
    user: null,
  };
}
var state = window.state;

// Provide no-op stubs for functions that may be absent when script.js is not loaded
if (typeof window.saveState !== 'function') window.saveState = function() {};
if (typeof window.renderSidebar !== 'function') window.renderSidebar = function() {};
if (typeof window.renderMain !== 'function') window.renderMain = function() {};

// Render login UI inside #auth-container when no user is signed in.
function renderLoginUI() {
  const container = document.getElementById('auth-container');
  if (!container) return;
  container.innerHTML = `
    <div class="flex flex-col items-center gap-4">
      <button id="google-login" class="w-full py-2 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300 font-medium transition-colors">使用 Google 登入</button>
      <div id="auth-message" class="text-xs text-red-500 hidden"></div>
    </div>`;

  document.getElementById('google-login').addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) handleAuthError(error);
  });
}

function handleAuthError(error) {
  console.error('Auth error:', error);
  const message = error && error.message ? error.message : '登入失敗';
  showAuthMessage(message);
}

function showAuthMessage(msg) {
  const el = document.getElementById('auth-message');
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}

// When the user is signed in, replace the UI with a simple status & logout button.
function renderUserUI(user) {
  const container = document.getElementById('auth-container');
  if (!container) return;
  const displayName = user.email || user.user_metadata?.full_name || '';
  container.innerHTML = `
    <div class="text-sm text-gray-600 mb-1">已登入: ${displayName}</div>
    <button id="logout-btn" class="w-full px-2 py-1 bg-gray-200 rounded text-sm">登出</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) handleAuthError(error);
    else window.location.href = '/index.html';
  });
}

// Load per‑user state from Supabase (if any) and merge it into the global `state`.
async function loadUserState(uid) {
  // editor.html owns its state through the selected template record.  Loading the
  // legacy account‑wide state here would overwrite the selected template and make
  // every template appear to contain the same last‑edited content.
  if (window.location.pathname.endsWith('/editor.html') || window.location.pathname.endsWith('editor.html')) return;
  if (typeof window.supabase === 'undefined' || window.supabaseSyncDisabled) return;
  try {
    const { data, error } = await supabase.from('users').select('state').eq('id', uid).single();
    if (!error && data && data.state) {
      const userState = data.state;
      const currentUser = state.user;
      state = { ...state, ...userState, user: currentUser };
    }
  } catch (e) {
    window.supabaseSyncDisabled = true;
    console.warn('Supabase 雲端同步失敗，已改為使用本機資料。', e);
  }
}

// Initialise authentication listeners after the DOM is ready.

// Show/hide editor UI based on authentication status
function showEditor() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.style.display = '';
    const children = sidebar.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.id !== 'auth-container') {
        child.style.display = '';
      }
    }
  }
  const main = document.getElementById('main-scroll');
  if (main) main.style.display = '';
}
function hideEditor() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.style.display = 'none';
    const children = sidebar.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.id !== 'auth-container') {
        child.style.display = 'none';
      }
    }
  }
  const main = document.getElementById('main-scroll');
  if (main) {
    if (state && state.previewMode) {
      main.style.display = '';
    } else {
      main.style.display = 'none';
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (typeof supabase === 'undefined') {
    console.error('Supabase client not available. Ensure Supabase SDK scripts are loaded.');
    return;
  }
  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user;
    if (user) {
      // Check for shared link token to enforce read‑only mode even for logged‑in users.
      const shareToken = new URLSearchParams(window.location.search).get('share');
      if (shareToken) {
        // Force read‑only preview for shared pages.
        state.previewMode = true;
        const authContainer = document.getElementById('auth-container');
        if (authContainer) authContainer.style.display = 'none';
        hideEditor();
      } else {
        state.user = { uid: user.id, email: user.email, displayName: user.user_metadata?.full_name };
        loadUserState(user.id);
        state.previewMode = false;
        renderUserUI(user);
        showEditor();
        if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '') {
          setTimeout(() => { window.location.href = '/template.html'; }, 600);
        }
      }
    } else {
      delete state.user;
      const shareToken = new URLSearchParams(window.location.search).get('share');
      if (shareToken) {
        state.previewMode = true;
        const authContainer = document.getElementById('auth-container');
        if (authContainer) authContainer.style.display = 'none';
        hideEditor();
      } else {
        state.previewMode = true;
        renderLoginUI();
        hideEditor();
      }
    }
    if (typeof saveState === 'function') saveState();
    if (typeof renderSidebar === 'function') renderSidebar();
    if (typeof renderMain === 'function') renderMain();
  });
  // Initialise UI for the first load (might be logged out).
  if (!state.user) {
    const shareToken = new URLSearchParams(window.location.search).get('share');
    if (shareToken) {
      const authContainer = document.getElementById('auth-container');
      if (authContainer) authContainer.style.display = 'none';
      hideEditor();
    } else {
      renderLoginUI();
      hideEditor();
    }
  }
});
