import { LocalStorageDriver } from "./local.ts";
import type { StorageDriver } from "./types.ts";

let driver: StorageDriver | null = null;

/** Returns the active storage driver, selected by STORAGE_DRIVER ("local" | "s3"). */
export function getStorage(): StorageDriver {
  if (driver) return driver;
  if (process.env.STORAGE_DRIVER === "s3") {
    // Lazy require so the S3 module (and its optional peer deps) never loads
    // in local/dev mode.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3StorageDriver } = require("./s3") as typeof import("./s3");
    driver = new S3StorageDriver();
  } else {
    driver = new LocalStorageDriver();
  }
  return driver;
}

export type { StorageDriver, PutResult } from "./types.ts";
