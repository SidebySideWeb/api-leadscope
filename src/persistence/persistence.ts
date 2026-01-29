/**
 * Persistence Layer Interface
 * 
 * Unified interface for data persistence that works with both database and local JSON files.
 * Workers don't need to know where data comes from.
 */

import type { Dataset } from '../db/datasets.js';
import type { ExportRecord } from '../db/exports.js';
import type { UsageTracking } from '../db/usageTracking.js';

export interface User {
  id: string;
  email: string;
  plan: 'demo' | 'starter' | 'pro';
  is_internal_user?: boolean; // If true, bypasses all plan limits
  created_at?: Date;
  updated_at?: Date;
}

export interface PersistenceLayer {
  /**
   * Health check - returns true if persistence layer is available
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get user by ID
   */
  getUser(userId: string): Promise<User | null>;

  /**
   * Get dataset by ID
   */
  getDataset(datasetId: string): Promise<Dataset | null>;

  /**
   * Save export record
   */
  saveExport(data: {
    datasetId: string;
    userId: string;
    tier: string;
    format: 'csv' | 'xlsx';
    rowCount: number;
    filePath: string;
    watermarkText: string;
  }): Promise<ExportRecord>;

  /**
   * Increment usage counter
   */
  incrementUsage(
    userId: string,
    type: 'export' | 'crawl' | 'dataset'
  ): Promise<UsageTracking>;

  /**
   * Get user usage tracking
   */
  getUserUsage(userId: string): Promise<UsageTracking>;
}
