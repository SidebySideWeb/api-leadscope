/**
 * LocalStore - Filesystem-based JSON fallback
 * Used when Supabase is unavailable
 */

import fs from 'fs/promises';
import path from 'path';
import type { Store, DatasetSnapshot, CrawlJobInput, CrawlJobRecord } from './store.js';
import type { Dataset } from '../db/datasets.js';
import type { CrawlPageRecord } from '../db/crawlPages.js';
import type { Contact } from '../types/index.js';
import type { ExportRow } from '../types/exports.js';

const STORE_DIR = path.join(process.cwd(), '.local-store');
const DATASETS_FILE = path.join(STORE_DIR, 'datasets.json');
const SNAPSHOTS_DIR = path.join(STORE_DIR, 'snapshots');
const CRAWL_JOBS_FILE = path.join(STORE_DIR, 'crawl-jobs.json');
const PAGES_DIR = path.join(STORE_DIR, 'pages');
const CONTACTS_FILE = path.join(STORE_DIR, 'contacts.json');

export class LocalStore implements Store {
  private initialized = false;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(STORE_DIR, { recursive: true });
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
    await fs.mkdir(PAGES_DIR, { recursive: true });

    // Initialize JSON files if they don't exist
    const files = [
      { path: DATASETS_FILE, default: '[]' },
      { path: CRAWL_JOBS_FILE, default: '[]' },
      { path: CONTACTS_FILE, default: '[]' }
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

  async getLatestDataset(userId: string): Promise<Dataset | null> {
    await this.ensureInitialized();
    const content = await fs.readFile(DATASETS_FILE, 'utf-8');
    const datasets: Dataset[] = JSON.parse(content);
    const userDatasets = datasets.filter(d => d.user_id === userId);
    return userDatasets.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0] || null;
  }

  async createDatasetSnapshot(
    datasetId: string,
    userId: string,
    data: DatasetSnapshot['data']
  ): Promise<DatasetSnapshot> {
    await this.ensureInitialized();
    const snapshotId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 30);

    const snapshot: DatasetSnapshot = {
      id: snapshotId,
      dataset_id: datasetId,
      user_id: userId,
      created_at: now,
      expires_at: expiresAt,
      data
    };

    const filePath = path.join(SNAPSHOTS_DIR, `${snapshotId}.json`);
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

    return snapshot;
  }

  async getDatasetSnapshot(
    datasetId: string,
    userId: string
  ): Promise<DatasetSnapshot | null> {
    await this.ensureInitialized();
    
    try {
      const files = await fs.readdir(SNAPSHOTS_DIR);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const filePath = path.join(SNAPSHOTS_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const snapshot: DatasetSnapshot = JSON.parse(content);

        if (
          snapshot.dataset_id === datasetId &&
          snapshot.user_id === userId &&
          new Date(snapshot.expires_at) > new Date()
        ) {
          return snapshot;
        }
      }
    } catch {
      // Directory might not exist or be empty
    }

    return null;
  }

  async createCrawlJob(input: CrawlJobInput): Promise<CrawlJobRecord> {
    await this.ensureInitialized();
    const jobId = crypto.randomUUID();
    const job: CrawlJobRecord = {
      id: jobId,
      business_id: input.business_id,
      website_url: input.website_url,
      status: 'queued',
      pages_limit: input.pages_limit || 15,
      pages_crawled: 0,
      created_at: new Date()
    };

    const content = await fs.readFile(CRAWL_JOBS_FILE, 'utf-8');
    const jobs: CrawlJobRecord[] = JSON.parse(content);
    jobs.push(job);
    await fs.writeFile(CRAWL_JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8');

    return job;
  }

  async savePage(
    crawlJobId: string,
    page: Omit<CrawlPageRecord, 'id' | 'crawl_job_id' | 'fetched_at'>
  ): Promise<CrawlPageRecord> {
    await this.ensureInitialized();
    const pageId = crypto.randomUUID();
    const pageRecord: CrawlPageRecord = {
      id: pageId,
      crawl_job_id: crawlJobId,
      ...page,
      fetched_at: new Date()
    };

    const filePath = path.join(PAGES_DIR, `${pageId}.json`);
    await fs.writeFile(filePath, JSON.stringify(pageRecord, null, 2), 'utf-8');

    return pageRecord;
  }

  async saveContacts(
    _businessId: number,
    contacts: Array<{
      email?: string | null;
      phone?: string | null;
      mobile?: string | null;
      source_url: string;
      confidence?: number;
    }>
  ): Promise<Contact[]> {
    await this.ensureInitialized();
    const content = await fs.readFile(CONTACTS_FILE, 'utf-8');
    const allContacts: Contact[] = JSON.parse(content);

    const saved: Contact[] = [];
    for (const contact of contacts) {
      const contactId = allContacts.length + 1;
      const now = new Date();
      const contactRecord: Contact = {
        id: contactId,
        email: contact.email || null,
        phone: contact.phone || null,
        mobile: contact.mobile || null,
        contact_type: contact.email ? 'email' : 'phone',
        is_generic: false,
        first_seen_at: now,
        last_verified_at: now,
        is_active: true,
        created_at: now
      };

      allContacts.push(contactRecord);
      saved.push(contactRecord);
    }

    await fs.writeFile(CONTACTS_FILE, JSON.stringify(allContacts, null, 2), 'utf-8');
    return saved;
  }

  async getExportRows(filters: {
    datasetId: string;
    userId: string;
    rowLimit?: number;
  }): Promise<ExportRow[]> {
    await this.ensureInitialized();
    
    // Load snapshot if available
    const snapshot = await this.getDatasetSnapshot(filters.datasetId, filters.userId);
    if (!snapshot) {
      return [];
    }

    const rows: ExportRow[] = [];
    for (const business of snapshot.data.businesses) {
      const businessContacts = snapshot.data.contacts.filter(
        c => c.business_id === business.id
      );

      if (businessContacts.length === 0) {
        // Still include business even without contacts
        rows.push({
          company_name: business.name,
          industry: business.industry,
          city: business.city,
          address: null,
          website: business.website,
          email: null,
          phone: null,
          mobile: null,
          source_url: business.website || '',
          first_seen_at: new Date(),
          last_verified_at: new Date(),
          contact_status: 'active'
        });
      } else {
        for (const contact of businessContacts) {
          rows.push({
            company_name: business.name,
            industry: business.industry,
            city: business.city,
            address: null,
            website: business.website,
            email: contact.email,
            phone: contact.phone,
            mobile: contact.mobile,
            source_url: contact.source_url,
            first_seen_at: new Date(),
            last_verified_at: new Date(),
            contact_status: 'active'
          });
        }
      }
    }

    if (filters.rowLimit) {
      return rows.slice(0, filters.rowLimit);
    }

    return rows;
  }
}
