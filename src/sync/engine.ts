import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase, generateId } from '../database/db';
import { CLOUD_SYNC_ENABLED } from './config';
import { supabase } from './client';
import { getActiveShop } from './activeShop';

type SyncTransaction = Pick<
  SQLiteDatabase,
  'runAsync' | 'getFirstAsync'
>;

const PUSH_BATCH_SIZE = 100;
const PULL_PAGE_SIZE = 200;
const MAX_PUSH_BATCHES = 20;
const MAX_PULL_PAGES = 50;
const BASELINE_CREATED_AT = '1970-01-01 00:00:00';

export interface SyncStatus {
  configured: boolean;
  signedIn: boolean;
  shopId: string | null;
  shopName: string | null;
  pending: number;
  lastError: string | null;
  lastPulledSeq: number;
  lastSyncedAt: string | null;
}

interface OutboxRow {
  id: string;
  entity: string;
  entity_id: string;
  op: string;
  payload: string;
  attempts: number;
}

interface ChangeRow {
  seq: number;
  entity: string;
  op: string;
  payload: Record<string, unknown>;
}

interface ApiError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

let running: Promise<SyncStatus> | null = null;

async function getState(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_state WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

async function setState(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)',
    [key, value]
  );
}

async function getDeviceId(): Promise<string> {
  const existing = await getState('device_id');
  if (existing) return existing;
  const id = generateId();
  await setState('device_id', id);
  return id;
}

function pulledSeqKey(shopId: string): string {
  return `last_pulled_seq:${shopId}`;
}

function operationalSnapshotKey(shopId: string): string {
  return `ops_snapshot:${shopId}`;
}

/**
 * If two devices created a type with the same name but different ids, the
 * second one is merged by name. The map keeps later product pulls pointing at
 * the local type that actually exists.
 */
function typeMapKey(remoteTypeId: string): string {
  return `type_map:${remoteTypeId}`;
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const apiError = error as ApiError;
    return (
      apiError.message ||
      apiError.details ||
      apiError.hint ||
      JSON.stringify(error)
    );
  }
  return String(error);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberOr(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timestampOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export async function getPendingCount(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM sync_outbox'
  );
  return row?.count ?? 0;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const shop = await getActiveShop();
  let signedIn = false;
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    signedIn = Boolean(data.session);
  }

  let lastPulledSeq = 0;
  if (shop) {
    lastPulledSeq = Number((await getState(pulledSeqKey(shop.id))) || 0);
  }

  return {
    configured: CLOUD_SYNC_ENABLED,
    signedIn,
    shopId: shop?.id ?? null,
    shopName: shop?.name ?? null,
    pending: await getPendingCount(),
    lastError: (await getState('last_error')) || null,
    lastPulledSeq,
    lastSyncedAt: await getState('last_synced_at'),
  };
}

/**
 * Queue the whole local shop for upload when linking a new cloud shop.
 *
 * Inventory is uploaded as one baseline movement per product/size. That keeps
 * the server's append-only stock ledger consistent without replaying every
 * historical sale. Operational rows (customers, bills, bill lines) are queued
 * as well, in dependency order.
 */
export async function enqueueLocalSnapshot(): Promise<void> {
  const shop = await getActiveShop();
  const db = await getDatabase();

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM sync_outbox');
    await txn.runAsync('DELETE FROM stock_movements');

    // Inventory is the net result of all old activity. One baseline movement
    // represents the stock already on this device.
    await txn.runAsync(
      `INSERT INTO stock_movements
         (id, product_id, size, delta, reason, created_at)
       SELECT
         'baseline-' || product_id || '-' || hex(size),
         product_id,
         size,
         quantity,
         'baseline',
         ?
       FROM inventory
       WHERE quantity <> 0`,
      [BASELINE_CREATED_AT]
    );

    await txn.runAsync(`
      INSERT OR REPLACE INTO sync_outbox
        (id, entity, entity_id, op, payload, attempts, last_error, created_at)
      SELECT
        lower(hex(randomblob(16))),
        'product_types',
        id,
        'upsert',
        json_object(
          'id', id,
          'name', name,
          'created_at', created_at,
          'updated_at', COALESCE(updated_at, datetime('now')),
          'deleted_at', deleted_at,
          'version', COALESCE(version, 1)
        ),
        0,
        NULL,
        datetime('now')
      FROM product_types;
    `);

    // Include deleted products/customers/orders as tombstones so bills that
    // reference them still satisfy the server foreign keys.
    await txn.runAsync(`
      INSERT OR REPLACE INTO sync_outbox
        (id, entity, entity_id, op, payload, attempts, last_error, created_at)
      SELECT
        lower(hex(randomblob(16))),
        'products',
        id,
        'upsert',
        json_object(
          'id', id,
          'name', name,
          'type_id', type_id,
          'brand', brand,
          'colour', colour,
          'cost_price', cost_price,
          'price', price,
          'barcode', CASE WHEN deleted_at IS NULL THEN barcode ELSE NULL END,
          'created_at', created_at,
          'updated_at', COALESCE(updated_at, datetime('now')),
          'deleted_at', deleted_at,
          'version', COALESCE(version, 1)
        ),
        0,
        NULL,
        datetime('now')
      FROM products;
    `);

    await txn.runAsync(`
      INSERT OR REPLACE INTO sync_outbox
        (id, entity, entity_id, op, payload, attempts, last_error, created_at)
      SELECT
        lower(hex(randomblob(16))),
        'customers',
        id,
        'upsert',
        json_object(
          'id', id,
          'name', name,
          'phone', phone,
          'total_purchase', total_purchase,
          'due_amount', due_amount,
          'created_at', created_at,
          'updated_at', COALESCE(updated_at, datetime('now')),
          'deleted_at', deleted_at,
          'version', COALESCE(version, 1)
        ),
        0,
        NULL,
        datetime('now')
      FROM customers;
    `);

    await txn.runAsync(`
      INSERT OR REPLACE INTO sync_outbox
        (id, entity, entity_id, op, payload, attempts, last_error, created_at)
      SELECT
        lower(hex(randomblob(16))),
        'orders',
        id,
        'upsert',
        json_object(
          'id', id,
          'date', date,
          'customer_id', customer_id,
          'total_amount', total_amount,
          'discount', discount,
          'tax', tax,
          'final_amount', final_amount,
          'payment_mode', payment_mode,
          'created_at', COALESCE(created_at, date, datetime('now')),
          'updated_at', COALESCE(updated_at, date, datetime('now')),
          'deleted_at', deleted_at,
          'version', COALESCE(version, 1)
        ),
        0,
        NULL,
        datetime('now')
      FROM orders;
    `);

    await txn.runAsync(`
      INSERT OR REPLACE INTO sync_outbox
        (id, entity, entity_id, op, payload, attempts, last_error, created_at)
      SELECT
        lower(hex(randomblob(16))),
        'order_items',
        id,
        'upsert',
        json_object(
          'id', id,
          'order_id', order_id,
          'product_id', product_id,
          'size', size,
          'quantity', quantity,
          'price', price,
          'created_at', COALESCE(created_at, datetime('now'))
        ),
        0,
        NULL,
        datetime('now')
      FROM order_items;
    `);
  });

  if (shop) {
    await setState(operationalSnapshotKey(shop.id), '1');
  }
}

/**
 * One-time backfill for shops linked before operational sync existed.
 *
 * The baseline is `current inventory - existing local movements`, because any
 * movements created after this build are already queued/synced and must not be
 * counted twice.
 */
async function enqueueOperationalBackfill(shopId: string): Promise<void> {
  if ((await getState(operationalSnapshotKey(shopId))) === '1') return;

  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT OR IGNORE INTO stock_movements
         (id, product_id, size, delta, reason, created_at)
       SELECT
         'baseline-' || product_id || '-' || hex(size),
         product_id,
         size,
         delta,
         'baseline',
         ?
       FROM (
         SELECT
           i.product_id,
           i.size,
           i.quantity - COALESCE((
             SELECT SUM(m.delta)
             FROM stock_movements m
             WHERE m.product_id = i.product_id AND m.size = i.size
           ), 0) AS delta
         FROM inventory i
       ) b
       WHERE b.delta <> 0`,
      [BASELINE_CREATED_AT]
    );

    await txn.runAsync(`
      INSERT OR REPLACE INTO sync_outbox
        (id, entity, entity_id, op, payload, attempts, last_error, created_at)
      SELECT
        lower(hex(randomblob(16))),
        'customers',
        id,
        'upsert',
        json_object(
          'id', id,
          'name', name,
          'phone', phone,
          'total_purchase', total_purchase,
          'due_amount', due_amount,
          'created_at', created_at,
          'updated_at', COALESCE(updated_at, datetime('now')),
          'deleted_at', deleted_at,
          'version', COALESCE(version, 1)
        ),
        0,
        NULL,
        datetime('now')
      FROM customers;
    `);

    await txn.runAsync(`
      INSERT OR REPLACE INTO sync_outbox
        (id, entity, entity_id, op, payload, attempts, last_error, created_at)
      SELECT
        lower(hex(randomblob(16))),
        'orders',
        id,
        'upsert',
        json_object(
          'id', id,
          'date', date,
          'customer_id', customer_id,
          'total_amount', total_amount,
          'discount', discount,
          'tax', tax,
          'final_amount', final_amount,
          'payment_mode', payment_mode,
          'created_at', COALESCE(created_at, date, datetime('now')),
          'updated_at', COALESCE(updated_at, date, datetime('now')),
          'deleted_at', deleted_at,
          'version', COALESCE(version, 1)
        ),
        0,
        NULL,
        datetime('now')
      FROM orders;
    `);

    await txn.runAsync(`
      INSERT OR REPLACE INTO sync_outbox
        (id, entity, entity_id, op, payload, attempts, last_error, created_at)
      SELECT
        lower(hex(randomblob(16))),
        'order_items',
        id,
        'upsert',
        json_object(
          'id', id,
          'order_id', order_id,
          'product_id', product_id,
          'size', size,
          'quantity', quantity,
          'price', price,
          'created_at', COALESCE(created_at, datetime('now'))
        ),
        0,
        NULL,
        datetime('now')
      FROM order_items;
    `);

    await txn.runAsync(
      'INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)',
      [operationalSnapshotKey(shopId), '1']
    );
  });
}

/** Joining in pull mode leaves local operational rows on-device and skips upload. */
export async function markOperationalSnapshotComplete(shopId?: string): Promise<void> {
  const shop = shopId ? { id: shopId } : await getActiveShop();
  if (!shop) return;
  await setState(operationalSnapshotKey(shop.id), '1');
}

/** Drop queued local writes (used when joining an existing cloud shop). */
export async function clearOutbox(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM sync_outbox');
}

async function pushOutbox(shopId: string): Promise<void> {
  if (!supabase) throw new Error('Cloud sync is not configured');
  const db = await getDatabase();
  const deviceId = await getDeviceId();

  for (let batch = 0; batch < MAX_PUSH_BATCHES; batch += 1) {
    const rows = await db.getAllAsync<OutboxRow>(
      `SELECT id, entity, entity_id, op, payload, attempts
       FROM sync_outbox
       ORDER BY CASE entity
         WHEN 'product_types' THEN 0
         WHEN 'products' THEN 1
         WHEN 'customers' THEN 2
         WHEN 'orders' THEN 3
         WHEN 'order_items' THEN 4
         WHEN 'stock_movements' THEN 5
         ELSE 6
       END,
       CASE
         WHEN entity = 'stock_movements'
           AND json_extract(payload, '$.reason') = 'baseline' THEN 0
         ELSE 1
       END,
       created_at, rowid
       LIMIT ?`,
      [PUSH_BATCH_SIZE]
    );
    if (rows.length === 0) return;

    const mutations = rows.map((row) => ({
      id: row.id,
      entity: row.entity,
      op: row.op,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }));

    const { error } = await supabase.rpc('sync_push', {
      p_shop_id: shopId,
      p_device_id: deviceId,
      p_mutations: mutations,
    });

    if (error) {
      await db.runAsync(
        `UPDATE sync_outbox
         SET attempts = attempts + 1, last_error = ?
         WHERE id IN (${rows.map(() => '?').join(',')})`,
        [describeError(error), ...rows.map((row) => row.id)]
      );
      throw new Error(describeError(error));
    }

    // The RPC is atomic. Every mutation in this batch was applied or was an
    // idempotent replay, so the whole batch can leave the outbox.
    await db.runAsync(
      `DELETE FROM sync_outbox WHERE id IN (${rows.map(() => '?').join(',')})`,
      rows.map((row) => row.id)
    );
  }

  const remaining = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM sync_outbox'
  );
  if (!remaining || remaining.count === 0) return;

  throw new Error('Too many pending changes. Tap sync again to continue.');
}

async function getMappedTypeId(
  txn: SyncTransaction,
  remoteTypeId: string
): Promise<string | null> {
  const row = await txn.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_state WHERE key = ?',
    [typeMapKey(remoteTypeId)]
  );
  return row?.value || null;
}

async function setMappedTypeId(
  txn: SyncTransaction,
  remoteTypeId: string,
  localTypeId: string
): Promise<void> {
  await txn.runAsync(
    'INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)',
    [typeMapKey(remoteTypeId), localTypeId]
  );
}

async function ensureProductType(
  txn: SyncTransaction,
  typeId: string
): Promise<void> {
  const existing = await txn.getFirstAsync<{ id: string }>(
    'SELECT id FROM product_types WHERE id = ?',
    [typeId]
  );
  if (existing) return;

  // "Other" is already a seeded type, so a placeholder must have a unique
  // name. The simple form is deterministic; the fallback handles a tombstone
  // or another local row that already owns the same name.
  const placeholder = `Other (${typeId})`;
  await txn.runAsync(
    `INSERT OR IGNORE INTO product_types
       (id, name, created_at, updated_at, version)
     VALUES (?, ?, datetime('now'), datetime('now'), 1)`,
    [typeId, placeholder]
  );

  const created = await txn.getFirstAsync<{ id: string }>(
    'SELECT id FROM product_types WHERE id = ?',
    [typeId]
  );
  if (created) return;

  await txn.runAsync(
    `INSERT INTO product_types
       (id, name, created_at, updated_at, version)
     VALUES (?, ?, datetime('now'), datetime('now'), 1)`,
    [typeId, `${placeholder} ${Math.random().toString(36).slice(2, 8)}`]
  );
}

async function ensureCustomer(
  txn: SyncTransaction,
  customerId: string | null,
  createdAt: string
): Promise<void> {
  if (!customerId) return;
  const existing = await txn.getFirstAsync<{ id: string }>(
    'SELECT id FROM customers WHERE id = ?',
    [customerId]
  );
  if (existing) return;
  await txn.runAsync(
    `INSERT OR IGNORE INTO customers
       (id, name, phone, created_at, updated_at, version)
     VALUES (?, 'Customer', NULL, ?, ?, 1)`,
    [customerId, createdAt, createdAt]
  );
}

async function ensureOrder(
  txn: SyncTransaction,
  orderId: string,
  createdAt: string
): Promise<void> {
  const existing = await txn.getFirstAsync<{ id: string }>(
    'SELECT id FROM orders WHERE id = ?',
    [orderId]
  );
  if (existing) return;
  await txn.runAsync(
    `INSERT OR IGNORE INTO orders
       (id, date, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, 1)`,
    [orderId, createdAt, createdAt, createdAt]
  );
}

async function applyProductType(
  txn: SyncTransaction,
  change: ChangeRow
): Promise<void> {
  const payload = change.payload || {};
  const id = String(payload.id || '');
  if (!id) return;

  // A previous pull may have merged this remote type into a local type with
  // the same name.
  if (await getMappedTypeId(txn, id)) return;

  const deletedAt =
    change.op === 'delete'
      ? new Date().toISOString()
      : typeof payload.deleted_at === 'string'
        ? payload.deleted_at
        : null;
  const name = String(payload.name || 'Other');
  const createdAt =
    typeof payload.created_at === 'string'
      ? payload.created_at
      : new Date().toISOString();
  const updatedAt =
    typeof payload.updated_at === 'string'
      ? payload.updated_at
      : new Date().toISOString();
  const version = Number(payload.version) || 1;

  if (deletedAt) {
    const existing = await txn.getFirstAsync<{ id: string }>(
      'SELECT id FROM product_types WHERE id = ?',
      [id]
    );
    if (existing) {
      await txn.runAsync(
        `UPDATE product_types
         SET deleted_at = ?, updated_at = ?, version = ?
         WHERE id = ?`,
        [deletedAt, updatedAt, version, id]
      );
      return;
    }

    // A remote tombstone must still exist locally so products and bills that
    // reference its id keep valid foreign keys.
    const conflict = await txn.getFirstAsync<{ id: string }>(
      'SELECT id FROM product_types WHERE lower(name) = lower(?) AND id <> ?',
      [name, id]
    );
    const tombstoneName = conflict ? `${name} (deleted ${id})` : name;
    await txn.runAsync(
      `INSERT OR IGNORE INTO product_types
         (id, name, created_at, updated_at, deleted_at, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, tombstoneName, createdAt, updatedAt, deletedAt, version]
    );
    return;
  }

  const nameConflict = await txn.getFirstAsync<{
    id: string;
    deleted_at: string | null;
  }>(
    `SELECT id, deleted_at FROM product_types
     WHERE lower(name) = lower(?) AND id <> ?`,
    [name, id]
  );
  if (nameConflict) {
    if (!nameConflict.deleted_at) {
      // Keep the live local row and route later remote products to it.
      await setMappedTypeId(txn, id, nameConflict.id);
      return;
    }
    // A tombstone still holds the UNIQUE local name. Free it so the remote
    // row can be inserted; the tombstone is hidden from every query anyway.
    await txn.runAsync(
      'UPDATE product_types SET name = ? WHERE id = ?',
      [`${name} (deleted ${nameConflict.id})`, nameConflict.id]
    );
  }

  await txn.runAsync(
    `INSERT INTO product_types
       (id, name, created_at, updated_at, deleted_at, version)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       version = excluded.version`,
    [id, name, createdAt, updatedAt, deletedAt, version]
  );
}

async function applyProduct(
  txn: SyncTransaction,
  change: ChangeRow
): Promise<void> {
  const payload = change.payload || {};
  const id = String(payload.id || '');
  if (!id) return;

  const deletedAt =
    change.op === 'delete'
      ? new Date().toISOString()
      : typeof payload.deleted_at === 'string'
        ? payload.deleted_at
        : null;

  if (deletedAt) {
    const existing = await txn.getFirstAsync<{ id: string }>(
      'SELECT id FROM products WHERE id = ?',
      [id]
    );
    if (existing) {
      await txn.runAsync(
        `UPDATE products
         SET deleted_at = ?, barcode = NULL, updated_at = ?, version = ?
         WHERE id = ?`,
        [
          deletedAt,
          typeof payload.updated_at === 'string'
            ? payload.updated_at
            : new Date().toISOString(),
          Number(payload.version) || 1,
          id,
        ]
      );
    } else {
      // Keep a local tombstone for bills that still reference this product.
      const remoteTypeId = String(payload.type_id || '').trim();
      const mappedTypeId = remoteTypeId
        ? await getMappedTypeId(txn, remoteTypeId)
        : null;
      const typeId = mappedTypeId || remoteTypeId || 'pt-008';
      await ensureProductType(txn, typeId);

      const createdAt =
        typeof payload.created_at === 'string'
          ? payload.created_at
          : new Date().toISOString();
      const updatedAt =
        typeof payload.updated_at === 'string'
          ? payload.updated_at
          : new Date().toISOString();
      await txn.runAsync(
        `INSERT OR IGNORE INTO products
           (id, name, type_id, brand, colour, cost_price, price, barcode,
            created_at, updated_at, deleted_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [
          id,
          String(payload.name || 'Deleted product'),
          typeId,
          typeof payload.brand === 'string' ? payload.brand : null,
          typeof payload.colour === 'string' ? payload.colour : null,
          Number(payload.cost_price) || 0,
          Number(payload.price) || 0,
          createdAt,
          updatedAt,
          deletedAt,
          Number(payload.version) || 1,
        ]
      );
    }
    await txn.runAsync('DELETE FROM inventory WHERE product_id = ?', [id]);
    return;
  }

  const remoteTypeId = String(payload.type_id || '').trim();
  if (!remoteTypeId) return;
  const typeId = (await getMappedTypeId(txn, remoteTypeId)) || remoteTypeId;
  await ensureProductType(txn, typeId);

  const barcode =
    typeof payload.barcode === 'string' && payload.barcode.trim()
      ? payload.barcode.trim()
      : null;

  // The local barcode column is unique across live and deleted rows. If a
  // different local product already owns this barcode, keep the pull from
  // failing; the next local edit can re-assign a barcode.
  let safeBarcode = barcode;
  if (barcode) {
    const conflict = await txn.getFirstAsync<{ id: string }>(
      'SELECT id FROM products WHERE barcode = ? AND id <> ?',
      [barcode, id]
    );
    if (conflict) safeBarcode = null;
  }

  const createdAt =
    typeof payload.created_at === 'string'
      ? payload.created_at
      : new Date().toISOString();
  const updatedAt =
    typeof payload.updated_at === 'string'
      ? payload.updated_at
      : new Date().toISOString();

  await txn.runAsync(
    `INSERT INTO products
       (id, name, type_id, brand, colour, cost_price, price, barcode,
        created_at, updated_at, deleted_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       type_id = excluded.type_id,
       brand = excluded.brand,
       colour = excluded.colour,
       cost_price = excluded.cost_price,
       price = excluded.price,
       barcode = excluded.barcode,
       updated_at = excluded.updated_at,
       deleted_at = NULL,
       version = excluded.version`,
    [
      id,
      String(payload.name || 'Unnamed'),
      typeId,
      typeof payload.brand === 'string' ? payload.brand : null,
      typeof payload.colour === 'string' ? payload.colour : null,
      Number(payload.cost_price) || 0,
      Number(payload.price) || 0,
      safeBarcode,
      createdAt,
      updatedAt,
      Number(payload.version) || 1,
    ]
  );
}

async function applyCustomer(
  txn: SyncTransaction,
  change: ChangeRow
): Promise<void> {
  const payload = change.payload || {};
  const id = String(payload.id || '');
  if (!id) return;

  const createdAt = timestampOr(payload.created_at, new Date().toISOString());
  const deletedAt =
    change.op === 'delete'
      ? new Date().toISOString()
      : stringOrNull(payload.deleted_at);
  const updatedAt = timestampOr(payload.updated_at, createdAt);

  await txn.runAsync(
    `INSERT INTO customers
       (id, name, phone, total_purchase, due_amount, created_at, updated_at,
        deleted_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       phone = excluded.phone,
       total_purchase = excluded.total_purchase,
       due_amount = excluded.due_amount,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       version = excluded.version`,
    [
      id,
      stringOr(payload.name, 'Customer'),
      stringOrNull(payload.phone),
      numberOr(payload.total_purchase),
      numberOr(payload.due_amount),
      createdAt,
      updatedAt,
      deletedAt,
      numberOr(payload.version, 1),
    ]
  );
}

async function applyOrder(
  txn: SyncTransaction,
  change: ChangeRow
): Promise<void> {
  const payload = change.payload || {};
  const id = String(payload.id || '');
  if (!id) return;

  const createdAt = timestampOr(payload.created_at, new Date().toISOString());
  const updatedAt = timestampOr(payload.updated_at, createdAt);
  const deletedAt =
    change.op === 'delete'
      ? new Date().toISOString()
      : stringOrNull(payload.deleted_at);

  if (deletedAt) {
    await txn.runAsync(
      `INSERT INTO orders
         (id, date, created_at, updated_at, deleted_at, version)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         version = excluded.version`,
      [id, createdAt, createdAt, updatedAt, deletedAt, numberOr(payload.version, 1)]
    );
    return;
  }

  const customerId = stringOrNull(payload.customer_id);
  await ensureCustomer(txn, customerId, createdAt);

  await txn.runAsync(
    `INSERT INTO orders
       (id, date, customer_id, total_amount, discount, tax, final_amount,
        payment_mode, created_at, updated_at, deleted_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       date = excluded.date,
       customer_id = excluded.customer_id,
       total_amount = excluded.total_amount,
       discount = excluded.discount,
       tax = excluded.tax,
       final_amount = excluded.final_amount,
       payment_mode = excluded.payment_mode,
       updated_at = excluded.updated_at,
       deleted_at = NULL,
       version = excluded.version`,
    [
      id,
      timestampOr(payload.date, createdAt),
      customerId,
      numberOr(payload.total_amount),
      numberOr(payload.discount),
      numberOr(payload.tax),
      numberOr(payload.final_amount),
      stringOr(payload.payment_mode, 'cash'),
      createdAt,
      updatedAt,
      numberOr(payload.version, 1),
    ]
  );
}

async function applyOrderItem(
  txn: SyncTransaction,
  change: ChangeRow
): Promise<void> {
  const payload = change.payload || {};
  const id = String(payload.id || '');
  if (!id) return;

  if (change.op === 'delete') {
    await txn.runAsync('DELETE FROM order_items WHERE id = ?', [id]);
    return;
  }

  const orderId = stringOrNull(payload.order_id);
  const productId = stringOrNull(payload.product_id);
  if (!orderId || !productId) return;

  const createdAt = timestampOr(payload.created_at, new Date().toISOString());
  await ensureOrder(txn, orderId, createdAt);

  const product = await txn.getFirstAsync<{ id: string }>(
    'SELECT id FROM products WHERE id = ?',
    [productId]
  );
  if (!product) return;

  await txn.runAsync(
    `INSERT INTO order_items
       (id, order_id, product_id, size, quantity, price, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       order_id = excluded.order_id,
       product_id = excluded.product_id,
       size = excluded.size,
       quantity = excluded.quantity,
       price = excluded.price`,
    [
      id,
      orderId,
      productId,
      stringOr(payload.size, ''),
      Math.max(1, Math.floor(numberOr(payload.quantity, 1))),
      numberOr(payload.price),
      createdAt,
    ]
  );
}

async function applyStockMovement(
  txn: SyncTransaction,
  change: ChangeRow
): Promise<void> {
  const payload = change.payload || {};
  const id = String(payload.id || '');
  const productId = stringOrNull(payload.product_id);
  const size = stringOr(payload.size, '');
  const delta = Math.trunc(numberOr(payload.delta));
  if (!id || !productId || !size || delta === 0) return;

  const reason = stringOr(payload.reason, 'adjustment');
  const inserted = await txn.runAsync(
    `INSERT OR IGNORE INTO stock_movements
       (id, product_id, size, delta, reason, order_id, device_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      size,
      delta,
      reason,
      stringOrNull(payload.order_id),
      stringOrNull(payload.device_id),
      timestampOr(payload.created_at, new Date().toISOString()),
    ]
  );
  if (!inserted.changes) return;

  const product = await txn.getFirstAsync<{ deleted_at: string | null }>(
    'SELECT deleted_at FROM products WHERE id = ?',
    [productId]
  );
  if (!product || product.deleted_at) return;

  if (reason === 'baseline') {
    // A baseline is an absolute starting count, not a delta. Resetting avoids
    // double-counting when a device that already has local stock pulls it.
    await txn.runAsync(
      `INSERT INTO inventory (id, product_id, size, quantity)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(product_id, size) DO UPDATE SET
         quantity = excluded.quantity`,
      [generateId(), productId, size, Math.max(0, delta)]
    );
    return;
  }

  await txn.runAsync(
    `INSERT INTO inventory (id, product_id, size, quantity)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(product_id, size) DO UPDATE SET
       quantity = MAX(0, quantity + ?)`,
    [
      generateId(),
      productId,
      size,
      Math.max(0, delta),
      delta,
    ]
  );
}

async function recalculateCustomerTotalsInTxn(txn: SyncTransaction): Promise<void> {
  await txn.runAsync(`
    UPDATE customers AS c
    SET total_purchase = COALESCE((
          SELECT SUM(o.final_amount)
          FROM orders o
          WHERE o.customer_id = c.id AND o.deleted_at IS NULL
        ), 0),
        updated_at = datetime('now')
    WHERE c.deleted_at IS NULL
      AND c.total_purchase <> COALESCE((
          SELECT SUM(o.final_amount)
          FROM orders o
          WHERE o.customer_id = c.id AND o.deleted_at IS NULL
        ), 0);
  `);
}

async function applyChanges(changes: ChangeRow[]): Promise<void> {
  if (changes.length === 0) return;
  const db = await getDatabase();

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      "UPDATE sync_state SET value = '1' WHERE key = 'applying_remote'"
    );
    try {
      for (const change of changes) {
        if (change.entity === 'product_types') {
          await applyProductType(txn, change);
        } else if (change.entity === 'products') {
          await applyProduct(txn, change);
        } else if (change.entity === 'customers') {
          await applyCustomer(txn, change);
        } else if (change.entity === 'orders') {
          await applyOrder(txn, change);
        } else if (change.entity === 'order_items') {
          await applyOrderItem(txn, change);
        } else if (change.entity === 'stock_movements') {
          await applyStockMovement(txn, change);
        }
      }
      // Bills can arrive after the customer row, and another device cannot know
      // our local order history. Sum the ledger so totals converge.
      await recalculateCustomerTotalsInTxn(txn);
    } finally {
      await txn.runAsync(
        "UPDATE sync_state SET value = '0' WHERE key = 'applying_remote'"
      );
    }
  });
}

async function pullChanges(shopId: string): Promise<void> {
  if (!supabase) throw new Error('Cloud sync is not configured');
  const key = pulledSeqKey(shopId);
  let since = Number((await getState(key)) || 0);

  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    const { data, error } = await supabase.rpc('sync_pull', {
      p_shop_id: shopId,
      p_since: since,
      p_limit: PULL_PAGE_SIZE,
    });

    if (error) throw new Error(describeError(error));

    const changes = (Array.isArray(data?.changes) ? data.changes : []) as ChangeRow[];
    await applyChanges(changes);

    const next = Number(data?.next_since);
    if (Number.isFinite(next) && next >= since) {
      since = next;
      await setState(key, String(since));
    }

    if (!data?.has_more) return;
    if (changes.length === 0) return;
  }

  // The next sync will continue from the saved cursor.
}

export async function syncNow(): Promise<SyncStatus> {
  if (!supabase) {
    return getSyncStatus();
  }
  if (running) return running;

  running = (async () => {
    try {
      const shop = await getActiveShop();
      if (!shop) return getSyncStatus();

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return getSyncStatus();

      await enqueueOperationalBackfill(shop.id);
      await pushOutbox(shop.id);
      await pullChanges(shop.id);

      await setState('last_error', '');
      await setState('last_synced_at', new Date().toISOString());
    } catch (error) {
      await setState('last_error', describeError(error));
    } finally {
      running = null;
    }
    return getSyncStatus();
  })();

  return running;
}
