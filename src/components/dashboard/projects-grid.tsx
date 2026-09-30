"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Plus, FolderKanban, Loader2, Search, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ProjectCard } from "./project-card";
import { NewProjectDialog } from "./new-project-dialog";
import { api, type ProjectSummary } from "@/lib/api-client";
import {
  applyProjectQuery,
  STATUS_FILTER_OPTIONS,
  SORT_OPTIONS,
  type ProjectStatusFilter,
  type ProjectSortOrder,
} from "@/lib/dashboard/project-filters";

export function ProjectsGrid({ title, limit }: { title: string; limit?: number }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>("all");
  const [sort, setSort] = useState<ProjectSortOrder>("updated-desc");

  const load = useCallback(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Client-side only: the dashboard already loads the complete (non-deleted) project list in
  // one request, so search/filter/sort are pure in-memory recomputation on every keystroke —
  // no extra API calls, no page reload, no added DB query complexity.
  const filtered = useMemo(
    () => applyProjectQuery(projects ?? [], { search, filter: statusFilter, sort }),
    [projects, search, statusFilter, sort],
  );
  const shown = limit ? filtered.slice(0, limit) : filtered;
  const hasAnyProjects = (projects?.length ?? 0) > 0;
  const isFiltered = search.trim() !== "" || statusFilter !== "all";

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted">{projects?.length ?? 0} project{projects?.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="accent" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" /> New project
          </Button>
        </div>
      </div>

      {hasAnyProjects && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects by name..."
              className="pl-9"
              aria-label="Search projects by name"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ProjectStatusFilter)}>
            <SelectTrigger className="w-auto min-w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as ProjectSortOrder)}>
            <SelectTrigger className="w-auto min-w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!projects ? (
        <div className="flex h-64 items-center justify-center text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : !hasAnyProjects ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-24 text-center">
          <FolderKanban className="size-8 text-muted-2" />
          <p className="font-medium">No projects yet</p>
          <p className="max-w-xs text-sm text-muted">Create your first project and upload a video to generate subtitles automatically.</p>
          <Button variant="accent" className="mt-2" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" /> New project
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-24 text-center">
          <SearchX className="size-8 text-muted-2" />
          <p className="font-medium">No projects match your search</p>
          <p className="max-w-xs text-sm text-muted">
            {isFiltered ? "Try a different name or clear the search and filter." : "Try a different search."}
          </p>
          {isFiltered && (
            <Button variant="outline" className="mt-2" onClick={clearFilters}>
              Clear search & filter
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} onChanged={load} />
          ))}
        </div>
      )}

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
