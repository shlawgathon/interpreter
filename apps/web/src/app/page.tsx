import Link from "next/link";
import { Globe, Mic, Users, AudioWaveform } from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-primary">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-slate-900">
              Interpreter
            </span>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-primary-dark"
          >
            Open Dashboard
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-5xl font-bold tracking-tight text-slate-900">
            Hear every voice
            <br />
            <span className="text-brand-primary">in your language</span>
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-500">
            Real-time speech translation and dubbing for Google Meet.
            Each participant speaks naturally in their own language — everyone
            hears the conversation in theirs.
          </p>

          <div className="mt-10 flex justify-center gap-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-6 py-3 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-primary-dark hover:shadow-md"
            >
              Get Started
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50"
            >
              Learn More
            </a>
          </div>
        </div>

        <div id="features" className="mx-auto mt-24 grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          <FeatureCard
            icon={<Mic className="h-6 w-6 text-brand-primary" />}
            title="Per-Listener Translation"
            description="Each user selects the language they want to hear. All other speakers are translated into that language in real time."
          />
          <FeatureCard
            icon={<AudioWaveform className="h-6 w-6 text-brand-accent" />}
            title="Real-Time Dubbing"
            description="Translated speech is synthesized and played back naturally, with optional voice cloning to preserve each speaker's identity."
          />
          <FeatureCard
            icon={<Users className="h-6 w-6 text-emerald-500" />}
            title="Multi-Party Support"
            description="Works for 2–4+ participants with different input and output languages — Hindi, Spanish, English, Mandarin, and more."
          />
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8">
        <p className="text-center text-sm text-slate-400">
          Interpreter — Audio translation everywhere and anywhere
        </p>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-50">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        {description}
      </p>
    </div>
  );
}
