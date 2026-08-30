import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { config } from './config.js';

export interface ArtifactStorage {
  readonly driver: 'database' | 'filesystem';
  put(key: string, content: Uint8Array, expectedSha256: string): Promise<{ storageKey: string | null; contentBase64: string | null }>;
  get(input: { storageKey: string | null; contentBase64: string | null; expectedSha256: string }): Promise<Uint8Array>;
  healthCheck(): Promise<boolean>;
}

const digest = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');

class DatabaseArtifactStorage implements ArtifactStorage {
  readonly driver = 'database' as const;
  async put(_key: string, content: Uint8Array, expectedSha256: string) {
    if (digest(content) !== expectedSha256) throw new Error('Artifact content digest did not match its metadata.');
    return { storageKey: null, contentBase64: Buffer.from(content).toString('base64') };
  }
  async get(input: { storageKey: string | null; contentBase64: string | null; expectedSha256: string }) {
    if (!input.contentBase64) throw new Error('Inline artifact content is unavailable.');
    const content = new Uint8Array(Buffer.from(input.contentBase64, 'base64'));
    if (digest(content) !== input.expectedSha256) throw new Error('Stored artifact failed its integrity check.');
    return content;
  }
  async healthCheck() { return true; }
}

class FilesystemArtifactStorage implements ArtifactStorage {
  readonly driver = 'filesystem' as const;
  private readonly root = resolve(config.ARTIFACT_STORAGE_PATH);

  private path(key: string): string {
    const value = resolve(this.root, key);
    if (value !== this.root && !value.startsWith(`${this.root}${sep}`)) throw new Error('Invalid artifact storage key.');
    return value;
  }

  async put(key: string, content: Uint8Array, expectedSha256: string) {
    if (digest(content) !== expectedSha256) throw new Error('Artifact content digest did not match its metadata.');
    const path = this.path(key); await mkdir(resolve(path, '..'), { recursive: true });
    try { await writeFile(path, content, { flag: 'wx', mode: 0o440 }); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      const existing = new Uint8Array(await readFile(path));
      if (digest(existing) !== expectedSha256) throw new Error('An immutable artifact key already exists with different content.');
    }
    return { storageKey: key, contentBase64: null };
  }

  async get(input: { storageKey: string | null; contentBase64: string | null; expectedSha256: string }) {
    if (!input.storageKey) throw new Error('Artifact storage key is unavailable.');
    const content = new Uint8Array(await readFile(this.path(input.storageKey)));
    if (digest(content) !== input.expectedSha256) throw new Error('Stored artifact failed its integrity check.');
    return content;
  }

  async healthCheck() {
    try { await mkdir(this.root, { recursive: true }); await readFile(this.root).catch(() => undefined); return true; } catch { return false; }
  }
}

let instance: ArtifactStorage | undefined;
export function artifactStorage(): ArtifactStorage {
  instance ??= config.ARTIFACT_STORAGE_DRIVER === 'filesystem' ? new FilesystemArtifactStorage() : new DatabaseArtifactStorage();
  return instance;
}
