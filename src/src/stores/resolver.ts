/**
 * Store resolver with automatic fallback
 * Attempts Supabase first, falls back to LocalStore if unavailable
 */

import { SupabaseStore } from './supabaseStore.js';
import { LocalStore } from './localStore.js';
import type { Store } from './store.js';
import type { Dataset } from '../db/datasets.js';
import type { DatasetSnapshot } from './store.js';

let cachedStore: Store | null = null;
let storeType: 'supabase' | 'local' | null = null;

/**
 * Resolve the active store with automatic fallback
 */
export async function resolveStore(): Promise<Store> {
  // Return cached store if available
  if (cachedStore && storeType) {
    // Verify health on cached store
    const healthy = await cachedStore.healthCheck();
    if (healthy) {
      return cachedStore;
    }
    // If unhealthy, clear cache and retry
    cachedStore = null;
    storeType = null;
  }

  // Try Supabase first
  const supabaseStore = new SupabaseStore();
  const supabaseHealthy = await supabaseStore.healthCheck();

  if (supabaseHealthy) {
    console.log('[store] Using SupabaseStore (database)');
    cachedStore = supabaseStore;
    storeType = 'supabase';
    return supabaseStore;
  }

  // Fallback to LocalStore
  console.warn('[store] ⚠️  Supabase unavailable, falling back to LocalStore (filesystem)');
  const localStore = new LocalStore();
  const localHealthy = await localStore.healthCheck();

  if (!localHealthy) {
    throw new Error('Both Supabase and LocalStore are unavailable');
  }

  cachedStore = localStore;
  storeType = 'local';
  return localStore;
}

/**
 * Dataset resolver with snapshot reuse
 * Reuses snapshots if <30 days old, otherwise queues discovery (non-blocking)
 */
export async function datasetResolver(
  userId: string,
  datasetId?: string
): Promise<{
  dataset: Dataset | null;
  snapshot: DatasetSnapshot | null;
  shouldQueueDiscovery: boolean;
}> {
  const store = await resolveStore();

  // If datasetId provided, check for snapshot first
  if (datasetId) {
    const snapshot = await store.getDatasetSnapshot(datasetId, userId);
    if (snapshot) {
      const ageDays = (Date.now() - new Date(snapshot.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < 30) {
        console.log(`[datasetResolver] Using snapshot (${ageDays.toFixed(1)} days old)`);
        return {
          dataset: null, // Snapshot contains the data we need
          snapshot,
          shouldQueueDiscovery: false
        };
      } else {
        console.log(`[datasetResolver] Snapshot expired (${ageDays.toFixed(1)} days old), queueing discovery`);
        // Queue discovery in background (non-blocking)
        queueDiscovery(datasetId, userId).catch(err => {
          console.error('[datasetResolver] Error queueing discovery:', err);
        });
        return {
          dataset: null,
          snapshot: null,
          shouldQueueDiscovery: true
        };
      }
    }
  }

  // Get latest dataset
  const dataset = await store.getLatestDataset(userId);
  if (!dataset) {
    return {
      dataset: null,
      snapshot: null,
      shouldQueueDiscovery: false
    };
  }

  // Check for snapshot of latest dataset
  const snapshot = await store.getDatasetSnapshot(dataset.id, userId);
  if (snapshot) {
    const ageDays = (Date.now() - new Date(snapshot.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 30) {
      console.log(`[datasetResolver] Using snapshot for latest dataset (${ageDays.toFixed(1)} days old)`);
      return {
        dataset,
        snapshot,
        shouldQueueDiscovery: false
      };
    }
  }

  // Queue discovery if no valid snapshot
  if (!snapshot || (Date.now() - new Date(snapshot.created_at).getTime()) / (1000 * 60 * 60 * 24) >= 30) {
    console.log('[datasetResolver] No valid snapshot, queueing discovery');
    queueDiscovery(dataset.id, userId).catch(err => {
      console.error('[datasetResolver] Error queueing discovery:', err);
    });
  }

  return {
    dataset,
    snapshot,
    shouldQueueDiscovery: !snapshot
  };
}

/**
 * Queue discovery job (non-blocking, in-memory)
 */
const discoveryQueue: Array<{ datasetId: string; userId: string }> = [];
let discoveryProcessing = false;

async function queueDiscovery(datasetId: string, userId: string): Promise<void> {
  discoveryQueue.push({ datasetId, userId });
  console.log(`[datasetResolver] Queued discovery for dataset ${datasetId} (queue size: ${discoveryQueue.length})`);

  // Process queue if not already processing
  if (!discoveryProcessing) {
    discoveryProcessing = true;
    processDiscoveryQueue().catch(err => {
      console.error('[datasetResolver] Error processing discovery queue:', err);
      discoveryProcessing = false;
    });
  }
}

async function processDiscoveryQueue(): Promise<void> {
  while (discoveryQueue.length > 0) {
    const job = discoveryQueue.shift();
    if (!job) break;

    try {
      console.log(`[datasetResolver] Processing discovery for dataset ${job.datasetId}`);
      // In a real implementation, this would trigger the discovery worker
      // For now, we just log it
      // You could integrate with your existing discovery service here
    } catch (error) {
      console.error(`[datasetResolver] Discovery failed for ${job.datasetId}:`, error);
    }
  }

  discoveryProcessing = false;
}
