/**
 * Row Level Security (RLS) Policies for Multi-Tenancy
 * 
 * Enforces data isolation per user based on dataset ownership.
 * 
 * Assumptions:
 * - Supabase auth.uid() returns UUID
 * - Backend stores user_id as VARCHAR(255) (converted from UUID or custom string)
 * - For VARCHAR(255) columns: Compare with auth.uid()::text
 * - For UUID columns: Compare with auth.uid() directly
 * - Backend uses service role key for writes (bypasses RLS)
 * 
 * Tables protected:
 * - datasets: Users can only see their own datasets
 * - businesses: Users can only see businesses in their datasets
 * - crawl_results: Users can only see crawl results for their datasets
 * - exports: Users can only see their own exports
 * - usage_tracking: Users can only see their own usage (if UUID matches)
 * - subscriptions: Users can only see their own subscriptions
 */

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- DATASETS POLICIES
-- ============================================================================

-- Users can SELECT their own datasets
-- user_id is VARCHAR(255), so compare with auth.uid()::text
CREATE POLICY "Users can view their own datasets"
  ON datasets
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- Users can INSERT their own datasets
CREATE POLICY "Users can create their own datasets"
  ON datasets
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

-- Users can UPDATE their own datasets
CREATE POLICY "Users can update their own datasets"
  ON datasets
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- Users can DELETE their own datasets
CREATE POLICY "Users can delete their own datasets"
  ON datasets
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ============================================================================
-- BUSINESSES POLICIES
-- ============================================================================

-- Users can SELECT businesses that they own
-- Use owner_user_id directly (VARCHAR(255))
CREATE POLICY "Users can view their own businesses"
  ON businesses
  FOR SELECT
  USING (owner_user_id = auth.uid()::text);

-- Users can INSERT businesses they own
CREATE POLICY "Users can create their own businesses"
  ON businesses
  FOR INSERT
  WITH CHECK (owner_user_id = auth.uid()::text);

-- Users can UPDATE businesses they own
CREATE POLICY "Users can update their own businesses"
  ON businesses
  FOR UPDATE
  USING (owner_user_id = auth.uid()::text)
  WITH CHECK (owner_user_id = auth.uid()::text);

-- Users can DELETE businesses they own
CREATE POLICY "Users can delete their own businesses"
  ON businesses
  FOR DELETE
  USING (owner_user_id = auth.uid()::text);

-- ============================================================================
-- CRAWL_RESULTS POLICIES
-- ============================================================================

-- Users can SELECT crawl_results for their datasets
-- crawl_results.dataset_id is UUID, datasets.id is UUID
CREATE POLICY "Users can view crawl results for their datasets"
  ON crawl_results
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id::text = crawl_results.dataset_id::text
        AND datasets.user_id = auth.uid()::text
    )
  );

-- Users can INSERT crawl_results for their datasets
CREATE POLICY "Users can create crawl results for their datasets"
  ON crawl_results
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id::text = crawl_results.dataset_id::text
        AND datasets.user_id = auth.uid()::text
    )
  );

-- Users can UPDATE crawl_results for their datasets
CREATE POLICY "Users can update crawl results for their datasets"
  ON crawl_results
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id::text = crawl_results.dataset_id::text
        AND datasets.user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id::text = crawl_results.dataset_id::text
        AND datasets.user_id = auth.uid()::text
    )
  );

-- Users can DELETE crawl_results from their datasets
CREATE POLICY "Users can delete crawl results from their datasets"
  ON crawl_results
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id::text = crawl_results.dataset_id::text
        AND datasets.user_id = auth.uid()::text
    )
  );

-- ============================================================================
-- EXPORTS POLICIES
-- ============================================================================

-- Users can SELECT their own exports
-- user_id is VARCHAR(255), so compare with auth.uid()::text
CREATE POLICY "Users can view their own exports"
  ON exports
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- Users can INSERT their own exports
CREATE POLICY "Users can create their own exports"
  ON exports
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

-- Users can UPDATE their own exports
CREATE POLICY "Users can update their own exports"
  ON exports
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- Users can DELETE their own exports
CREATE POLICY "Users can delete their own exports"
  ON exports
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ============================================================================
-- USAGE_TRACKING POLICIES
-- ============================================================================

-- Users can SELECT their own usage tracking
-- user_id is UUID, so compare directly with auth.uid()
CREATE POLICY "Users can view their own usage tracking"
  ON usage_tracking
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can INSERT their own usage tracking
CREATE POLICY "Users can create their own usage tracking"
  ON usage_tracking
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can UPDATE their own usage tracking
CREATE POLICY "Users can update their own usage tracking"
  ON usage_tracking
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can DELETE their own usage tracking
CREATE POLICY "Users can delete their own usage tracking"
  ON usage_tracking
  FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- SUBSCRIPTIONS POLICIES
-- ============================================================================

-- Users can SELECT their own subscriptions
-- user_id is VARCHAR(255), so compare with auth.uid()::text
CREATE POLICY "Users can view their own subscriptions"
  ON subscriptions
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- Users can INSERT their own subscriptions
-- Note: In practice, subscriptions are created by webhooks (service role)
CREATE POLICY "Users can create their own subscriptions"
  ON subscriptions
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

-- Users can UPDATE their own subscriptions
-- Note: In practice, subscriptions are updated by webhooks (service role)
CREATE POLICY "Users can update their own subscriptions"
  ON subscriptions
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- Users cannot DELETE subscriptions (webhook-managed)
-- No DELETE policy = no DELETE access for authenticated users

-- ============================================================================
-- DISCOVERY_RUNS POLICIES
-- ============================================================================

-- Users can SELECT discovery_runs for their datasets
-- discovery_runs.dataset_id is UUID, check through datasets.user_id
CREATE POLICY "Users can view discovery runs for their datasets"
  ON discovery_runs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id = discovery_runs.dataset_id
        AND datasets.user_id = auth.uid()::text
    )
  );

-- Users can INSERT discovery_runs for their datasets
CREATE POLICY "Users can create discovery runs for their datasets"
  ON discovery_runs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id = discovery_runs.dataset_id
        AND datasets.user_id = auth.uid()::text
    )
  );

-- Users can UPDATE discovery_runs for their datasets
CREATE POLICY "Users can update discovery runs for their datasets"
  ON discovery_runs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id = discovery_runs.dataset_id
        AND datasets.user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id = discovery_runs.dataset_id
        AND datasets.user_id = auth.uid()::text
    )
  );

-- Users can DELETE discovery_runs from their datasets
CREATE POLICY "Users can delete discovery runs from their datasets"
  ON discovery_runs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id = discovery_runs.dataset_id
        AND datasets.user_id = auth.uid()::text
    )
  );

-- ============================================================================
-- EXTRACTION_JOBS POLICIES
-- ============================================================================

-- Users can SELECT extraction_jobs for businesses they own
-- Check through business_id -> businesses.owner_user_id
CREATE POLICY "Users can view extraction jobs for their businesses"
  ON extraction_jobs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = extraction_jobs.business_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- Users can INSERT extraction_jobs for businesses they own
CREATE POLICY "Users can create extraction jobs for their businesses"
  ON extraction_jobs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = extraction_jobs.business_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- Users can UPDATE extraction_jobs for businesses they own
CREATE POLICY "Users can update extraction jobs for their businesses"
  ON extraction_jobs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = extraction_jobs.business_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = extraction_jobs.business_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- Users can DELETE extraction_jobs from their businesses
CREATE POLICY "Users can delete extraction jobs from their businesses"
  ON extraction_jobs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = extraction_jobs.business_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- ============================================================================
-- DATASET_SNAPSHOTS POLICIES
-- ============================================================================

-- Users can SELECT their own dataset snapshots
-- user_id is UUID, compare directly with auth.uid()
CREATE POLICY "Users can view their own dataset snapshots"
  ON dataset_snapshots
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can INSERT their own dataset snapshots
CREATE POLICY "Users can create their own dataset snapshots"
  ON dataset_snapshots
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can UPDATE their own dataset snapshots
CREATE POLICY "Users can update their own dataset snapshots"
  ON dataset_snapshots
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can DELETE their own dataset snapshots
CREATE POLICY "Users can delete their own dataset snapshots"
  ON dataset_snapshots
  FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- WEBSITES POLICIES
-- ============================================================================

-- Users can SELECT websites for businesses they own
-- Check through business_id -> businesses.owner_user_id
CREATE POLICY "Users can view websites for their businesses"
  ON websites
  FOR SELECT
  USING (
    websites.business_id IS NULL OR
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = websites.business_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- Users can INSERT websites for businesses they own
CREATE POLICY "Users can create websites for their businesses"
  ON websites
  FOR INSERT
  WITH CHECK (
    websites.business_id IS NULL OR
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = websites.business_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- Users can UPDATE websites for businesses they own
CREATE POLICY "Users can update websites for their businesses"
  ON websites
  FOR UPDATE
  USING (
    websites.business_id IS NULL OR
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = websites.business_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    websites.business_id IS NULL OR
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = websites.business_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- Users can DELETE websites from their businesses
CREATE POLICY "Users can delete websites from their businesses"
  ON websites
  FOR DELETE
  USING (
    websites.business_id IS NULL OR
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = websites.business_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- ============================================================================
-- CRAWL_JOBS POLICIES
-- ============================================================================

-- Users can SELECT crawl_jobs for websites they own
-- Check through website_id -> websites.business_id -> businesses.owner_user_id
CREATE POLICY "Users can view crawl jobs for their websites"
  ON crawl_jobs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM websites
      JOIN businesses ON businesses.id = websites.business_id
      WHERE websites.id = crawl_jobs.website_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- Users can INSERT crawl_jobs for websites they own
CREATE POLICY "Users can create crawl jobs for their websites"
  ON crawl_jobs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM websites
      JOIN businesses ON businesses.id = websites.business_id
      WHERE websites.id = crawl_jobs.website_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- Users can UPDATE crawl_jobs for websites they own
CREATE POLICY "Users can update crawl jobs for their websites"
  ON crawl_jobs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM websites
      JOIN businesses ON businesses.id = websites.business_id
      WHERE websites.id = crawl_jobs.website_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM websites
      JOIN businesses ON businesses.id = websites.business_id
      WHERE websites.id = crawl_jobs.website_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- Users can DELETE crawl_jobs from their websites
CREATE POLICY "Users can delete crawl jobs from their websites"
  ON crawl_jobs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM websites
      JOIN businesses ON businesses.id = websites.business_id
      WHERE websites.id = crawl_jobs.website_id
        AND businesses.owner_user_id = auth.uid()::text
    )
  );

-- ============================================================================
-- DENY ANON ACCESS (DEFAULT BEHAVIOR)
-- ============================================================================

-- By default, RLS denies all access to anon users
-- No explicit policies needed - RLS blocks unauthenticated access by default

-- ============================================================================
-- NOTES
-- ============================================================================

-- Backend writes (INSERT/UPDATE/DELETE) should use service role key
-- Service role key bypasses RLS, allowing backend to write without restrictions
-- 
-- Frontend reads (SELECT) use anon key with RLS policies enforcing multi-tenancy
-- 
-- If user_id format mismatch exists (VARCHAR(255) vs UUID):
-- - Ensure backend stores auth.uid()::text in VARCHAR(255) columns
-- - OR create a mapping function/table to convert between formats
-- - OR use JWT claims to store user_id as string
