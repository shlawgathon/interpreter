"use client";

import { Mic2, Play, Trash2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const DEMO_PROFILES = [
  {
    id: "1",
    name: "My Voice — English",
    status: "ready" as const,
    createdAt: "Feb 20, 2026",
    expiresAt: "Feb 27, 2026",
  },
  {
    id: "2",
    name: "My Voice — Hindi",
    status: "pending" as const,
    createdAt: "Feb 21, 2026",
    expiresAt: "Feb 28, 2026",
  },
];

const STATUS_STYLES = {
  ready: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  expired: "bg-slate-100 text-slate-500",
};

export default function VoiceProfilesPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Voice Profiles
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your cloned voice profiles for translated speech.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-primary-dark">
          <Mic2 className="h-4 w-4" />
          New Profile
        </button>
      </div>

      <div className="mt-8 space-y-3">
        {DEMO_PROFILES.map((profile) => (
          <div
            key={profile.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-sm"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50">
                <Mic2 className="h-6 w-6 text-brand-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {profile.name}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                      STATUS_STYLES[profile.status],
                    )}
                  >
                    {profile.status}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                  <span>Created {profile.createdAt}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Expires {profile.expiresAt}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600">
                <Play className="h-4 w-4" />
              </button>
              <button className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
