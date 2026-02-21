export default defineBackground(() => {
  console.log("[interpreter] background service worker started");

  let contentTabId: number | null = null;

  browser.runtime.onInstalled.addListener(() => {
    console.log("[interpreter] extension installed");
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "requestTabCapture" && sender.tab?.id) {
      contentTabId = sender.tab.id;
      handleTabCapture(sender.tab.id).then(sendResponse);
      return true;
    }

    if (msg.type === "stopTabCapture") {
      chrome.runtime.sendMessage({ type: "stopCapture" });
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "audioChunk" && contentTabId !== null) {
      chrome.tabs.sendMessage(contentTabId, {
        type: "audioChunk",
        buffer: msg.buffer,
      });
      return false;
    }
  });

  async function handleTabCapture(tabId: number) {
    try {
      await ensureOffscreenDocument();

      const streamId = await new Promise<string>((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId(
          { targetTabId: tabId },
          (id) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(id);
            }
          },
        );
      });

      const response = await chrome.runtime.sendMessage({
        type: "startCapture",
        streamId,
      });

      if (response?.error) {
        return { error: response.error };
      }

      return { ok: true };
    } catch (err: any) {
      console.error("[background] tab capture error:", err);
      return { error: err.message };
    }
  }

  async function ensureOffscreenDocument() {
    const existing = await chrome.offscreen.hasDocument();
    if (existing) return;

    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Capture tab audio for real-time translation",
    });
  }
});
