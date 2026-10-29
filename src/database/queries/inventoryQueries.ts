import { getDatabase, generateId } from '../db';
import { InventoryItem } from '../../types/models';

export interface StockMovementOptions {
    /** Why the stock changed. Stored on the sync movement. */
    reason?: string;
    /** Attach a sale movement to its bill. */
    orderId?: string | null;
    /** Deterministic id used by the one-time inventory baseline. */
    movementId?: string;
    /** Override the movement timestamp (baselines sort before real changes). */
    createdAt?: string;
}

/**
 * Record one append-only stock delta. Inventory itself remains the fast local
 * cache; the movement is what syncs between devices.
 */
export async function recordStockMovement(
    productId: string,
    size: string,
    delta: number,
    options: StockMovementOptions = {}
): Promise<void> {
    const change = Math.trunc(delta);
    if (!Number.isFinite(change) || change === 0) return;

    const db = await getDatabase();
    await db.runAsync(
        `INSERT OR IGNORE INTO stock_movements
           (id, product_id, size, delta, reason, order_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        [
            options.movementId ?? generateId(),
            productId,
            size,
            change,
            options.reason ?? 'adjustment',
            options.orderId ?? null,
            options.createdAt ?? null,
        ]
    );
}

export async function getInventoryForProduct(productId: string): Promise<InventoryItem[]> {
    const db = await getDatabase();
    return db.getAllAsync<InventoryItem>(
        'SELECT * FROM inventory WHERE product_id = ? ORDER BY size',
        [productId]
    );
}

export async function setInventory(
    productId: string,
    size: string,
    quantity: number
): Promise<void> {
    const db = await getDatabase();
    const nextQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
    const existing = await db.getFirstAsync<InventoryItem>(
        'SELECT * FROM inventory WHERE product_id = ? AND size = ?',
        [productId, size]
    );

    if (existing) {
        await db.runAsync(
            'UPDATE inventory SET quantity = ? WHERE product_id = ? AND size = ?',
            [nextQuantity, productId, size]
        );
    } else {
        const id = generateId();
        await db.runAsync(
            'INSERT INTO inventory (id, product_id, size, quantity) VALUES (?, ?, ?, ?)',
            [id, productId, size, nextQuantity]
        );
    }

    await recordStockMovement(
        productId,
        size,
        nextQuantity - (existing?.quantity ?? 0),
        { reason: 'adjustment' }
    );
}

/**
 * Add stock without overwriting the current count. Used by the AI import
 * review screen when the user explicitly confirms a stock receipt.
 */
export async function increaseStock(
    productId: string,
    size: string,
    qty: number,
    options: StockMovementOptions = {}
): Promise<void> {
    const quantity = Math.floor(Number(qty) || 0);
    if (quantity <= 0) return;
    const db = await getDatabase();
    const id = generateId();
    await db.runAsync(
        `INSERT INTO inventory (id, product_id, size, quantity)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(product_id, size)
         DO UPDATE SET quantity = quantity + excluded.quantity`,
        [id, productId, size, quantity]
    );
    await recordStockMovement(productId, size, quantity, {
        reason: options.reason ?? 'stock_in',
        orderId: options.orderId,
        movementId: options.movementId,
        createdAt: options.createdAt,
    });
}

export async function reduceStock(
    productId: string,
    size: string,
    qty: number,
    options: StockMovementOptions = {}
): Promise<void> {
    const quantity = Math.floor(Number(qty) || 0);
    if (quantity <= 0) return;
    const db = await getDatabase();
    const existing = await db.getFirstAsync<InventoryItem>(
        'SELECT * FROM inventory WHERE product_id = ? AND size = ?',
        [productId, size]
    );
    const removed = Math.min(quantity, Math.max(0, existing?.quantity ?? 0));
    if (removed <= 0) return;

    await db.runAsync(
        'UPDATE inventory SET quantity = MAX(0, quantity - ?) WHERE product_id = ? AND size = ?',
        [removed, productId, size]
    );
    await recordStockMovement(productId, size, -removed, {
        reason: options.reason ?? 'sale',
        orderId: options.orderId,
        movementId: options.movementId,
        createdAt: options.createdAt,
    });
}

export async function getLowStockProducts(threshold: number = 5): Promise<any[]> {
    const db = await getDatabase();
    return db.getAllAsync(
        `SELECT p.id, p.name, pt.name as type_name, i.size, i.quantity
     FROM inventory i
     JOIN products p ON i.product_id = p.id
     LEFT JOIN product_types pt ON p.type_id = pt.id
     WHERE p.deleted_at IS NULL
       AND i.quantity <= ? AND i.quantity > 0
     ORDER BY i.quantity ASC`,
        [threshold]
    );
}

export async function getTotalStock(productId: string): Promise<number> {
    const db = await getDatabase();
    const result = await db.getFirstAsync<{ total: number }>(
        'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory WHERE product_id = ?',
        [productId]
    );
    return result?.total ?? 0;
}

export async function deleteInventoryForProduct(productId: string): Promise<void> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<InventoryItem>(
        'SELECT * FROM inventory WHERE product_id = ?',
        [productId]
    );
    await db.runAsync('DELETE FROM inventory WHERE product_id = ?', [productId]);
    for (const row of rows) {
        await recordStockMovement(productId, row.size, -row.quantity, {
            reason: 'adjustment',
        });
    }
}
