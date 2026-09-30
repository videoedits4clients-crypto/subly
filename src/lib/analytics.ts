/**
 * Lightweight, provider-agnostic analytics event abstraction. Nothing here
 * talks to a third-party service — `track()` just calls whatever sink is
 * registered (a `console.log` by default), so wiring up PostHog/Segment/GA
 * later is a one-line change in `setAnalyticsSink` rather than a rewrite of
 * every call site sprinkled through the app.
 *
 * Works identically from server code (API routes, the export/transcription
 * pipelines) and client components — call `track(...)` from either.
 */
export type AnalyticsEvent =
  | "project_created"
  | "video_uploaded"
  | "transcription_started"
  | "transcription_completed"
  | "transcription_failed"
  | "transcription_cancelled"
  | "transcription_stalled"
  | "subtitle_edited"
  | "style_applied"
  | "preset_applied"
  | "translation_started"
  | "translation_completed"
  | "filler_words_removed"
  | "silence_removed"
  | "video_trimmed"
  | "export_started"
  | "export_completed"
  | "export_failed"
  | "export_cancelled"
  | "export_stalled"
  | "export_font_unavailable"
  | "export_verification_failed"
  | "project_deleted"
  | "project_restored"
  | "project_permanently_deleted";

export type AnalyticsProperties = Record<string, string | number | boolean | undefined>;

export type AnalyticsSink = (event: AnalyticsEvent, properties: AnalyticsProperties) => void;

const defaultSink: AnalyticsSink = (event, properties) => {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(`[analytics] ${event}`, properties);
  }
};

let sink: AnalyticsSink = defaultSink;

/** Swaps the analytics backend — call once at app startup to route events to a real provider instead of the console. */
export function setAnalyticsSink(next: AnalyticsSink): void {
  sink = next;
}

export function track(event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  try {
    sink(event, properties);
  } catch {
    // Analytics must never break the feature it's observing.
  }
}
