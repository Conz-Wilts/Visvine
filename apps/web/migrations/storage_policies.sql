-- ============================================
-- Storage RLS Policies for node_images bucket
-- ============================================
-- This migration creates RLS policies for the storage bucket
-- Run this in the Supabase SQL Editor with elevated privileges

-- 1. Create the storage bucket if it doesn't exist
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('node_images', 'node_images', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Drop existing policies if they exist (for re-running)
-- ============================================
DROP POLICY IF EXISTS "Allow authenticated users to upload node images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to node images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update node images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete node images" ON storage.objects;

-- 3. Policy: Allow public users to upload images
-- ============================================
CREATE POLICY "Allow authenticated users to upload node images"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'node_images'
);

-- 4. Policy: Allow public read access to images
-- ============================================
CREATE POLICY "Allow public read access to node images"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'node_images'
);

-- 5. Policy: Allow public users to update their uploads
-- ============================================
CREATE POLICY "Allow authenticated users to update node images"
ON storage.objects
FOR UPDATE
TO public
USING (
  bucket_id = 'node_images'
)
WITH CHECK (
  bucket_id = 'node_images'
);

-- 6. Policy: Allow public users to delete images
-- ============================================
CREATE POLICY "Allow authenticated users to delete node images"
ON storage.objects
FOR DELETE
TO public
USING (
  bucket_id = 'node_images'
);

-- ============================================
-- Summary
-- ============================================
-- These policies allow:
-- - Anyone (public) to upload (INSERT) images
-- - Anyone (public) to view/download (SELECT) images
-- - Anyone (public) to update (UPDATE) images (for upsert)
-- - Anyone (public) to delete (DELETE) images
-- ============================================
