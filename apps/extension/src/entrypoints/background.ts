export default defineBackground(() => {
  console.log("[interpreter] background service worker started");

  browser.runtime.onInstalled.addListener(() => {
    console.log("[interpreter] extension installed");
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "requestTabCapture" && sender.tab?.id) {
      const tabId = sender.tab.id;

      chrome.tabCapture.getMediaStreamId(
        { consumerTabId: tabId },
        (streamId) => {
          if (chrome.runtime.lastError) {
            console.error("[tabCapture] error:", chrome.runtime.lastError.message);
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ streamId });
          }
        },
      );

      return true;
    }
  });
});
