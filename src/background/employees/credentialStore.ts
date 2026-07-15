import { normalizeSupportedOrigin } from "../alayaCareUrls";

const CREDENTIAL_PREFIX = "ac-tools-employee-api-credentials:";

export interface EmployeeApiCredentials {
  publicKey: string;
  privateKey: string;
}

export interface StoredEmployeeApiCredentials extends EmployeeApiCredentials {
  storage: "session" | "local";
}

function credentialKey(origin: string): string {
  return `${CREDENTIAL_PREFIX}${normalizeSupportedOrigin(origin)}`;
}

export async function storeEmployeeApiCredentials(
  origin: string,
  credentials: EmployeeApiCredentials,
  remember: boolean
): Promise<void> {
  const key = credentialKey(origin);
  if (remember) {
    await chrome.storage.local.set({ [key]: credentials });
    await chrome.storage.session.remove(key);
  } else {
    await chrome.storage.session.set({ [key]: credentials });
    await chrome.storage.local.remove(key);
  }
}

export async function clearStoredEmployeeApiCredentials(origin: string): Promise<void> {
  const key = credentialKey(origin);
  await Promise.all([chrome.storage.session.remove(key), chrome.storage.local.remove(key)]);
}

export async function loadEmployeeApiCredentials(
  origin: string
): Promise<StoredEmployeeApiCredentials | null> {
  const key = credentialKey(origin);
  const [sessionStored, localStored] = await Promise.all([
    chrome.storage.session.get(key),
    chrome.storage.local.get(key)
  ]);
  const sessionValue = sessionStored[key] as Partial<EmployeeApiCredentials> | undefined;
  if (sessionValue?.publicKey && sessionValue.privateKey) {
    return { ...sessionValue, storage: "session" } as StoredEmployeeApiCredentials;
  }
  const localValue = localStored[key] as Partial<EmployeeApiCredentials> | undefined;
  if (localValue?.publicKey && localValue.privateKey) {
    return { ...localValue, storage: "local" } as StoredEmployeeApiCredentials;
  }
  return null;
}

export async function listCredentialOrigins(): Promise<Map<string, "session" | "local">> {
  const [sessionStored, localStored] = await Promise.all([
    chrome.storage.session.get(null),
    chrome.storage.local.get(null)
  ]);
  const origins = new Map<string, "session" | "local">();
  for (const key of Object.keys(localStored)) {
    if (key.startsWith(CREDENTIAL_PREFIX)) {
      origins.set(key.slice(CREDENTIAL_PREFIX.length), "local");
    }
  }
  for (const key of Object.keys(sessionStored)) {
    if (key.startsWith(CREDENTIAL_PREFIX)) {
      origins.set(key.slice(CREDENTIAL_PREFIX.length), "session");
    }
  }
  return origins;
}
