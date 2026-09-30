// Runtime SQLite migrations for the packaged desktop app's per-user database.
//
// Why this exists: an installed user's `subly.db` is created ONCE, on first
// launch, by copying prisma/template.db (see ensureDatabase() in main.js) —
// it is never touched again by anything Prisma-related, because the Prisma
// CLI isn't bundled in a packaged build (see ensureDatabase's own doc
// comment). That means an app UPDATE that adds a new column to schema.prisma
// has no way to reach an already-installed user's existing database file —
// until now. This module runs on every launch, right after ensureDatabase(),
// and additively brings an old database's actual schema up to date.
//
// Design constraints (all load-bearing, not just style preferences):
//  - Never DROP or recreate a table, never rewrite/replace the database file.
//  - Never touch existing column data — only ADD COLUMN, which SQLite fills
//    with NULL for every existing row and leaves everything else untouched.
//  - "Already applied" is detected by inspecting the database's OWN live
//    schema (PRAGMA table_info), never by a separate version-number/ledger
//    table — a ledger can drift from reality (e.g. a user restoring an older
//    backup, or a migration that half-applied on a previous crashed run);
//    checking the actual schema can't drift, so this is safe to run on every
//    single launch unconditionally, in any order, any number of times.
//  - Zero new dependencies: uses Node's built-in `node:sqlite` (available in
//    the Electron 44 / Node 24 runtime this app ships), not a native module
//    that would need its own packaging story.
//
// Adding a future additive migration: append one more entry to MIGRATIONS
// below. Each entry owns its own "is this already applied?" check and its
// own "apply it" step, so migrations more involved than a single ADD COLUMN
// (e.g. a new index, a backfill) are just as expressible as the column case.
const { DatabaseSync } = require("node:sqlite");

function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier: ${JSON.stringify(name)}`);
  return `"${name}"`;
}

function tableExists(db, table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function hasColumn(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
  return rows.some((r) => r.name === column);
}

/** Factory for the common case: one additive `ALTER TABLE ... ADD COLUMN ...`. */
function addColumnMigration({ id, description, table, column, columnDdl }) {
  return {
    id,
    description,
    isApplied: (db) => {
      if (!tableExists(db, table)) {
        // A required table missing entirely is a different, more serious problem
        // than "column not added yet" (the template.db this DB was copied from
        // should always have every table) — surface it loudly rather than
        // silently treating "no table" as "already migrated".
        throw new Error(`Migration "${id}" expects table "${table}" to exist, but it does not.`);
      }
      return hasColumn(db, table, column);
    },
    apply: (db) => {
      db.exec(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(column)} ${columnDdl}`);
    },
  };
}

const MIGRATIONS = [
  addColumnMigration({
    id: "2026-09-gujarati-script-text",
    description:
      "Subtitle.gujaratiScriptText — derived native Gujarati-script rendering of `text` (see src/lib/subtitles/gujarati-script.ts). Additive, nullable; existing rows get NULL until lazily generated.",
    table: "Subtitle",
    column: "gujaratiScriptText",
    columnDdl: "TEXT",
  }),
  addColumnMigration({
    id: "2026-09-project-progress",
    description:
      "Project.progress — real transcription percentage wired from python/whisper_worker.py's per-segment progress events (see pipeline.ts). Additive; existing rows default to 0.",
    table: "Project",
    column: "progress",
    columnDdl: "REAL NOT NULL DEFAULT 0",
  }),
  addColumnMigration({
    id: "2026-09-project-processing-started-at",
    description:
      "Project.processingStartedAt — set when a transcription attempt begins, so the UI can show real elapsed time (never an invented ETA). Additive, nullable.",
    table: "Project",
    column: "processingStartedAt",
    columnDdl: "DATETIME",
  }),
];

/**
 * Runs every migration in MIGRATIONS against the database at `dbPath`,
 * skipping any that are already applied. Returns which ids were newly
 * applied vs. already up to date, so the caller can log it. Throws (without
 * having modified anything) if any migration's own check/apply step fails —
 * callers should treat a thrown error as fatal-but-safe: the existing
 * database is left exactly as it was found, never partially migrated,
 * never deleted or recreated.
 */
function runMigrations(dbPath, { log } = {}) {
  const db = new DatabaseSync(dbPath);
  const applied = [];
  const alreadyUpToDate = [];
  try {
    db.exec("BEGIN IMMEDIATE"); // all-or-nothing for this run: one failing migration rolls back every ADD COLUMN from this same run, never leaves a half-migrated schema
    for (const migration of MIGRATIONS) {
      try {
        if (migration.isApplied(db)) {
          alreadyUpToDate.push(migration.id);
          continue;
        }
        migration.apply(db);
        applied.push(migration.id);
        log?.(`db migration applied: ${migration.id} — ${migration.description}`);
      } catch (err) {
        throw new Error(`Database migration "${migration.id}" failed: ${err.message}`, { cause: err });
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // best-effort — if COMMIT itself already failed the transaction may already be gone
    }
    throw err;
  } finally {
    db.close();
  }
  return { applied, alreadyUpToDate };
}

module.exports = { runMigrations, MIGRATIONS };
