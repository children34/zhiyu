# Firestore 設定步驟

## 1. 建立 Firestore 資料庫
開啟以下網址，確認專案是 `zhiyu-0304`：

https://console.cloud.google.com/datastore/setup?project=zhiyu-0304

請選擇：
- `Native mode`
- `Standard` 版
- 任一適合地區（建議 `asia-east1`）

建立完成後，錯誤 `The database (default) does not exist` 才會消失。

## 2. 啟用 Google 登入
Firebase Console → Authentication → Sign-in method → Google → Enable

並確認 Authorized domains 至少包含：
- `localhost`
- `127.0.0.1`（如果您是用這個開發）

## 3. 套用 Firestore 規則
這個資料夾已經提供：
- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`

如果您的電腦有安裝 Firebase CLI，請在這個資料夾執行：

```bash
firebase login
firebase use zhiyu-0304
firebase deploy --only firestore:rules,firestore:indexes
```

## 4. 不用 CLI 的方式
也可以直接去 Firebase Console → Firestore Database → 規則，貼上 `firestore.rules` 內容後按「發佈」。

## 5. 目前規則內容
- `users/{uid}`：只允許登入者存取自己的文件
- `firestore_test/{docId}`：允許已登入使用者讀寫，方便測試

## 6. 測試成功條件
- Google 登入成功
- `index.html` 可進入編輯模式
- 不再出現 `The database (default) does not exist`
- `firestore_test/test_doc` 可成功寫入
