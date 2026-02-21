export interface LanguageOption {
  code: string;
  name: string;
  speechmaticsCode: string;
  minimaxName: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "en", name: "English", speechmaticsCode: "en", minimaxName: "English" },
  { code: "es", name: "Spanish", speechmaticsCode: "es", minimaxName: "Spanish" },
  { code: "fr", name: "French", speechmaticsCode: "fr", minimaxName: "French" },
  { code: "de", name: "German", speechmaticsCode: "de", minimaxName: "German" },
  { code: "it", name: "Italian", speechmaticsCode: "it", minimaxName: "Italian" },
  { code: "pt", name: "Portuguese", speechmaticsCode: "pt", minimaxName: "Portuguese" },
  { code: "zh", name: "Chinese (Mandarin)", speechmaticsCode: "cmn", minimaxName: "Chinese" },
  { code: "ja", name: "Japanese", speechmaticsCode: "ja", minimaxName: "Japanese" },
  { code: "ko", name: "Korean", speechmaticsCode: "ko", minimaxName: "Korean" },
  { code: "ar", name: "Arabic", speechmaticsCode: "ar", minimaxName: "Arabic" },
  { code: "hi", name: "Hindi", speechmaticsCode: "hi", minimaxName: "Hindi" },
  { code: "ru", name: "Russian", speechmaticsCode: "ru", minimaxName: "Russian" },
  { code: "nl", name: "Dutch", speechmaticsCode: "nl", minimaxName: "Dutch" },
  { code: "sv", name: "Swedish", speechmaticsCode: "sv", minimaxName: "Swedish" },
  { code: "pl", name: "Polish", speechmaticsCode: "pl", minimaxName: "Polish" },
  { code: "tr", name: "Turkish", speechmaticsCode: "tr", minimaxName: "Turkish" },
];

export function getLanguageByCode(code: string): LanguageOption | undefined {
  return LANGUAGES.find((l) => l.code === code);
}
