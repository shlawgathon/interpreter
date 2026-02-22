/**
 * Google Meet overlay widget — injected as a content script.
 * Renders a floating translation control panel at the bottom-right of the
 * meeting window using shadow DOM for full style isolation.
 */

import { LANGUAGES } from "../utils/languages";

const MEETING_PATTERN = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;

type WidgetStatus = "idle" | "connected" | "capturing" | "disconnected" | "error";

const STATUS_LABELS: Record<WidgetStatus, string> = {
  idle: "Ready",
  connected: "Connected",
  capturing: "Translating live",
  disconnected: "Disconnected",
  error: "Error",
};

/* ═══════════════════════════════════════════
   CSS (injected into shadow DOM)
   ═══════════════════════════════════════════ */
const WIDGET_CSS = `
@import url("https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap");

:host {
  all: initial;
  font-family: "DM Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  --bg: #1e1e24;
  --surface: #262630;
  --elevated: #2e2e3a;
  --hover: #363642;
  --border: #444450;
  --border-a: #5a5a68;
  --text: #fafafa;
  --text2: #c8c8d0;
  --muted: #8888a0;
  --amber: #f0c674;
  --amber-dim: rgba(240,198,116,0.15);
  --amber-glow: rgba(240,198,116,0.35);
  --green: #86efac;
  --green-dim: rgba(134,239,172,0.12);
  --red: #fca5a5;
  --red-dim: rgba(252,165,165,0.12);
  --r: 12px;
  --rs: 8px;
}

*,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── FAB (minimized) ── */
.fab {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--bg);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  box-shadow: 0 4px 24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06);
}

.fab:hover {
  border-color: var(--border-a);
  transform: scale(1.08);
  box-shadow: 0 6px 32px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.1);
}

.fab svg {
  width: 20px;
  height: 20px;
  color: var(--amber);
}

.fab-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
  border: 2px solid var(--bg);
}

.fab-dot.capturing {
  background: var(--amber);
  animation: fpulse 2s ease-in-out infinite;
}

.fab-dot.connected { background: var(--green); }
.fab-dot.error, .fab-dot.disconnected { background: var(--red); }

@keyframes fpulse {
  0%,100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ── Panel (expanded) ── */
.panel {
  width: 310px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 8px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08);
  overflow: hidden;
  animation: panel-in 0.25s ease;
}

@keyframes panel-in {
  from { opacity: 0; transform: translateY(12px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* header */
.p-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 10px;
}

.p-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--amber-dim), transparent);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.p-logo svg { width: 14px; height: 14px; color: var(--amber); }

.p-title {
  flex: 1;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.3px;
}

.p-waveform {
  width: 32px;
  height: 16px;
  color: var(--muted);
  transition: color 0.4s;
}

.p-waveform.active { color: var(--amber); }

.p-minimize {
  width: 24px;
  height: 24px;
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  font-size: 14px;
  line-height: 1;
}

.p-minimize:hover {
  color: var(--text2);
  border-color: var(--border-a);
}

/* status */
.p-status {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 16px;
  font-size: 11px;
  color: var(--text2);
  font-weight: 500;
}

.s-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  flex-shrink: 0;
}

.s-dot.capturing {
  background: var(--amber);
  animation: fpulse 2s ease-in-out infinite;
}

.s-dot.connected { background: var(--green); }
.s-dot.error, .s-dot.disconnected { background: var(--red); }

/* body */
.p-body {
  padding: 8px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* languages */
.langs {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  overflow: hidden;
}

.langs select {
  flex: 1;
  min-width: 0;
  padding: 7px 24px 7px 9px;
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: var(--rs);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' fill='%235a5a65' viewBox='0 0 16 16'%3E%3Cpath d='M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  transition: border-color 0.2s;
}

.langs select:focus {
  outline: none;
  border-color: var(--border-a);
}

.langs select:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.swap-btn {
  width: 26px;
  height: 26px;
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.25s;
}

.swap-btn svg { width: 12px; height: 12px; transition: transform 0.3s; }

.swap-btn:hover {
  color: var(--text2);
  border-color: var(--border-a);
}

.swap-btn:hover svg { transform: rotate(180deg); }
.swap-btn:disabled { opacity: 0.3; cursor: not-allowed; }

/* action button */
.action-btn {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.action-btn svg { width: 13px; height: 13px; }

.action-btn.start {
  background: var(--amber);
  color: #09090b;
}

.action-btn.start:hover {
  box-shadow: 0 4px 20px var(--amber-glow);
  transform: translateY(-1px);
}

.action-btn.stop {
  background: var(--elevated);
  color: var(--text);
  border: 1px solid var(--border);
}

.action-btn.stop:hover {
  background: var(--hover);
  border-color: var(--border-a);
}

/* transcript */
.transcript {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--rs);
  padding: 10px;
  max-height: 120px;
  min-height: 48px;
  overflow-y: auto;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text2);
}

.transcript::-webkit-scrollbar { width: 3px; }
.transcript::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

.t-entry {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
  animation: tup 0.3s ease;
}

.t-entry:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }

.t-orig { color: var(--muted); font-size: 10px; font-style: italic; margin-bottom: 2px; }
.t-trans { color: var(--text); font-weight: 500; font-size: 11.5px; }

.t-empty {
  color: var(--muted);
  text-align: center;
  padding: 10px 0;
  font-size: 10.5px;
}

@keyframes tup {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* waveform SVG */
.wf .wf-bar {
  transform-origin: center;
  transform: scaleY(1);
  transition: transform 0.3s;
}

.wf.active .wf-bar {
  animation: wfd 0.7s ease-in-out infinite alternate;
}

.wf.active .wf-bar:nth-child(1) { animation-delay: 0ms; }
.wf.active .wf-bar:nth-child(2) { animation-delay: 120ms; }
.wf.active .wf-bar:nth-child(3) { animation-delay: 240ms; }
.wf.active .wf-bar:nth-child(4) { animation-delay: 160ms; }
.wf.active .wf-bar:nth-child(5) { animation-delay: 80ms; }

@keyframes wfd {
  0% { transform: scaleY(0.25); }
  100% { transform: scaleY(1); }
}

/* container positioning */
.widget-anchor {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
`;

/* ═══════════════════════════════════════════
   SVG Snippets
   ═══════════════════════════════════════════ */
const SVG_GLOBE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

const SVG_WAVEFORM = `<svg viewBox="0 0 32 20" fill="currentColor" class="wf"><rect class="wf-bar" x="3" y="6" width="3" height="8" rx="1.5"/><rect class="wf-bar" x="8.5" y="3" width="3" height="14" rx="1.5"/><rect class="wf-bar" x="14" y="1" width="3" height="18" rx="1.5"/><rect class="wf-bar" x="19.5" y="4" width="3" height="12" rx="1.5"/><rect class="wf-bar" x="25" y="6.5" width="3" height="7" rx="1.5"/></svg>`;

const SVG_SWAP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16l-4-4 4-4"/><path d="M17 8l4 4-4 4"/><path d="M3 12h18"/></svg>`;

const SVG_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>`;

const SVG_STOP = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

const SVG_MINUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

/* ═══════════════════════════════════════════
   Widget Class
   ═══════════════════════════════════════════ */
class InterpreterWidget {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private anchor!: HTMLDivElement;
  private fab!: HTMLDivElement;
  private panel!: HTMLDivElement;

  private expanded = false;
  private status: WidgetStatus = "idle";
  private isCapturing = false;
  private sourceLang = "en";
  private targetLang = "es";

  private transcripts: { orig: string; trans: string }[] = [];
  private currentOrig = "";
  private currentTrans = "";

  private fabDot!: HTMLDivElement;
  private statusDot!: HTMLDivElement;
  private statusLabel!: HTMLSpanElement;
  private waveformEl!: HTMLDivElement;
  private sourceSelect!: HTMLSelectElement;
  private targetSelect!: HTMLSelectElement;
  private swapBtn!: HTMLButtonElement;
  private actionBtn!: HTMLButtonElement;
  private transcriptBox!: HTMLDivElement;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "interpreter-meet-widget-host";
    this.shadow = this.host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = WIDGET_CSS;
    this.shadow.appendChild(style);

    this.buildDOM();
    document.body.appendChild(this.host);

    this.loadSettings();
    this.listenForMessages();
    this.syncState();
  }

  /* ── DOM Construction ── */

  private buildDOM(): void {
    this.anchor = this.el("div", "widget-anchor");

    this.buildFab();
    this.buildPanel();

    this.anchor.appendChild(this.fab);
    this.shadow.appendChild(this.anchor);
  }

  private buildFab(): void {
    this.fab = this.el("div", "fab");
    this.fab.innerHTML = SVG_GLOBE;

    this.fabDot = this.el("div", "fab-dot");
    this.fab.appendChild(this.fabDot);

    this.fab.addEventListener("click", () => this.toggleExpand());
  }

  private buildPanel(): void {
    this.panel = this.el("div", "panel");

    // Header
    const header = this.el("div", "p-header");
    const logo = this.el("div", "p-logo");
    logo.innerHTML = SVG_GLOBE;
    const title = this.el("span", "p-title");
    title.textContent = "Interpreter";

    this.waveformEl = this.el("div", "p-waveform");
    this.waveformEl.innerHTML = SVG_WAVEFORM;

    const minBtn = this.el("button", "p-minimize") as HTMLButtonElement;
    minBtn.innerHTML = SVG_MINUS;
    minBtn.addEventListener("click", () => this.toggleExpand());

    header.append(logo, title, this.waveformEl, minBtn);

    // Status
    const statusRow = this.el("div", "p-status");
    this.statusDot = this.el("div", "s-dot");
    this.statusLabel = this.el("span") as HTMLSpanElement;
    this.statusLabel.textContent = "Ready";
    statusRow.append(this.statusDot, this.statusLabel);

    // Body
    const body = this.el("div", "p-body");

    // Languages
    const langs = this.el("div", "langs");
    this.sourceSelect = this.buildLangSelect(this.sourceLang);
    this.targetSelect = this.buildLangSelect(this.targetLang);
    this.swapBtn = this.el("button", "swap-btn") as HTMLButtonElement;
    this.swapBtn.innerHTML = SVG_SWAP;
    this.swapBtn.addEventListener("click", () => this.swapLangs());
    langs.append(this.sourceSelect, this.swapBtn, this.targetSelect);

    // Action button
    this.actionBtn = this.el("button", "action-btn start") as HTMLButtonElement;
    this.actionBtn.innerHTML = `${SVG_PLAY}<span>Start Translation</span>`;
    this.actionBtn.addEventListener("click", () => this.toggleCapture());

    // Transcript
    this.transcriptBox = this.el("div", "transcript");
    this.transcriptBox.innerHTML = `<div class="t-empty">Translations will appear here</div>`;

    body.append(langs, this.actionBtn, this.transcriptBox);
    this.panel.append(header, statusRow, body);
  }

  private buildLangSelect(selected: string): HTMLSelectElement {
    const sel = document.createElement("select");
    for (const lang of LANGUAGES) {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = lang.name;
      if (lang.code === selected) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  /* ── Expand / Collapse ── */

  private toggleExpand(): void {
    this.expanded = !this.expanded;
    if (this.expanded) {
      this.fab.remove();
      this.anchor.appendChild(this.panel);
    } else {
      this.panel.remove();
      this.anchor.appendChild(this.fab);
    }
  }

  /* ── Language Swap ── */

  private swapLangs(): void {
    const tmp = this.sourceSelect.value;
    this.sourceSelect.value = this.targetSelect.value;
    this.targetSelect.value = tmp;
    this.sourceLang = this.sourceSelect.value;
    this.targetLang = this.targetSelect.value;
    chrome.storage.sync.set({ sourceLang: this.sourceLang, targetLang: this.targetLang });
  }

  /* ── Start / Stop ── */

  private toggleCapture(): void {
    if (this.isCapturing) {
      chrome.runtime.sendMessage({ type: "stop-capture", target: "background" });
    } else {
      this.sourceLang = this.sourceSelect.value;
      this.targetLang = this.targetSelect.value;
      chrome.storage.sync.set({ sourceLang: this.sourceLang, targetLang: this.targetLang });
      chrome.runtime.sendMessage(
        {
          type: "start-capture",
          target: "background",
          sourceLang: this.sourceLang,
          targetLang: this.targetLang,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            this.setStatus("error", chrome.runtime.lastError.message);
            return;
          }
          if (response && !response.success) {
            this.setStatus("error", response.error || "Failed to start capture");
          }
        }
      );
    }
  }

  /* ── Status Updates ── */

  private setStatus(s: WidgetStatus, errorMsg?: string): void {
    this.status = s;
    this.isCapturing = s === "capturing";

    this.fabDot.className = `fab-dot ${s}`;
    this.statusDot.className = `s-dot ${s}`;
    this.statusLabel.textContent = s === "error" ? (errorMsg || "Error") : STATUS_LABELS[s];

    this.waveformEl.className = `p-waveform${this.isCapturing ? " active" : ""}`;
    const wfSvg = this.waveformEl.querySelector(".wf");
    if (wfSvg) {
      wfSvg.classList.toggle("active", this.isCapturing);
    }

    this.sourceSelect.disabled = this.isCapturing;
    this.targetSelect.disabled = this.isCapturing;
    this.swapBtn.disabled = this.isCapturing;

    if (this.isCapturing) {
      this.actionBtn.className = "action-btn stop";
      this.actionBtn.innerHTML = `${SVG_STOP}<span>Stop Translation</span>`;
    } else {
      this.actionBtn.className = "action-btn start";
      this.actionBtn.innerHTML = `${SVG_PLAY}<span>Start Translation</span>`;
    }
  }

  /* ── Transcript Rendering ── */

  private renderTranscript(): void {
    const box = this.transcriptBox;
    if (this.transcripts.length === 0 && !this.currentOrig) {
      box.innerHTML = `<div class="t-empty">Translations will appear here</div>`;
      return;
    }

    let html = "";
    const recent = this.transcripts.slice(-5);
    for (const t of recent) {
      html += `<div class="t-entry"><div class="t-orig">${this.esc(t.orig)}</div><div class="t-trans">${this.esc(t.trans)}</div></div>`;
    }
    if (this.currentOrig) {
      html += `<div class="t-entry"><div class="t-orig">${this.esc(this.currentOrig)}</div>`;
      if (this.currentTrans) {
        html += `<div class="t-trans">${this.esc(this.currentTrans)}</div>`;
      }
      html += `</div>`;
    }
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }

  /* ── Chrome Messaging ── */

  private listenForMessages(): void {
    chrome.runtime.onMessage.addListener((msg: any) => {
      if (msg.target !== "popup") return;

      switch (msg.type) {
        case "status":
          this.setStatus(msg.status as WidgetStatus);
          break;
        case "transcript":
          if (msg.isFinal) {
            this.currentOrig = (this.currentOrig + " " + msg.text).trim();
          } else {
            this.currentOrig = msg.text;
          }
          this.renderTranscript();
          break;
        case "translated-text":
          this.transcripts.push({ orig: this.currentOrig, trans: msg.text });
          this.currentOrig = "";
          this.currentTrans = "";
          this.renderTranscript();
          break;
        case "translated-text-partial":
          this.currentTrans = msg.text;
          this.renderTranscript();
          break;
        case "error":
          this.setStatus("error", msg.message);
          break;
      }
    });
  }

  private syncState(): void {
    chrome.runtime.sendMessage({ type: "get-state", target: "background" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.isCapturing) {
        this.setStatus("capturing");
      }
    });
  }

  private loadSettings(): void {
    chrome.storage.sync.get(["sourceLang", "targetLang"], (data) => {
      if (data.sourceLang) {
        this.sourceLang = data.sourceLang;
        this.sourceSelect.value = data.sourceLang;
      }
      if (data.targetLang) {
        this.targetLang = data.targetLang;
        this.targetSelect.value = data.targetLang;
      }
    });
  }

  /* ── Helpers ── */

  private el(tag: string, className?: string): HTMLDivElement {
    const e = document.createElement(tag) as HTMLDivElement;
    if (className) e.className = className;
    return e;
  }

  private esc(s: string): string {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  destroy(): void {
    this.host.remove();
  }
}

/* ═══════════════════════════════════════════
   Activation Logic
   ═══════════════════════════════════════════ */

let widget: InterpreterWidget | null = null;

function maybeActivate(): void {
  const inMeeting = MEETING_PATTERN.test(window.location.pathname);
  if (inMeeting && !widget) {
    widget = new InterpreterWidget();
  } else if (!inMeeting && widget) {
    widget.destroy();
    widget = null;
  }
}

maybeActivate();

let lastHref = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    maybeActivate();
  }
});
observer.observe(document.body, { childList: true, subtree: true });
