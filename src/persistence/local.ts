/**
 * Local file persistence (fallback when DB unavailable)
 */

import fs from 'fs/promises';
import path from 'path';
import type { Persistence } from './index.js';
import type { BusinessWithWebsite, CrawlResultV1, DatasetCrawlSummary } from '../types/crawl.js';
import { logger } from '../utils/logger.js';

const DATA_DIR = path.join(process.cwd(), 'data');

export class LocalPersistence implements Persistence {
  async isAvailable(): Promise<boolean> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  async listBusinesses(datasetId: string, limit?: number): Promise<BusinessWithWebsite[]> {
    const filePath = path.join(DATA_DIR, `businesses_${datasetId}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const businesses: BusinessWithWebsite[] = JSON.parse(content);
      
      if (limit) {
        return businesses.slice(0, limit);
      }
      
      return businesses;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn(`[LocalPersistence] Businesses file not found: ${filePath}`);
        return [];
      }
      throw error;
    }
  }

  async upsertCrawlResult(result: CrawlResultV1): Promise<void> {
    const crawlDir = path.join(DATA_DIR, 'crawls', result.dataset_id);
    await fs.mkdir(crawlDir, { recursive: true });

    const filePath = path.join(crawlDir, `${result.business_id}.json`);
    const tempPath = `${filePath}.tmp`;

    // Atomic write
    await fs.writeFile(tempPath, JSON.stringify(result, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);

    // Update index
    await this.updateIndex(result.dataset_id, result.business_id, 'completed');
  }

  async saveSummary(summary: DatasetCrawlSummary): Promise<void> {
    const crawlDir = path.join(DATA_DIR, 'crawls', summary.dataset_id);
    await fs.mkdir(crawlDir, { recursive: true });

    const filePath = path.join(crawlDir, 'summary.json');
    const tempPath = `${filePath}.tmp`;

    // Atomic write
    await fs.writeFile(tempPath, JSON.stringify(summary, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
  }

  private async updateIndex(datasetId: string, businessId: string, status: string): Promise<void> {
    const crawlDir = path.join(DATA_DIR, 'crawls', datasetId);
    const indexPath = path.join(crawlDir, 'index.json');

    let index: Record<string, string> = {};
    
    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      index = JSON.parse(content);
    } catch {
      // Index doesn't exist yet
    }

    index[businessId] = status;

    const tempPath = `${indexPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(index, null, 2), 'utf-8');
    await fs.rename(tempPath, indexPath);
  }
}
