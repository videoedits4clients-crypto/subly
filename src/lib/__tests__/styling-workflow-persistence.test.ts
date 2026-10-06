/**
 * P23 — the effective look of every caption survives the real persistence path after a realistic workflow with
 * undo and redo in the middle: editor store → applyProjectPatch (the body of PATCH /api/projects/:id) → real temporary
 * SQLite → a FRESH PrismaClient (reopen / restart) → toProjectData. The strongest check is last: the ASS the exporter
 * builds from the reopened project is byte-identical to the one built from the in-editor project.
 *
 * Run with: node --test src/lib/__tests__/styling-workflow-persistence.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { applyProjectPatch } from "../project-patch.ts";
import { toProjectData, projectInclude } from "../project-mapper.ts";
import { useEditorStore } from "../../store/editor-store.ts";
import { buildAssDocument } from "../subtitles/ass.ts";
import { CAPTION_TEMPLATES, resolveTemplate } from "../caption-templates.ts";
import { getPreset } from "../presets.ts";
import { resolveAnimation, resolveStyle } from "../../types/subtitle.ts";
import type { ProjectData } from "../../types/subtitle.ts";
import { syntheticMetrics } from "../fonts/__tests__/synthetic-font.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DB = path.join(__dirname, "..", "..", "..", "prisma", "template.db");
const tpl = (id: string) => resolveTemplate(CAPTION_TEMPLATES.find((t) => t.id === id)!);
const METRICS = syntheticMetrics({ cell: 1.4, advanceEm: 0.55 });

let tmpDir: string;
let dbPath: string;
let projectId: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subly-workflow-test-"));
});
test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});
test.beforeEach(async () => {
  dbPath = path.join(tmpDir, `w-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  await fs.copyFile(TEMPLATE_DB, dbPath);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  const owner = await prisma.user.create({ data: { email: `wf-${Date.now()}-${Math.random()}@example.com`, name: "Workflow Test" } });
  projectId = (await prisma.project.create({ data: { ownerId: owner.id, name: "Workflow project", status: "READY" } })).id;
  await applyProjectPatch(prisma, projectId, {
    subtitles: ["Short one", "A longer caption that wraps across the frame width", "Third caption", "Fourth caption here"].map((text, i) => {
      const ws = text.split(" ");
      return {
        id: `s${i}`,
        index: i,
        start: 1 + i * 3,
        end: 3.8 + i * 3,
        text,
        words: ws.map((t, j) => ({ text: t, start: 1 + i * 3 + (j * 2.8) / ws.length, end: 1 + i * 3 + ((j + 1) * 2.8) / ws.length })),
      };
    }),
  });
  await prisma.$disconnect();
});
test.afterEach(async () => {
  await fs.rm(dbPath, { force: true });
});

async function open(): Promise<ProjectData> {
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  try {
    return toProjectData(await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: projectInclude }));
  } finally {
    await prisma.$disconnect();
  }
}
async function save(p: ProjectData) {
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  try {
    await applyProjectPatch(prisma, projectId, { globalStyle: p.globalStyle, animation: p.animation, subtitles: p.subtitles });
  } finally {
    await prisma.$disconnect();
  }
}
const ass = (p: ProjectData) =>
  buildAssDocument({ subtitles: p.subtitles, globalStyle: p.globalStyle, globalAnimation: p.animation, playResX: 1080, playResY: 1920, fontMetrics: () => METRICS });

test("template → customize → per-caption edit → undo → redo → save → reopen: identical looks AND byte-identical export", async () => {
  const st = useEditorStore.getState();
  st.load(await open());
  st.applyTemplate({ all: true }, tpl("cinematic-minimal"));
  st.applyTemplate({ ids: ["s1"] }, tpl("karaoke-pop"));
  for (let i = 0; i < 25; i++) st.setSubtitleStyleOverride("s1", { fontSize: 50 + i }); // a slider drag: one step
  st.setSubtitleAnimationOverride("s1", { exit: "fade" });
  st.setSubtitleStyleOverride("s2", { x: 30, y: 30, align: "left", vAlign: "top" });
  st.setWordStyleOverride("s2", 0, { color: "#22D3EE", fontSize: 70 });
  st.setGlobalStyle({ color: "#E5E7EB" });
  st.undo(); // global colour
  st.undo(); // word style
  st.redo(); // word style again
  const applied = getPreset("minimal")!;
  st.applyPreset(applied.style, applied.animation);
  st.setGlobalAnimation({ entrance: "pop" });
  await save(useEditorStore.getState().project!);

  const edited = useEditorStore.getState().project!;
  const reopened = await open();
  for (const caption of edited.subtitles) {
    const r = reopened.subtitles.find((s) => s.id === caption.id)!;
    assert.deepEqual(resolveStyle(reopened, r), resolveStyle(edited, caption), `${caption.id} style`);
    assert.deepEqual(resolveAnimation(reopened, r), resolveAnimation(edited, caption), `${caption.id} animation`);
    assert.deepEqual(r.words, caption.words, `${caption.id} words incl. word styling`);
    assert.equal(r.text, caption.text);
    assert.equal(r.start, caption.start);
    assert.equal(r.end, caption.end);
  }
  assert.deepEqual(reopened.globalStyle, edited.globalStyle);
  assert.deepEqual(reopened.animation, edited.animation);
  assert.equal(ass(reopened), ass(edited), "the export built from the reopened project is byte-identical");
});

test("continue editing after reopening: the persisted per-caption looks are intact and editable; undo history starts empty", async () => {
  const st = useEditorStore.getState();
  st.load(await open());
  st.applyTemplate({ ids: ["s0", "s2"] }, tpl("news-bar"));
  await save(useEditorStore.getState().project!);

  st.load(await open());
  assert.equal(useEditorStore.getState().past.length, 0, "a freshly opened editor has no history");
  assert.equal(useEditorStore.getState().project!.subtitles[0].style!.fontFamily, tpl("news-bar").style.fontFamily);
  useEditorStore.getState().setSubtitleStyleOverride("s0", { fontSize: 44 });
  useEditorStore.getState().applyTemplate({ all: true }, tpl("meme-impact"));
  assert.ok(useEditorStore.getState().project!.subtitles.every((s) => s.style === undefined));
  useEditorStore.getState().undo();
  await save(useEditorStore.getState().project!);
  const reopened = await open();
  assert.equal(reopened.subtitles[0].style!.fontSize, 44, "undo of the apply-to-all restored s0's own size, and that persisted");
  assert.ok(reopened.subtitles[2].style, "…and s2's template override");
});
