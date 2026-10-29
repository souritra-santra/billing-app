/**
 * Local sync metadata and outbox.
 *
 * Writes to synced tables are captured by SQLite triggers. The sync engine
 * pushes the outbox, then applies remote changes with `applying_remote = 1` so
 * the same triggers do not echo remote data back to the server.
 */

export const SYNC_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_outbox (
    id TEXT PRIMARY KEY,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL DEFAULT 'upsert',
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_outbox_entity
    ON sync_outbox(entity, entity_id);
  CREATE INDEX IF NOT EXISTS idx_sync_outbox_created
    ON sync_outbox(created_at);

  INSERT OR IGNORE INTO sync_state (key, value) VALUES ('applying_remote', '0');
  UPDATE sync_state SET value = '0' WHERE key = 'applying_remote';

  CREATE TRIGGER IF NOT EXISTS trg_product_types_sync_insert
  AFTER INSERT ON product_types
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'product_types',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'name', NEW.name,
        'created_at', NEW.created_at,
        'updated_at', datetime('now'),
        'deleted_at', NEW.deleted_at,
        'version', COALESCE(NEW.version, 1)
      ),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_product_types_sync_update
  AFTER UPDATE ON product_types
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'product_types',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'name', NEW.name,
        'created_at', NEW.created_at,
        'updated_at', datetime('now'),
        'deleted_at', NEW.deleted_at,
        'version', COALESCE(NEW.version, 1)
      ),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_product_types_sync_delete
  AFTER DELETE ON product_types
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'product_types',
      OLD.id,
      'delete',
      json_object('id', OLD.id, 'deleted_at', datetime('now')),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_products_sync_insert
  AFTER INSERT ON products
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'products',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'name', NEW.name,
        'type_id', NEW.type_id,
        'brand', NEW.brand,
        'colour', NEW.colour,
        'cost_price', NEW.cost_price,
        'price', NEW.price,
        'barcode', NEW.barcode,
        'created_at', NEW.created_at,
        'updated_at', datetime('now'),
        'deleted_at', NEW.deleted_at,
        'version', COALESCE(NEW.version, 1)
      ),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_products_sync_update
  AFTER UPDATE ON products
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'products',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'name', NEW.name,
        'type_id', NEW.type_id,
        'brand', NEW.brand,
        'colour', NEW.colour,
        'cost_price', NEW.cost_price,
        'price', NEW.price,
        'barcode', NEW.barcode,
        'created_at', NEW.created_at,
        'updated_at', datetime('now'),
        'deleted_at', NEW.deleted_at,
        'version', COALESCE(NEW.version, 1)
      ),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_products_sync_delete
  AFTER DELETE ON products
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'products',
      OLD.id,
      'delete',
      json_object('id', OLD.id, 'deleted_at', datetime('now')),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_customers_sync_insert
  AFTER INSERT ON customers
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'customers',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'name', NEW.name,
        'phone', NEW.phone,
        'total_purchase', NEW.total_purchase,
        'due_amount', NEW.due_amount,
        'created_at', NEW.created_at,
        'updated_at', COALESCE(NEW.updated_at, datetime('now')),
        'deleted_at', NEW.deleted_at,
        'version', COALESCE(NEW.version, 1)
      ),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_customers_sync_update
  AFTER UPDATE ON customers
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'customers',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'name', NEW.name,
        'phone', NEW.phone,
        'total_purchase', NEW.total_purchase,
        'due_amount', NEW.due_amount,
        'created_at', NEW.created_at,
        'updated_at', COALESCE(NEW.updated_at, datetime('now')),
        'deleted_at', NEW.deleted_at,
        'version', COALESCE(NEW.version, 1)
      ),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_customers_sync_delete
  AFTER DELETE ON customers
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'customers',
      OLD.id,
      'delete',
      json_object('id', OLD.id, 'deleted_at', datetime('now')),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_orders_sync_insert
  AFTER INSERT ON orders
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'orders',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'date', NEW.date,
        'customer_id', NEW.customer_id,
        'total_amount', NEW.total_amount,
        'discount', NEW.discount,
        'tax', NEW.tax,
        'final_amount', NEW.final_amount,
        'payment_mode', NEW.payment_mode,
        'created_at', COALESCE(NEW.created_at, NEW.date, datetime('now')),
        'updated_at', COALESCE(NEW.updated_at, NEW.date, datetime('now')),
        'deleted_at', NEW.deleted_at,
        'version', COALESCE(NEW.version, 1)
      ),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_orders_sync_update
  AFTER UPDATE ON orders
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'orders',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'date', NEW.date,
        'customer_id', NEW.customer_id,
        'total_amount', NEW.total_amount,
        'discount', NEW.discount,
        'tax', NEW.tax,
        'final_amount', NEW.final_amount,
        'payment_mode', NEW.payment_mode,
        'created_at', COALESCE(NEW.created_at, NEW.date, datetime('now')),
        'updated_at', COALESCE(NEW.updated_at, NEW.date, datetime('now')),
        'deleted_at', NEW.deleted_at,
        'version', COALESCE(NEW.version, 1)
      ),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_orders_sync_delete
  AFTER DELETE ON orders
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'orders',
      OLD.id,
      'delete',
      json_object('id', OLD.id, 'deleted_at', datetime('now')),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_order_items_sync_insert
  AFTER INSERT ON order_items
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'order_items',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'order_id', NEW.order_id,
        'product_id', NEW.product_id,
        'size', NEW.size,
        'quantity', NEW.quantity,
        'price', NEW.price,
        'created_at', COALESCE(NEW.created_at, datetime('now'))
      ),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_order_items_sync_update
  AFTER UPDATE ON order_items
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'order_items',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'order_id', NEW.order_id,
        'product_id', NEW.product_id,
        'size', NEW.size,
        'quantity', NEW.quantity,
        'price', NEW.price,
        'created_at', COALESCE(NEW.created_at, datetime('now'))
      ),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_order_items_sync_delete
  AFTER DELETE ON order_items
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'order_items',
      OLD.id,
      'delete',
      json_object('id', OLD.id),
      0,
      NULL,
      datetime('now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_stock_movements_sync_insert
  AFTER INSERT ON stock_movements
  WHEN COALESCE((SELECT value FROM sync_state WHERE key = 'applying_remote'), '0') <> '1'
  BEGIN
    INSERT OR REPLACE INTO sync_outbox
      (id, entity, entity_id, op, payload, attempts, last_error, created_at)
    VALUES (
      lower(hex(randomblob(16))),
      'stock_movements',
      NEW.id,
      'upsert',
      json_object(
        'id', NEW.id,
        'product_id', NEW.product_id,
        'size', NEW.size,
        'delta', NEW.delta,
        'reason', NEW.reason,
        'order_id', NEW.order_id,
        'device_id', NEW.device_id,
        'created_at', NEW.created_at
      ),
      0,
      NULL,
      datetime('now')
    );
  END;
`;
