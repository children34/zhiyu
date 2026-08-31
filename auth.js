// auth.js - Handles user authentication (Google OAuth & Email/Password)

// Ensure global `state` exists even on login page (where script.js is not loaded)
if (typeof window.state === 'undefined') {
  window.state = {
    previewMode: true,
    user: null,
  };
}
var state = window.state;

// Provide no-op stubs for functions that may be absent when script.js is not loaded
if (typeof window.saveState !== 'function') {
  window.saveState = function() {};
}
if (typeof window.renderSidebar !== 'function') {
  window.renderSidebar = function() {};
}
if (typeof window.renderMain !== 'function') {
  window.renderMain = function() {};
}

// Render login UI inside #auth-container when no user is signed in.
function renderLoginUI() {
    const container = document.getElementById('auth-container');
    if (!container) return;
    container.innerHTML = `
        <div class=\"flex flex-col items-center gap-4\">
            <button id="google-login" class="w-full py-2 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300 font-medium transition-colors">使用 Google 登入</button>
            <div id=\"auth-message\" class=\"text-xs text-red-500 hidden\"></div>
        </div>`;

    // Google sign‑in
    document.getElementById('google-login').addEventListener('click', () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(handleAuthError);
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
    container.innerHTML = `
        <div class=\"text-sm text-gray-600 mb-1\">已登入: ${user.email}</div>
        <button id=\"logout-btn\" class=\"w-full px-2 py-1 bg-gray-200 rounded text-sm\">登出</button>
    `;
    document.getElementById('logout-btn').addEventListener('click', () => { auth.signOut().then(() => { window.location.href = 'index.html'; }).catch(handleAuthError); });
}

// Load per‑user state from Firestore (if any) and merge it into the global `state`.
async function loadUserState(uid) {
    // editor.html owns its state through the selected template record.  Loading the
    // legacy account-wide state here would overwrite the selected template and make
    // every template appear to contain the same last-edited content.
    if (window.location.pathname.endsWith('/editor.html') || window.location.pathname.endsWith('editor.html')) return;
    if (typeof db === 'undefined' || window.firestoreSyncDisabled) return;
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists && doc.data().state) {
            const userState = doc.data().state;
            // Merge user‑specific state, preserving the current `state.user` reference.
            const currentUser = state.user;
            state = { ...state, ...userState, user: currentUser };
        }
    } catch (e) {
        window.firestoreSyncDisabled = true;
        console.warn('Firestore 雲端讀取失敗，已改為使用本機資料。', e);
    }
}

// Initialise authentication listeners after the DOM is ready.

// Show/hide editor UI based on authentication status
function showEditor() {
    // Show sidebar sections except auth container and ensure the sidebar container is visible
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
    // Hide sidebar sections except auth container and hide the sidebar container in preview mode
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        // hide the whole sidebar when in preview/read‑only mode
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
        // Keep main content visible when in preview mode (read‑only)
        if (state && state.previewMode) {
            main.style.display = '';
        } else {
            main.style.display = 'none';
        }
    }
}
window.addEventListener('DOMContentLoaded', () => {
    if (typeof auth === 'undefined') {
        console.error('Firebase Auth not available. Ensure Firebase SDK scripts are loaded.');
        return;
    }
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // Distinguish anonymous users (used for share preview) from real authenticated users.
            if (user.isAnonymous) {
                // Treat anonymous sign‑in as preview‑only: do NOT enable edit mode.
                // Keep a minimal user record if needed but enforce previewMode.
                delete state.user;
                // Do NOT load personal state or enable editing.
                state.previewMode = true;
                renderLoginUI(); // Show login UI (or you could hide it); preview mode stays.
                hideEditor();
            } else {
                // Check for shared link token to enforce read‑only mode even for logged‑in users.
                const shareToken = new URLSearchParams(window.location.search).get('share');
                if (shareToken) {
                    // Force read‑only preview for shared pages.
                    // 保留已登入使用者資訊，僅保持預覽模式以隱藏左側
                    state.previewMode = true;
                    // Hide login UI for shared preview (no Google login required).
                    const authContainer = document.getElementById('auth-container');
                    if (authContainer) authContainer.style.display = 'none';
                    hideEditor();
                } else {
                    // Store minimal user info in global `state` for real accounts.
                    state.user = { uid: user.uid, email: user.email, displayName: user.displayName };
                    await loadUserState(user.uid);
                    // Allow editing for authenticated users
                    state.previewMode = false;
                    renderUserUI(user);
                    showEditor();
                    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '') {
                        // After successful login, go to the main editor page.
                        setTimeout(() => { window.location.href = 'template.html'; }, 600)
                    }
                }
            }
        } else {
            delete state.user;
            // Check for shared link token to enforce read‑only preview without login UI
            const shareToken = new URLSearchParams(window.location.search).get('share');
            if (shareToken) {
                state.previewMode = true;
                // Hide login UI for shared preview
                const authContainer = document.getElementById('auth-container');
                if (authContainer) authContainer.style.display = 'none';
                hideEditor();
            } else {
                // Enforce preview mode for unauthenticated users
                state.previewMode = true;
                renderLoginUI();
                hideEditor();
            }
        }
        // Persist previewMode change immediately
        if (typeof saveState === 'function') saveState();
        // Re‑render UI (sidebar, main content, preview button) to reflect auth status.
        if (typeof renderSidebar === 'function') renderSidebar();
        if (typeof renderMain === 'function') renderMain();
    });
    // Initialise UI for the first load (might be logged out).
    if (!state.user) {
        const shareToken = new URLSearchParams(window.location.search).get('share');
        if (shareToken) {
            // Hide login UI for shared preview
            const authContainer = document.getElementById('auth-container');
            if (authContainer) authContainer.style.display = 'none';
            hideEditor();
        } else {
            renderLoginUI();
            hideEditor();
        }
    }
});
