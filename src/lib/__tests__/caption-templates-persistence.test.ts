/**
 * P22 — what applying a template leaves in the project survives the real persistence path: the editor store's
 * result is written with applyProjectPatch (the body of PATCH /api/projects/:id) into a real temporary SQLite
 * database and read back through a FRESH PrismaClient (a project reopen / app restart) with toProjectData.
 *
 * Templates themselves are built-in code, so nothing about them is stored; only their effect (ordinary style and
 * animation on the project / captions) is — which is exactly what this verifies.
 *
 * Run with: node --test src/lib/__tests__/caption-templates-persistence.test.ts
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
import { CAPTION_TEMPLATES, resolveTemplate } from "../caption-templates.ts";
import { resolveAnimation, resolveStyle } from "../../types/subtitle.ts";
import type { ProjectData } from "../../types/subtitle.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DB = path.join(__dirname, "..", "..", "..", "prisma", "template.db");

let tmpDir: string;
let dbPath: string;
let projectId: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subly-template-test-"));
});
test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});
test.beforeEach(async () => {
  dbPath = path.join(tmpDir, `t-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  await fs.copyFile(TEMPLATE_DB, dbPath);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  const owner = await prisma.user.create({ data: { email: `tpl-${Date.now()}-${Math.random()}@example.com`, name: "Template Test" } });
  const project = await prisma.project.create({ data: { ownerId: owner.id, name: "Template project", status: "READY" } });
  projectId = project.id;
  await applyProjectPatch(prisma, projectId, {
    subtitles: [0, 1, 2].map((i) => ({
      id: `s${i}`,
      index: i,
      start: i * 2,
      end: i * 2 + 1.5,
      text: `caption ${i}`,
      words: [
        { text: "caption", start: i * 2, end: i * 2 + 0.7 },
        { text: String(i), start: i * 2 + 0.7, end: i * 2 + 1.5, style: i === 1 ? { color: "#FF0000" } : undefined },
      ],
      ...(i === 2 ? { style: { color: "#00FF00" }, animation: { entrance: "slide-up" as const } } : {}),
    })),
  });
  await prisma.$disconnect();
});
test.afterEach(async () => {
  await fs.rm(dbPath, { force: true });
});

/** A brand-new client each time: this is what a project reopen / Electron restart sees. */
async function reopen(): Promise<ProjectData> {
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

test("a template applied to some captions persists as per-caption style + animation and reopens identical", async () => {
  useEditorStore.getState().load(await reopen());
  const r = resolveTemplate(CAPTION_TEMPLATES.find((t) => t.id === "karaoke-pop")!);
  assert.equal(useEditorStore.getState().applyTemplate({ ids: ["s0", "s1"] }, r), 2);
  const edited = useEditorStore.getState().project!;
  await save(edited);

  const reopened = await reopen();
  for (const id of ["s0", "s1"]) {
    const sub = reopened.subtitles.find((s) => s.id === id)!;
    assert.deepEqual(resolveStyle(reopened, sub), r.style, id);
    assert.deepEqual(resolveAnimation(reopened, sub), r.animation, id);
  }
  const untouched = reopened.subtitles.find((s) => s.id === "s2")!;
  assert.deepEqual(untouched.style, { color: "#00FF00" }, "a caption the template wasn't applied to keeps its own override");
  // and what the editor holds is what the database holds
  assert.deepEqual(reopened.subtitles.map((s) => ({ ...s, style: s.style, animation: s.animation })), edited.subtitles.map((s) => ({ ...s })));
});

test("a template applied to ALL captions persists as the project defaults with every override cleared", async () => {
  useEditorStore.getState().load(await reopen());
  const r = resolveTemplate(CAPTION_TEMPLATES.find((t) => t.id === "cinematic-minimal")!);
  useEditorStore.getState().applyTemplate({ all: true }, r);
  await save(useEditorStore.getState().project!);

  const reopened = await reopen();
  assert.deepEqual(reopened.globalStyle, r.style);
  assert.deepEqual(reopened.animation, r.animation);
  assert.ok(reopened.subtitles.every((s) => s.style === undefined && s.animation === undefined), "the old per-caption override on s2 is gone after reload");
});

test("text, timing and word timestamps and per-word styling are identical after apply + save + reopen", async () => {
  const original = await reopen();
  useEditorStore.getState().load(original);
  useEditorStore.getState().applyTemplate({ all: true }, resolveTemplate(CAPTION_TEMPLATES.find((t) => t.id === "meme-impact")!));
  await save(useEditorStore.getState().project!);
  const reopened = await reopen();
  const content = (p: ProjectData) => p.subtitles.map((s) => ({ id: s.id, index: s.index, text: s.text, start: s.start, end: s.end, words: s.words }));
  assert.deepEqual(content(reopened), content(original));
});

test("undo after reopening restores the previous state and that saves too (undo history itself is session-only)", async () => {
  useEditorStore.getState().load(await reopen());
  const before = JSON.stringify(useEditorStore.getState().project!.subtitles);
  useEditorStore.getState().applyTemplate({ ids: ["s0"] }, resolveTemplate(CAPTION_TEMPLATES.find((t) => t.id === "social-pop")!));
  await save(useEditorStore.getState().project!);
  useEditorStore.getState().undo();
  await save(useEditorStore.getState().project!);
  assert.equal(JSON.stringify((await reopen()).subtitles), before);
  // a freshly loaded editor starts with an empty history
  useEditorStore.getState().load(await reopen());
  assert.equal(useEditorStore.getState().past.length, 0);
});
