/**
 * Pure, dependency-free search/filter/sort logic for the dashboard project grid. Kept separate
 * from projects-grid.tsx so it's directly unit-testable (no React, no DOM) and so the exact same
 * composition rules are guaranteed regardless of how the toolbar UI evolves.
 *
 * Deliberately structural (an interface, not an import of api-client's ProjectSummary): the
 * dashboard's real project list already comes from GET /api/projects, which filters
 * `deletedAt: null` at the database level (see src/app/api/projects/route.ts) — trashed projects
 * never reach this module in practice. The optional `deletedAt` field here is a defense-in-depth
 * guarantee (and what makes that guarantee independently testable) rather than a sign this module
 * expects to receive trashed projects.
 */

export interface FilterableProject {
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export type ProjectStatusFilter = "all" | "processing" | "ready" | "failed";
export type ProjectSortOrder = "updated-desc" | "created-desc" | "created-asc" | "name-asc" | "name-desc";

// Mirrors the status values actually written by lib/pipeline.ts and lib/export-pipeline.ts (see
// project-card.tsx's STATUS_LABEL for the same grouping expressed as UI badges). "processing"
// covers a project that hasn't reached a terminal ready/failed state yet, including one with no
// video uploaded yet (EMPTY) — there's no separate "not started" bucket in this feature's scope.
const PROCESSING_STATUSES = new Set(["EMPTY", "LOADING", "TRANSCRIBING", "EXPORTING"]);
const READY_STATUSES = new Set(["READY", "EDITING", "EXPORTED"]);
const FAILED_STATUSES = new Set(["ERROR"]);

export const STATUS_FILTER_OPTIONS: { value: ProjectStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "processing", label: "In Progress" },
  { value: "ready", label: "Ready" },
  { value: "failed", label: "Failed" },
];

export const SORT_OPTIONS: { value: ProjectSortOrder; label: string }[] = [
  { value: "updated-desc", label: "Recently Updated" },
  { value: "created-desc", label: "Recently Created" },
  { value: "created-asc", label: "Oldest First" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
];

export function matchesStatusFilter(status: string, filter: ProjectStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "processing") return PROCESSING_STATUSES.has(status);
  if (filter === "ready") return READY_STATUSES.has(status);
  return FAILED_STATUSES.has(status);
}

/** Case-insensitive substring match on project name only — not transcript text (out of scope
 * for this phase; see the P1 task description). An empty/whitespace-only query matches
 * everything. */
export function searchProjectsByName<T extends FilterableProject>(projects: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return projects;
  return projects.filter((p) => p.name.toLowerCase().includes(q));
}

export function filterProjectsByStatus<T extends FilterableProject>(projects: T[], filter: ProjectStatusFilter): T[] {
  return projects.filter((p) => matchesStatusFilter(p.status, filter));
}

export function sortProjects<T extends FilterableProject>(projects: T[], sort: ProjectSortOrder): T[] {
  const sorted = [...projects];
  switch (sort) {
    case "updated-desc":
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      break;
    case "created-desc":
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      break;
    case "created-asc":
      sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      break;
    case "name-asc":
      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      break;
    case "name-desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" }));
      break;
  }
  return sorted;
}

/** The one function the dashboard grid actually calls — composes search, status filter, and
 * sort in the correct order (search/filter first since they're independent set-narrowing
 * predicates, sort last since it must apply to whatever survives). Also excludes any
 * `deletedAt`-set project defensively, even though the real API already never returns one. */
export function applyProjectQuery<T extends FilterableProject>(
  projects: T[],
  opts: { search?: string; filter?: ProjectStatusFilter; sort?: ProjectSortOrder },
): T[] {
  const notTrashed = projects.filter((p) => !p.deletedAt);
  const searched = searchProjectsByName(notTrashed, opts.search ?? "");
  const filtered = filterProjectsByStatus(searched, opts.filter ?? "all");
  return sortProjects(filtered, opts.sort ?? "updated-desc");
}
