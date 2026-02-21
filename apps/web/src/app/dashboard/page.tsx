"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { Plus, Copy, Users, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@convex/_generated/api";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function DashboardPage() {
  const [showCreate, setShowCreate] = useState(false);

  let sessions: any[] | undefined;
  try {
    sessions = useQuery(api.sessions.list);
  } catch {
    sessions = undefined;
  }

  const hasSessions = sessions && sessions.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Your Sessions
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Create or join a translation session for your next Meet call.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-primary-dark hover:shadow-md"
        >
          <Plus className="h-4 w-4" />
          New Session
        </button>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sessions === undefined && (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
            ))}
          </>
        )}
        {sessions?.map((session: any) => (
          <SessionCardItem
            key={session._id}
            session={{
              id: session._id,
              name: session.name,
              code: session.code,
              status: session.status,
              createdAt: new Date(session.createdAt).toLocaleString(),
            }}
          />
        ))}
        {sessions?.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
            <p className="text-sm text-slate-500">No sessions yet.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-sm font-medium text-brand-primary hover:underline"
            >
              Create your first session
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateSessionModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

function SessionCardItem({
  session,
}: {
  session: { id: string; name: string; code: string; status: string; createdAt: string };
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(session.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <a
      href={`/dashboard/${session.id}`}
      className={cn(
        "block rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md",
        session.status === "active"
          ? "border-l-4 border-l-emerald-500 border-t-slate-200 border-r-slate-200 border-b-slate-200"
          : "border-slate-200",
      )}
    >
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-slate-900">{session.name}</h3>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            session.status === "active"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-500",
          )}
        >
          {session.status === "active" ? "Live" : "Ended"}
        </span>
      </div>

      <div className="mt-3">
        <button
          onClick={(e) => {
            e.preventDefault();
            copyCode();
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-600 transition-colors hover:bg-slate-200"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {session.code}
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-400">{session.createdAt}</p>
    </a>
  );
}

function CreateSessionModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdCode, setCreatedCode] = useState("");

  let createSession: any;
  try {
    createSession = useMutation(api.sessions.create);
  } catch {
    createSession = null;
  }

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);

    const code = generateCode();
    if (createSession) {
      await createSession({ name: name.trim(), code, hostId: "local-user" });
    }
    setCreatedCode(code);
    setCreating(false);
  };

  const [codeCopied, setCodeCopied] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md animate-fade-in-up rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        {!createdCode ? (
          <>
            <h2 className="text-lg font-semibold text-slate-900">New Session</h2>
            <p className="mt-1 text-sm text-slate-500">
              Create a translation session and share the join code with participants.
            </p>

            <div className="mt-5">
              <label className="block text-sm font-medium text-slate-700">Session Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Product Sync"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || creating}
                className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-40"
              >
                {creating ? "Creating..." : "Create Session"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-slate-900">Session Created</h2>
            <p className="mt-1 text-sm text-slate-500">
              Share this code with participants to join.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <span className="rounded-lg bg-slate-100 px-6 py-3 font-mono text-2xl font-bold tracking-widest text-slate-900">
                {createdCode}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(createdCode);
                  setCodeCopied(true);
                  setTimeout(() => setCodeCopied(false), 2000);
                }}
                className="rounded-lg border border-slate-200 p-3 text-slate-500 transition-colors hover:bg-slate-50"
              >
                {codeCopied ? <Check className="h-5 w-5 text-emerald-500" /> : <Copy className="h-5 w-5" />}
              </button>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-primary-dark"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
