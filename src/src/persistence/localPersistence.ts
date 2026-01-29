/**
 * Local JSON Persistence Implementation
 * 
 * Uses local JSON files for persistence when database is unavailable.
 * Same interface as database persistence.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { PersistenceLayer, User } from './persistence.js';
import type { Dataset } from '../db/datasets.js';
import type { ExportRecord } from '../db/exports.js';
import type { UsageTracking } from '../db/usageTracking.js';

const STORE_DIR = path.join(process.cwd(), '.local-persistence');
const USERS_FILE = path.join(STORE_DIR, 'users.json');
const DATASETS_FILE = path.join(STORE_DIR, 'datasets.json');
const EXPORTS_FILE = path.join(STORE_DIR, 'exports.json');
const USAGE_FILE = path.join(STORE_DIR, 'usage.json');

export class LocalPersistence implements PersistenceLayer {
  private initialized = false;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(STORE_DIR, { recursive: true });

    // Initialize JSON files if they don't exist
    const files = [
      { path: USERS_FILE, default: '[]' },
      { path: DATASETS_FILE, default: '[]' },
      { path: EXPORTS_FILE, default: '[]' },
      { path: USAGE_FILE, default: '[]' },
    ];

    for (const file of files) {
      try {
        await fs.access(file.path);
      } catch {
        await fs.writeFile(file.path, file.default, 'utf-8');
      }
    }

    this.initialized = true;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      return true;
    } catch {
      return false;
    }
  }

  async getUser(userId: string): Promise<User | null> {
    await this.ensureInitialized();
    
    try {
      const content = await fs.readFile(USERS_FILE, 'utf-8');
      const users: User[] = JSON.parse(content);
      const user = users.find(u => u.id === userId);
      
      if (user) {
        return user;
      }

      // If user doesn't exist, create a default demo user
      const newUser: User = {
        id: userId,
        email: '',
        plan: 'demo',
        is_internal_user: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      users.push(newUser);
      await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
      
      return newUser;
    } catch (error) {
      console.error('[LocalPersistence] Error getting user:', error);
      return null;
    }
  }

  async getDataset(datasetId: string): Promise<Dataset | null> {
    await this.ensureInitialized();
    
    try {
      const content = await fs.readFile(DATASETS_FILE, 'utf-8');
      const datasets: Dataset[] = JSON.parse(content);
      return datasets.find(d => d.id === datasetId) || null;
    } catch (error) {
      console.error('[LocalPersistence] Error getting dataset:', error);
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
    await this.ensureInitialized();
    
    try {
      const content = await fs.readFile(EXPORTS_FILE, 'utf-8');
      const exports: ExportRecord[] = JSON.parse(content);

      const exportRecord: ExportRecord = {
        id: randomUUID(),
        user_id: data.userId,
        export_type: 'admin',
        industry_id: null,
        city_id: null,
        total_rows: data.rowCount,
        file_format: data.format,
        file_path: data.filePath,
        watermark_text: data.watermarkText,
        filters: {
          datasetId: data.datasetId,
          tier: data.tier,
        },
        created_at: new Date(),
        expires_at: null,
      };

      exports.push(exportRecord);
      await fs.writeFile(EXPORTS_FILE, JSON.stringify(exports, null, 2), 'utf-8');

      return exportRecord;
    } catch (error) {
      console.error('[LocalPersistence] Error saving export:', error);
      throw error;
    }
  }

  private async ensureUsageRecord(userId: string): Promise<UsageTracking> {
    const content = await fs.readFile(USAGE_FILE, 'utf-8');
    const allUsage: UsageTracking[] = JSON.parse(content);

    // Get current month-year
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const monthYear = `${year}-${month}`;

    // Find or create usage record for this month
    let usage = allUsage.find(
      u => u.user_id === userId && u.month_year === monthYear
    );

    if (!usage) {
      // Create new record for this month (automatic reset)
      usage = {
        id: randomUUID(),
        user_id: userId,
        month_year: monthYear,
        exports_this_month: 0,
        crawls_this_month: 0,
        datasets_created_this_month: 0,
        created_at: now,
        updated_at: now,
      };
      allUsage.push(usage);
      await fs.writeFile(USAGE_FILE, JSON.stringify(allUsage, null, 2), 'utf-8');
    }

    return usage;
  }

  async getUserUsage(userId: string): Promise<UsageTracking> {
    await this.ensureInitialized();
    
    try {
      return await this.ensureUsageRecord(userId);
    } catch (error) {
      console.error('[LocalPersistence] Error getting user usage:', error);
      // Return default usage on error
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      return {
        id: randomUUID(),
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
    await this.ensureInitialized();
    
    try {
      const content = await fs.readFile(USAGE_FILE, 'utf-8');
      const allUsage: UsageTracking[] = JSON.parse(content);

      // Get current month-year
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const monthYear = `${year}-${month}`;

      // Find or create usage record for this month
      let usage = allUsage.find(
        u => u.user_id === userId && u.month_year === monthYear
      );

      if (!usage) {
        // Create new record for this month (automatic reset)
        usage = {
          id: randomUUID(),
          user_id: userId,
          month_year: monthYear,
          exports_this_month: 0,
          crawls_this_month: 0,
          datasets_created_this_month: 0,
          created_at: now,
          updated_at: now,
        };
        allUsage.push(usage);
      }

      // Increment the appropriate counter
      switch (type) {
        case 'export':
          usage.exports_this_month += 1;
          break;
        case 'crawl':
          usage.crawls_this_month += 1;
          break;
        case 'dataset':
          usage.datasets_created_this_month += 1;
          break;
      }

      usage.updated_at = new Date();

      await fs.writeFile(USAGE_FILE, JSON.stringify(allUsage, null, 2), 'utf-8');

      return usage;
    } catch (error) {
      console.error(`[LocalPersistence] Error incrementing ${type} usage:`, error);
      throw error;
    }
  }
}
