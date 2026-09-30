export interface PutResult {
  /** Opaque key used to fetch/delete the object later. */
  key: string;
  /** Publicly resolvable URL (may be a local /api/files/* route or a real CDN/S3 URL). */
  url: string;
}

export interface StorageDriver {
  put(key: string, data: Buffer, contentType?: string): Promise<PutResult>;
  getPath(key: string): Promise<string>; // absolute local path OR presigned URL, driver-specific
  del(key: string): Promise<void>;
  /** Recursively removes every object/file whose key starts with `prefix` — used to clean up
   * everything belonging to one project (source video, audio, exports, .ass sidecars) in one
   * call when it's permanently deleted (see api/projects/[id]/trash/route.ts). Must never
   * remove anything outside `prefix` — implementations are responsible for their own
   * containment/path-safety checks (see local.ts's resolveSafePath). A no-op, not an error, if
   * nothing exists under `prefix`. */
  delDir(prefix: string): Promise<void>;
  publicUrl(key: string): string;
  /** Duplicates an existing object under a new key (e.g. project duplication) — a real, independent copy, not a shared reference. */
  copy(srcKey: string, destKey: string): Promise<PutResult>;
  /** Human-readable "where your files live" for display in Settings (see /api/system/status)
   * — an absolute local folder path for the local driver; omitted entirely for a remote
   * driver (S3) where there's no meaningful single local path to show. */
  describeLocation?(): string;
}
