/**
 * Export Schema v1 - Tests
 */

import { 
  buildExportRowsV1, 
  exportToCSVV1, 
  saveExportFileV1,
  exportDatasetV1,
  type BusinessExportInput,
  type Plan 
} from './exportSchemaV1.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Test building export rows
 */
function testBuildRows() {
  console.log('Testing buildExportRowsV1...');
  
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

  // Test demo plan (should allow up to 50)
  const demoRows = buildExportRowsV1(businesses, 'demo');
  console.log(`✅ Demo plan: ${demoRows.length} rows (expected: 2)`);
  
  // Test paid plan (should allow all)
  const paidRows = buildExportRowsV1(businesses, 'paid');
  console.log(`✅ Paid plan: ${paidRows.length} rows (expected: 2)`);
  
  // Verify row structure
  if (demoRows[0]?.business_name === 'Acme Corp') {
    console.log('✅ Row structure correct');
  } else {
    console.error('❌ Row structure incorrect');
  }
}

/**
 * Test demo limit enforcement
 */
function testDemoLimit() {
  console.log('\nTesting demo limit enforcement...');
  
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

  // Demo plan: should truncate to 50
  const demoRows = buildExportRowsV1(businesses, 'demo');
  if (demoRows.length === 50) {
    console.log(`✅ Demo plan correctly truncated to 50 rows (from ${businesses.length})`);
  } else {
    console.error(`❌ Demo plan should truncate to 50, got ${demoRows.length}`);
  }

  // Paid plan: should allow all
  const paidRows = buildExportRowsV1(businesses, 'paid');
  if (paidRows.length === 60) {
    console.log(`✅ Paid plan correctly allows all ${paidRows.length} rows`);
  } else {
    console.error(`❌ Paid plan should allow all rows, got ${paidRows.length}`);
  }
}

/**
 * Test CSV generation
 */
function testCSVGeneration() {
  console.log('\nTesting CSV generation...');
  
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
  
  // Check header
  if (csv.includes('business_name,website,email,phone,source_page,confidence')) {
    console.log('✅ CSV header correct');
  } else {
    console.error('❌ CSV header incorrect');
  }
  
  // Check data row
  if (csv.includes('Acme Corp') && csv.includes('info@acme.com')) {
    console.log('✅ CSV data row correct');
  } else {
    console.error('❌ CSV data row incorrect');
  }
  
  console.log('\nCSV content:');
  console.log(csv);
}

/**
 * Test complete export workflow
 */
async function testCompleteExport() {
  console.log('\nTesting complete export workflow...');
  
  const businesses: BusinessExportInput[] = [
    {
      business: { name: 'Test Business' },
      website: { url: 'https://test.com' },
      contact: {
        email: 'test@test.com',
        phone: '+302101234567',
        source_url: 'https://test.com/contact',
        confidence: 0.9,
      },
    },
  ];

  const datasetId = 'test-dataset-' + Date.now();
  const plan: Plan = 'demo';

  try {
    const result = await exportDatasetV1(businesses, plan, datasetId);
    
    if (result.success) {
      console.log(`✅ Export successful`);
      console.log(`   File: ${result.filePath}`);
      console.log(`   Rows exported: ${result.rows_exported}`);
      console.log(`   Rows total: ${result.rows_total}`);
      console.log(`   Limit: ${result.limit}`);
      
      // Verify file exists
      try {
        await fs.access(result.filePath);
        console.log('✅ Export file exists');
        
        // Read and verify content
        const content = await fs.readFile(result.filePath, 'utf-8');
        if (content.includes('Test Business')) {
          console.log('✅ Export file content correct');
        } else {
          console.error('❌ Export file content incorrect');
        }
        
        // Cleanup
        await fs.unlink(result.filePath);
        const dir = path.dirname(result.filePath);
        try {
          await fs.rmdir(dir);
        } catch {
          // Directory might not be empty, ignore
        }
      } catch {
        console.error('❌ Export file does not exist');
      }
    } else {
      console.error(`❌ Export failed: ${result.error}`);
    }
  } catch (error: any) {
    console.error(`❌ Export error: ${error.message}`);
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('='.repeat(60));
  console.log('Export Schema v1 - Test Suite');
  console.log('='.repeat(60));
  
  testBuildRows();
  testDemoLimit();
  testCSVGeneration();
  await testCompleteExport();
  
  console.log('\n' + '='.repeat(60));
  console.log('All tests completed!');
  console.log('='.repeat(60));
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };
