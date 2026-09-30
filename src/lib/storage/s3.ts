import type { PutResult, StorageDriver } from "./types";

/**
 * S3-compatible storage driver (AWS S3, Cloudflare R2, MinIO, Backblaze B2...).
 * Requires the optional `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
 * packages — installed lazily so local/dev usage never pays for them:
 *
 *   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *
 * Env vars: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL (CDN/public base to build URLs from).
 *
 * The imports below are built from a runtime string on purpose — a literal
 * `import("@aws-sdk/client-s3")` makes Next/Turbopack try to resolve the
 * package at build time and fail the whole build when it isn't installed
 * (which is the point of it being optional). Building the specifier at
 * runtime keeps this path lazy without requiring the AWS SDK for local/demo
 * (STORAGE_DRIVER=local) usage.
 */
type ClientS3Module = typeof import("@aws-sdk/client-s3");
type PresignerModule = typeof import("@aws-sdk/s3-request-presigner");

function importOptional<T>(specifier: string): Promise<T> {
  return import(/* webpackIgnore: true */ specifier) as Promise<T>;
}

const CLIENT_S3_SPECIFIER = ["@aws-sdk", "client-s3"].join("/");
const PRESIGNER_SPECIFIER = ["@aws-sdk", "s3-request-presigner"].join("/");

export class S3StorageDriver implements StorageDriver {
  private clientPromise: Promise<InstanceType<ClientS3Module["S3Client"]>> | null = null;
  private bucket = process.env.S3_BUCKET ?? "";

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = importOptional<ClientS3Module>(CLIENT_S3_SPECIFIER).then(
        ({ S3Client }) =>
          new S3Client({
            region: process.env.S3_REGION || "auto",
            endpoint: process.env.S3_ENDPOINT || undefined,
            credentials: {
              accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
            },
            forcePathStyle: true,
          }),
      );
    }
    return this.clientPromise;
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<PutResult> {
    const { PutObjectCommand } = await importOptional<ClientS3Module>(CLIENT_S3_SPECIFIER);
    const client = await this.client();
    await client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
    );
    return { key, url: this.publicUrl(key) };
  }

  async getPath(key: string): Promise<string> {
    const { GetObjectCommand } = await importOptional<ClientS3Module>(CLIENT_S3_SPECIFIER);
    const { getSignedUrl } = await importOptional<PresignerModule>(PRESIGNER_SPECIFIER);
    const client = await this.client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 3600 });
  }

  async del(key: string): Promise<void> {
    const { DeleteObjectCommand } = await importOptional<ClientS3Module>(CLIENT_S3_SPECIFIER);
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async delDir(prefix: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]+$/.test(prefix)) {
      throw new Error(`Refusing to delete an unsafe storage prefix: ${JSON.stringify(prefix)}`);
    }
    const { ListObjectsV2Command, DeleteObjectsCommand } = await importOptional<ClientS3Module>(CLIENT_S3_SPECIFIER);
    const client = await this.client();
    let continuationToken: string | undefined;
    do {
      // client.send()'s return type is deliberately `unknown` in the ambient fallback types
      // (src/types/optional-s3.d.ts, used only until the real, optional AWS SDK is actually
      // installed) — narrowed here to just the two fields this loop reads.
      const page = (await client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: `${prefix}/`, ContinuationToken: continuationToken }),
      )) as { Contents?: { Key?: string }[]; IsTruncated?: boolean; NextContinuationToken?: string };
      const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k);
      if (keys.length) {
        await client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async copy(srcKey: string, destKey: string): Promise<PutResult> {
    const { CopyObjectCommand } = await importOptional<ClientS3Module>(CLIENT_S3_SPECIFIER);
    const client = await this.client();
    await client.send(
      new CopyObjectCommand({ Bucket: this.bucket, CopySource: `${this.bucket}/${srcKey}`, Key: destKey }),
    );
    return { key: destKey, url: this.publicUrl(destKey) };
  }

  publicUrl(key: string): string {
    const base = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, "");
    return base ? `${base}/${key}` : `/api/files/${key}`;
  }
}
