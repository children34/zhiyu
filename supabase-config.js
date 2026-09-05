// supabase-config.js
const supabaseUrl = "https://kbfqcbuiimhptjsdkybp.supabase.co";
const supabaseKey = "sb_publishable_9W2nS5SBmt3FE97bUwH1mg_tMcTalrG";
window.supabase = supabase.createClient(supabaseUrl, supabaseKey);

// -------------------------
// 為了兼容舊程式碼，額外暴露別名
window.supabaseClient = window.supabase;