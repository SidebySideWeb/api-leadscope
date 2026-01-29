/**
 * Structured Action Logger
 * 
 * Logs all actions as JSON to stdout with:
 * - timestamp
 * - user_id
 * - action
 * - dataset_id
 * - result_summary
 * - gated
 * - error (if exists)
 */

export type ActionType = 
  | 'export'
  | 'crawl'
  | 'discovery'
  | 'refresh'
  | 'usage_increment';

export interface ActionLog {
  timestamp: string; // ISO 8601
  user_id: string;
  action: ActionType;
  dataset_id?: string | null;
  result_summary: string;
  gated: boolean;
  error?: string | null;
  metadata?: Record<string, unknown>; // Additional context
}

/**
 * Log an action to stdout as JSON
 */
export function logAction(log: ActionLog): void {
  // Output JSON to stdout (one line per log entry)
  console.log(JSON.stringify(log));
}

/**
 * Helper to create action log for export
 */
export function logExportAction(params: {
  userId: string;
  datasetId: string;
  resultSummary: string;
  gated: boolean;
  error?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  logAction({
    timestamp: new Date().toISOString(),
    user_id: params.userId,
    action: 'export',
    dataset_id: params.datasetId,
    result_summary: params.resultSummary,
    gated: params.gated,
    error: params.error || null,
    metadata: params.metadata,
  });
}

/**
 * Helper to create action log for crawl
 */
export function logCrawlAction(params: {
  userId: string;
  datasetId: string;
  resultSummary: string;
  gated: boolean;
  error?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  logAction({
    timestamp: new Date().toISOString(),
    user_id: params.userId,
    action: 'crawl',
    dataset_id: params.datasetId,
    result_summary: params.resultSummary,
    gated: params.gated,
    error: params.error || null,
    metadata: params.metadata,
  });
}

/**
 * Helper to create action log for discovery
 */
export function logDiscoveryAction(params: {
  userId: string;
  datasetId?: string | null;
  resultSummary: string;
  gated: boolean;
  error?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  logAction({
    timestamp: new Date().toISOString(),
    user_id: params.userId,
    action: 'discovery',
    dataset_id: params.datasetId || null,
    result_summary: params.resultSummary,
    gated: params.gated,
    error: params.error || null,
    metadata: params.metadata,
  });
}

/**
 * Helper to create action log for refresh
 */
export function logRefreshAction(params: {
  userId: string;
  datasetId?: string | null;
  resultSummary: string;
  gated: boolean;
  error?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  logAction({
    timestamp: new Date().toISOString(),
    user_id: params.userId,
    action: 'refresh',
    dataset_id: params.datasetId || null,
    result_summary: params.resultSummary,
    gated: params.gated,
    error: params.error || null,
    metadata: params.metadata,
  });
}

/**
 * Helper to create action log for usage increment
 */
export function logUsageIncrementAction(params: {
  userId: string;
  actionType: 'export' | 'crawl' | 'dataset';
  resultSummary: string;
  metadata?: Record<string, unknown>;
}): void {
  logAction({
    timestamp: new Date().toISOString(),
    user_id: params.userId,
    action: 'usage_increment',
    dataset_id: null,
    result_summary: params.resultSummary,
    gated: false,
    error: null,
    metadata: {
      usage_type: params.actionType,
      ...params.metadata,
    },
  });
}
