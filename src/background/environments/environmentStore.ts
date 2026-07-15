import {
  DEFAULT_SUPPORT_URL,
  ENVIRONMENT_REGISTRY_STORAGE_KEY,
  emptyEnvironmentRegistry,
  type EnvironmentConfig,
  type EnvironmentRegistry
} from "../../shared/environments";
import { normalizeSupportedOrigin } from "../alayaCareUrls";

export async function loadEnvironmentRegistry(): Promise<EnvironmentRegistry> {
  const stored = await chrome.storage.local.get(ENVIRONMENT_REGISTRY_STORAGE_KEY);
  const raw = stored[ENVIRONMENT_REGISTRY_STORAGE_KEY] as Partial<EnvironmentRegistry> | undefined;
  if (!raw?.environments || !Array.isArray(raw.environments)) {
    return emptyEnvironmentRegistry();
  }
  return sanitizeRegistry(raw as EnvironmentRegistry);
}

export async function saveEnvironment(config: EnvironmentConfig): Promise<EnvironmentRegistry> {
  const registry = await loadEnvironmentRegistry();
  const normalized = sanitizeEnvironment(config);
  const index = registry.environments.findIndex((item) => item.origin === normalized.origin);
  if (index >= 0) {
    registry.environments[index] = normalized;
  } else {
    registry.environments.push(normalized);
  }
  registry.environments.sort((a, b) => a.name.localeCompare(b.name));
  if (!registry.defaultOrigin) {
    registry.defaultOrigin = normalized.origin;
  }
  await persist(registry);
  return registry;
}

export async function ensureEnvironment(origin: string): Promise<EnvironmentRegistry> {
  const normalizedOrigin = normalizeSupportedOrigin(origin);
  const registry = await loadEnvironmentRegistry();
  if (registry.environments.some((item) => item.origin === normalizedOrigin)) {
    return registry;
  }
  return saveEnvironment({
    origin: normalizedOrigin,
    name: new URL(normalizedOrigin).hostname.split(".")[0] || normalizedOrigin,
    supportUrl: DEFAULT_SUPPORT_URL
  });
}

export async function deleteEnvironment(origin: string): Promise<EnvironmentRegistry> {
  const normalizedOrigin = normalizeSupportedOrigin(origin);
  const registry = await loadEnvironmentRegistry();
  registry.environments = registry.environments.filter((item) => item.origin !== normalizedOrigin);
  if (registry.defaultOrigin === normalizedOrigin) {
    registry.defaultOrigin = registry.environments[0]?.origin ?? null;
  }
  await persist(registry);
  return registry;
}

export async function setDefaultEnvironment(origin: string | null): Promise<EnvironmentRegistry> {
  const registry = await loadEnvironmentRegistry();
  if (origin === null) {
    registry.defaultOrigin = null;
  } else {
    const normalizedOrigin = normalizeSupportedOrigin(origin);
    if (!registry.environments.some((item) => item.origin === normalizedOrigin)) {
      throw new Error("The default tenant must exist in the environment registry.");
    }
    registry.defaultOrigin = normalizedOrigin;
  }
  await persist(registry);
  return registry;
}

export async function importEnvironmentRegistry(
  registry: EnvironmentRegistry
): Promise<EnvironmentRegistry> {
  const sanitized = sanitizeRegistry(registry);
  await persist(sanitized);
  return sanitized;
}

function sanitizeRegistry(registry: EnvironmentRegistry): EnvironmentRegistry {
  const environments = [...new Map(
    (registry.environments ?? []).map((item) => {
      const sanitized = sanitizeEnvironment(item);
      return [sanitized.origin, sanitized];
    })
  ).values()].sort((a, b) => a.name.localeCompare(b.name));
  const requestedDefault = registry.defaultOrigin
    ? normalizeSupportedOrigin(registry.defaultOrigin)
    : null;
  return {
    environments,
    defaultOrigin: environments.some((item) => item.origin === requestedDefault)
      ? requestedDefault
      : environments[0]?.origin ?? null
  };
}

function sanitizeEnvironment(config: EnvironmentConfig): EnvironmentConfig {
  const origin = normalizeSupportedOrigin(config.origin);
  const name = config.name.trim();
  if (!name) {
    throw new Error("Environment name is required.");
  }
  let supportUrl = config.supportUrl.trim() || DEFAULT_SUPPORT_URL;
  try {
    const parsedSupportUrl = new URL(supportUrl);
    if (parsedSupportUrl.protocol !== "https:" && parsedSupportUrl.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
    supportUrl = parsedSupportUrl.toString();
  } catch {
    throw new Error("Support URL must be a valid HTTP or HTTPS URL.");
  }
  return { origin, name, supportUrl };
}

async function persist(registry: EnvironmentRegistry): Promise<void> {
  await chrome.storage.local.set({ [ENVIRONMENT_REGISTRY_STORAGE_KEY]: registry });
}
