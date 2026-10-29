import * as SQLite from 'expo-sqlite';
import { CREATE_TABLES_SQL, SEED_PRODUCT_TYPES } from './schema';
import { SYNC_SCHEMA_SQL } from './syncSchema';
import { getActiveShop, getDefaultShopId } from '../sync/activeShop';

let db: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;
let currentDbName: string | null = null;

/**
 * The first cloud shop inherits `billingapp.db` so existing local data is not
 * lost. Every additional shop gets an isolated database file.
 */
async function resolveDatabaseName(): Promise<string> {
    const shop = await getActiveShop();
    if (!shop) return 'billingapp.db';

    const defaultShopId = await getDefaultShopId();
    if (!defaultShopId || defaultShopId === shop.id) return 'billingapp.db';

    const safeId = shop.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    return `billingapp-${safeId || 'shop'}.db`;
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (db) return db;
    if (opening) return opening;

    opening = (async () => {
        const name = await resolveDatabaseName();
        const database = await SQLite.openDatabaseAsync(name);
        await database.execAsync('PRAGMA journal_mode = WAL;');
        await database.execAsync('PRAGMA foreign_keys = ON;');
        await database.execAsync(CREATE_TABLES_SQL);
        await runMigrations(database);
        // Seed before the sync triggers exist. The link-a-shop flow explicitly
        // snapshots existing local rows into the outbox; create_shop also seeds
        // the same defaults on the server.
        await database.execAsync(SEED_PRODUCT_TYPES);
        await database.execAsync(SYNC_SCHEMA_SQL);
        db = database;
        currentDbName = name;
        return database;
    })();

    try {
        return await opening;
    } finally {
        opening = null;
    }
}

/** Close the current database before switching shops. */
export async function closeDatabase(): Promise<void> {
    if (opening) {
        try {
            await opening;
        } catch {
            // The next call will retry opening the selected database.
        }
    }
    const current = db;
    db = null;
    currentDbName = null;
    if (current) {
        await current.closeAsync();
    }
}

export function getCurrentDatabaseName(): string | null {
    return currentDbName;
}

/**
 * Lightweight in-place migrations for databases created before this schema.
 * `CREATE TABLE IF NOT EXISTS` does nothing to existing tables, so columns
 * added later are migrated here with a column check.
 */
async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
    // v1 -> v2: buying price (cost_price) on products.
    const productColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(products)');
    if (!productColumns.some((column) => column.name === 'cost_price')) {
        await db.execAsync('ALTER TABLE products ADD COLUMN cost_price REAL NOT NULL DEFAULT 0;');
    }
    // v2 -> v3: brand and colour captured from AI imports / labels.
    if (!productColumns.some((column) => column.name === 'brand')) {
        await db.execAsync('ALTER TABLE products ADD COLUMN brand TEXT;');
    }
    if (!productColumns.some((column) => column.name === 'colour')) {
        await db.execAsync('ALTER TABLE products ADD COLUMN colour TEXT;');
    }

    // v3 -> v4: cloud sync metadata. `updated_at` is nullable for existing
    // rows and backfilled below; the other two have safe constant defaults.
    const typeColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(product_types)');
    if (!typeColumns.some((column) => column.name === 'updated_at')) {
        await db.execAsync('ALTER TABLE product_types ADD COLUMN updated_at TEXT;');
        await db.execAsync(
            "UPDATE product_types SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;"
        );
    }
    if (!typeColumns.some((column) => column.name === 'deleted_at')) {
        await db.execAsync('ALTER TABLE product_types ADD COLUMN deleted_at TEXT;');
    }
    if (!typeColumns.some((column) => column.name === 'version')) {
        await db.execAsync('ALTER TABLE product_types ADD COLUMN version INTEGER NOT NULL DEFAULT 1;');
    }

    const freshProductColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(products)');
    if (!freshProductColumns.some((column) => column.name === 'updated_at')) {
        await db.execAsync('ALTER TABLE products ADD COLUMN updated_at TEXT;');
        await db.execAsync(
            "UPDATE products SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;"
        );
    }
    if (!freshProductColumns.some((column) => column.name === 'deleted_at')) {
        await db.execAsync('ALTER TABLE products ADD COLUMN deleted_at TEXT;');
    }
    if (!freshProductColumns.some((column) => column.name === 'version')) {
        await db.execAsync('ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 1;');
    }
}

export function generateId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const segments = [8, 4, 4, 4, 12];
    return segments
        .map((len) =>
            Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
        )
        .join('-');
}
