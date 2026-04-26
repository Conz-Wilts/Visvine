-- ============================================
-- Add image_url column to nodes table
-- ============================================
-- This migration adds the image_url column to store references to uploaded images

ALTER TABLE nodes
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add a comment to document the column
COMMENT ON COLUMN nodes.image_url IS 'Public URL to the node image stored in Supabase Storage';
