export default defineBackground(() => {
  console.log("[interpreter] background service worker started");

  browser.runtime.onInstalled.addListener(() => {
    console.log("[interpreter] extension installed");
  });
});
