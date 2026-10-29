import { getDatabase, generateId } from '../db';
import { Customer } from '../../types/models';

export async function getAllCustomers(): Promise<Customer[]> {
    const db = await getDatabase();
    return db.getAllAsync<Customer>('SELECT * FROM customers ORDER BY name');
}

export async function getCustomerById(id: string): Promise<Customer | null> {
    const db = await getDatabase();
    return db.getFirstAsync<Customer>('SELECT * FROM customers WHERE id = ?', [id]);
}

export async function addCustomer(name: string, phone: string): Promise<string> {
    const db = await getDatabase();
    const id = generateId();
    await db.runAsync(
        'INSERT INTO customers (id, name, phone) VALUES (?, ?, ?)',
        [id, name, phone]
    );
    return id;
}

export async function updateCustomer(
    id: string,
    name: string,
    phone: string
): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE customers SET name = ?, phone = ? WHERE id = ?', [name, phone, id]);
}

export async function updateCustomerPurchase(
    id: string,
    amount: number
): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
        'UPDATE customers SET total_purchase = total_purchase + ? WHERE id = ?',
        [amount, id]
    );
}

export async function searchCustomers(query: string): Promise<Customer[]> {
    const db = await getDatabase();
    return db.getAllAsync<Customer>(
        'SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name',
        [`%${query}%`, `%${query}%`]
    );
}

export async function deleteCustomer(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM customers WHERE id = ?', [id]);
}
