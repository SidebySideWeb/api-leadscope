/**
 * GEMI Metadata Migration Script
 * 
 * Fetches metadata from GEMI API and upserts into Supabase:
 * - GET /metadata/prefectures -> prefectures table
 * - GET /metadata/municipalities -> municipalities table
 * - GET /metadata/activities -> industries table
 * 
 * Usage: node scripts/seed-gemi-metadata.js
 */

import axios from 'axios';
import * as pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

// GEMI API configuration
const GEMI_API_BASE_URL = process.env.GEMI_API_BASE_URL || 'https://opendata-api.businessportal.gr/api/opendata/v1';
const GEMI_API_KEY = process.env.GEMI_API_KEY;

// Note: We'll check GEMI_API_KEY in main() after dotenv loads, so we can show better error messages

// Create axios client with authentication
// Try different auth methods based on API requirements
const axiosClient = axios.create({
  baseURL: GEMI_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
  params: {}, // Will be populated per request
});

// Add API key to requests - try different methods
// Method 1: Query parameter (common for open data APIs)
axiosClient.interceptors.request.use((config) => {
  if (GEMI_API_KEY) {
    // Try as query parameter first
    config.params = config.params || {};
    config.params.api_key = GEMI_API_KEY;
    // Also try as header (X-API-Key is common)
    config.headers['X-API-Key'] = GEMI_API_KEY;
    // And as Authorization Bearer (fallback)
    if (!config.headers['Authorization']) {
      config.headers['Authorization'] = `Bearer ${GEMI_API_KEY}`;
    }
  }
  return config;
});

/**
 * Fetch prefectures from GEMI API
 */
async function fetchPrefectures() {
  try {
    console.log('📥 Fetching prefectures from GEMI API...');
    const response = await axiosClient.get('/metadata/prefectures');
    return response.data.data || response.data || [];
  } catch (error) {
    console.error('❌ Error fetching prefectures:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    throw error;
  }
}

/**
 * Fetch municipalities from GEMI API
 */
async function fetchMunicipalities() {
  try {
    console.log('📥 Fetching municipalities from GEMI API...');
    const response = await axiosClient.get('/metadata/municipalities');
    return response.data.data || response.data || [];
  } catch (error) {
    console.error('❌ Error fetching municipalities:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    throw error;
  }
}

/**
 * Fetch activities (industries) from GEMI API
 */
async function fetchActivities() {
  try {
    console.log('📥 Fetching activities from GEMI API...');
    const response = await axiosClient.get('/metadata/activities');
    return response.data.data || response.data || [];
  } catch (error) {
    console.error('❌ Error fetching activities:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    throw error;
  }
}

/**
 * Upsert prefectures into database
 */
async function upsertPrefectures(prefectures) {
  console.log(`\n💾 ========== UPSERTING PREFECTURES ==========`);
  console.log(`💾 Total prefectures to process: ${prefectures.length}`);
  
  if (prefectures.length === 0) {
    console.warn(`⚠️  No prefectures to upsert!`);
    return { inserted: 0, updated: 0, errors: 0 };
  }
  
  // Log first prefecture structure for debugging
  console.log(`💾 First prefecture sample:`, JSON.stringify({
    id: prefectures[0].id,
    gemi_id: prefectures[0].gemi_id,
    descr: prefectures[0].descr,
    descrEn: prefectures[0].descrEn,
    keys: Object.keys(prefectures[0]),
  }, null, 2));
  
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < prefectures.length; i++) {
    const prefecture = prefectures[i];
    try {
      if ((i + 1) % 10 === 0 || i < 3) {
        console.log(`💾 [${i + 1}/${prefectures.length}] Processing: ${prefecture.descr || prefecture.id}`);
      }
      // Map GEMI API response to our schema
      // API returns: id, descr (Greek), descrEn (English)
      // Table: id (text), descr (text), descr_en (text), gemi_id (text)
      const gemiId = String(prefecture.id || prefecture.gemi_id || '');
      const descr = prefecture.descr || ''; // Greek name
      const descrEn = prefecture.descrEn || prefecture.descrEn || ''; // English name
      const lastUpdated = prefecture.lastUpdated ? new Date(prefecture.lastUpdated) : null;

      if (!gemiId || !descr) {
        console.warn(`⚠️  [${i + 1}/${prefectures.length}] Skipping prefecture with missing data:`, JSON.stringify({
          id: prefecture.id,
          gemi_id: prefecture.gemi_id,
          descr: prefecture.descr,
          keys: Object.keys(prefecture),
        }));
        errors++;
        continue;
      }

      // Generate UUID for id if not exists, or use existing
      const prefectureId = `pref-${gemiId}`;

      // Check if exists first to track insert vs update
      const existing = await pool.query(
        'SELECT id FROM prefectures WHERE gemi_id = $1',
        [gemiId]
      );

      if (i < 3) {
        console.log(`💾 Inserting prefecture: ${descr} (gemi_id: ${gemiId}, id: ${prefectureId})`);
      }

      const result = await pool.query(
        `INSERT INTO prefectures (id, gemi_id, descr, descr_en, last_updated_api, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (gemi_id) 
         DO UPDATE SET 
           descr = EXCLUDED.descr,
           descr_en = EXCLUDED.descr_en,
           last_updated_api = EXCLUDED.last_updated_api
         RETURNING id`,
        [prefectureId, gemiId, descr, descrEn || null, lastUpdated]
      );

      if (existing.rows.length === 0) {
        inserted++;
        if (i < 3) {
          console.log(`✅ Inserted prefecture: ${descr} (ID: ${result.rows[0].id})`);
        }
      } else {
        updated++;
        if (i < 3) {
          console.log(`🔄 Updated prefecture: ${descr} (ID: ${result.rows[0].id})`);
        }
      }
    } catch (error) {
      console.error(`❌ [${i + 1}/${prefectures.length}] Error upserting prefecture ${prefecture.id || 'unknown'}:`, error.message);
      if (error.code) {
        console.error(`   Error code: ${error.code}`);
      }
      if (error.detail) {
        console.error(`   Detail: ${error.detail}`);
      }
      if (i < 3 && error.stack) {
        console.error(`   Stack:`, error.stack);
      }
      errors++;
    }
  }

  console.log(`\n💾 ========== PREFECTURES SUMMARY ==========`);
  console.log(`✅ Inserted: ${inserted}`);
  console.log(`🔄 Updated: ${updated}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📊 Total: ${inserted + updated + errors} / ${prefectures.length}`);
  console.log(`💾 ===========================================\n`);
  return { inserted, updated, errors };
}

/**
 * Upsert municipalities into database
 */
async function upsertMunicipalities(municipalities) {
  console.log(`\n💾 ========== UPSERTING MUNICIPALITIES ==========`);
  console.log(`💾 Total municipalities to process: ${municipalities.length}`);
  
  if (municipalities.length === 0) {
    console.warn(`⚠️  No municipalities to upsert!`);
    return { inserted: 0, updated: 0, errors: 0, skippedPrefecture: 0 };
  }
  
  // Log first municipality structure for debugging
  console.log(`💾 First municipality sample:`, JSON.stringify({
    id: municipalities[0].id,
    gemi_id: municipalities[0].gemi_id,
    descr: municipalities[0].descr,
    descrEn: municipalities[0].descrEn,
    prefectureId: municipalities[0].prefectureId,
    keys: Object.keys(municipalities[0]),
  }, null, 2));
  
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  let skippedPrefecture = 0;

  for (let i = 0; i < municipalities.length; i++) {
    const municipality = municipalities[i];
    try {
      if ((i + 1) % 50 === 0 || i < 3) {
        console.log(`💾 [${i + 1}/${municipalities.length}] Processing: ${municipality.descr || municipality.id}`);
      }
      // API returns: id, descr (Greek), descrEn (English), prefectureId
      // Table: id (text), prefecture_id (text), descr (text), descr_en (text), gemi_id (text)
      const gemiId = String(municipality.id || municipality.gemi_id || '');
      const descr = municipality.descr || ''; // Greek name
      const descrEn = municipality.descrEn || municipality.descrEn || ''; // English name
      const prefectureGemiId = String(municipality.prefectureId || municipality.prefecture_id || municipality.prefecture?.id || '');
      const lastUpdated = municipality.lastUpdated ? new Date(municipality.lastUpdated) : null;

      if (!gemiId || !descr) {
        console.warn(`⚠️  Skipping municipality with missing data:`, JSON.stringify(municipality));
        errors++;
        continue;
      }

      // Get prefecture_id (text) from prefectures table using gemi_id
      let prefectureId = null;
      if (prefectureGemiId) {
        const prefectureResult = await pool.query(
          'SELECT id FROM prefectures WHERE gemi_id = $1',
          [prefectureGemiId]
        );
        prefectureId = prefectureResult.rows[0]?.id || null;
        
        if (!prefectureId) {
          console.warn(`⚠️  Prefecture with gemi_id ${prefectureGemiId} not found for municipality ${gemiId} (${descr})`);
          skippedPrefecture++;
        }
      }

      // Generate UUID for id if not exists
      const municipalityId = `mun-${gemiId}`;

      // Check if exists first to track insert vs update
      const existing = await pool.query(
        'SELECT id FROM municipalities WHERE gemi_id = $1',
        [gemiId]
      );

      const result = await pool.query(
        `INSERT INTO municipalities (id, gemi_id, prefecture_id, descr, descr_en, last_updated_api, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (gemi_id) 
         DO UPDATE SET 
           prefecture_id = COALESCE(EXCLUDED.prefecture_id, municipalities.prefecture_id),
           descr = EXCLUDED.descr,
           descr_en = EXCLUDED.descr_en,
           last_updated_api = EXCLUDED.last_updated_api
         RETURNING id`,
        [municipalityId, gemiId, prefectureId, descr, descrEn || null, lastUpdated]
      );

      if (existing.rows.length === 0) {
        inserted++;
      } else {
        updated++;
      }
    } catch (error) {
      console.error(`❌ Error upserting municipality ${municipality.id || 'unknown'}:`, error.message);
      errors++;
    }
  }

  console.log(`✅ Municipalities: ${inserted} inserted, ${updated} updated, ${errors} errors`);
  if (skippedPrefecture > 0) {
    console.log(`⚠️  ${skippedPrefecture} municipalities skipped due to missing prefecture`);
  }
  return { inserted, updated, errors, skippedPrefecture };
}

/**
 * Upsert activities (industries) into database
 * Matches by name (case-insensitive) and updates gemi_id
 * Processes in batches to avoid connection pool exhaustion
 */
async function upsertActivities(activities) {
  console.log(`\n💾 Upserting ${activities.length} activities...`);
  
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  let notMatched = 0;

  // Process in batches of 100 to avoid connection pool exhaustion
  const batchSize = 100;
  for (let i = 0; i < activities.length; i += batchSize) {
    const batch = activities.slice(i, i + batchSize);
    console.log(`   Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(activities.length / batchSize)} (${batch.length} activities)...`);

    for (const activity of batch) {
      try {
        // API returns: id, descr (Greek), descrEn (English)
        // Table: id (uuid), name (text), gemi_id (integer)
        const gemiId = parseInt(activity.id || activity.gemi_id || activity.activity_id || '0', 10);
        const name = activity.descrEn || activity.name_en || activity.nameEn || activity.descr || activity.name;

        if (!gemiId || gemiId === 0 || !name) {
          console.warn(`⚠️  Skipping activity with missing data:`, JSON.stringify(activity));
          errors++;
          continue;
        }

        // Check if gemi_id already exists (to avoid conflicts)
        const existingGemiId = await pool.query(
          'SELECT id FROM industries WHERE gemi_id = $1',
          [gemiId]
        );

        if (existingGemiId.rows.length > 0) {
          // Already has this gemi_id, skip
          continue;
        }

        // Try to match by name (case-insensitive)
        const matched = await pool.query(
          `UPDATE industries 
           SET gemi_id = $1, updated_at = NOW()
           WHERE (name = $2 OR name ILIKE $2)
             AND gemi_id IS NULL
           RETURNING id`,
          [gemiId, name]
        );

        if (matched.rows.length > 0) {
          updated++;
        } else {
          // No match found - create new industry
          // Note: industries table requires discovery_keywords to be a non-empty array
          // Use the industry name as the first keyword
          try {
            const keywords = [name]; // Use name as the discovery keyword
            await pool.query(
              `INSERT INTO industries (gemi_id, name, created_at, updated_at, is_active, discovery_keywords)
               VALUES ($1, $2, NOW(), NOW(), true, $3::jsonb)
               ON CONFLICT (gemi_id) DO NOTHING
               RETURNING id`,
              [gemiId, name, JSON.stringify(keywords)]
            );
            inserted++;
          } catch (insertError) {
            // If insert fails, industry might exist with different name
            notMatched++;
            console.warn(`⚠️  Could not match or create industry: ${name} (gemi_id: ${gemiId}) - ${insertError.message}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error upserting activity ${activity.id || 'unknown'}:`, error.message);
        errors++;
      }
    }

    // Small delay between batches to avoid overwhelming the database
    if (i + batchSize < activities.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`✅ Activities: ${updated} updated, ${inserted} inserted, ${notMatched} not matched, ${errors} errors`);
  return { inserted, updated, errors, notMatched };
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting GEMI metadata migration...\n');
  console.log(`📡 GEMI API Base URL: ${GEMI_API_BASE_URL}`);
  console.log(`🔑 API Key: ${GEMI_API_KEY ? '***' + GEMI_API_KEY.slice(-4) : 'NOT SET'}\n`);

  // Check if API key is set
  if (!GEMI_API_KEY) {
    console.error('❌ ERROR: GEMI_API_KEY environment variable is required');
    console.error('   Please add GEMI_API_KEY=your_key to your .env file');
    console.error('   Note: Remove "export" prefix if present (dotenv doesn\'t need it)');
    process.exit(1);
  }

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');

    // Check existing data counts
    try {
      const prefecturesCount = await pool.query('SELECT COUNT(*) as count FROM prefectures');
      const municipalitiesCount = await pool.query('SELECT COUNT(*) as count FROM municipalities');
      const industriesWithGemi = await pool.query('SELECT COUNT(*) as count FROM industries WHERE gemi_id IS NOT NULL');
      
      console.log('📊 Current database state:');
      console.log(`   Prefectures: ${prefecturesCount.rows[0]?.count || 0} records`);
      console.log(`   Municipalities: ${municipalitiesCount.rows[0]?.count || 0} records`);
      console.log(`   Industries with gemi_id: ${industriesWithGemi.rows[0]?.count || 0} records\n`);
    } catch (checkError) {
      console.warn('⚠️  Could not check existing data (tables might not exist yet):', checkError.message);
      console.log('');
    }

    // Fetch and upsert prefectures
    const prefectures = await fetchPrefectures();
    await upsertPrefectures(prefectures);

    // Fetch and upsert municipalities
    const municipalities = await fetchMunicipalities();
    await upsertMunicipalities(municipalities);

    // Fetch and upsert activities
    const activities = await fetchActivities();
    const activitiesResult = await upsertActivities(activities);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Prefectures: ${prefectures.length} fetched`);
    console.log(`Municipalities: ${municipalities.length} fetched`);
    console.log(`Activities: ${activities.length} fetched`);
    console.log('\n✅ GEMI metadata migration completed successfully!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if executed directly
main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  console.error(error.stack);
  process.exit(1);
});
