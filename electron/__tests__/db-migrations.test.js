/**
 * Tests for the packaged desktop app's runtime SQLite migration mechanism
 * (electron/db-migrations.js) — the fix for "an existing user's subly.db has
 * no way to receive an additive schema change shipped in a later version".
 *
 * Run with: node --test electron/__tests__/db-migrations.test.js
 *
 * Deliberately uses Node's own built-in `node:test`/`node:assert` AND
 * `node:sqlite` — same zero-new-dependency convention as the rest of this
 * project's test suites, and exercises the exact same sqlite module the
 * packaged Electron app itself uses at runtime.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runMigrations, MIGRATIONS } = require("../db-migrations.js");

/** Minimal-but-real subset of the actual Prisma-managed schema (Project +
 * Subtitle), matching prisma/schema.prisma's SQLite column mapping, WITHOUT
 * the `gujaratiScriptText` column — i.e. exactly the shape of a real
 * pre-Gujarati-Script-feature `subly.db` from an older installed version. */
const PRE_MIGRATION_SCHEMA = `
  CREATE TABLE Project (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'EMPTY',
    language TEXT NOT NULL DEFAULT 'en',
    captionOutputMode TEXT NOT NULL DEFAULT 'original'
  );
  CREATE TABLE Subtitle (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    start REAL NOT NULL,
    end REAL NOT NULL,
    text TEXT NOT NULL,
    words TEXT NOT NULL,
    style TEXT,
    animation TEXT,
    hinglishText TEXT
  );
`;

/** node:sqlite returns rows as null-prototype objects — spread into a plain
 * object so assert.deepEqual (deepStrictEqual under node:assert/strict, which
 * also compares [[Prototype]]) compares only the actual column values. */
function plain(row) {
  return row === undefined ? row : { ...row };
}

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "subly-migration-test-")), "subly.db");
}

function seedRealisticProject(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(PRE_MIGRATION_SCHEMA);
  db.prepare(
    `INSERT INTO Project (id, ownerId, name, status, language, captionOutputMode) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("proj1", "user1", "rishab test guj", "READY", "gu", "hinglish");
  db.prepare(
    `INSERT INTO Subtitle (id, projectId, "index", start, end, text, words, hinglishText) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("sub1", "proj1", 0, 0.0, 1.7, "अप्रेशण सामबडिय ने डर लागिव", '[{"text":"अप्रेशण","start":0,"end":0.48}]', "Apreshan samabadiv ne dar lagiv");
  db.prepare(
    `INSERT INTO Subtitle (id, projectId, "index", start, end, text, words, hinglishText) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("sub2", "proj1", 1, 1.7, 3.16, "तो चलो आजे एक डर", '[{"text":"तो","start":1.7,"end":1.9}]', "To chalo aaje ek dar");
  db.close();
}

test("A. fresh DB (already current schema, as copied from template.db) — migration is a no-op", () => {
  const dbPath = tempDbPath();
  const db = new DatabaseSync(dbPath);
  db.exec(PRE_MIGRATION_SCHEMA);
  // Simulates a fresh template.db that already has every column every current migration adds.
  db.exec(`ALTER TABLE Subtitle ADD COLUMN gujaratiScriptText TEXT`);
  db.exec(`ALTER TABLE Project ADD COLUMN progress REAL NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE Project ADD COLUMN processingStartedAt DATETIME`);
  db.close();

  const result = runMigrations(dbPath);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.alreadyUpToDate, MIGRATIONS.map((m) => m.id));

  // Verify schema unchanged (still exactly one gujaratiScriptText column, not duplicated).
  const verify = new DatabaseSync(dbPath);
  const cols = verify.prepare(`PRAGMA table_info(Subtitle)`).all().map((c) => c.name);
  assert.equal(cols.filter((c) => c === "gujaratiScriptText").length, 1);
  verify.close();
});

test("B. pre-Gujarati-Script DB (real project data, column missing) — migration adds the column and preserves every existing row untouched", () => {
  const dbPath = tempDbPath();
  seedRealisticProject(dbPath);

  // Sanity: confirm the column genuinely does not exist yet before migrating —
  // this is the "actually pre-migration database" the test must start from.
  const before = new DatabaseSync(dbPath);
  const colsBefore = before.prepare(`PRAGMA table_info(Subtitle)`).all().map((c) => c.name);
  assert.ok(!colsBefore.includes("gujaratiScriptText"), "test setup must NOT already have the column");
  const projectBefore = plain(before.prepare(`SELECT * FROM Project WHERE id = 'proj1'`).get());
  const subsBefore = before.prepare(`SELECT * FROM Subtitle ORDER BY "index"`).all().map(plain);
  before.close();

  const result = runMigrations(dbPath);
  assert.deepEqual(result.applied, ["2026-09-gujarati-script-text", "2026-09-project-progress", "2026-09-project-processing-started-at"]);
  assert.deepEqual(result.alreadyUpToDate, []);

  const after = new DatabaseSync(dbPath);
  const colsAfter = after.prepare(`PRAGMA table_info(Subtitle)`).all().map((c) => c.name);
  assert.ok(colsAfter.includes("gujaratiScriptText"), "column must exist after migration");
  const projectColsAfter = after.prepare(`PRAGMA table_info(Project)`).all().map((c) => c.name);
  assert.ok(projectColsAfter.includes("progress"), "progress column must exist after migration");
  assert.ok(projectColsAfter.includes("processingStartedAt"), "processingStartedAt column must exist after migration");

  // Existing project row's original fields untouched; the two new columns are present with
  // their migration-defined defaults (never a destructive rewrite).
  const projectAfter = plain(after.prepare(`SELECT * FROM Project WHERE id = 'proj1'`).get());
  const { progress, processingStartedAt, ...projectRest } = projectAfter;
  assert.deepEqual(projectRest, projectBefore);
  assert.equal(progress, 0);
  assert.equal(processingStartedAt, null);

  // Existing subtitle rows: every original field byte-identical, new column present as NULL
  // (never a destructive rewrite — SQLite ADD COLUMN backfills NULL, nothing else moves).
  const subsAfter = after.prepare(`SELECT * FROM Subtitle ORDER BY "index"`).all().map(plain);
  assert.equal(subsAfter.length, subsBefore.length);
  for (let i = 0; i < subsBefore.length; i++) {
    const { gujaratiScriptText, ...rest } = subsAfter[i];
    assert.deepEqual(rest, subsBefore[i]);
    assert.equal(gujaratiScriptText, null);
  }
  after.close();
});

test("C. already-migrated DB — running migration again is a true no-op, no duplicate-column error", () => {
  const dbPath = tempDbPath();
  seedRealisticProject(dbPath);

  const allIds = MIGRATIONS.map((m) => m.id);
  const first = runMigrations(dbPath);
  assert.deepEqual(first.applied, allIds);

  // Run it again (and a third time) — must not throw "duplicate column name", must
  // report everything as already up to date, and must not touch the data again.
  const second = runMigrations(dbPath);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.alreadyUpToDate, allIds);

  const third = runMigrations(dbPath);
  assert.deepEqual(third.applied, []);
  assert.deepEqual(third.alreadyUpToDate, allIds);

  const db = new DatabaseSync(dbPath);
  const subs = db.prepare(`SELECT * FROM Subtitle ORDER BY "index"`).all();
  assert.equal(subs.length, 2);
  assert.equal(subs[0].text, "अप्रेशण सामबडिय ने डर लागिव");
  db.close();
});

test("never drops or recreates the database file — same file, table count unchanged, only the new column added", () => {
  const dbPath = tempDbPath();
  seedRealisticProject(dbPath);
  const statBefore = fs.statSync(dbPath);

  const before = new DatabaseSync(dbPath);
  const tablesBefore = before.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all().map(plain);
  before.close();

  runMigrations(dbPath);

  assert.ok(fs.existsSync(dbPath), "database file must still exist at the same path");
  assert.ok(fs.statSync(dbPath).birthtimeMs === statBefore.birthtimeMs, "must be the same file, not a recreated one");

  const after = new DatabaseSync(dbPath);
  const tablesAfter = after.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all().map(plain);
  after.close();
  assert.deepEqual(tablesAfter, tablesBefore, "no tables dropped or added — only an additive column change");
});

test("fails safely (throws a clear error, leaves the database untouched) when a required table is missing", () => {
  const dbPath = tempDbPath();
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE Project (id TEXT PRIMARY KEY)`); // no Subtitle table at all
  db.close();

  assert.throws(() => runMigrations(dbPath), /expects table "Subtitle" to exist/);

  // The database itself must still be openable and untouched afterward — a
  // failed migration must never leave a corrupted or half-applied file.
  const after = new DatabaseSync(dbPath);
  const tables = after.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map(plain);
  after.close();
  assert.deepEqual(tables, [{ name: "Project" }]);
});

test("MIGRATIONS is a declarative, independently-checked list — reusable for future additive changes", () => {
  // Asserts the shape future migrations must follow (see db-migrations.js's own
  // doc comment on how to add one): each entry owns its own idempotency check
  // and its own apply step, so appending a new entry never affects existing ones.
  assert.ok(Array.isArray(MIGRATIONS));
  assert.ok(MIGRATIONS.length >= 1);
  assert.ok(MIGRATIONS.every((m) => typeof m.id === "string" && typeof m.isApplied === "function" && typeof m.apply === "function"));
});
