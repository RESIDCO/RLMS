/**
 * StorageProvider — Phase 1: local disk (or existing Supabase storage later).
 * Never overwrite: each upload is a new object key. SHA-256 required.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export type StoredObject = {
  storageKey: string;
  sha256: string;
  size: number;
  mime: string;
};

export interface StorageProvider {
  put(opts: {
    tenantId: string;
    kind: string;
    filename: string;
    mime: string;
    bytes: Buffer;
  }): Promise<StoredObject>;
  get(storageKey: string): Promise<{ bytes: Buffer; sha256: string }>;
  verify(storageKey: string, expectedSha256: string): Promise<boolean>;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class LocalDiskStorageProvider implements StorageProvider {
  constructor(private rootDir: string) {}

  private keyFor(tenantId: string, kind: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
    return path.posix.join(tenantId, kind, `${randomUUID()}-${safe}`);
  }

  async put(opts: {
    tenantId: string;
    kind: string;
    filename: string;
    mime: string;
    bytes: Buffer;
  }): Promise<StoredObject> {
    const storageKey = this.keyFor(opts.tenantId, opts.kind, opts.filename);
    const abs = path.join(this.rootDir, storageKey);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, opts.bytes);
    const sha256 = sha256Hex(opts.bytes);
    return {
      storageKey,
      sha256,
      size: opts.bytes.length,
      mime: opts.mime,
    };
  }

  async get(storageKey: string): Promise<{ bytes: Buffer; sha256: string }> {
    const abs = path.join(this.rootDir, storageKey);
    const bytes = await readFile(abs);
    return { bytes, sha256: sha256Hex(bytes) };
  }

  async verify(storageKey: string, expectedSha256: string): Promise<boolean> {
    const { sha256 } = await this.get(storageKey);
    return sha256 === expectedSha256;
  }
}

const defaultRoot =
  process.env.REPAIR_STORAGE_ROOT ||
  path.join(process.cwd(), "data", "repair-storage");

let storageProvider: StorageProvider = new LocalDiskStorageProvider(defaultRoot);

export function getStorageProvider(): StorageProvider {
  return storageProvider;
}

export function setStorageProvider(provider: StorageProvider): void {
  storageProvider = provider;
}
