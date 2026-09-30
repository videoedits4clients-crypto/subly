/**
 * Regression tests for the editor's actual persistence mechanism — applyProjectPatch (the
 * extracted body of PATCH /api/projects/:id — see lib/project-patch.ts) writing, and
 * toProjectData (lib/project-mapper.ts) reading back — run against a REAL, temporary SQLite
 * database through a REAL PrismaClient, exactly mirroring what the autosave hook
 * (hooks/use-autosave.ts) actually does on every save and what the editor does on every
 * reload. This is the "UI mutation → PATCH → database → reload → same editor state" contract
 * from the P1 Editor State Persistence task, tested at the real mechanism level.
 *
 * Run with: node --test src/lib/__tests__/project-patch.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { applyProjectPatch, type ProjectPatchData } from "../project-patch.ts";
import { toProjectData, projectInclude } from "../project-mapper.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { SubtitleStyle, AnimationConfig, CompositionSettings, TimingRules, Word } from "../../types/subtitle.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DB = path.join(__dirname, "..", "..", "..", "prisma", "template.db");

let tmpDir: string;
let dbPath: string;
let prisma: PrismaClient;
let ownerId: string;
let projectId: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subly-patch-test-"));
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  dbPath = path.join(tmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  await fs.copyFile(TEMPLATE_DB, dbPath);
  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  const owner = await prisma.user.create({ data: { email: `patch-test-${Date.now()}-${Math.random()}@example.com`, name: "Patch Test" } });
  ownerId = owner.id;
  const project = await prisma.project.create({ data: { ownerId, name: "Test project", status: "READY" } });
  projectId = project.id;
});

test.afterEach(async () => {
  await prisma.$disconnect();
  await fs.rm(dbPath, { force: true });
});

async function reload() {
  const row = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: projectInclude });
  return toProjectData(row);
}

function words(texts: string[], startAt = 0): Word[] {
  return texts.map((text, i) => ({ text, start: startAt + i, end: startAt + i + 0.9 }));
}

test("1. subtitle text and timing persist exactly across a write + reload", async () => {
  const patch: ProjectPatchData = {
    subtitles: [
      { id: "s1", index: 0, start: 0, end: 1.2, text: "Hello world", words: words(["Hello", "world"]) },
      { id: "s2", index: 1, start: 1.2, end: 2.5, text: "this is SUBLY", words: words(["this", "is", "SUBLY"], 1.2) },
    ],
  };
  await applyProjectPatch(prisma, projectId, patch);
  const reloaded = await reload();
  assert.equal(reloaded.subtitles.length, 2);
  assert.equal(reloaded.subtitles[0].text, "Hello world");
  assert.equal(reloaded.subtitles[0].start, 0);
  assert.equal(reloaded.subtitles[0].end, 1.2);
  assert.equal(reloaded.subtitles[1].text, "this is SUBLY");
  assert.deepEqual(
    reloaded.subtitles[0].words.map((w) => w.text),
    ["Hello", "world"],
  );
  assert.equal(reloaded.subtitles[0].words[1].end, 1.9);
});

test("2. word timestamps and word-level style overrides persist exactly", async () => {
  const wordsWithOverride: Word[] = [
    { text: "Hello", start: 0, end: 0.5, style: { color: "#FF0000", fontSize: 80 } },
    { text: "world", start: 0.5, end: 1.0 },
  ];
  await applyProjectPatch(prisma, projectId, {
    subtitles: [{ id: "s1", index: 0, start: 0, end: 1.0, text: "Hello world", words: wordsWithOverride }],
  });
  const reloaded = await reload();
  const w0 = reloaded.subtitles[0].words[0];
  assert.equal(w0.start, 0);
  assert.equal(w0.end, 0.5);
  assert.deepEqual(w0.style, { color: "#FF0000", fontSize: 80 });
  assert.equal(reloaded.subtitles[0].words[1].style, undefined);
});

test("3. per-caption style and animation overrides persist exactly, independent of the global style", async () => {
  const styleOverride: Partial<SubtitleStyle> = { color: "#00FF00", fontFamily: "Poppins", fontWeight: 700 };
  const animationOverride: Partial<AnimationConfig> = { entrance: "slide-up", word: "none" };
  await applyProjectPatch(prisma, projectId, {
    globalStyle: DEFAULT_SUBTITLE_STYLE,
    subtitles: [
      { id: "s1", index: 0, start: 0, end: 1, text: "override me", words: words(["override", "me"]), style: styleOverride, animation: animationOverride },
      { id: "s2", index: 1, start: 1, end: 2, text: "plain caption", words: words(["plain", "caption"], 1) },
    ],
  });
  const reloaded = await reload();
  assert.deepEqual(reloaded.subtitles[0].style, styleOverride);
  assert.deepEqual(reloaded.subtitles[0].animation, animationOverride);
  assert.equal(reloaded.subtitles[1].style, undefined);
  assert.equal(reloaded.subtitles[1].animation, undefined);
  assert.deepEqual(reloaded.globalStyle, DEFAULT_SUBTITLE_STYLE);
});

test("4. global style — every field, including font family/source/weight/size, colors, background, alignment, word highlighting — persists exactly", async () => {
  const customStyle: SubtitleStyle = {
    ...DEFAULT_SUBTITLE_STYLE,
    fontFamily: "Arial",
    fontSource: "system",
    fontWeight: 400,
    fontSize: 48,
    color: "#123456",
    highlightColor: "#ABCDEF",
    backgroundColor: "#000011",
    backgroundOpacity: 0.5,
    align: "left",
    vAlign: "top",
    wordHighlight: false,
    x: 30,
    y: 60,
  };
  await applyProjectPatch(prisma, projectId, { globalStyle: customStyle });
  const reloaded = await reload();
  assert.deepEqual(reloaded.globalStyle, customStyle);
});

test("5. animation config persists exactly", async () => {
  const customAnimation: AnimationConfig = { entrance: "pop", exit: "fade", word: "bg-highlight", durationSec: 0.35 };
  await applyProjectPatch(prisma, projectId, { animation: customAnimation });
  const reloaded = await reload();
  assert.deepEqual(reloaded.animation, customAnimation);
});

test("6. composition (canvas size, aspect ratio via dimensions, video visibility, background color) persists exactly", async () => {
  const customComposition: CompositionSettings = { canvasWidth: 1920, canvasHeight: 1080, videoVisible: false, backgroundColor: "#336699" };
  await applyProjectPatch(prisma, projectId, { composition: customComposition, aspectRatio: "16:9" });
  const reloaded = await reload();
  assert.deepEqual(reloaded.composition, customComposition);
  assert.equal(reloaded.aspectRatio, "16:9");
});

test("7. timing rules persist exactly", async () => {
  const customRules: TimingRules = { minDuration: 0.5, maxDuration: 4, maxCharsPerLine: 30, maxLines: 1, maxWordsPerCaption: 3, smartSegmentation: false };
  await applyProjectPatch(prisma, projectId, { timingRules: customRules });
  const reloaded = await reload();
  assert.deepEqual(reloaded.timingRules, customRules);
});

test("8. trim and cut ranges persist exactly", async () => {
  await applyProjectPatch(prisma, projectId, {
    trimStart: 2.5,
    trimEnd: 30,
    cutRanges: [
      { id: "c1", start: 5, end: 7, reason: "manual" },
      { id: "c2", start: 10, end: 10.5, reason: "filler" },
    ],
  });
  const reloaded = await reload();
  assert.equal(reloaded.trimStart, 2.5);
  assert.equal(reloaded.trimEnd, 30);
  assert.deepEqual(reloaded.cutRanges, [
    { id: "c1", start: 5, end: 7, reason: "manual" },
    { id: "c2", start: 10, end: 10.5, reason: "filler" },
  ]);
});

test("9. rapid sequential edits — applying patches one after another (as the fixed, serialized autosave now guarantees) leaves the database in exactly the FINAL state, not an intermediate one", async () => {
  const texts = ["Hello", "Hello world", "Hello world this", "Hello world this is", "Hello world this is SUBLY"];
  for (const text of texts) {
    await applyProjectPatch(prisma, projectId, {
      subtitles: [{ id: "s1", index: 0, start: 0, end: 1, text, words: words(text.split(" ")) }],
    });
  }
  const reloaded = await reload();
  assert.equal(reloaded.subtitles[0].text, "Hello world this is SUBLY");
});

test("10. a partial patch (only `name`) never touches subtitles, style, or any other field — proves 'project-level settings persisted separately' cannot silently clobber captions", async () => {
  await applyProjectPatch(prisma, projectId, {
    globalStyle: { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Poppins" },
    subtitles: [{ id: "s1", index: 0, start: 0, end: 1, text: "keep me", words: words(["keep", "me"]) }],
  });
  await applyProjectPatch(prisma, projectId, { name: "Renamed project" });
  const reloaded = await reload();
  assert.equal(reloaded.name, "Renamed project");
  assert.equal(reloaded.subtitles.length, 1);
  assert.equal(reloaded.subtitles[0].text, "keep me");
  assert.equal(reloaded.globalStyle.fontFamily, "Poppins");
});

test("11. an unchanged/no-op patch (subtitles omitted entirely) leaves the existing subtitle set completely untouched, including ids", async () => {
  await applyProjectPatch(prisma, projectId, {
    subtitles: [{ id: "s1", index: 0, start: 0, end: 1, text: "untouched", words: words(["untouched"]) }],
  });
  const before = await reload();
  await applyProjectPatch(prisma, projectId, { trimStart: 0 }); // unrelated field, no subtitles key at all
  const after = await reload();
  assert.deepEqual(after.subtitles, before.subtitles);
});

test("12. captionOutputMode and hinglishText/gujaratiScriptText persist and round-trip exactly, independent of the original text", async () => {
  await applyProjectPatch(prisma, projectId, {
    captionOutputMode: "hinglish",
    subtitles: [
      {
        id: "s1",
        index: 0,
        start: 0,
        end: 1,
        text: "नमस्ते",
        words: [{ text: "नमस्ते", start: 0, end: 1, hinglishText: "namaste" }],
        hinglishText: "namaste",
      },
    ],
  });
  const reloaded = await reload();
  assert.equal(reloaded.captionOutputMode, "hinglish");
  assert.equal(reloaded.subtitles[0].text, "नमस्ते");
  assert.equal(reloaded.subtitles[0].hinglishText, "namaste");
  assert.equal(reloaded.subtitles[0].words[0].hinglishText, "namaste");
});

test("13. an existing, already-persisted project's data is fully recovered by reload — a fresh read after multiple writes matches the last write byte-for-byte on every category at once", async () => {
  const globalStyle: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Montserrat", color: "#EEEEEE" };
  const animation: AnimationConfig = { ...DEFAULT_ANIMATION, entrance: "pop" };
  const composition: CompositionSettings = { ...DEFAULT_COMPOSITION, backgroundColor: "#010203" };
  const timingRules: TimingRules = { ...DEFAULT_TIMING_RULES, maxWordsPerCaption: 6 };
  await applyProjectPatch(prisma, projectId, {
    name: "Full round trip",
    globalStyle,
    animation,
    composition,
    timingRules,
    trimStart: 1,
    trimEnd: 20,
    cutRanges: [{ id: "c1", start: 2, end: 3, reason: "silence" }],
    subtitles: [{ id: "s1", index: 0, start: 0, end: 1, text: "full check", words: words(["full", "check"]) }],
  });
  const reloaded = await reload();
  assert.equal(reloaded.name, "Full round trip");
  assert.deepEqual(reloaded.globalStyle, globalStyle);
  assert.deepEqual(reloaded.animation, animation);
  assert.deepEqual(reloaded.composition, composition);
  assert.deepEqual(reloaded.timingRules, timingRules);
  assert.equal(reloaded.trimStart, 1);
  assert.equal(reloaded.trimEnd, 20);
  assert.deepEqual(reloaded.cutRanges, [{ id: "c1", start: 2, end: 3, reason: "silence" }]);
  assert.equal(reloaded.subtitles[0].text, "full check");
});

test("14. deleting all captions (an explicit empty array) actually clears them, distinct from omitting the key entirely (test 11)", async () => {
  await applyProjectPatch(prisma, projectId, {
    subtitles: [{ id: "s1", index: 0, start: 0, end: 1, text: "will be deleted", words: words(["will", "be", "deleted"]) }],
  });
  await applyProjectPatch(prisma, projectId, { subtitles: [] });
  const reloaded = await reload();
  assert.deepEqual(reloaded.subtitles, []);
});

test("15. a globalStyle stored as a raw, partial object (bypassing the API's own validation entirely — e.g. legacy data from before the P3 backend-hardening fix, Task 58314) reads back as a complete SubtitleStyle, not the partial shape that was actually stored", async () => {
  // applyProjectPatch trusts its caller already validated (see its own doc comment) — writing a
  // malformed partial object directly through it, skipping the route's globalStyleSchema
  // entirely, is exactly how already-corrupted data could exist regardless of this fix. This
  // proves toProjectData's own read-side resolveGlobalStyle() (lib/project-mapper.ts) protects
  // every consumer independent of how the bad data got there in the first place.
  await applyProjectPatch(prisma, projectId, { globalStyle: { fontFamily: "Montserrat", fontSize: 70 } });
  const reloaded = await reload();
  assert.equal(reloaded.globalStyle.fontFamily, "Montserrat");
  assert.equal(reloaded.globalStyle.fontSize, 70);
  assert.equal(reloaded.globalStyle.color, DEFAULT_SUBTITLE_STYLE.color);
  assert.equal(Object.keys(reloaded.globalStyle).length, Object.keys(DEFAULT_SUBTITLE_STYLE).length);
});
