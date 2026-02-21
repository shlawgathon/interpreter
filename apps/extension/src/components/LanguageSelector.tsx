import { SUPPORTED_LANGUAGES } from "@interpreter/shared";

interface Props {
  label: string;
  value: string;
  onChange: (code: string) => void;
  compact?: boolean;
}

export function LanguageSelector({ label, value, onChange, compact }: Props) {
  if (compact) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 outline-none focus:border-brand-primary-light"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.flag} {lang.code.toUpperCase()}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-brand-primary-light"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.flag} {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
}
