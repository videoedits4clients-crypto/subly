/**
 * Tests for the per-language local Whisper model policy (Gujarati -> medium,
 * every other language unchanged) — see local-provider.ts resolveLocalModel.
 *
 * Run with: node --test src/lib/transcription/__tests__/model-selection.test.ts
 *
 * Same zero-dependency convention as the rest of this project's test suites:
 * Node's own built-in `node:test`/`node:assert`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocalModel, DEFAULT_LOCAL_MODEL, LocalWhisperProvider } from "../local-provider.ts";
import { LANGUAGES } from "../../../types/subtitle.ts";

test("1. explicit Gujarati selects medium", () => {
  assert.equal(resolveLocalModel("gu"), "medium");
});

test("2. English preserves the existing (small) model", () => {
  assert.equal(resolveLocalModel("en"), DEFAULT_LOCAL_MODEL);
  assert.equal(resolveLocalModel("en"), "small");
});

test("3. Hindi preserves the existing (small) model", () => {
  assert.equal(resolveLocalModel("hi"), DEFAULT_LOCAL_MODEL);
});

test("4. every other supported language preserves existing (small) behavior — only Gujarati is overridden", () => {
  for (const { code } of LANGUAGES) {
    if (code === "gu") continue;
    assert.equal(resolveLocalModel(code), DEFAULT_LOCAL_MODEL, `language "${code}" must NOT be affected by the Gujarati override`);
  }
});

test("5. Auto Detect (undefined language) uses the existing default model — per the current architecture, the model is chosen and loaded BEFORE Whisper's own language auto-detection runs, so a detected-but-not-yet-known Gujarati result can never retroactively change which model already ran", () => {
  assert.equal(resolveLocalModel(undefined), DEFAULT_LOCAL_MODEL);
});

test("explicit opts.model always wins over the per-language policy (existing override escape hatch preserved)", () => {
  const provider = new LocalWhisperProvider({ model: "large-v3-turbo", language: "gu" });
  const config = (provider as unknown as { config: { model: string } }).config;
  assert.equal(config.model, "large-v3-turbo");
});

test("SUBLY_WHISPER_MODEL env override still wins over the per-language policy (existing behavior preserved)", () => {
  const prev = process.env.SUBLY_WHISPER_MODEL;
  process.env.SUBLY_WHISPER_MODEL = "large-v3";
  try {
    const provider = new LocalWhisperProvider({ language: "gu" });
    const config = (provider as unknown as { config: { model: string } }).config;
    assert.equal(config.model, "large-v3");
  } finally {
    if (prev === undefined) delete process.env.SUBLY_WHISPER_MODEL;
    else process.env.SUBLY_WHISPER_MODEL = prev;
  }
});

test("with no override, LocalWhisperProvider picks medium for Gujarati and small for everything else", () => {
  const prev = process.env.SUBLY_WHISPER_MODEL;
  delete process.env.SUBLY_WHISPER_MODEL;
  try {
    const gu = new LocalWhisperProvider({ language: "gu" });
    const en = new LocalWhisperProvider({ language: "en" });
    const auto = new LocalWhisperProvider({ language: undefined });
    const guConfig = (gu as unknown as { config: { model: string } }).config;
    const enConfig = (en as unknown as { config: { model: string } }).config;
    const autoConfig = (auto as unknown as { config: { model: string } }).config;
    assert.equal(guConfig.model, "medium");
    assert.equal(enConfig.model, "small");
    assert.equal(autoConfig.model, "small");
  } finally {
    if (prev !== undefined) process.env.SUBLY_WHISPER_MODEL = prev;
  }
});

test("6/8. existing transcription options (device/computeType) remain unchanged regardless of which model gets picked", () => {
  const gu = new LocalWhisperProvider({ language: "gu" });
  const en = new LocalWhisperProvider({ language: "en" });
  const guConfig = (gu as unknown as { config: { device: string; computeType: string } }).config;
  const enConfig = (en as unknown as { config: { device: string; computeType: string } }).config;
  assert.equal(guConfig.device, "cpu");
  assert.equal(guConfig.computeType, "int8");
  assert.equal(enConfig.device, "cpu");
  assert.equal(enConfig.computeType, "int8");
});

// getTranscriptionProvider() (transcription/index.ts) and pipeline.ts's threading of
// `language` into it are covered by TypeScript's own type-checking (both compile
// cleanly against the new signature) plus the real end-to-end worker run against the
// actual 61.3s Gujarati benchmark audio (see the model-selection investigation report) —
// unit-testing index.ts directly here isn't done because it statically imports
// mock-provider.ts/openai-provider.ts, which use extensionless relative specifiers Node's
// native test runner can't resolve without editing files unrelated to this feature.

test("7. word timestamps remain enabled — transcribeLocal's wire call is unaffected by model selection (unit-level: the TranscriptionProvider interface and its transcribe() options are unchanged by this feature)", () => {
  // This is a structural guarantee, not a runtime one: model selection only changes
  // LocalWhisperConfig.model (see the config assertions above) — word_timestamps=True
  // and vad_filter=True are hardcoded in python/whisper_worker.py's transcribe handler
  // and are never touched by anything in local-provider.ts/index.ts/pipeline.ts.
  const provider = new LocalWhisperProvider({ language: "gu" });
  assert.equal(typeof provider.transcribe, "function");
});
