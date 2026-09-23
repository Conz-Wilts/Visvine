-- The built-in types a new space starts with take the design tokens' type
-- palette (packages/tokens, color.type.*): Person blue-400, Space the logo
-- green, Event rose-400 (off red, which is danger). Existing spaces are moved by
-- `pnpm db:types:recolor`, which keeps any colour an admin chose.
ALTER TABLE "spaces" ALTER COLUMN "node_types"
  SET DEFAULT '[{"name": "Person", "color": "#60a5fa", "shape": "rectangle"}, {"name": "Space", "color": "#78d870", "shape": "square"}, {"name": "Event", "color": "#fb7185", "shape": "rectangle"}]';
