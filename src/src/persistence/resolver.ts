/**
 * Persistence Resolver with Automatic Fallback
 * 
 * Attempts database first, falls back to local JSON files if unavailable.
 * Workers don't need to know where data comes from.
 */

import { DbPersistence } from './dbPersistence.js';
import { LocalPersistence } from './localPersistence.js';
import type { PersistenceLayer } from './persistence.js';

let cachedPersistence: PersistenceLayer | null = null;
let persistenceType: 'db' | 'local' | null = null;

/**
 * Resolve the active persistence layer with automatic fallback
 */
export async function resolvePersistence(): Promise<PersistenceLayer> {
  // Return cached persistence if available
  if (cachedPersistence && persistenceType) {
    // Verify health on cached persistence
    const healthy = await cachedPersistence.healthCheck();
    if (healthy) {
      return cachedPersistence;
    }
    // If unhealthy, clear cache and retry
    cachedPersistence = null;
    persistenceType = null;
  }

  // Try database first
  const dbPersistence = new DbPersistence();
  const dbHealthy = await dbPersistence.healthCheck();

  if (dbHealthy) {
    console.log('[persistence] Using DbPersistence (database)');
    cachedPersistence = dbPersistence;
    persistenceType = 'db';
    return dbPersistence;
  }

  // Fallback to local JSON files
  console.warn('[persistence] ⚠️  Database unavailable, falling back to LocalPersistence (JSON files)');
  const localPersistence = new LocalPersistence();
  const localHealthy = await localPersistence.healthCheck();

  if (!localHealthy) {
    throw new Error('Both database and local persistence are unavailable');
  }

  cachedPersistence = localPersistence;
  persistenceType = 'local';
  return localPersistence;
}
