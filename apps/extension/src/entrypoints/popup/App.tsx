import { useState } from "react";
import { SUPPORTED_LANGUAGES } from "@interpreter/shared";

export function App() {
  const [sessionCode, setSessionCode] = useState("");
  const [spokenLang, setSpokenLang] = useState("en");
  const [listenLang, setListenLang] = useState("en");
  const [connected] = useState(false);

  return (
    <div className="flex h-[500px] w-[400px] flex-col bg-slate-900 text-slate-100">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2" />
            <path d="M8 12h8M12 8v8" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <span className="text-lg font-semibold">Interpreter</span>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${
            connected
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-red-500/20 text-red-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-5 p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Session Code
          </label>
          <div className="flex gap-2">
            <input
              value={sessionCode}
              onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
              placeholder="Enter code..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm outline-none placeholder:text-slate-600 focus:border-brand-primary-light"
            />
            <button className="rounded-lg bg-brand-primary px-4 text-sm font-medium transition-colors hover:bg-brand-primary-dark">
              Join
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">
              I Speak
            </label>
            <select
              value={spokenLang}
              onChange={(e) => setSpokenLang(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm outline-none focus:border-brand-primary-light"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">
              I Hear
            </label>
            <select
              value={listenLang}
              onChange={(e) => setListenLang(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm outline-none focus:border-brand-primary-light"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Dub Volume
          </label>
          <div className="flex items-center gap-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M11 5L6 9H2v6h4l5 4V5z"
                stroke="#94A3B8"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <input
              type="range"
              min="0"
              max="100"
              defaultValue="70"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-brand-accent"
            />
            <span className="w-8 text-right text-xs text-slate-400">70%</span>
          </div>
        </div>

        <div className="mt-auto">
          <a
            href="http://localhost:3000/dashboard"
            target="_blank"
            rel="noreferrer"
            className="block w-full rounded-lg border border-slate-700 py-2.5 text-center text-sm font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
          >
            Open Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
