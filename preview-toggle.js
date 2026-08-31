document.addEventListener('DOMContentLoaded', () => {
    // Helper to persist state changes without adding to undo history
    function saveStateImmediate(){
        // `false` disables history recording (no undo/redo entry)
        if (typeof saveState === 'function') {
            saveState(false);
        }
    }
    // Ensure renderMain exists before patching
    if (typeof renderMain !== 'function') return;
    // Store original renderMain
    const originalRenderMain = renderMain;
    // Define a function to apply preview UI after rendering
    function applyPreviewUI() {
        // Determine if the current page is accessed via a shared read‑only link
        const shareToken = new URLSearchParams(window.location.search).get('share');
        // Force preview mode when no user is authenticated
        // 只有在未登入且未使用共享連結時才進入只讀模式
        if (!state.user && !shareToken) {
            state.previewMode = true;
        }
        // Add or update preview and edit buttons
        // Remove any legacy single toggle button
        const legacyBtn = document.getElementById('toggle-preview');
        if (legacyBtn) legacyBtn.remove();
        const fontSelect = document.getElementById('font-select');
        if (fontSelect) {
            // Ensure a container for the two buttons exists
            let btnContainer = document.getElementById('preview-edit-container');
            if (!btnContainer) {
                btnContainer = document.createElement('div');
                btnContainer.id = 'preview-edit-container';
                btnContainer.className = 'mt-2 ml-2 flex space-x-2';
                const insertTarget = fontSelect.closest('.mt-4') || fontSelect.parentElement;
                if (insertTarget) {
                    insertTarget.insertAdjacentElement('afterend', btnContainer);
                }
            }
            // Preview button
            let previewBtn = document.getElementById('preview-btn');
            if (!previewBtn) {
                previewBtn = document.createElement('button');
                previewBtn.id = 'preview-btn';
                previewBtn.textContent = '預覽';
                btnContainer.appendChild(previewBtn);
            }
            // Edit button
            let editBtn = document.getElementById('edit-btn');
            if (!editBtn) {
                editBtn = document.createElement('button');
                editBtn.id = 'edit-btn';
                editBtn.textContent = '編輯';
                btnContainer.appendChild(editBtn);
                // 若為只讀分享連結，保持編輯按鈕可用；否則依據 previewMode 決定是否禁用
                // 永遠保持編輯按鈕可用，取消 disabled 設定
                editBtn.disabled = false;
                editBtn.title = ''
            }
            // Update edit button disabled state based on auth
            // 若為只讀分享連結，保持編輯按鈕可用；否則根據 previewMode 設定
            if (shareToken) {
                editBtn.disabled = false;
                editBtn.title = '';
            } else {
                editBtn.disabled = false;
                editBtn.title = '';
            }
            // Apply common styling
            const baseClass = 'px-2 py-1 text-sm rounded';
            if (state.previewMode) {
                previewBtn.className = `${baseClass} bg-gray-300 text-white`;
                editBtn.className = `${baseClass} bg-gray-200 text-gray-700`;
            } else {
                previewBtn.className = `${baseClass} bg-gray-200 text-gray-700`;
                editBtn.className = `${baseClass} bg-gray-300 text-white`;
            }
            // Bind click handlers (only once)
            if (!previewBtn.dataset.bound) {
                previewBtn.addEventListener('click', () => {
                    if (!state.previewMode) {
                        state.previewMode = true;
                        saveStateImmediate();
                        renderMain();
                    }
                });
                previewBtn.dataset.bound = 'true';
            }
            if (!editBtn.dataset.bound) {
                editBtn.addEventListener('click', () => {
                    if (state.previewMode) {
                        state.previewMode = false;
                        saveStateImmediate();
                        renderMain();
                    }
                });
                editBtn.dataset.bound = 'true';
            }
        }
        // Apply preview mode styles
        if (state.previewMode) {
            document.querySelectorAll('.text-content').forEach(el => {
                el.setAttribute('contenteditable', 'false');
                el.style.cursor = 'default';
            });
            document.querySelectorAll('.controls, .add-btn, .drag-handle').forEach(el => el.style.display = 'none');
            // Ensure todo items, table cells, and links are non‑editable in preview mode
            document.querySelectorAll('.todo-text, td, th, a').forEach(el => {
                el.setAttribute('contenteditable', 'false');
            });
                const titleInput = document.getElementById('page-title-input');
                if (titleInput) titleInput.setAttribute('disabled', 'true');
        } else {
            document.querySelectorAll('.text-content').forEach(el => {
                el.setAttribute('contenteditable', 'true');
                el.style.cursor = '';
            });
            document.querySelectorAll('.controls, .add-btn, .drag-handle').forEach(el => el.style.display = '');
                const titleInput = document.getElementById('page-title-input');
                if (titleInput) titleInput.removeAttribute('disabled');
        }
        // Insert share‑only footer when in shared read‑only mode
        if (shareToken && !document.getElementById('share-footer')) {
            const footer = document.createElement('div');
            footer.id = 'share-footer';
            footer.textContent = '© 2026 織語';
            footer.className = 'text-xs text-center text-gray-500 mt-4 mb-2';
            // Append to main content container if present, otherwise to body
            const mainContent = document.getElementById('main-content');
            if (mainContent) {
                mainContent.appendChild(footer);
            } else {
                document.body.appendChild(footer);
            }
        }
    }
    // Patch renderMain to run applyPreviewUI after the original logic
    window.renderMain = function() {
        originalRenderMain.apply(this, arguments);
        applyPreviewUI();
    };
    // Run once now in case the page is already rendered
    applyPreviewUI();
});