"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useParams } from "next/navigation";
import { Copy, Check, Download, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const SPEAKER_COLORS = [
  "bg-indigo-100 text-indigo-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const [copied, setCopied] = useState(false);

  let participants: any[] | undefined;
  let transcripts: any[] | undefined;
  let endSession: any;

  try {
    participants = useQuery(api.participants.listBySession, {
      sessionId: sessionId as Id<"sessions">,
    });
    transcripts = useQuery(api.transcripts.listBySession, {
      sessionId: sessionId as Id<"sessions">,
    });
    endSession = useMutation(api.sessions.end);
  } catch {
    participants = [];
    transcripts = [];
    endSession = null;
  }

  const speakerColorMap = new Map<string, string>();
  let colorIdx = 0;
  const getColor = (name: string) => {
    if (!speakerColorMap.has(name)) {
      speakerColorMap.set(name, SPEAKER_COLORS[colorIdx % SPEAKER_COLORS.length]);
      colorIdx++;
    }
    return speakerColorMap.get(name)!;
  };

  const sessionCode = "---";

  const copyCode = () => {
    navigator.clipboard.writeText(sessionCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEnd = async () => {
    if (endSession) {
      await endSession({ id: sessionId as Id<"sessions"> });
    }
  };

  const handleExport = () => {
    if (!transcripts?.length) return;
    const text = transcripts
      .map((t: any) => `[${t.speakerName}] ${t.originalText}\n→ ${JSON.stringify(t.translations)}`)
      .join("\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${sessionId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Session</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-slate-500">Live</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyCode}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            Code
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Download className="h-3 w-3" />
            Export
          </button>
          <button
            onClick={handleEnd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
          >
            <StopCircle className="h-3 w-3" />
            End Session
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden pt-4">
        {/* Participants Panel */}
        <div className="w-64 shrink-0 space-y-3">
          <h2 className="text-sm font-medium text-slate-500">
            Participants ({participants?.length ?? 0})
          </h2>
          {participants?.map((p: any) => (
            <div
              key={p._id}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-600">
                  {p.name?.[0] ?? "?"}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-400">
                    {p.spokenLanguage?.toUpperCase()} → {p.listenLanguage?.toUpperCase()}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {(!participants || participants.length === 0) && (
            <p className="text-xs text-slate-400">
              Waiting for participants to join...
            </p>
          )}
        </div>

        {/* Transcript Panel */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-medium text-slate-500">
              Live Transcript ({transcripts?.length ?? 0} entries)
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {(!transcripts || transcripts.length === 0) ? (
              <p className="py-12 text-center text-sm text-slate-400">
                Transcript will appear here when participants start speaking...
              </p>
            ) : (
              <div className="space-y-4">
                {transcripts.map((line: any) => (
                  <div key={line._id} className="animate-fade-in-up">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                          getColor(line.speakerName),
                        )}
                      >
                        {line.speakerName}
                      </span>
                      <span className="text-[10px] text-slate-300">
                        {new Date(line.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-900">
                      {line.translations
                        ? Object.values(line.translations)[0] as string
                        : line.originalText}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {line.originalText}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
