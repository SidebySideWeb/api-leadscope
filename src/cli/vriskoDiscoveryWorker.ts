/**
 * CLI entry point for vrisko discovery worker
 * 
 * Runs continuously, polling database for jobs and processing them
 * 
 * Usage: npm run worker:vrisko-discovery
 */

import dotenv from 'dotenv';
import { startVriskoDiscoveryWorker } from '../workers/vriskoDiscoveryWorker.js';

dotenv.config();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Start worker
startVriskoDiscoveryWorker().catch((error) => {
  console.error('❌ Fatal error in vrisko discovery worker:', error);
  process.exit(1);
});
