// Ambient fallback types for the OPTIONAL @aws-sdk packages used only by
// src/lib/storage/s3.ts (dynamically imported, only reached when
// STORAGE_DRIVER=s3). Keeps `tsc` green without requiring every dev to
// install the AWS SDK just to work on local/demo storage.
//
// Once you `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`,
// delete this file — the real package types take over automatically.
declare module "@aws-sdk/client-s3" {
  export class S3Client {
    constructor(config: unknown);
    send(command: unknown): Promise<unknown>;
  }
  export class PutObjectCommand {
    constructor(input: unknown);
  }
  export class GetObjectCommand {
    constructor(input: unknown);
  }
  export class DeleteObjectCommand {
    constructor(input: unknown);
  }
  export class CopyObjectCommand {
    constructor(input: unknown);
  }
  export class ListObjectsV2Command {
    constructor(input: unknown);
  }
  export class DeleteObjectsCommand {
    constructor(input: unknown);
  }
}

declare module "@aws-sdk/s3-request-presigner" {
  export function getSignedUrl(client: unknown, command: unknown, options?: unknown): Promise<string>;
}
