import "../../assets/styles.css";
import { createRoot } from "react-dom/client";
import { Overlay } from "../../components/Overlay";

export default defineContentScript({
  matches: ["https://meet.google.com/*"],
  cssInjectionMode: "ui",

  async main(ctx) {
    console.log("[interpreter] content script loaded on Meet");

    const ui = await createShadowRootUi(ctx, {
      name: "interpreter-overlay",
      position: "overlay",
      alignment: "bottom-right",
      onMount(container) {
        const root = createRoot(container);
        root.render(<Overlay />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
