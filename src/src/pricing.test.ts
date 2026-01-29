/**
 * Pricing Gates - Tests
 * 
 * Verify that pricing gates enforce limits correctly
 */

import { 
  assertExport, 
  assertCrawlDepth, 
  assertCrawlCount,
  getExportLimit,
  getCrawlDepthLimit,
  getCrawlCountLimit,
  isPaidPlan,
  isDemoPlan,
  type Plan 
} from './pricing.js';

/**
 * Test export limits
 */
function testExportLimits() {
  console.log('Testing export limits...');
  
  // Demo plan: should allow up to 50 rows
  try {
    assertExport('demo', 50); // Should pass
    console.log('✅ Demo: 50 rows allowed');
  } catch (error) {
    console.error('❌ Demo: 50 rows should be allowed', error);
  }
  
  // Demo plan: should reject 51 rows
  try {
    assertExport('demo', 51); // Should throw
    console.error('❌ Demo: 51 rows should be rejected');
  } catch (error: any) {
    console.log('✅ Demo: 51 rows correctly rejected:', error.message);
  }
  
  // Paid plan: should allow unlimited
  try {
    assertExport('paid', 1000); // Should pass
    assertExport('paid', 10000); // Should pass
    console.log('✅ Paid: Unlimited rows allowed');
  } catch (error) {
    console.error('❌ Paid: Should allow unlimited rows', error);
  }
  
  // Verify limits
  console.log(`   Demo export limit: ${getExportLimit('demo')}`);
  console.log(`   Paid export limit: ${getExportLimit('paid')}`);
}

/**
 * Test crawl depth limits
 */
function testCrawlDepthLimits() {
  console.log('\nTesting crawl depth limits...');
  
  // Demo plan: should allow up to depth 2
  try {
    assertCrawlDepth('demo', 2); // Should pass
    console.log('✅ Demo: Depth 2 allowed');
  } catch (error) {
    console.error('❌ Demo: Depth 2 should be allowed', error);
  }
  
  // Demo plan: should reject depth 3
  try {
    assertCrawlDepth('demo', 3); // Should throw
    console.error('❌ Demo: Depth 3 should be rejected');
  } catch (error: any) {
    console.log('✅ Demo: Depth 3 correctly rejected:', error.message);
  }
  
  // Paid plan: should allow unlimited depth
  try {
    assertCrawlDepth('paid', 10); // Should pass
    assertCrawlDepth('paid', 100); // Should pass
    console.log('✅ Paid: Unlimited depth allowed');
  } catch (error) {
    console.error('❌ Paid: Should allow unlimited depth', error);
  }
  
  // Verify limits
  console.log(`   Demo crawl depth limit: ${getCrawlDepthLimit('demo')}`);
  console.log(`   Paid crawl depth limit: ${getCrawlDepthLimit('paid')}`);
}

/**
 * Test crawl count limits
 */
function testCrawlCountLimits() {
  console.log('\nTesting crawl count limits...');
  
  // Demo plan: should allow up to 20 crawls
  try {
    assertCrawlCount('demo', 20); // Should pass
    console.log('✅ Demo: 20 crawls allowed');
  } catch (error) {
    console.error('❌ Demo: 20 crawls should be allowed', error);
  }
  
  // Demo plan: should reject 21 crawls
  try {
    assertCrawlCount('demo', 21); // Should throw
    console.error('❌ Demo: 21 crawls should be rejected');
  } catch (error: any) {
    console.log('✅ Demo: 21 crawls correctly rejected:', error.message);
  }
  
  // Paid plan: should allow unlimited crawls
  try {
    assertCrawlCount('paid', 100); // Should pass
    assertCrawlCount('paid', 1000); // Should pass
    console.log('✅ Paid: Unlimited crawls allowed');
  } catch (error) {
    console.error('❌ Paid: Should allow unlimited crawls', error);
  }
  
  // Verify limits
  console.log(`   Demo crawl count limit: ${getCrawlCountLimit('demo')}`);
  console.log(`   Paid crawl count limit: ${getCrawlCountLimit('paid')}`);
}

/**
 * Test helper functions
 */
function testHelperFunctions() {
  console.log('\nTesting helper functions...');
  
  // Test isPaidPlan
  if (isPaidPlan('paid')) {
    console.log('✅ isPaidPlan("paid") = true');
  } else {
    console.error('❌ isPaidPlan("paid") should be true');
  }
  
  if (!isPaidPlan('demo')) {
    console.log('✅ isPaidPlan("demo") = false');
  } else {
    console.error('❌ isPaidPlan("demo") should be false');
  }
  
  // Test isDemoPlan
  if (isDemoPlan('demo')) {
    console.log('✅ isDemoPlan("demo") = true');
  } else {
    console.error('❌ isDemoPlan("demo") should be true');
  }
  
  if (!isDemoPlan('paid')) {
    console.log('✅ isDemoPlan("paid") = false');
  } else {
    console.error('❌ isDemoPlan("paid") should be false');
  }
}

/**
 * Run all tests
 */
function runTests() {
  console.log('='.repeat(60));
  console.log('Pricing Gates - Test Suite');
  console.log('='.repeat(60));
  
  testExportLimits();
  testCrawlDepthLimits();
  testCrawlCountLimits();
  testHelperFunctions();
  
  console.log('\n' + '='.repeat(60));
  console.log('All tests completed!');
  console.log('='.repeat(60));
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

export { runTests };
