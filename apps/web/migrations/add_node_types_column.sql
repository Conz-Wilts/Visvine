-- ============================================
-- Migration: Add node_types column to communities table
-- ============================================
-- This migration adds support for custom node types per community

-- Add the node_types column to communities table
ALTER TABLE communities 
ADD COLUMN IF NOT EXISTS node_types JSONB;

-- Optional: Set default node types for existing communities
-- This ensures existing communities have the standard types
UPDATE communities 
SET node_types = '[
  {"name":"Person","color":"#2563eb","shape":"rectangle","icon":"👤"},
  {"name":"Organization","color":"#9333ea","shape":"hexagon","icon":"🏢"},
  {"name":"Event","color":"#ef4444","shape":"rectangle","icon":"📅"},
  {"name":"Group","color":"#0ea5e9","shape":"rectangle","icon":"👥"}
]'::jsonb
WHERE node_types IS NULL;

-- Verify the migration
SELECT 
  id, 
  name, 
  node_types 
FROM communities 
LIMIT 5;



