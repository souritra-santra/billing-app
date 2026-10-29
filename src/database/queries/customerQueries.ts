import { getDatabase, generateId } from '../db';
import { Customer } from '../../types/models';

export async function getAllCustomers(): Promise<Customer[]> {
    const db = await getDatabase();
    return db.getAllAsync<Customer>(
        'SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY name'
    );
}

export async function getCustomerById(id: string): Promise<Customer | null> {
    const db = await getDatabase();
    return db.getFirstAsync<Customer>(
        'SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL',
        [id]
    );
}

export async function addCustomer(name: string, phone: string): Promise<string> {
    const db = await getDatabase();
    const id = generateId();
    await db.runAsync(
        'INSERT INTO customers (id, name, phone) VALUES (?, ?, ?)',
        [id, name, phone || null]
    );
    return id;
}

export async function updateCustomer(
    id: string,
    name: string,
    phone: string
): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
        `UPDATE customers
         SET name = ?, phone = ?, updated_at = datetime('now')
         WHERE id = ? AND deleted_at IS NULL`,
        [name, phone || null, id]
    );
}

export async function updateCustomerPurchase(
    id: string,
    amount: number
): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
        `UPDATE customers
         SET total_purchase = total_purchase + ?, updated_at = datetime('now')
         WHERE id = ? AND deleted_at IS NULL`,
        [amount, id]
    );
}

export async function searchCustomers(query: string): Promise<Customer[]> {
    const db = await getDatabase();
    return db.getAllAsync<Customer>(
        `SELECT * FROM customers
         WHERE deleted_at IS NULL AND (name LIKE ? OR phone LIKE ?)
         ORDER BY name`,
        [`%${query}%`, `%${query}%`]
    );
}

/**
 * Customers are soft-deleted so bills synced from other devices keep a valid
 * foreign key and can still show the customer name.
 */
export async function deleteCustomer(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
        `UPDATE customers
         SET deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND deleted_at IS NULL`,
        [id]
    );
}

/**
 * Recompute customer totals from the local order ledger. Pulled orders can
 * arrive in any order, so summing the ledger is safer than applying deltas.
 */
export async function recalculateCustomerTotals(customerId?: string): Promise<void> {
    const db = await getDatabase();
    const filter = customerId ? 'AND c.id = ?' : '';
    await db.runAsync(
        `UPDATE customers AS c
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
             ), 0)
           ${filter}`,
        customerId ? [customerId] : []
    );
}
