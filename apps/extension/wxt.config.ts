import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Interpreter — Real-Time Meet Translation",
    description: "Hear every Google Meet participant in your language with real-time translation and dubbing.",
    permissions: ["activeTab", "tabCapture"],
    host_permissions: ["https://meet.google.com/*"],
  },
  runner: {
    startUrls: ["https://meet.google.com"],
  },
});
