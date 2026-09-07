import {
  DEFAULT_SUPPORT_URL,
  ENVIRONMENT_REGISTRY_STORAGE_KEY,
  emptyEnvironmentRegistry,
  type EnvironmentConfig,
  type EnvironmentRegistry,
} from "../shared/environments";
import { normalizeSupportedOrigin } from "../alayaCareUrls";
import type { KeyValueStore } from "../platform";

/** Non-secret tenant registry: friendly names, support links, and the default tenant. */
export class EnvironmentStore {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<EnvironmentRegistry> {
    const raw = await this.store.get<Partial<EnvironmentRegistry>>(
      ENVIRONMENT_REGISTRY_STORAGE_KEY,
    );
    if (!raw?.environments || !Array.isArray(raw.environments)) {
      return emptyEnvironmentRegistry();
    }
    return sanitizeRegistry(raw as EnvironmentRegistry);
  }

  async save(config: EnvironmentConfig): Promise<EnvironmentRegistry> {
    const registry = await this.load();
    const normalized = sanitizeEnvironment(config);
    const index = registry.environments.findIndex(
      (item) => item.origin === normalized.origin,
    );
    if (index >= 0) {
      registry.environments[index] = normalized;
    } else {
      registry.environments.push(normalized);
    }
    registry.environments.sort((a, b) => a.name.localeCompare(b.name));
    if (!registry.defaultOrigin) {
      registry.defaultOrigin = normalized.origin;
    }
    await this.persist(registry);
    return registry;
  }

  async ensure(origin: string): Promise<EnvironmentRegistry> {
    const normalizedOrigin = normalizeSupportedOrigin(origin);
    const registry = await this.load();
    if (
      registry.environments.some((item) => item.origin === normalizedOrigin)
    ) {
      return registry;
    }
    return this.save({
      origin: normalizedOrigin,
      name:
        new URL(normalizedOrigin).hostname.split(".")[0] || normalizedOrigin,
      supportUrl: DEFAULT_SUPPORT_URL,
    });
  }

  async delete(origin: string): Promise<EnvironmentRegistry> {
    const normalizedOrigin = normalizeSupportedOrigin(origin);
    const registry = await this.load();
    registry.environments = registry.environments.filter(
      (item) => item.origin !== normalizedOrigin,
    );
    if (registry.defaultOrigin === normalizedOrigin) {
      registry.defaultOrigin = registry.environments[0]?.origin ?? null;
    }
    await this.persist(registry);
    return registry;
  }

  async setDefault(origin: string | null): Promise<EnvironmentRegistry> {
    const registry = await this.load();
    if (origin === null) {
      registry.defaultOrigin = null;
    } else {
      const normalizedOrigin = normalizeSupportedOrigin(origin);
      if (
        !registry.environments.some((item) => item.origin === normalizedOrigin)
      ) {
        throw new Error(
          "The default tenant must exist in the environment registry.",
        );
      }
      registry.defaultOrigin = normalizedOrigin;
    }
    await this.persist(registry);
    return registry;
  }

  async import(registry: EnvironmentRegistry): Promise<EnvironmentRegistry> {
    const sanitized = sanitizeRegistry(registry);
    await this.persist(sanitized);
    return sanitized;
  }

  private async persist(registry: EnvironmentRegistry): Promise<void> {
    await this.store.set(ENVIRONMENT_REGISTRY_STORAGE_KEY, registry);
  }
}

function sanitizeRegistry(registry: EnvironmentRegistry): EnvironmentRegistry {
  const environments = [
    ...new Map(
      (registry.environments ?? []).map((item) => {
        const sanitized = sanitizeEnvironment(item);
        return [sanitized.origin, sanitized];
      }),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const requestedDefault = registry.defaultOrigin
    ? normalizeSupportedOrigin(registry.defaultOrigin)
    : null;
  return {
    environments,
    defaultOrigin: environments.some((item) => item.origin === requestedDefault)
      ? requestedDefault
      : (environments[0]?.origin ?? null),
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
    if (
      parsedSupportUrl.protocol !== "https:" &&
      parsedSupportUrl.protocol !== "http:"
    ) {
      throw new Error("Unsupported protocol");
    }
    supportUrl = parsedSupportUrl.toString();
  } catch {
    throw new Error("Support URL must be a valid HTTP or HTTPS URL.");
  }
  const taskTemplateId = readOptionalTaskTemplateId(config.taskTemplateId);
  const taskGroupPattern = readOptionalGroupPattern(config.taskGroupPattern);
  return {
    origin,
    name,
    supportUrl,
    ...(taskTemplateId !== undefined ? { taskTemplateId } : {}),
    ...(taskGroupPattern !== undefined ? { taskGroupPattern } : {})
  };
}

function readOptionalTaskTemplateId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const id = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new Error("Onboarding task template ID must be a positive whole number.");
  }
  return id;
}

function readOptionalGroupPattern(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("Onboarding group pattern must be text.");
  }
  const pattern = value.trim();
  if (!pattern) {
    return undefined;
  }
  try {
    new RegExp(pattern);
  } catch {
    throw new Error("Onboarding group pattern must be a valid regular expression.");
  }
  return pattern;
}
