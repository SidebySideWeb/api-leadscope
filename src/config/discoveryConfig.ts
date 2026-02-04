/**
 * Discovery Configuration
 * 
 * Configurable parameters for grid-based discovery system
 */

export interface DiscoveryConfig {
  // Grid generation
  gridRadiusKm: number; // Radius per grid point (default: 1.5km)
  gridDensity: number; // Grid step size in km (default: 1.5km, creates overlapping coverage)
  
  // Search limits
  maxSearchesPerDataset: number; // Maximum API calls per discovery (default: 500)
  minNewBusinessesPercent: number; // Stop if new businesses < X% (default: 2%)
  
  // Rate limiting
  concurrency: number; // Concurrent API calls (default: 3)
  requestDelayMs: number; // Delay between requests (default: 200ms)
  
  // Retry logic
  retryAttempts: number; // Number of retries on failure (default: 3)
  retryDelayMs: number; // Base delay for retries (default: 1000ms)
}

/**
 * Default discovery configuration
 */
export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  gridRadiusKm: 1.5, // 1.5km radius per grid point
  gridDensity: 1.5, // 1.5km step (creates ~50% overlap)
  maxSearchesPerDataset: 500, // Max API calls per discovery
  minNewBusinessesPercent: 2, // Stop if <2% new businesses per batch
  concurrency: 3, // 3 concurrent requests
  requestDelayMs: 200, // 200ms delay between requests
  retryAttempts: 3, // 3 retries
  retryDelayMs: 1000, // 1 second base delay
};

/**
 * Get discovery configuration from environment variables or defaults
 */
export function getDiscoveryConfig(): DiscoveryConfig {
  return {
    gridRadiusKm: parseFloat(process.env.DISCOVERY_GRID_RADIUS_KM || String(DEFAULT_DISCOVERY_CONFIG.gridRadiusKm)),
    gridDensity: parseFloat(process.env.DISCOVERY_GRID_DENSITY || String(DEFAULT_DISCOVERY_CONFIG.gridDensity)),
    maxSearchesPerDataset: parseInt(process.env.DISCOVERY_MAX_SEARCHES || String(DEFAULT_DISCOVERY_CONFIG.maxSearchesPerDataset), 10),
    minNewBusinessesPercent: parseFloat(process.env.DISCOVERY_MIN_NEW_PERCENT || String(DEFAULT_DISCOVERY_CONFIG.minNewBusinessesPercent)),
    concurrency: parseInt(process.env.DISCOVERY_CONCURRENCY || String(DEFAULT_DISCOVERY_CONFIG.concurrency), 10),
    requestDelayMs: parseInt(process.env.DISCOVERY_REQUEST_DELAY_MS || String(DEFAULT_DISCOVERY_CONFIG.requestDelayMs), 10),
    retryAttempts: parseInt(process.env.DISCOVERY_RETRY_ATTEMPTS || String(DEFAULT_DISCOVERY_CONFIG.retryAttempts), 10),
    retryDelayMs: parseInt(process.env.DISCOVERY_RETRY_DELAY_MS || String(DEFAULT_DISCOVERY_CONFIG.retryDelayMs), 10),
  };
}
