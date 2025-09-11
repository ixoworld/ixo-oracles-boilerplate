export const supportedOracles = ['guru', 'giza', 'oracleSessions'];

type LiteralUnion<LiteralType extends BaseType, BaseType extends string> =
  | LiteralType
  | (BaseType & Record<never, never>);

export type OraclesNamesOnMatrix = LiteralUnion<
  (typeof supportedOracles)[number],
  string
>;
export enum AgentVoice {
  PUCK = 'Puck',
  CHARON = 'Charon',
  KORE = 'Kore',
  FENRIR = 'Fenrir',
  AOEDE = 'Aoede',
  LEDA = 'Leda',
  ORUS = 'Orus',
  ZEPHYR = 'Zephyr',
}

// Supported Gemini Live Half-Cascade Voices
export const SUPPORTED_VOICES = [
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Aoede',
  'Leda',
  'Orus',
  'Zephyr',
] as const;

// Supported Languages with their display names
export const SUPPORTED_LANGUAGES = {
  // English variants - only UK and US
  'en-GB': 'English (United Kingdom)',
  'en-US': 'English (United States)',
  // EU Languages
  'de-DE': 'German (Germany)',
  'fr-FR': 'French (France)',
  'fr-CA': 'French (Canada)',
  'es-ES': 'Spanish (Spain)',
  'it-IT': 'Italian (Italy)',
  'nl-NL': 'Dutch (Netherlands)',
  'pl-PL': 'Polish (Poland)',
  'ru-RU': 'Russian (Russia)',
  'tr-TR': 'Turkish (Turkey)',
  'vi-VN': 'Vietnamese (Vietnam)',
  'ja-JP': 'Japanese (Japan)',
  'ko-KR': 'Korean (South Korea)',
  'zh-CN': 'Mandarin Chinese (China)',
  'th-TH': 'Thai (Thailand)',
  'id-ID': 'Indonesian (Indonesia)',
  // Arabic
  'ar-XA': 'Arabic (Generic)',
  // Indian Languages
  'hi-IN': 'Hindi (India)',
  'bn-IN': 'Bengali (India)',
  'gu-IN': 'Gujarati (India)',
  'kn-IN': 'Kannada (India)',
  'ml-IN': 'Malayalam (India)',
  'mr-IN': 'Marathi (India)',
  'ta-IN': 'Tamil (India)',
  'te-IN': 'Telugu (India)',
} as const;

// Type definitions
export type VoiceName = (typeof SUPPORTED_VOICES)[number];
export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

// Helper arrays for easier iteration
export const LANGUAGE_CODES = Object.keys(
  SUPPORTED_LANGUAGES,
) as LanguageCode[];
export const LANGUAGE_NAMES = Object.values(SUPPORTED_LANGUAGES);

// Total combinations
export const TOTAL_COMBINATIONS =
  SUPPORTED_VOICES.length * LANGUAGE_CODES.length; // 208 combinations
export type OraclesCallMatrixEvent = {
  type: 'm.ixo.oracles_call';
  content: {
    sessionId: string;
    userDid: string;
    oracleDid: string;
    callType: 'audio' | 'video';
    callStatus: 'active' | 'ended' | 'pending';
    callStartedAt?: string;
    callEndedAt?: string;
    agentVoice?: VoiceName;
    language?: LanguageCode;
    encryptionKey: string;
  };
};

export * from 'matrix-bot-sdk';
