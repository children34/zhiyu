(async function() {
  const out = document.getElementById('output');

  function log(msg) {
    console.log(msg);
    out.textContent += msg + '\n';
  }

  try {
    // 嘗試使用 Google 登入（若尚未登入）
    if (typeof auth !== 'undefined' && auth.currentUser == null) {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
      log('已使用 Google 登入');
    }

    const testRef = db.collection('firestore_test').doc('test_doc');
    // 寫入測試資料
    await testRef.set({ timestamp: Date.now(), message: 'Firestore 測試成功' });
    log('寫入成功');

    // 讀取測試資料
    const snap = await testRef.get();
    if (snap.exists) {
      log('讀取成功：' + JSON.stringify(snap.data()));
    } else {
      log('讀取失敗：文件不存在');
    }
  } catch (e) {
    log('錯誤: ' + e);
  }
})();