/**
 * Regression tests for the dashboard's search/filter/sort composition
 * (src/lib/dashboard/project-filters.ts) — pure functions, no DOM, no API calls.
 *
 * Run with: node --test src/lib/dashboard/__tests__/project-filters.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyProjectQuery,
  searchProjectsByName,
  filterProjectsByStatus,
  sortProjects,
  matchesStatusFilter,
  type FilterableProject,
} from "../project-filters.ts";

function project(overrides: Partial<FilterableProject> & { name: string }): FilterableProject {
  return {
    status: "READY",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("1/2. search matches project name, case-insensitively", () => {
  const projects = [project({ name: "Client Pitch" }), project({ name: "weekly recap" }), project({ name: "Untitled" })];
  assert.deepEqual(
    searchProjectsByName(projects, "CLIENT").map((p) => p.name),
    ["Client Pitch"],
  );
  assert.deepEqual(
    searchProjectsByName(projects, "recap").map((p) => p.name),
    ["weekly recap"],
  );
});

test("3. search returns zero results when there is no match", () => {
  const projects = [project({ name: "Client Pitch" }), project({ name: "weekly recap" })];
  assert.deepEqual(searchProjectsByName(projects, "nonexistent"), []);
});

test("search: empty/whitespace query matches everything (all non-deleted projects)", () => {
  const projects = [project({ name: "A" }), project({ name: "B" })];
  assert.equal(searchProjectsByName(projects, "").length, 2);
  assert.equal(searchProjectsByName(projects, "   ").length, 2);
});

test("4. each status filter produces the correct subset", () => {
  const projects = [
    project({ name: "empty-one", status: "EMPTY" }),
    project({ name: "loading-one", status: "LOADING" }),
    project({ name: "transcribing-one", status: "TRANSCRIBING" }),
    project({ name: "ready-one", status: "READY" }),
    project({ name: "editing-one", status: "EDITING" }),
    project({ name: "exported-one", status: "EXPORTED" }),
    project({ name: "error-one", status: "ERROR" }),
  ];

  assert.equal(filterProjectsByStatus(projects, "all").length, 7);
  assert.deepEqual(
    filterProjectsByStatus(projects, "processing").map((p) => p.name).sort(),
    ["empty-one", "loading-one", "transcribing-one"].sort(),
  );
  assert.deepEqual(
    filterProjectsByStatus(projects, "ready").map((p) => p.name).sort(),
    ["ready-one", "editing-one", "exported-one"].sort(),
  );
  assert.deepEqual(
    filterProjectsByStatus(projects, "failed").map((p) => p.name),
    ["error-one"],
  );
});

test("matchesStatusFilter agrees with filterProjectsByStatus for every known status", () => {
  for (const status of ["EMPTY", "LOADING", "TRANSCRIBING", "EXPORTING", "READY", "EDITING", "EXPORTED", "ERROR"]) {
    for (const filter of ["all", "processing", "ready", "failed"] as const) {
      const viaFilter = filterProjectsByStatus([project({ name: "x", status })], filter).length === 1;
      assert.equal(matchesStatusFilter(status, filter), viaFilter);
    }
  }
});

test("5. each sort order is correct", () => {
  const projects = [
    project({ name: "Banana", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z" }),
    project({ name: "apple", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }),
    project({ name: "Cherry", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-10T00:00:00.000Z" }),
  ];

  assert.deepEqual(
    sortProjects(projects, "updated-desc").map((p) => p.name),
    ["Cherry", "Banana", "apple"],
  );
  assert.deepEqual(
    sortProjects(projects, "created-desc").map((p) => p.name),
    ["apple", "Banana", "Cherry"],
  );
  assert.deepEqual(
    sortProjects(projects, "created-asc").map((p) => p.name),
    ["Cherry", "Banana", "apple"],
  );
  assert.deepEqual(
    sortProjects(projects, "name-asc").map((p) => p.name),
    ["apple", "Banana", "Cherry"],
  );
  assert.deepEqual(
    sortProjects(projects, "name-desc").map((p) => p.name),
    ["Cherry", "Banana", "apple"],
  );
});

test("sortProjects does not mutate the input array", () => {
  const projects = [project({ name: "B" }), project({ name: "A" })];
  const original = [...projects];
  sortProjects(projects, "name-asc");
  assert.deepEqual(projects, original);
});

test("6. search + filter + sort compose correctly together", () => {
  const projects = [
    project({ name: "Client Launch", status: "READY", updatedAt: "2026-01-05T00:00:00.000Z" }),
    project({ name: "Client Recap", status: "READY", updatedAt: "2026-01-10T00:00:00.000Z" }),
    project({ name: "Client Draft", status: "ERROR", updatedAt: "2026-01-20T00:00:00.000Z" }),
    project({ name: "Weekly Update", status: "READY", updatedAt: "2026-01-15T00:00:00.000Z" }),
  ];

  const result = applyProjectQuery(projects, { search: "client", filter: "ready", sort: "updated-desc" });
  assert.deepEqual(
    result.map((p) => p.name),
    ["Client Recap", "Client Launch"],
  );
});

test("7. trashed (deletedAt-set) projects never appear in results, regardless of search/filter/sort", () => {
  const projects = [
    project({ name: "Active Project", status: "READY" }),
    project({ name: "Trashed Project", status: "READY", deletedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  const result = applyProjectQuery(projects, {});
  assert.deepEqual(result.map((p) => p.name), ["Active Project"]);

  // Even an exact-name search for the trashed project must not surface it.
  const searched = applyProjectQuery(projects, { search: "Trashed" });
  assert.deepEqual(searched, []);
});

test("8. empty-state behavior: a non-empty project list with no matches produces an empty array, distinguishable from an empty input", () => {
  const projects = [project({ name: "Only Project", status: "READY" })];
  assert.deepEqual(applyProjectQuery(projects, { search: "nope" }), []);
  assert.deepEqual(applyProjectQuery([], {}), []);
});

test("default options (no search/filter/sort passed) match the documented defaults: show all, sorted by Recently Updated", () => {
  const projects = [
    project({ name: "Old", updatedAt: "2026-01-01T00:00:00.000Z" }),
    project({ name: "New", updatedAt: "2026-01-31T00:00:00.000Z" }),
  ];
  assert.deepEqual(applyProjectQuery(projects, {}).map((p) => p.name), ["New", "Old"]);
});
