/**
 * THE single authoritative definition of SUBLY's V1 TRANSCRIPTION language policy — see the
 * explicit architecture freeze this codifies: "V1 language policy: English -> Whisper Small,
 * Hindi -> Whisper Small, Hinglish -> Whisper Small + existing deterministic Hinglish
 * conversion, Gujarati -> DEFERRED." Every other language listed below is deferred for the
 * exact same reason Gujarati is: none of them have been through this project's real-audio
 * benchmarking process (see research/hindi_benchmark, research/hinglish_benchmark), so none of
 * them may be presented, marketed, or requested as officially transcription-supported —
 * regardless of what the underlying Whisper model can technically attempt. "Whisper accepts
 * the language code" is not the bar; "this project validated it" is.
 *
 * This is the ONE place that decision lives. It's consumed by:
 *  - the pre-transcription language picker (types/subtitle.ts's TRANSCRIPTION_LANGUAGE_OPTIONS,
 *    re-exported from here — see components/dashboard/transcription-settings-dialog.tsx)
 *  - backend validation for any request that sets Project.language
 *    (src/app/api/projects/[id]/route.ts, src/app/api/projects/route.ts)
 *  - marketing copy (components/landing/features.tsx) — generated FROM this list via
 *    supportedLanguageSummary(), never hand-typed, so it cannot silently drift out of sync
 *  - Gujarati Script gating (lib/subtitles/output-mode.ts's projectSupportsGujaratiScript) —
 *    not itself changed, but documented against this policy: no NEW project can reach
 *    language "gu" once the picker/backend both enforce this list, so that gate now only
 *    ever fires for a project that already had "gu" before this freeze — preserved, not
 *    deleted, exactly as instructed.
 *
 * Explicitly NOT governed by this policy: the AI-translate feature (components/editor/
 * ai-menu.tsx) and the post-transcription LanguageSwitcher (components/editor/
 * language-switcher.tsx). Both operate on an ALREADY-transcribed text transcript via a cloud
 * text model (or its demo fallback) — a completely different question ("can a general text
 * model translate this transcript") from "can our local Whisper model transcribe this
 * language well," which is what this file governs. They keep using the full language catalog
 * (types/subtitle.ts's LANGUAGES).
 */

export type LanguagePolicyStatus = "supported" | "deferred";

export interface LanguagePolicyEntry {
  /** ISO-639-1-ish code, matching SupportedLanguage in types/subtitle.ts (excluding "auto"). */
  code: string;
  label: string;
  status: LanguagePolicyStatus;
}

export const LANGUAGE_POLICY: LanguagePolicyEntry[] = [
  { code: "en", label: "English", status: "supported" },
  { code: "hi", label: "Hindi", status: "supported" },
  { code: "gu", label: "Gujarati", status: "deferred" },
  { code: "mr", label: "Marathi", status: "deferred" },
  { code: "bn", label: "Bengali", status: "deferred" },
  { code: "ta", label: "Tamil", status: "deferred" },
  { code: "te", label: "Telugu", status: "deferred" },
  { code: "pa", label: "Punjabi", status: "deferred" },
  { code: "ur", label: "Urdu", status: "deferred" },
  { code: "es", label: "Spanish", status: "deferred" },
  { code: "fr", label: "French", status: "deferred" },
  { code: "de", label: "German", status: "deferred" },
  { code: "pt", label: "Portuguese", status: "deferred" },
  { code: "ar", label: "Arabic", status: "deferred" },
  { code: "ja", label: "Japanese", status: "deferred" },
  { code: "ko", label: "Korean", status: "deferred" },
];

export const SUPPORTED_LANGUAGES: LanguagePolicyEntry[] = LANGUAGE_POLICY.filter((l) => l.status === "supported");
export const DEFERRED_LANGUAGES: LanguagePolicyEntry[] = LANGUAGE_POLICY.filter((l) => l.status === "deferred");

/** True only for a language this project has actually validated for transcription. */
export function isLanguageSupported(code: string): boolean {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

export function isKnownLanguageCode(code: string): boolean {
  return LANGUAGE_POLICY.some((l) => l.code === code);
}

/** Options for the PRE-transcription picker: "Auto Detect" plus every officially supported
 * language — deferred languages are never offered here. Auto Detect is included because it
 * isn't itself a claim of support for any specific unvalidated language: it just lets Whisper
 * decide at runtime, same as it always has, and remains most useful/accurate on the languages
 * this project has actually validated. */
export const TRANSCRIPTION_LANGUAGE_POLICY_OPTIONS: { code: string; label: string }[] = [
  { code: "auto", label: "Auto Detect" },
  ...SUPPORTED_LANGUAGES.map((l) => ({ code: l.code, label: l.label })),
];

/** Validates a language code a client sent for TRANSCRIPTION purposes (Project.language). Used
 * by backend PATCH/create validation so a client can never bypass the UI and request a
 * deferred (or unknown) language directly. */
export function isValidTranscriptionLanguageRequest(code: string): boolean {
  return code === "auto" || isLanguageSupported(code);
}

/** Human-readable summary of what's actually supported, generated from the policy so
 * marketing/UI copy can never claim more than this without editing this one file — see
 * components/landing/features.tsx. */
export function supportedLanguageSummary(): string {
  const labels = SUPPORTED_LANGUAGES.map((l) => l.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
