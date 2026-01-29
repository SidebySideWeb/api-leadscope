/**
 * Database Persistence Implementation
 * 
 * Uses PostgreSQL database for persistence.
 * Falls back to local JSON if database is unavailable.
 */

import { pool, testConnection } from '../config/database.js';
import type { PersistenceLayer, User } from './persistence.js';
import type { Dataset } from '../db/datasets.js';
import type { ExportRecord } from '../db/exports.js';
import type { UsageTracking } from '../db/usageTracking.js';
import { getUserPlan } from '../db/userPlans.js';
import { getDatasetById } from '../db/datasets.js';
import { logDatasetExport } from '../db/exports.js';
import { isInternalUser } from '../db/subscriptions.js';
import { 
  getUserUsage as dbGetUserUsage, 
  incrementExports, 
  incrementCrawls, 
  incrementDatasets 
} from '../db/usageTracking.js';

export class DbPersistence implements PersistenceLayer {
  async healthCheck(): Promise<boolean> {
    return await testConnection();
  }

  async getUser(userId: string): Promise<User | null> {
    try {
      // Get user plan from subscriptions table
      const plan = await getUserPlan(userId);
      
      // Check if user is internal (server-side only)
      const isInternal = await isInternalUser(userId);
      
      // Try to get user subscription for additional info
      const { getUserSubscription } = await import('../db/userPlans.js');
      const subscription = await getUserSubscription(userId);
      
      // Construct user object from available data
      // In a real system, you'd have a users table with email
      // This is a simplified version that works with subscriptions
      return {
        id: userId,
        email: '', // Email would come from users table if it existed
        plan,
        is_internal_user: isInternal,
        created_at: subscription?.current_period_end ? undefined : new Date(),
        updated_at: new Date(),
      };
    } catch (error) {
      console.error('[DbPersistence] Error getting user:', error);
      // Return default demo user on error
      return {
        id: userId,
        email: '',
        plan: 'demo',
        is_internal_user: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }
  }

  async getDataset(datasetId: string): Promise<Dataset | null> {
    try {
      return await getDatasetById(datasetId);
    } catch (error) {
      console.error('[DbPersistence] Error getting dataset:', error);
      return null;
    }
  }

  async saveExport(data: {
    datasetId: string;
    userId: string;
    tier: string;
    format: 'csv' | 'xlsx';
    rowCount: number;
    filePath: string;
    watermarkText: string;
  }): Promise<ExportRecord> {
    try {
      return await logDatasetExport(data);
    } catch (error) {
      console.error('[DbPersistence] Error saving export:', error);
      throw error;
    }
  }

  async getUserUsage(userId: string): Promise<UsageTracking> {
    try {
      return await dbGetUserUsage(userId);
    } catch (error) {
      console.error('[DbPersistence] Error getting user usage:', error);
      // Return default usage on error
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      return {
        id: '',
        user_id: userId,
        month_year: `${year}-${month}`,
        exports_this_month: 0,
        crawls_this_month: 0,
        datasets_created_this_month: 0,
        created_at: now,
        updated_at: now,
      };
    }
  }

  async incrementUsage(
    userId: string,
    type: 'export' | 'crawl' | 'dataset'
  ): Promise<UsageTracking> {
    try {
      switch (type) {
        case 'export':
          return await incrementExports(userId);
        case 'crawl':
          return await incrementCrawls(userId);
        case 'dataset':
          return await incrementDatasets(userId);
        default:
          throw new Error(`Unknown usage type: ${type}`);
      }
    } catch (error) {
      console.error(`[DbPersistence] Error incrementing ${type} usage:`, error);
      throw error;
    }
  }
}
