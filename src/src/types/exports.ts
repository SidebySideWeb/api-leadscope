export type ExportType = 'snapshot' | 'subscription' | 'admin';
export type ExportFormat = 'csv' | 'xlsx';

export interface ExportFilters {
  industryId?: number;
  cityId?: number;
  datasetId?: string; // UUID
  ownerUserId?: string;
  isActiveContactsOnly?: boolean;
  minLastVerifiedDays?: number;
  hasWebsite?: boolean;
  hasEmail?: boolean;
  hasPhone?: boolean;
}

export interface ExportRequest {
  userId: string;
  exportType: ExportType;
  format?: ExportFormat;
  filters?: ExportFilters;
  industryId?: number;
  cityId?: number;
  rowLimit?: number;
}

export interface ExportResult {
  exportId: string;
  filePath: string;
  downloadUrl: string;
  totalRows: number;
  expiresAt?: Date;
}

export interface ExportRecord {
  id: string;
  user_id: string;
  export_type: ExportType;
  industry_id: number | null;
  city_id: number | null;
  total_rows: number;
  file_format: ExportFormat;
  file_path: string;
  watermark_text: string;
  filters: ExportFilters | null;
  created_at: Date;
  expires_at: Date | null;
}

export interface ExportRow {
  company_name: string;
  industry: string;
  city: string;
  address: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  source_url: string;
  first_seen_at: Date;
  last_verified_at: Date;
  contact_status: 'active' | 'removed';
}
