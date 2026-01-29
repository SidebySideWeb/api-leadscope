import type { ExportRequest, ExportResult } from '../types/exports.js';
import { exportSnapshot, exportSubscription } from '../exports/exportService.js';

/**
 * Export Job Handler
 * Routes to appropriate export service based on type
 */
export async function executeExportJob(request: ExportRequest): Promise<ExportResult> {
  console.log(`\n📤 Starting export job`);
  console.log(`   User: ${request.userId}`);
  console.log(`   Type: ${request.exportType}`);
  console.log(`   Format: ${request.format || 'xlsx'}`);

  try {
    let result: ExportResult;

    switch (request.exportType) {
      case 'snapshot':
        result = await exportSnapshot(request);
        break;
      case 'subscription':
        result = await exportSubscription(request);
        break;
      case 'admin':
        // Admin exports use subscription logic but with no limits
        result = await exportSubscription({
          ...request,
          exportType: 'admin'
        });
        break;
      default:
        throw new Error(`Unknown export type: ${request.exportType}`);
    }

    console.log(`\n✅ Export job completed`);
    console.log(`   Export ID: ${result.exportId}`);
    console.log(`   Total rows: ${result.totalRows}`);
    console.log(`   File path: ${result.filePath}`);

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Export job failed: ${errorMsg}`);
    throw error;
  }
}
