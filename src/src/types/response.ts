/**
 * Response Types - Shared across backend API responses
 * 
 * These types ensure consistency between backend and frontend.
 */

import type { PlanId } from './plan.js';

/**
 * Response Metadata - Included in paginated/list API responses
 * 
 * This structure is storage-agnostic. The UI works identically
 * whether the backend uses database or local fallback storage.
 * All UI decisions should be based on this meta, never on storage mode detection.
 */
export interface ResponseMeta {
  plan_id: PlanId; // 'demo' | 'starter' | 'pro'
  gated: boolean; // Whether response was limited by plan
  gate_reason?: string; // Reason for gating (if gated)
  total_available: number; // Total items available (before limits)
  total_returned: number; // Items actually returned (after limits)
  upgrade_hint?: string; // Upgrade suggestion (if gated)
}

/**
 * Generic API Response wrapper
 */
export interface ApiResponse<T> {
  data: T | null;
  meta: ResponseMeta;
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * Paginated API Response
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: ResponseMeta;
}
