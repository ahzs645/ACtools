import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { KeyValueStore } from "@ac-core/platform";

/**
 * The desktop app's `local` storage tier: one JSON document in the user-data
 * directory, encrypted at rest with the OS credential store (DPAPI on Windows,
 * Keychain on macOS, the desktop keyring on Linux) whenever Electron reports
 * that encryption is available.
 *
 * Remembered API keys, the environment registry, feature flags, preferences,
 * and Shift Lab records all live here, so the whole document is encrypted
 * rather than just the secret fields.
 */
export class FileStore implements KeyValueStore {
  private values: Record<string, unknown> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  static forUserData(fileName: string): FileStore {
    return new FileStore(join(app.getPath("userData"), fileName));
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const values = await this.read();
    return values[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.update((values) => {
      values[key] = structuredClone(value);
    });
  }

  async remove(keys: string | string[]): Promise<void> {
    await this.update((values) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete values[key];
      }
    });
  }

  async keys(): Promise<string[]> {
    return Object.keys(await this.read());
  }

  private async read(): Promise<Record<string, unknown>> {
    if (this.values) {
      return this.values;
    }
    let raw: Buffer;
    try {
      raw = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.values = {};
        return this.values;
      }
      throw error;
    }
    const text = decode(raw);
    try {
      const parsed = JSON.parse(text) as unknown;
      this.values =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      // A corrupt store must not brick the app; start over and let the user
      // re-enter configuration rather than crash on every launch.
      console.warn(`Ignoring unreadable store at ${this.filePath}`);
      this.values = {};
    }
    return this.values;
  }

  private update(mutate: (values: Record<string, unknown>) => void): Promise<void> {
    this.queue = this.queue.then(async () => {
      const values = await this.read();
      mutate(values);
      await this.write(values);
    });
    return this.queue;
  }

  private async write(values: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload = encode(JSON.stringify(values));
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temp, payload, { mode: 0o600 });
    await rename(temp, this.filePath);
  }
}

const ENCRYPTED_PREFIX = Buffer.from("ACT1");

function encode(text: string): Buffer {
  if (safeStorage.isEncryptionAvailable()) {
    return Buffer.concat([ENCRYPTED_PREFIX, safeStorage.encryptString(text)]);
  }
  return Buffer.from(text, "utf8");
}

function decode(raw: Buffer): string {
  if (raw.subarray(0, ENCRYPTED_PREFIX.length).equals(ENCRYPTED_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "The AC Tools store is encrypted but this session cannot reach the OS credential store."
      );
    }
    return safeStorage.decryptString(Buffer.from(raw.subarray(ENCRYPTED_PREFIX.length)));
  }
  return raw.toString("utf8");
}
