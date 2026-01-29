import { pool } from '../config/database.js';

export type ExportFormat = 'csv' | 'xlsx';

export interface ExportRecord {
  id: string;
  user_id: string;
  export_type: 'snapshot' | 'subscription' | 'admin';
  industry_id: number | null;
  city_id: number | null;
  total_rows: number;
  file_format: ExportFormat;
  file_path: string;
  watermark_text: string;
  filters: unknown | null;
  created_at: Date;
  expires_at: Date | null;
}

export async function logDatasetExport(data: {
  datasetId: string;
  userId: string;
  tier: string;
  format: ExportFormat;
  rowCount: number;
  filePath: string;
  watermarkText: string;
}): Promise<ExportRecord> {
  const filters = {
    datasetId: data.datasetId,
    tier: data.tier
  };

  const result = await pool.query<ExportRecord>(
    `INSERT INTO exports (
      user_id,
      export_type,
      industry_id,
      city_id,
      total_rows,
      file_format,
      file_path,
      watermark_text,
      filters,
      expires_at
    )
    VALUES ($1, 'admin', NULL, NULL, $2, $3, $4, $5, $6, NULL)
    RETURNING *`,
    [
      data.userId,
      data.rowCount,
      data.format,
      data.filePath,
      data.watermarkText,
      JSON.stringify(filters)
    ]
  );

  return result.rows[0];
}

