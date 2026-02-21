"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { FileText, Search, Download } from "lucide-react";
import { api } from "@convex/_generated/api";

export default function TranscriptsPage() {
  const [searchQuery, setSearchQuery] = useState("");

  let sessions: any[] | undefined;
  try {
    sessions = useQuery(api.sessions.list);
  } catch {
    sessions = undefined;
  }

  const filtered = useMemo(() => {
    if (!sessions) return [];
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s: any) =>
        s.name?.toLowerCase().includes(q) ||
        s.code?.toLowerCase().includes(q),
    );
  }, [sessions, searchQuery]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Transcripts
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Review and search past session transcripts.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by session name or code..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
          />
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {sessions === undefined && (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
            ))}
          </>
        )}

        {filtered.map((s: any) => (
          <a
            key={s._id}
            href={`/dashboard/${s._id}`}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50">
                <FileText className="h-5 w-5 text-slate-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">{s.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {new Date(s.createdAt).toLocaleDateString()} &middot;{" "}
                  <span className="font-mono">{s.code}</span> &middot;{" "}
                  {s.status === "active" ? "Live" : "Ended"}
                </p>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.preventDefault();
                // TODO: export transcript for this session
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Download className="h-3 w-3" />
              Export
            </button>
          </a>
        ))}

        {sessions?.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-400">
            No transcripts yet. Start a session to begin recording.
          </p>
        )}
      </div>
    </div>
  );
}
