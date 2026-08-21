/**
 * Optional tools.
 *
 * Each flag has a build-time default below, and can be overridden per install
 * from Settings → Optional tools. The stored value lives in `chrome.storage.local`
 * so the side panel and the background service worker agree on it: the panel
 * hides a disabled tool's entry point, and the background refuses its messages.
 */
export interface AcFeatureFlags {
  /**
   * "Structured client snapshot" — searches, ranks, and reads live client
   * charts from the signed-in AlayaCare UAT tenant.
   */
  clientChartSnapshot: boolean;

  /**
   * "Create client from JSON" — replays a chart export into a new synthetic
   * client on the active UAT tenant.
   */
  clientChartImport: boolean;

  /** "Batch PDF parser" — fully local PDF parsing, no tenant calls. */
  clientChartPdfParser: boolean;
}

export type AcFeatureFlag = keyof AcFeatureFlags;

export const FEATURE_FLAG_STORAGE_KEY = "ac-tools-feature-flags";

/** Used until a stored override says otherwise. */
export const DEFAULT_FEATURE_FLAGS: AcFeatureFlags = {
  clientChartSnapshot: false,
  clientChartImport: true,
  clientChartPdfParser: true
};

export const FEATURE_FLAG_LABELS: Record<AcFeatureFlag, string> = {
  clientChartSnapshot: "Structured client snapshot",
  clientChartImport: "Create client from JSON",
  clientChartPdfParser: "Batch PDF parser"
};

function mergeFeatureFlags(candidate: unknown): AcFeatureFlags {
  if (!candidate || typeof candidate !== "object") {
    return { ...DEFAULT_FEATURE_FLAGS };
  }

  const value = candidate as Partial<Record<AcFeatureFlag, unknown>>;
  const merged = { ...DEFAULT_FEATURE_FLAGS };

  for (const flag of Object.keys(DEFAULT_FEATURE_FLAGS) as AcFeatureFlag[]) {
    if (typeof value[flag] === "boolean") {
      merged[flag] = value[flag];
    }
  }

  return merged;
}

export async function loadFeatureFlags(): Promise<AcFeatureFlags> {
  try {
    const stored = await chrome.storage.local.get(FEATURE_FLAG_STORAGE_KEY);
    return mergeFeatureFlags(stored[FEATURE_FLAG_STORAGE_KEY]);
  } catch {
    return { ...DEFAULT_FEATURE_FLAGS };
  }
}

export async function saveFeatureFlags(flags: AcFeatureFlags): Promise<AcFeatureFlags> {
  const next = mergeFeatureFlags(flags);
  await chrome.storage.local.set({ [FEATURE_FLAG_STORAGE_KEY]: next });
  return next;
}

/** Message returned when a caller reaches a disabled tool. */
export function disabledFeatureMessage(flag: AcFeatureFlag): string {
  return `${FEATURE_FLAG_LABELS[flag]} is turned off in Settings → Optional tools.`;
}
