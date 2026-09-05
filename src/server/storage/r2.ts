import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env, integrations } from '@/lib/env';

/**
 * Object storage for evidence artefacts and generated documents.
 *
 * Cloudflare R2 speaks the S3 API, so this is the same client either way. Two
 * drivers:
 *
 *   r2     — production. Durable, and no egress fee for reading it back.
 *   local  — development. The filesystem under STORAGE_LOCAL_PATH.
 *
 * The driver is chosen from configuration, and the calling code never knows
 * which it got. That matters because evidence has to outlive the row that
 * points at it: a report may be re-exported months after the audit, and a
 * screenshot that only lived in a container's filesystem would be gone.
 *
 * Keys are content-addressed (`sha256`), so storing the same artefact twice
 * costs one object, and a stored object can always be verified against the hash
 * recorded in the database.
 */

export type StorageDriver = 'r2' | 'local';

export interface StoredObject {
  key: string;
  sha256: string;
  bytes: number;
  contentType: string;
  driver: StorageDriver;
}

export function activeDriver(): StorageDriver {
  return integrations.r2 ? 'r2' : 'local';
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: 'auto', // R2 ignores region, but the SDK requires one.
    endpoint: env.R2_S3_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    // R2 does not support the checksum headers newer SDKs add by default.
    forcePathStyle: true,
  });
  return client;
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/**
 * Builds a content-addressed key, sharded by the first two hex characters so a
 * bucket listing stays navigable once there are many thousands of objects.
 */
export function objectKey(prefix: string, hash: string, extension: string): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return `${prefix}/${hash.slice(0, 2)}/${hash}${ext}`;
}

export async function putObject(args: {
  data: Buffer;
  prefix: 'evidence' | 'reports' | 'proposals' | 'presentations' | 'attachments';
  extension: string;
  contentType: string;
  /** Metadata stored alongside the object, for later forensics. */
  metadata?: Record<string, string>;
}): Promise<StoredObject> {
  const hash = sha256(args.data);
  const key = objectKey(args.prefix, hash, args.extension);
  const driver = activeDriver();

  if (driver === 'r2') {
    await s3().send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        Body: args.data,
        ContentType: args.contentType,
        // Metadata values must be ASCII; anything else is dropped rather than
        // risking a signature mismatch.
        Metadata: Object.fromEntries(
          Object.entries(args.metadata ?? {}).map(([k, v]) => [
            k.toLowerCase(),
            v.replace(/[^\x20-\x7E]/g, '').slice(0, 200),
          ]),
        ),
      }),
    );
  } else {
    const file = path.resolve(env.STORAGE_LOCAL_PATH, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, args.data);
  }

  return {
    key,
    sha256: hash,
    bytes: args.data.byteLength,
    contentType: args.contentType,
    driver,
  };
}

export async function getObject(key: string): Promise<Buffer | null> {
  if (activeDriver() === 'r2') {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
      if (!res.Body) return null;
      const chunks: Uint8Array[] = [];
      // @ts-expect-error the SDK stream is async-iterable at runtime
      for await (const chunk of res.Body) chunks.push(chunk as Uint8Array);
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  try {
    return await fs.readFile(path.resolve(env.STORAGE_LOCAL_PATH, key));
  } catch {
    return null;
  }
}

/**
 * Verifies a stored object still matches the hash recorded when it was written.
 *
 * Evidence underpins client-facing claims, so "the file is still the file we
 * captured" is worth being able to prove rather than assume.
 */
export async function verifyObject(key: string, expectedSha256: string): Promise<boolean> {
  const data = await getObject(key);
  return data !== null && sha256(data) === expectedSha256;
}

export async function deleteObject(key: string): Promise<void> {
  if (activeDriver() === 'r2') {
    await s3().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return;
  }
  try {
    await fs.unlink(path.resolve(env.STORAGE_LOCAL_PATH, key));
  } catch {
    // Already gone is the desired end state.
  }
}

export interface StorageHealth {
  driver: StorageDriver;
  configured: boolean;
  reachable: boolean;
  bucket: string | null;
  message: string;
}

/** Confirms the bucket exists and the credentials can reach it. */
export async function checkStorage(): Promise<StorageHealth> {
  const driver = activeDriver();

  if (driver === 'local') {
    const dir = path.resolve(env.STORAGE_LOCAL_PATH);
    try {
      await fs.mkdir(dir, { recursive: true });
      return {
        driver,
        configured: true,
        reachable: true,
        bucket: null,
        message:
          `Local filesystem at ${dir}. Fine for development, but evidence stored here does not ` +
          'outlive the machine — configure R2 before production.',
      };
    } catch (err) {
      return {
        driver,
        configured: false,
        reachable: false,
        bucket: null,
        message: `Cannot write to ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  try {
    await s3().send(new HeadBucketCommand({ Bucket: env.R2_BUCKET }));
    return {
      driver,
      configured: true,
      reachable: true,
      bucket: env.R2_BUCKET,
      message: `Cloudflare R2 bucket "${env.R2_BUCKET}" is reachable.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      driver,
      configured: true,
      reachable: false,
      bucket: env.R2_BUCKET,
      message:
        /NoSuchBucket|NotFound|404/.test(message)
          ? `The bucket "${env.R2_BUCKET}" does not exist. Create it in the Cloudflare dashboard, or set R2_BUCKET to an existing one.`
          : /403|Forbidden|SignatureDoesNotMatch|InvalidAccessKeyId/.test(message)
            ? `R2 rejected the credentials: ${message}. Check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, and that the token has Object Read & Write on this bucket.`
            : `Could not reach R2: ${message}`,
    };
  }
}

/** Drops the cached client. Used after a configuration change, and by tests. */
export function resetStorageClient(): void {
  client?.destroy?.();
  client = null;
}
