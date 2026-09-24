import { createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { config } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Media storage abstraction. Callers never touch the filesystem or S3 directly —
 * files are streamed back through the API (never served by URL), so the driver
 * can be swapped without touching callers. Object keys are server-generated cuids
 * (no path traversal). Two drivers ship:
 *   - `local`: disk under MEDIA_DIR (dev / single node)
 *   - `s3`:    any S3-compatible store (Backblaze B2, Cloudflare R2, AWS S3,
 *              MinIO) — required for multi-instance / ephemeral production hosts
 */
export interface StorageDriver {
  readonly name: string;
  ensure(): Promise<void>;
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

function assertKey(key: string): void {
  if (key.includes('/') || key.includes('\\') || key.includes('..')) {
    throw new Error('invalid storage key');
  }
}

/** Local-disk driver. */
class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root = isAbsolute(config.MEDIA_DIR)
    ? config.MEDIA_DIR
    : resolve(process.cwd(), config.MEDIA_DIR);

  private pathFor(key: string): string {
    assertKey(key);
    return join(this.root, key);
  }

  async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    logger.info({ dir: this.root }, 'media storage ready (local disk)');
  }

  async put(key: string, data: Buffer): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.pathFor(key), data);
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      /* already gone */
    }
  }
}

/** Generic S3-compatible driver (Backblaze B2, Cloudflare R2, AWS S3, MinIO). */
class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly bucket = config.S3_BUCKET;

  constructor() {
    this.client = new S3Client({
      region: config.S3_REGION || 'auto',
      endpoint: config.S3_ENDPOINT || undefined,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async ensure(): Promise<void> {
    if (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
      throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
    }
    // Best-effort connectivity check; a missing object is fine, auth errors surface.
    try {
      await this.exists('__healthcheck__');
      logger.info({ bucket: this.bucket, endpoint: config.S3_ENDPOINT || 'aws' }, 'media storage ready (S3-compatible)');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : 'unknown', bucket: this.bucket },
        'S3 storage reachable check failed at startup',
      );
    }
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<void> {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
    );
  }

  async getStream(key: string): Promise<Readable> {
    assertKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  async exists(key: string): Promise<boolean> {
    assertKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      /* already gone */
    }
  }
}

export const storage: StorageDriver =
  config.STORAGE_DRIVER === 's3' ? new S3StorageDriver() : new LocalStorageDriver();

/** Prepare storage (create dir / verify bucket). Called once at startup. */
export async function ensureStorage(): Promise<void> {
  await storage.ensure();
}
