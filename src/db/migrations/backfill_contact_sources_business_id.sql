-- Migration: Backfill business_id in contact_sources by matching through websites
-- This populates business_id for existing contact_sources records
-- Date: 2025-01-XX
-- 
-- Run this AFTER add_business_id_to_contact_sources.sql

-- Update contact_sources with business_id by matching source_url to website URLs
UPDATE contact_sources cs
SET business_id = w.business_id
FROM websites w
WHERE cs.business_id IS NULL
  AND (
    cs.source_url LIKE '%' || REPLACE(REPLACE(w.url, 'https://', ''), 'http://', '') || '%'
    OR cs.source_url = w.url
    OR cs.source_url LIKE w.url || '%'
    OR REPLACE(REPLACE(cs.source_url, 'https://', ''), 'http://', '') = REPLACE(REPLACE(w.url, 'https://', ''), 'http://', '')
  );

-- For contact_sources from Google Place Details (source_url contains maps.google.com)
-- We can't match them through websites, so they'll remain NULL
-- These will be handled by the fallback join in queries

-- Show summary
SELECT 
  COUNT(*) as total_contact_sources,
  COUNT(business_id) as with_business_id,
  COUNT(*) - COUNT(business_id) as without_business_id
FROM contact_sources;
