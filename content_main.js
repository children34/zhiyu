// isTriggerKey 函數的修復範例
// 請將此函數新增至 content_main.js 中，或替換現有的 isTriggerKey 實作

function isTriggerKey(event) {
  // 1. 檢查 event 是否存在
  if (!event) return false;

  // 2. 檢查 key 是否存在
  if (!event.key) return false;

  // 3. 安全地呼叫 toLowerCase
  const key = event.key.toString().toLowerCase();

  // 4. 你的觸發邏輯
  // 例如：return key === 'some-specific-key';

  // 預設返回 false（若需要特定鍵位比較，請自行實作回傳邏輯）
  return false;
}

// 將是 Trigger Key 函數綁定到事件監聽器 (示例)
document.addEventListener('keydown', (event) => {
  if (isTriggerKey(event)) {
    // 執行對應的觸發動作
    console.log('觸發鍵盤快捷鍵');
    // yourCodeHere();
  }
});

// 另一種寫法：直接作為對象方法 (若原本為 uR.isTriggerKey 結構)
const keyHandler = {
  isTriggerKey: function(event) {
    // 1. 檢查 event 是否存在
    if (!event) return false;

    // 2. 檢查 key 是否存在
    if (!event.key) return false;

    // 3. 安全地呼叫 toLowerCase
    const key = event.key.toString().toLowerCase();

    // 4. 你的觸發邏輯
    // return key === 'specific-key';

    // 預設返回 false
    return false;
  }
};

// 使用範例：直接呼叫
// if (keyHandler.isTriggerKey(event)) { ... }