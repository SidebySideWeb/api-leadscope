/**
 * Export Schema v1 - Usage Examples
 */

import { 
  buildExportRowsV1, 
  exportToCSVV1, 
  saveExportFileV1,
  exportDatasetV1,
  type BusinessExportInput,
  type Plan 
} from './exportSchemaV1.js';

/**
 * Example: Build export rows
 */
export function exampleBuildRows() {
  const businesses: BusinessExportInput[] = [
    {
      business: { name: 'Acme Corp' },
      website: { url: 'https://acme.com' },
      contact: {
        email: 'info@acme.com',
        phone: '+302101234567',
        source_url: 'https://acme.com/contact',
        confidence: 0.9,
      },
    },
    {
      business: { name: 'Tech Solutions' },
      website: { url: 'https://techsol.com' },
      contact: {
        email: 'hello@techsol.com',
        phone: '+306912345678',
        source_url: 'https://techsol.com/about',
        confidence: 0.8,
      },
    },
  ];

  // Build rows (enforces demo limit)
  const rows = buildExportRowsV1(businesses, 'demo');
  console.log(`Built ${rows.length} export rows`);
}

/**
 * Example: Generate CSV
 */
export function exampleGenerateCSV() {
  const businesses: BusinessExportInput[] = [
    {
      business: { name: 'Acme Corp' },
      website: { url: 'https://acme.com' },
      contact: {
        email: 'info@acme.com',
        phone: '+302101234567',
        source_url: 'https://acme.com/contact',
        confidence: 0.9,
      },
    },
  ];

  const rows = buildExportRowsV1(businesses, 'demo');
  const csv = exportToCSVV1(rows);
  console.log('CSV content:');
  console.log(csv);
}

/**
 * Example: Complete export workflow
 */
export async function exampleCompleteExport() {
  const businesses: BusinessExportInput[] = [
    {
      business: { name: 'Acme Corp' },
      website: { url: 'https://acme.com' },
      contact: {
        email: 'info@acme.com',
        phone: '+302101234567',
        source_url: 'https://acme.com/contact',
        confidence: 0.9,
      },
    },
    {
      business: { name: 'Tech Solutions' },
      website: { url: 'https://techsol.com' },
      contact: {
        email: 'hello@techsol.com',
        phone: '+306912345678',
        source_url: 'https://techsol.com/about',
        confidence: 0.8,
      },
    },
  ];

  const datasetId = 'abc-123-def';
  const plan: Plan = 'demo';

  // Complete export (builds rows, generates CSV, saves file)
  const result = await exportDatasetV1(businesses, plan, datasetId);

  if (result.success) {
    console.log(`✅ Export successful`);
    console.log(`   File: ${result.filePath}`);
    console.log(`   Rows exported: ${result.rows_exported}`);
    console.log(`   Rows total: ${result.rows_total}`);
    console.log(`   Limit: ${result.limit}`);
  } else {
    console.error(`❌ Export failed: ${result.error}`);
  }
}

/**
 * Example: Demo limit enforcement
 */
export function exampleDemoLimit() {
  // Create 60 businesses (exceeds demo limit of 50)
  const businesses: BusinessExportInput[] = Array.from({ length: 60 }, (_, i) => ({
    business: { name: `Business ${i + 1}` },
    website: { url: `https://business${i + 1}.com` },
    contact: {
      email: `info@business${i + 1}.com`,
      phone: `+30210${String(i).padStart(7, '0')}`,
      source_url: `https://business${i + 1}.com/contact`,
      confidence: 0.9,
    },
  }));

  // Build rows (will truncate to 50 for demo plan)
  const rows = buildExportRowsV1(businesses, 'demo');
  console.log(`Demo plan: ${rows.length} rows (truncated from ${businesses.length})`);

  // Paid plan: no truncation
  const paidRows = buildExportRowsV1(businesses, 'paid');
  console.log(`Paid plan: ${paidRows.length} rows (no truncation)`);
}
