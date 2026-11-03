CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  bigbang_id TEXT NOT NULL UNIQUE CHECK (length(bigbang_id) BETWEEN 6 AND 14),
  barcode TEXT NOT NULL CHECK (length(barcode) BETWEEN 8 AND 14),
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'archived')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

