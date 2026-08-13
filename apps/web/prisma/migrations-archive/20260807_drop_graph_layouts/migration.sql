-- Drop the persisted force-directed context layout. The graph it served is gone —
-- /context is a knowledge browser now — so the saved node positions and camera
-- transforms have nothing left to restore.

DROP TABLE IF EXISTS "graph_layouts" CASCADE;
