-- Verification script to check actual database schema types
-- Run this in Supabase SQL Editor to verify the actual column types

-- Check cities.id type
SELECT 
    'cities.id' as column_ref,
    column_name,
    data_type,
    udt_name
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'cities' 
  AND column_name = 'id';

-- Check industries.id type
SELECT 
    'industries.id' as column_ref,
    column_name,
    data_type,
    udt_name
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'industries' 
  AND column_name = 'id';

-- Check datasets.city_id and industry_id types
SELECT 
    'datasets.' || column_name as column_ref,
    column_name,
    data_type,
    udt_name
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'datasets' 
  AND column_name IN ('city_id', 'industry_id');

-- Check businesses.city_id and industry_id types
SELECT 
    'businesses.' || column_name as column_ref,
    column_name,
    data_type,
    udt_name
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'businesses' 
  AND column_name IN ('city_id', 'industry_id');

-- Check exports.city_id and industry_id types
SELECT 
    'exports.' || column_name as column_ref,
    column_name,
    data_type,
    udt_name
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'exports' 
  AND column_name IN ('city_id', 'industry_id');

-- Check foreign key constraints with column types
SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    tc.constraint_name,
    kcu_col.data_type as column_type,
    ccu_col.data_type as referenced_type
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.columns AS kcu_col
  ON kcu_col.table_name = kcu.table_name
  AND kcu_col.column_name = kcu.column_name
  AND kcu_col.table_schema = kcu.table_schema
JOIN information_schema.columns AS ccu_col
  ON ccu_col.table_name = ccu.table_name
  AND ccu_col.column_name = ccu.column_name
  AND ccu_col.table_schema = ccu.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('datasets', 'businesses', 'exports')
  AND kcu.column_name IN ('city_id', 'industry_id');
