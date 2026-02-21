"use client";

import { useState, useRef } from "react";
import { Shield, Upload, Play, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@interpreter/shared";

const WS_SERVER = process.env.NEXT_PUBLIC_WS_SERVER_URL?.replace("ws://", "http://") ?? "http://localhost:8080";

type CloneStatus = "idle" | "uploading" | "ready" | "error";

export default function SettingsPage() {
  const [spokenLang, setSpokenLang] = useState("en");
  const [listenLang, setListenLang] = useState("en");
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [cloneStatus, setCloneStatus] = useState<CloneStatus>("idle");
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCloneStatus("uploading");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${WS_SERVER}/api/voice-clone`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json();
      setVoiceId(data.voiceId);
      setCloneStatus("ready");
    } catch {
      setCloneStatus("error");
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Settings
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Configure your language preferences and voice profile.
      </p>

      <div className="mt-8 space-y-6">
        {/* Language Preferences */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">
            Language Preferences
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Set your default spoken and listening languages.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">
                I Speak
              </label>
              <select
                value={spokenLang}
                onChange={(e) => setSpokenLang(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">
                I Hear
              </label>
              <select
                value={listenLang}
                onChange={(e) => setListenLang(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Voice Clone */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
              <Shield className="h-5 w-5 text-brand-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-slate-900">
                Voice Clone
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                When enabled, your translated speech will sound like your
                own voice to other listeners. Requires explicit consent.
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => setVoiceConsent(!voiceConsent)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                voiceConsent ? "bg-brand-primary" : "bg-slate-200"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  voiceConsent ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <span className="text-sm text-slate-700">
              I consent to voice cloning for translation purposes
            </span>
          </div>

          {voiceConsent && (
            <div className="mt-5">
              {cloneStatus === "idle" && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Upload className="h-8 w-8 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        Upload a voice sample
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        10 seconds to 5 minutes of clear speech. MP3, WAV, or
                        M4A up to 20MB.
                      </p>
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-primary-dark"
                    >
                      Choose File
                    </button>
                  </div>
                </div>
              )}

              {cloneStatus === "uploading" && (
                <div className="flex items-center gap-3 rounded-lg bg-indigo-50 p-4">
                  <Loader2 className="h-5 w-5 animate-spin text-brand-primary" />
                  <p className="text-sm text-brand-primary">
                    Processing your voice sample...
                  </p>
                </div>
              )}

              {cloneStatus === "ready" && (
                <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-4">
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-medium text-emerald-700">
                      Voice profile ready
                    </p>
                    <p className="text-xs text-emerald-600">
                      ID: {voiceId?.slice(0, 12)}... — expires in 7 days
                    </p>
                  </div>
                </div>
              )}

              {cloneStatus === "error" && (
                <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  <div>
                    <p className="text-sm font-medium text-red-700">
                      Voice cloning failed
                    </p>
                    <button
                      onClick={() => setCloneStatus("idle")}
                      className="mt-1 text-xs text-red-600 underline"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-xs text-amber-700">
              Cloned voices expire after 7 days of inactivity. Your audio
              samples are processed securely and never shared.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <button className="rounded-lg bg-brand-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-primary-dark">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
