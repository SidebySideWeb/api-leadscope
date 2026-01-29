export interface Country {
  id: number;
  name: string;
  code: string;
  created_at: Date;
}

export interface Industry {
  id: number;
  name: string;
  created_at: Date;
}

export interface City {
  id: number;
  name: string;
  normalized_name: string;
  country_id: number;
  latitude: number | null;
  longitude: number | null;
  radius_km: number | null;
  created_at: Date;
}

export interface Business {
  id: number;
  name: string;
  normalized_name: string;
  address: string | null;
  postal_code: string | null;
  city_id: number;
  industry_id: number | null;
  google_place_id: string | null;
  dataset_id: string; // UUID
  owner_user_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface Website {
  id: number;
  business_id: number | null;
  url: string;
  last_crawled_at: Date | null;
  html_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Contact {
  id: number;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  contact_type: 'email' | 'phone' | 'mobile';
  is_generic: boolean;
  first_seen_at: Date;
  last_verified_at: Date;
  is_active: boolean;
  created_at: Date;
}

export interface ContactSource {
  id: number;
  contact_id: number;
  source_url: string;
  page_type: 'homepage' | 'contact' | 'about' | 'company' | 'footer';
  found_at: Date;
  html_hash: string;
  created_at: Date;
}

export interface CrawlJob {
  id: string; // UUID
  website_id: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  pages_crawled: number;
  pages_limit: number;
  job_type: 'discovery' | 'refresh';
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface GooglePlaceResult {
  place_id: string;
  name: string;
  formatted_address: string;
  website?: string;
  international_phone_number?: string;
  address_components?: Array<{
    types: string[];
    long_name: string;
    short_name: string;
  }>;
  rating?: number;
  user_rating_count?: number;
}

export interface DiscoveryInput {
  industry: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  useGeoGrid?: boolean; // Use geo-grid discovery instead of simple text search
  cityRadiusKm?: number; // Required if useGeoGrid is true
  datasetId: string; // Required: dataset ID (UUID) for ownership
}

export interface CrawlResult {
  url: string;
  html: string;
  htmlHash: string;
  pageType: 'homepage' | 'contact' | 'about' | 'company' | 'footer';
}

export interface ExtractedContact {
  email?: string;
  phone?: string;
  mobile?: string;
  contactType: 'email' | 'phone' | 'mobile';
  isGeneric: boolean;
}

// Re-export canonical export types
export type {
  ExportRowV1,
  ExportMetaV1,
  ExportPayloadV1,
  BusinessExportInput,
} from './export.js';

export {
  mapBusinessAndCrawlResultToExportRow,
  isValidExportRowV1,
  assertExportRowV1,
} from './export.js';

// Re-export plan and response types
export type { PlanId } from './plan.js';
export type { ResponseMeta, ApiResponse, PaginatedResponse } from './response.js';
