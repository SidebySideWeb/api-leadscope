/**
 * GEMI Fetch Worker
 * Background job to fetch businesses from GEMI API for a municipality
 * Runs with rate limiting (8 req/min, 7.5s delay)
 */

import { fetchGemiCompaniesForMunicipality, importGemiCompaniesToDatabase } from '../services/gemiService.js';
import { pool } from '../config/database.js';

export interface GemiFetchJob {
  municipality_gemi_id: number;
  activity_id?: number; // Optional industry filter
  dataset_id: string;
  user_id: string;
}

/**
 * Process a GEMI fetch job
 * Fetches all companies for a municipality and imports them to database
 */
export async function processGemiFetchJob(job: GemiFetchJob): Promise<{
  success: boolean;
  companiesFetched: number;
  companiesImported: number;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
}> {
  const startTime = Date.now();
  console.log(`[GEMI Worker] Starting fetch job for municipality ${job.municipality_gemi_id}`);

  try {
    // Fetch companies from GEMI API
    const result = await fetchGemiCompaniesForMunicipality(
      job.municipality_gemi_id,
      job.activity_id
    );

    console.log(`[GEMI Worker] Fetched ${result.companies.length} companies from GEMI API`);

    // Import to database
    const importResult = await importGemiCompaniesToDatabase(
      result.companies,
      job.dataset_id,
      job.user_id
    );

    const duration = Date.now() - startTime;
    console.log(
      `[GEMI Worker] Completed in ${duration}ms: ` +
      `${importResult.inserted} inserted, ${importResult.updated} updated, ${importResult.skipped} skipped`
    );

    return {
      success: true,
      companiesFetched: result.companies.length,
      companiesImported: importResult.inserted + importResult.updated,
      inserted: importResult.inserted,
      updated: importResult.updated,
      skipped: importResult.skipped,
    };
  } catch (error: any) {
    console.error(`[GEMI Worker] Error processing job:`, error);
    return {
      success: false,
      companiesFetched: 0,
      companiesImported: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Queue a GEMI fetch job (stores in database for processing)
 * You can create a jobs table or use existing job system
 */
export async function queueGemiFetchJob(job: GemiFetchJob): Promise<string> {
  // For now, we'll process immediately
  // In production, you might want to use a job queue system
  const jobId = `gemi-fetch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Process asynchronously
  processGemiFetchJob(job)
    .then((result) => {
      console.log(`[GEMI Worker] Job ${jobId} completed:`, result);
    })
    .catch((error) => {
      console.error(`[GEMI Worker] Job ${jobId} failed:`, error);
    });

  return jobId;
}
