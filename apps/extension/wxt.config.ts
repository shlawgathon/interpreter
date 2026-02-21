import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Interpreter — Real-Time Meet Translation",
    description: "Hear every Google Meet participant in your language with real-time translation and dubbing.",
    permissions: ["activeTab"],
    host_permissions: ["https://meet.google.com/*"],
    web_accessible_resources: [
      {
        resources: ["webrtc-intercept.js"],
        matches: ["https://meet.google.com/*"],
      },
    ],
  },
  runner: {
    startUrls: ["https://meet.google.com"],
  },
});
