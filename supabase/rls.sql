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
ALTER TABLE crawl_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
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

-- Users can SELECT businesses that belong to their datasets
-- Join through datasets table to verify ownership
-- Note: businesses.dataset_id may be UUID or INTEGER depending on schema
-- This policy works for both by using implicit type casting
CREATE POLICY "Users can view businesses in their datasets"
  ON businesses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id::text = businesses.dataset_id::text
        AND datasets.user_id = auth.uid()::text
    )
  );

-- Users can INSERT businesses into their datasets
CREATE POLICY "Users can create businesses in their datasets"
  ON businesses
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id::text = businesses.dataset_id::text
        AND datasets.user_id = auth.uid()::text
    )
  );

-- Users can UPDATE businesses in their datasets
CREATE POLICY "Users can update businesses in their datasets"
  ON businesses
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id::text = businesses.dataset_id::text
        AND datasets.user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id::text = businesses.dataset_id::text
        AND datasets.user_id = auth.uid()::text
    )
  );

-- Users can DELETE businesses from their datasets
CREATE POLICY "Users can delete businesses from their datasets"
  ON businesses
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM datasets
      WHERE datasets.id::text = businesses.dataset_id::text
        AND datasets.user_id = auth.uid()::text
    )
  );

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
