export const ALAYACARE_CLIENT_CHART_EXPORT_KIND = "alayacare-client-chart-export" as const;
export const ALAYACARE_CLIENT_CHART_EXPORT_SCHEMA_VERSION = 1 as const;

export interface ClientChartIdentity {
  routeId: string;
  id: number;
  guid: number;
  profileId?: number;
  branchId?: number;
  fullName: string;
  preferredName?: string;
  status?: string;
  externalId?: string | null;
}

export interface ClientChartSection {
  source: string;
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  loadedCount?: number;
  reportedCount?: number;
  pagesLoaded?: number;
  totalPages?: number;
  complete?: boolean;
  warnings?: string[];
}

export interface ClientChartExportSnapshot {
  kind: typeof ALAYACARE_CLIENT_CHART_EXPORT_KIND;
  schemaVersion: typeof ALAYACARE_CLIENT_CHART_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  tenantOrigin: string;
  sourceUrl: string;
  client: ClientChartIdentity;
  scope: {
    uatOnly: true;
    attachmentBinariesIncluded: false;
    pagination?: "all-reported-pages";
    knownExclusions?: string[];
  };
  sections: Record<string, ClientChartSection>;
  counts: {
    sections: number;
    successful: number;
    failed: number;
    complete?: number;
    partial?: number;
  };
}

export interface ClientChartSearchResult {
  clientId: number;
  routeId: string;
  guid: number;
  profileId?: number;
  fullName: string;
  preferredName?: string;
  status?: string;
  alayaCareId: string;
  dateOfBirth?: string;
  branchName?: string;
  clientGroups: string[];
}

export interface ClientChartSearchResponse {
  query: string;
  total: number;
  items: ClientChartSearchResult[];
}

export interface ClientChartRankedResult extends ClientChartSearchResult {
  fullnessScore: number;
  populatedSections: number;
  totalSections: number;
  recordCount: number;
  failedSections: number;
}

export interface ClientChartRankResponse {
  candidatePool: number;
  deepScanned: number;
  items: ClientChartRankedResult[];
  methodology: string;
}

export interface ActiveClientRoute {
  routeId: string;
  clientId: number;
}

export function readActiveClientRoute(hash: string): ActiveClientRoute | null {
  const modern = /^#\/clients\/([0-9a-z]+)(?:\/(?:overview|client-info|scheduling|care-management|care-delivery|accounting|events)(?:\/|$)|$)/i.exec(
    hash
  );
  const legacy = /^#\/customer\/default\/view\/id\/([0-9a-z]+)(?:\/|$)/i.exec(hash);
  const routeId = modern?.[1] ?? legacy?.[1];
  if (!routeId) return null;

  if (
    new Set(["list", "charts", "facility", "services-list", "myclient-service-list"]).has(
      routeId.toLowerCase()
    )
  ) {
    return null;
  }

  const clientId = Number.parseInt(routeId, 36);
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return null;
  return { routeId: routeId.toLowerCase(), clientId };
}
