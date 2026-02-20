export type JobType = 'discovery' | 'refresh';

export interface DiscoveryJobInput {
  industry?: string; // Legacy: industry name (for backward compatibility)
  industry_id?: string; // Legacy: industry UUID (for backward compatibility)
  industry_gemi_id?: number; // Preferred: industry GEMI ID
  industry_group_id?: string; // New: industry group UUID (alternative to industry_id)
  city?: string; // Legacy: city name (for backward compatibility)
  city_id?: string; // Legacy: city UUID (for backward compatibility)
  municipality_id?: string; // Legacy: municipality internal ID (for backward compatibility)
  municipality_gemi_id?: number; // Preferred: municipality GEMI ID
  prefecture_id?: string; // Prefecture internal ID (for prefecture-level discovery)
  prefecture_gemi_id?: number; // Preferred: prefecture GEMI ID (for prefecture-level discovery)
  latitude?: number;
  longitude?: number;
  cityRadiusKm?: number;
  useGeoGrid?: boolean;
  requestedByUserId?: number | string;
  userId?: string; // User ID for dataset reuse logic (required if datasetId not provided)
  datasetId?: string; // Optional: if not provided, will resolve/create based on city + industry
  discoveryRunId?: string; // Optional: if provided, use this discovery_run instead of creating a new one
  // userPlan removed - always resolved from database via getUserPermissions()
}

export interface RefreshJobInput {
  batchSize?: number;
  maxAgeDays?: number;
}

export interface JobResult {
  jobId: string;
  jobType: JobType;
  startTime: Date;
  endTime: Date;
  totalWebsitesProcessed: number;
  contactsAdded: number;
  contactsRemoved: number;
  contactsVerified: number;
  errors: string[];
  gated?: boolean; // True if limited by plan
  upgrade_hint?: string; // Upgrade suggestion if gated
}

export interface ContactMatch {
  contactId: number;
  isNew: boolean;
  isActive: boolean;
}
