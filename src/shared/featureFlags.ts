/**
 * Build-time feature flags.
 *
 * These are plain constants: flip a value here, rebuild, and reload the
 * extension. A disabled flag hides the entry point in the side panel *and*
 * refuses the matching background message, so a disabled tool cannot be
 * reached by an out-of-date panel either.
 */
export interface AcFeatureFlags {
  /**
   * "Structured client snapshot" — searches, ranks, and reads live client
   * charts from the signed-in AlayaCare UAT tenant.
   *
   * Disabled for now: set to `true` to bring the sub-tool back.
   */
  clientChartSnapshot: boolean;

  /**
   * "Create a synthetic client from JSON" — replays a chart export into a new
   * synthetic client on the active UAT tenant.
   */
  clientChartImport: boolean;

  /** "Parse batch-export PDFs" — fully local PDF parsing, no tenant calls. */
  clientChartPdfParser: boolean;
}

export const AC_FEATURE_FLAGS: AcFeatureFlags = {
  clientChartSnapshot: false,
  clientChartImport: true,
  clientChartPdfParser: true
};

export function isFeatureEnabled(flag: keyof AcFeatureFlags): boolean {
  return AC_FEATURE_FLAGS[flag];
}

/** Message returned when a caller reaches a disabled tool. */
export function disabledFeatureMessage(label: string): string {
  return `${label} is disabled in this build.`;
}
