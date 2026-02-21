export interface Language {
  code: string;
  name: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "zh", name: "Mandarin", flag: "🇨🇳" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "pt", name: "Portuguese", flag: "🇧🇷" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
];

export const LANGUAGE_MAP = new Map(
  SUPPORTED_LANGUAGES.map((l) => [l.code, l]),
);

export function getLanguageName(code: string): string {
  return LANGUAGE_MAP.get(code)?.name ?? code;
}

export function getLanguageFlag(code: string): string {
  return LANGUAGE_MAP.get(code)?.flag ?? "🌐";
}
