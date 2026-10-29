export const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS product_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type_id TEXT NOT NULL,
    brand TEXT,
    colour TEXT,
    cost_price REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    barcode TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (type_id) REFERENCES product_types(id)
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    size TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id),
    UNIQUE(product_id, size)
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    total_purchase REAL NOT NULL DEFAULT 0,
    due_amount REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL DEFAULT (datetime('now')),
    customer_id TEXT,
    total_amount REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    final_amount REAL NOT NULL DEFAULT 0,
    payment_mode TEXT NOT NULL DEFAULT 'cash',
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    size TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- AI import extraction history. Images are never uploaded to a database of
  -- ours; only the local draft/result metadata is persisted here.
  CREATE TABLE IF NOT EXISTS ai_import_sessions (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    image_uri TEXT,
    supplier_name TEXT,
    invoice_number TEXT,
    image_quality TEXT,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    error_code TEXT,
    error_message TEXT,
    raw_response TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_product_drafts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT,
    brand TEXT,
    type_id TEXT,
    type_hint TEXT,
    cost_price REAL,
    mrp REAL,
    quantity INTEGER,
    size TEXT,
    colour TEXT,
    barcode TEXT,
    supplier_name TEXT,
    invoice_number TEXT,
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    product_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES ai_import_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (type_id) REFERENCES product_types(id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_products_type ON products(type_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);
  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_ai_sessions_created ON ai_import_sessions(created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_drafts_session ON ai_product_drafts(session_id);
  CREATE INDEX IF NOT EXISTS idx_ai_drafts_status ON ai_product_drafts(status);
`;

export const SEED_PRODUCT_TYPES = `
  INSERT OR IGNORE INTO product_types (id, name) VALUES
    ('pt-001', 'Shirt'),
    ('pt-002', 'T-Shirt'),
    ('pt-003', 'Jeans'),
    ('pt-004', 'Trousers'),
    ('pt-005', 'Saree'),
    ('pt-006', 'Kurta'),
    ('pt-007', 'Jacket'),
    ('pt-008', 'Other');
`;
