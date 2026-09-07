import { normalizeSupportedOrigin } from "../alayaCareUrls";
import type { CorePlatform } from "../platform";

const CREDENTIAL_PREFIX = "ac-tools-employee-api-credentials:";

export interface EmployeeApiCredentials {
  publicKey: string;
  privateKey: string;
}

export type CredentialStorageTier = "session" | "local";

export interface StoredEmployeeApiCredentials extends EmployeeApiCredentials {
  storage: CredentialStorageTier;
}

function credentialKey(origin: string): string {
  return `${CREDENTIAL_PREFIX}${normalizeSupportedOrigin(origin)}`;
}

/**
 * External API key storage, keyed by tenant origin.
 *
 * Keys default to the session tier and are only written to the local tier when
 * the user explicitly asks to remember them on this device.
 */
export class CredentialStore {
  constructor(private readonly platform: Pick<CorePlatform, "local" | "session">) {}

  async store(origin: string, credentials: EmployeeApiCredentials, remember: boolean): Promise<void> {
    const key = credentialKey(origin);
    if (remember) {
      await this.platform.local.set(key, credentials);
      await this.platform.session.remove(key);
    } else {
      await this.platform.session.set(key, credentials);
      await this.platform.local.remove(key);
    }
  }

  async clear(origin: string): Promise<void> {
    const key = credentialKey(origin);
    await Promise.all([this.platform.session.remove(key), this.platform.local.remove(key)]);
  }

  async load(origin: string): Promise<StoredEmployeeApiCredentials | null> {
    const key = credentialKey(origin);
    const [sessionValue, localValue] = await Promise.all([
      this.platform.session.get<Partial<EmployeeApiCredentials>>(key),
      this.platform.local.get<Partial<EmployeeApiCredentials>>(key)
    ]);
    if (sessionValue?.publicKey && sessionValue.privateKey) {
      return { publicKey: sessionValue.publicKey, privateKey: sessionValue.privateKey, storage: "session" };
    }
    if (localValue?.publicKey && localValue.privateKey) {
      return { publicKey: localValue.publicKey, privateKey: localValue.privateKey, storage: "local" };
    }
    return null;
  }

  async listOrigins(): Promise<Map<string, CredentialStorageTier>> {
    const [sessionKeys, localKeys] = await Promise.all([
      this.platform.session.keys(),
      this.platform.local.keys()
    ]);
    const origins = new Map<string, CredentialStorageTier>();
    for (const key of localKeys) {
      if (key.startsWith(CREDENTIAL_PREFIX)) {
        origins.set(key.slice(CREDENTIAL_PREFIX.length), "local");
      }
    }
    for (const key of sessionKeys) {
      if (key.startsWith(CREDENTIAL_PREFIX)) {
        origins.set(key.slice(CREDENTIAL_PREFIX.length), "session");
      }
    }
    return origins;
  }
}
