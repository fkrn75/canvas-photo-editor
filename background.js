// background.js — MV3 서비스 워커
// 역할: 툴바 아이콘 클릭 시 에디터(editor.html)를 새 탭에서 연다.
// 리스너는 반드시 최상위(top-level)에 등록한다. 워커가 잠들었다 깨어나도 즉시 이벤트를 받기 위함이다.

// 이미 열려 있는 에디터 탭이 있으면 그 탭으로 포커스를 옮기고, 없으면 새 탭을 만든다.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("editor.html");
  try {
    // url 필터로 기존 에디터 탭을 찾는다("tabs" 권한 필요).
    const existing = await chrome.tabs.query({ url });
    if (existing.length > 0) {
      const tab = existing[0];
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return;
    }
  } catch (err) {
    // 권한 문제 등으로 query가 실패해도 아래에서 새 탭을 연다.
    console.warn("기존 탭 조회 실패, 새 탭을 엽니다:", err);
  }
  await chrome.tabs.create({ url });
});

// 설치 직후 1회 에디터를 열어 동작을 바로 확인할 수 있게 한다.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
  }
});
