// auth-handler.js - Handles Supabase OAuth redirect fragment and cleans URL

;(async function() {
  // Ensure Supabase client is available
  if (typeof supabase === 'undefined') return;
  try {
    // Parse token from URL fragment (e.g. "#access_token=…&refresh_token=…") and store session
    await supabase.auth.getSessionFromUrl({ storeSession: true });
  } catch (e) {
    console.error('OAuth fragment parse error:', e);
  }

  // Remove the fragment so the URL looks clean
  if (window.location.hash) {
    const cleanUrl = window.location.pathname + window.location.search;
    // Use replaceState to avoid a page reload
    window.history.replaceState(null, '', cleanUrl);
  }
})();