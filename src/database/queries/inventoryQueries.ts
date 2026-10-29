import { getDatabase, generateId } from '../db';
import { InventoryItem } from '../../types/models';

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
    const existing = await db.getFirstAsync<InventoryItem>(
        'SELECT * FROM inventory WHERE product_id = ? AND size = ?',
        [productId, size]
    );
    if (existing) {
        await db.runAsync(
            'UPDATE inventory SET quantity = ? WHERE product_id = ? AND size = ?',
            [quantity, productId, size]
        );
    } else {
        const id = generateId();
        await db.runAsync(
            'INSERT INTO inventory (id, product_id, size, quantity) VALUES (?, ?, ?, ?)',
            [id, productId, size, quantity]
        );
    }
}

/**
 * Add stock without overwriting the current count. Used by the AI import
 * review screen when the user explicitly confirms a stock receipt.
 */
export async function increaseStock(
    productId: string,
    size: string,
    qty: number
): Promise<void> {
    if (!Number.isFinite(qty) || qty <= 0) return;
    const db = await getDatabase();
    const id = generateId();
    await db.runAsync(
        `INSERT INTO inventory (id, product_id, size, quantity)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(product_id, size)
         DO UPDATE SET quantity = quantity + excluded.quantity`,
        [id, productId, size, Math.floor(qty)]
    );
}

export async function reduceStock(
    productId: string,
    size: string,
    qty: number
): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
        'UPDATE inventory SET quantity = MAX(0, quantity - ?) WHERE product_id = ? AND size = ?',
        [qty, productId, size]
    );
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
    await db.runAsync('DELETE FROM inventory WHERE product_id = ?', [productId]);
}
