import { useEffect, useRef } from "react";

export interface TranscriptLine {
  id: string;
  speakerName: string;
  translated: string;
  original: string;
  isFinal: boolean;
}

interface Props {
  lines: TranscriptLine[];
}

const SPEAKER_COLORS = [
  "bg-indigo-500/20 text-indigo-300",
  "bg-amber-500/20 text-amber-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-rose-500/20 text-rose-300",
  "bg-cyan-500/20 text-cyan-300",
];

export function TranscriptPanel({ lines }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScroll.current = atBottom;
  };

  const speakerColorMap = new Map<string, string>();
  let colorIdx = 0;
  const getColor = (name: string) => {
    if (!speakerColorMap.has(name)) {
      speakerColorMap.set(name, SPEAKER_COLORS[colorIdx % SPEAKER_COLORS.length]);
      colorIdx++;
    }
    return speakerColorMap.get(name)!;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="max-h-48 overflow-y-auto rounded-lg bg-slate-800/30 p-2"
    >
      {lines.length === 0 ? (
        <p className="py-4 text-center text-[10px] text-slate-500">
          Transcript will appear here...
        </p>
      ) : (
        <div className="space-y-2">
          {lines.map((line) => (
            <div key={line.id} className={line.isFinal ? "" : "opacity-60"}>
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-medium ${getColor(line.speakerName)}`}
              >
                {line.speakerName}
              </span>
              <p className="mt-0.5 font-mono text-[11px] leading-snug text-slate-200">
                {line.translated}
              </p>
            </div>
          ))}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
