-- Create the match_nodes function for pgvector semantic search
CREATE OR REPLACE FUNCTION match_nodes(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.0,
  match_count int DEFAULT 50
)
RETURNS TABLE(
  id text,
  name text,
  type text,
  subtitle text,
  location text,
  url text,
  tags text[],
  metadata jsonb,
  similarity float
)
AS $$
  SELECT id, name, type, subtitle, location, url, tags, metadata,
    1 - (embedding <=> query_embedding) AS similarity
  FROM nodes
  WHERE embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql;
