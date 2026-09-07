/**
 * Host abstraction for the AC Tools core.
 *
 * The same services run inside the Chrome extension (backed by
 * `chrome.storage` and the extension's `fetch`) and inside the desktop app
 * (backed by files in the Electron user-data directory and Node's `fetch`).
 * Nothing under `packages/ac-core` may reference `chrome.*`, `window`, or
 * `document` directly; everything host-specific arrives through these types.
 */

/** A small async key/value store with the same shape on every host. */
export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  keys(): Promise<string[]>;
}

/** Everything the API-key ("external API") pathway needs from its host. */
export interface CorePlatform {
  /** Survives restarts. Remembered credentials and the environment registry live here. */
  local: KeyValueStore;
  /** Cleared when the host exits. Session-only credentials live here. */
  session: KeyValueStore;
  /** Plain HTTP; the core adds Basic auth itself. Must not attach cookies. */
  fetch: typeof fetch;
}

/**
 * Everything the signed-in-session pathway needs from its host.
 *
 * In the extension this is the AlayaCare page the content script runs on. In
 * the desktop app it is a tenant the user signed into inside an Electron
 * session, whose cookies the host attaches to every request.
 */
export interface SessionContext {
  /** Tenant origin, e.g. `https://example.uat.alayacare.ca`. */
  readonly origin: string;
  /** Current page URL. Read lazily because hash routes change without a reload. */
  getHref(): string;
  /** Cookie-bearing fetch for `origin`. Relative paths are resolved against `origin` first. */
  fetch: typeof fetch;
  /**
   * Hand a generated file to the user. Hosts with a DOM may omit this and get
   * an anchor-click download; the desktop app supplies a native save dialog.
   */
  saveFile?(content: Uint8Array, type: string, filename: string): Promise<void>;
}

/** In-memory store, used for the desktop session tier and in tests. */
export class MemoryStore implements KeyValueStore {
  private readonly values = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.values.delete(key);
    }
  }

  async keys(): Promise<string[]> {
    return [...this.values.keys()];
  }
}
