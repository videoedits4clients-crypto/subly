/**
 * Regression tests for stale-job recovery (src/lib/recovery/stale-job-recovery.ts) — run
 * against a REAL, temporary SQLite database (a throwaway copy of prisma/template.db) through a
 * REAL PrismaClient, so `updateMany`/`findMany` semantics are exercised exactly as production
 * uses them, not a hand-rolled mock of Prisma's query builder. No real filesystem storage is
 * touched — a small recording fake stands in for StorageDriver (see RecoveryStorage). No
 * network, no real Windows install, no packaged app involved.
 *
 * Run with: node --test src/lib/recovery/__tests__/stale-job-recovery.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { recoverStaleJobs, type RecoveryStorage } from "../stale-job-recovery.ts";
import { exportOutputKey, exportAssKey } from "../../export-output-key.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DB = path.join(__dirname, "..", "..", "..", "..", "prisma", "template.db");

let tmpDir: string;
let dbPath: string;
let prisma: PrismaClient;
let ownerId: string;

function fakeStorage(): RecoveryStorage & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    del: async (key: string) => {
      deleted.push(key);
    },
  };
}

async function freshDb(): Promise<void> {
  dbPath = path.join(tmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  await fs.copyFile(TEMPLATE_DB, dbPath);
  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  const owner = await prisma.user.create({ data: { email: `recovery-test-${Date.now()}-${Math.random()}@example.com`, name: "Recovery Test" } });
  ownerId = owner.id;
}

test.beforeEach(async () => {
  await freshDb();
});

test.afterEach(async () => {
  await prisma.$disconnect();
  await fs.rm(dbPath, { force: true });
});

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subly-recovery-test-"));
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

interface ProjectOverrides {
  status?: string;
  errorMessage?: string | null;
  progress?: number;
  processingStartedAt?: Date | null;
  language?: string;
}

function project(overrides: ProjectOverrides = {}) {
  return prisma.project.create({ data: { ownerId, name: "Test project", status: "EMPTY", ...overrides } });
}

test("1. no active jobs → no changes", async () => {
  await project({ status: "READY" });
  await project({ status: "EMPTY" });
  const result = await recoverStaleJobs(prisma, fakeStorage());
  assert.deepEqual(result, { recoveredProjects: 0, recoveredExportJobs: 0 });
});

test("2. a project mid-dispatch (status just set, updatedAt = now) is swept the same as any other non-terminal row — recovery makes no per-row freshness distinction; safety instead comes entirely from the call site being invoked exactly once, at server startup, before any request (and therefore any dispatch) is possible — see test below asserting that single call site", async () => {
  const p = await project({ status: "TRANSCRIBING", progress: 42 });
  const result = await recoverStaleJobs(prisma, fakeStorage());
  assert.equal(result.recoveredProjects, 1);
  const reloaded = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
  assert.equal(reloaded.status, "ERROR");
});

test("3. stale transcription job → recovered (both LOADING and TRANSCRIBING)", async () => {
  const loading = await project({ status: "LOADING", progress: 5, processingStartedAt: new Date() });
  const transcribing = await project({ status: "TRANSCRIBING", progress: 60, processingStartedAt: new Date() });
  const result = await recoverStaleJobs(prisma, fakeStorage());
  assert.equal(result.recoveredProjects, 2);
  for (const id of [loading.id, transcribing.id]) {
    const reloaded = await prisma.project.findUniqueOrThrow({ where: { id } });
    assert.equal(reloaded.status, "ERROR");
    assert.equal(reloaded.progress, 0);
    assert.equal(reloaded.processingStartedAt, null);
    assert.match(reloaded.errorMessage ?? "", /interrupted/i);
  }
});

test("4. stale export job → recovered, and both the partial output file and the .ass caption sidecar are removed via storage.del", async () => {
  const p = await project({ status: "EXPORTING" });
  const job = await prisma.exportJob.create({ data: { projectId: p.id, status: "RUNNING", stage: "rendering", progress: 40 } });
  const storage = fakeStorage();
  const result = await recoverStaleJobs(prisma, storage);
  assert.equal(result.recoveredExportJobs, 1);
  const reloaded = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(reloaded.status, "ERROR");
  assert.equal(reloaded.outputUrl, null);
  assert.match(reloaded.errorMessage ?? "", /interrupted/i);
  assert.deepEqual(storage.deleted.sort(), [exportAssKey(p.id, job.id), exportOutputKey(p.id, job.id)].sort());
});

test("5. multiple stale jobs → all recovered", async () => {
  const p1 = await project({ status: "TRANSCRIBING" });
  const p2 = await project({ status: "LOADING" });
  const p3 = await project({ status: "EXPORTING" });
  const job1 = await prisma.exportJob.create({ data: { projectId: p3.id, status: "QUEUED" } });
  const job2 = await prisma.exportJob.create({ data: { projectId: p3.id, status: "RUNNING" } });
  const result = await recoverStaleJobs(prisma, fakeStorage());
  assert.equal(result.recoveredProjects, 3); // p1, p2 (transcription) + p3 (EXPORTING → READY)
  assert.equal(result.recoveredExportJobs, 2); // job1, job2
  for (const id of [p1.id, p2.id]) {
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id } })).status, "ERROR");
  }
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: p3.id } })).status, "READY");
  for (const id of [job1.id, job2.id]) {
    assert.equal((await prisma.exportJob.findUniqueOrThrow({ where: { id } })).status, "ERROR");
  }
});

test("6. multiple projects → only the correct (non-terminal) ones are recovered", async () => {
  const stale = await project({ status: "TRANSCRIBING" });
  const ready = await project({ status: "READY" });
  const editing = await project({ status: "EDITING" });
  const exported = await project({ status: "EXPORTED" });
  const empty = await project({ status: "EMPTY" });
  const errored = await project({ status: "ERROR", errorMessage: "Something went wrong while generating subtitles." });

  await recoverStaleJobs(prisma, fakeStorage());

  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: stale.id } })).status, "ERROR");
  for (const untouched of [ready, editing, exported, empty]) {
    const reloaded = await prisma.project.findUniqueOrThrow({ where: { id: untouched.id } });
    assert.equal(reloaded.status, untouched.status);
  }
  const reloadedError = await prisma.project.findUniqueOrThrow({ where: { id: errored.id } });
  assert.equal(reloadedError.errorMessage, "Something went wrong while generating subtitles."); // not overwritten
});

test("7. already-ERROR export job → unchanged (message not overwritten)", async () => {
  const p = await project({ status: "READY" });
  const job = await prisma.exportJob.create({
    data: { projectId: p.id, status: "ERROR", errorMessage: "Export failed: the exported video could not be verified." },
  });
  const storage = fakeStorage();
  const result = await recoverStaleJobs(prisma, storage);
  assert.equal(result.recoveredExportJobs, 0);
  const reloaded = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(reloaded.errorMessage, "Export failed: the exported video could not be verified.");
  assert.deepEqual(storage.deleted, []);
});

test("8. already-DONE export job → unchanged (outputUrl preserved, no cleanup attempted)", async () => {
  const p = await project({ status: "EXPORTED" });
  const job = await prisma.exportJob.create({
    data: { projectId: p.id, status: "DONE", stage: "complete", progress: 100, outputUrl: `/api/files/${p.id}/exports/whatever.mp4` },
  });
  const storage = fakeStorage();
  await recoverStaleJobs(prisma, storage);
  const reloaded = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(reloaded.status, "DONE");
  assert.equal(reloaded.outputUrl, `/api/files/${p.id}/exports/whatever.mp4`);
  assert.deepEqual(storage.deleted, []);
});

test("9. already-READY project → unchanged", async () => {
  const p = await project({ status: "READY" });
  await recoverStaleJobs(prisma, fakeStorage());
  const reloaded = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
  assert.equal(reloaded.status, "READY");
  assert.equal(reloaded.updatedAt.getTime(), p.updatedAt.getTime());
});

test("10. recovery is idempotent — a second run finds nothing left to do", async () => {
  const p = await project({ status: "TRANSCRIBING" });
  const job = await prisma.exportJob.create({ data: { projectId: p.id, status: "RUNNING" } });
  const first = await recoverStaleJobs(prisma, fakeStorage());
  assert.equal(first.recoveredProjects, 1);
  assert.equal(first.recoveredExportJobs, 1);

  const second = await recoverStaleJobs(prisma, fakeStorage());
  assert.deepEqual(second, { recoveredProjects: 0, recoveredExportJobs: 0 });

  // Running it a third time, and confirming the message wasn't re-written/duplicated.
  await recoverStaleJobs(prisma, fakeStorage());
  const reloadedProject = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
  const reloadedJob = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(reloadedProject.errorMessage, "Previous processing was interrupted. You can retry this project.");
  assert.equal(reloadedJob.errorMessage, "Previous export was interrupted. The incomplete output was removed.");
});

test("11. recovery messages are persisted exactly, and are plain/non-technical (no PIDs, paths, stack traces)", async () => {
  const p = await project({ status: "LOADING" });
  const job = await prisma.exportJob.create({ data: { projectId: (await project({ status: "EXPORTING" })).id, status: "QUEUED" } });
  await recoverStaleJobs(prisma, fakeStorage());
  const reloadedProject = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
  const reloadedJob = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(reloadedProject.errorMessage, "Previous processing was interrupted. You can retry this project.");
  assert.equal(reloadedJob.errorMessage, "Previous export was interrupted. The incomplete output was removed.");
  for (const msg of [reloadedProject.errorMessage, reloadedJob.errorMessage]) {
    assert.doesNotMatch(msg!, /pid|ffmpeg|stack|\.exe|C:\\|\/tmp\//i);
  }
});

test("12. a fully successful, already-completed project (EXPORTED, with a real DONE export job) remains completely untouched", async () => {
  const p = await project({ status: "EXPORTED" });
  const job = await prisma.exportJob.create({
    data: { projectId: p.id, status: "DONE", outputUrl: `/api/files/${p.id}/exports/real.mp4`, stage: "complete", progress: 100 },
  });
  const storage = fakeStorage();
  const result = await recoverStaleJobs(prisma, storage);
  assert.deepEqual(result, { recoveredProjects: 0, recoveredExportJobs: 0 });
  const reloadedProject = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
  const reloadedJob = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(reloadedProject.status, "EXPORTED");
  assert.equal(reloadedJob.status, "DONE");
  assert.equal(reloadedJob.outputUrl, `/api/files/${p.id}/exports/real.mp4`);
  assert.deepEqual(storage.deleted, []);
});

test("13. after recovery, the project is in exactly the state the existing retry flow needs (video asset untouched, status ERROR so the UI's retry button appears, no unrelated fields disturbed)", async () => {
  const p = await project({ status: "TRANSCRIBING", language: "hi", progress: 77 });
  await prisma.videoAsset.create({
    data: { projectId: p.id, url: `/api/files/${p.id}/source.mp4`, originalName: "source.mp4", mimeType: "video/mp4", sizeBytes: 12345 },
  });
  await recoverStaleJobs(prisma, fakeStorage());
  const reloaded = await prisma.project.findUniqueOrThrow({ where: { id: p.id }, include: { video: true } });
  assert.equal(reloaded.status, "ERROR"); // ProcessingScreen renders the Retry button for this
  assert.equal(reloaded.language, "hi"); // untouched
  assert.ok(reloaded.video); // still attached — POST /retry's only precondition
  assert.equal(reloaded.video!.url, `/api/files/${p.id}/source.mp4`);
});

test("14. normal startup with a realistic mix of terminal-state projects and no stale work is a complete no-op", async () => {
  await project({ status: "READY" });
  await project({ status: "EDITING" });
  await project({ status: "EXPORTED" });
  await project({ status: "EMPTY" });
  const errored = await project({ status: "ERROR", errorMessage: "Transcription cancelled." });
  const before = await prisma.project.findMany({ orderBy: { id: "asc" } });

  const result = await recoverStaleJobs(prisma, fakeStorage());
  assert.deepEqual(result, { recoveredProjects: 0, recoveredExportJobs: 0 });

  const after = await prisma.project.findMany({ orderBy: { id: "asc" } });
  assert.deepEqual(after, before);
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: errored.id } })).errorMessage, "Transcription cancelled.");
});

test("recoverStaleJobs has exactly one call site in the whole codebase (instrumentation-node.ts) — the invariant the whole safety argument rests on: it must never be reachable from a request-handling code path, only from the pre-request startup boundary", async () => {
  const srcRoot = path.join(__dirname, "..", "..", "..");
  const callSites: string[] = [];
  async function walk(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith("stale-job-recovery.ts")) {
        const content = await fs.readFile(full, "utf-8");
        if (content.includes("recoverStaleJobs(")) callSites.push(full);
      }
    }
  }
  await walk(srcRoot);
  assert.deepEqual(
    callSites.map((f) => path.basename(f)),
    ["instrumentation-node.ts"],
  );
});
