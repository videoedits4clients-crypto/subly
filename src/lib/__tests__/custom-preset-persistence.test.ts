/**
 * Regression tests for custom caption preset persistence (Task 87426, P6 Style Creator) — run
 * against a REAL, temporary SQLite database through a REAL PrismaClient, exactly mirroring
 * project-patch.test.ts's own pattern for the SubtitlePreset model instead of Project. Custom
 * presets already have their own pure-function test suite (custom-presets.test.ts) that never
 * touches a database; this file exists specifically to prove the DB *mechanism* itself —
 * create/read/update/delete round-tripping through real SQL, restart-safety (a fresh
 * PrismaClient reconnecting to the same file, standing in for the packaged app closing and
 * reopening), and isolation between two independently-stored rows.
 *
 * Run with: node --test src/lib/__tests__/custom-preset-persistence.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { parsePresetRows, validateNewPresetName, duplicatePresetName } from "../custom-presets.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION } from "../../types/subtitle.ts";
import type { SubtitleStyle, AnimationConfig } from "../../types/subtitle.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DB = path.join(__dirname, "..", "..", "..", "prisma", "template.db");

let tmpDir: string;
let dbPath: string;
let prisma: PrismaClient;
let ownerId: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subly-preset-persist-test-"));
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  dbPath = path.join(tmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  await fs.copyFile(TEMPLATE_DB, dbPath);
  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  const owner = await prisma.user.create({ data: { email: `preset-persist-${Date.now()}-${Math.random()}@example.com`, name: "Preset Persist Test" } });
  ownerId = owner.id;
});

test.afterEach(async () => {
  await prisma.$disconnect();
  await fs.rm(dbPath, { force: true });
});

/** Opens a NEW PrismaClient against the SAME database file — standing in for the packaged app
 * being fully closed and relaunched (a fresh process, a fresh connection, same file on disk),
 * exactly what Part 15/24's "apply custom style → restart → still exists → reapply" requires. */
async function reconnect(): Promise<PrismaClient> {
  const fresh = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  return fresh;
}

async function createPreset(client: PrismaClient, name: string, style: SubtitleStyle, animation: AnimationConfig) {
  return client.subtitlePreset.create({
    data: { ownerId, name, style: JSON.stringify(style), animation: JSON.stringify(animation) },
  });
}

test("1. a created custom preset round-trips exactly through a real SQLite write + read", async () => {
  const style: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Poppins", color: "#FF00FF" };
  const animation: AnimationConfig = { ...DEFAULT_ANIMATION, word: "bg-highlight" };
  await createPreset(prisma, "My Neon", style, animation);

  const rows = await prisma.subtitlePreset.findMany({ where: { ownerId, isBuiltIn: false } });
  const [parsed] = parsePresetRows(rows);
  assert.equal(parsed.name, "My Neon");
  assert.deepEqual(parsed.style, style);
  assert.deepEqual(parsed.animation, animation);
});

test("2. restart persistence: a custom preset created before a full 'app restart' (fresh PrismaClient, same DB file) is still there, and can be applied again", async () => {
  const style: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Montserrat" };
  const created = await createPreset(prisma, "My Creator Style", style, DEFAULT_ANIMATION);

  // Simulate the packaged app closing entirely.
  await prisma.$disconnect();

  // And reopening.
  const reopened = await reconnect();
  const rows = await reopened.subtitlePreset.findMany({ where: { ownerId, isBuiltIn: false } });
  const [parsed] = parsePresetRows(rows);
  assert.equal(parsed.id, created.id);
  assert.equal(parsed.name, "My Creator Style");
  assert.deepEqual(parsed.style, style, "style survives a full restart unchanged — can be reapplied exactly");
  await reopened.$disconnect();
});

test("3. isolation: updating custom preset A's style never touches B's stored row", async () => {
  const a = await createPreset(prisma, "Style A", { ...DEFAULT_SUBTITLE_STYLE, color: "#FF0000" }, DEFAULT_ANIMATION);
  const b = await createPreset(prisma, "Style B", { ...DEFAULT_SUBTITLE_STYLE, color: "#0000FF" }, DEFAULT_ANIMATION);

  await prisma.subtitlePreset.update({ where: { id: a.id }, data: { style: JSON.stringify({ ...DEFAULT_SUBTITLE_STYLE, color: "#00FF00" }) } });

  const rows = await prisma.subtitlePreset.findMany({ where: { ownerId, isBuiltIn: false }, orderBy: { createdAt: "asc" } });
  const parsed = parsePresetRows(rows);
  assert.equal(parsed.find((p) => p.id === a.id)!.style.color, "#00FF00", "A was updated");
  assert.equal(parsed.find((p) => p.id === b.id)!.style.color, "#0000FF", "B is completely untouched");
});

test("4. isolation: deleting custom preset A does not affect B", async () => {
  const a = await createPreset(prisma, "Style A", DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION);
  const b = await createPreset(prisma, "Style B", DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION);

  await prisma.subtitlePreset.delete({ where: { id: a.id } });

  const rows = await prisma.subtitlePreset.findMany({ where: { ownerId, isBuiltIn: false } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, b.id, "B survives A's deletion untouched");
});

test("5. duplicate workflow against real DB rows: duplicatePresetName + createCustomPreset produces an independent second row with a distinct, valid name", async () => {
  const original = await createPreset(prisma, "My Marker", { ...DEFAULT_SUBTITLE_STYLE, highlightColor: "#FFE066" }, DEFAULT_ANIMATION);

  const existingRows = parsePresetRows(await prisma.subtitlePreset.findMany({ where: { ownerId, isBuiltIn: false } }));
  const dupName = duplicatePresetName(existingRows, "My Marker");
  assert.equal(dupName, "My Marker Copy");
  const nameCheck = validateNewPresetName(existingRows, dupName);
  assert.equal(nameCheck.ok, true);

  const duplicated = await createPreset(prisma, dupName, { ...DEFAULT_SUBTITLE_STYLE, highlightColor: "#FFE066" }, DEFAULT_ANIMATION);
  assert.notEqual(duplicated.id, original.id, "the duplicate is a genuinely separate row");

  // Mutate the duplicate; the original must be unaffected — real DB round-trip of the
  // isolation guarantee custom-presets.test.ts already proves at the pure-function level.
  await prisma.subtitlePreset.update({ where: { id: duplicated.id }, data: { style: JSON.stringify({ ...DEFAULT_SUBTITLE_STYLE, highlightColor: "#00FF00" }) } });
  const rows = parsePresetRows(await prisma.subtitlePreset.findMany({ where: { ownerId, isBuiltIn: false }, orderBy: { createdAt: "asc" } }));
  assert.equal(rows.find((p) => p.id === original.id)!.style.highlightColor, "#FFE066", "original untouched by editing the duplicate");
  assert.equal(rows.find((p) => p.id === duplicated.id)!.style.highlightColor, "#00FF00");
});

test("6. duplicate-name validation runs against the REAL current DB state, not a stale in-memory list", async () => {
  await createPreset(prisma, "My Marker", DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION);
  const rows = parsePresetRows(await prisma.subtitlePreset.findMany({ where: { ownerId, isBuiltIn: false } }));
  const check = validateNewPresetName(rows, "my marker"); // case-insensitive collision
  assert.deepEqual(check, { ok: false, error: '"my marker" already exists.' });
});

test("7. a built-in preset row (isBuiltIn: true) is never returned by the same query the custom-presets API uses — built-ins and custom styles stay in separate result sets even though they share one table", async () => {
  // No real code path ever inserts isBuiltIn: true (see custom-presets.ts's own module doc
  // comment) — this row is created directly here purely to prove the WHERE clause itself
  // (isBuiltIn: false) is the actual guarantee, not just "nothing happens to insert one."
  await prisma.subtitlePreset.create({
    data: { ownerId, name: "Should never appear", isBuiltIn: true, style: JSON.stringify(DEFAULT_SUBTITLE_STYLE), animation: JSON.stringify(DEFAULT_ANIMATION) },
  });
  await createPreset(prisma, "My Real Custom Style", DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION);

  const rows = await prisma.subtitlePreset.findMany({ where: { ownerId, isBuiltIn: false } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "My Real Custom Style");
});

test("8. two different owners' custom presets never leak into each other's list", async () => {
  const otherOwner = await prisma.user.create({ data: { email: `other-${Date.now()}@example.com`, name: "Other User" } });
  await createPreset(prisma, "My Style", DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION);
  await prisma.subtitlePreset.create({
    data: { ownerId: otherOwner.id, name: "Their Style", style: JSON.stringify(DEFAULT_SUBTITLE_STYLE), animation: JSON.stringify(DEFAULT_ANIMATION) },
  });

  const mine = await prisma.subtitlePreset.findMany({ where: { ownerId, isBuiltIn: false } });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, "My Style");
});
