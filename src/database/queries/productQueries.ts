import { getDatabase, generateId } from '../db';
import { Product, ProductType } from '../../types/models';

export async function getProductTypes(): Promise<ProductType[]> {
    const db = await getDatabase();
    return db.getAllAsync<ProductType>(
        'SELECT * FROM product_types WHERE deleted_at IS NULL ORDER BY name'
    );
}

export async function addProductType(name: string): Promise<string> {
    const db = await getDatabase();
    const id = generateId();
    await db.runAsync('INSERT INTO product_types (id, name) VALUES (?, ?)', [id, name]);
    return id;
}

export async function getAllProducts(): Promise<Product[]> {
    const db = await getDatabase();
    return db.getAllAsync<Product>(
        `SELECT p.*, pt.name as type_name 
     FROM products p 
     LEFT JOIN product_types pt ON p.type_id = pt.id 
     WHERE p.deleted_at IS NULL
     ORDER BY p.created_at DESC`
    );
}

export async function getProductsByType(typeId: string): Promise<Product[]> {
    const db = await getDatabase();
    return db.getAllAsync<Product>(
        `SELECT p.*, pt.name as type_name 
     FROM products p 
     LEFT JOIN product_types pt ON p.type_id = pt.id 
     WHERE p.type_id = ? AND p.deleted_at IS NULL
     ORDER BY p.name`,
        [typeId]
    );
}

export async function getProductByBarcode(barcode: string): Promise<Product | null> {
    const db = await getDatabase();
    return db.getFirstAsync<Product>(
        `SELECT p.*, pt.name as type_name 
     FROM products p 
     LEFT JOIN product_types pt ON p.type_id = pt.id 
     WHERE p.barcode = ? AND p.deleted_at IS NULL`,
        [barcode]
    );
}

export async function getProductById(id: string): Promise<Product | null> {
    const db = await getDatabase();
    return db.getFirstAsync<Product>(
        `SELECT p.*, pt.name as type_name 
     FROM products p 
     LEFT JOIN product_types pt ON p.type_id = pt.id 
     WHERE p.id = ? AND p.deleted_at IS NULL`,
        [id]
    );
}

export async function addProduct(
    name: string,
    typeId: string,
    costPrice: number,
    price: number,
    barcode: string,
    brand?: string | null,
    colour?: string | null
): Promise<string> {
    const db = await getDatabase();
    const id = generateId();
    await db.runAsync(
        `INSERT INTO products (id, name, type_id, brand, colour, cost_price, price, barcode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, typeId, brand?.trim() || null, colour?.trim() || null, costPrice, price, barcode]
    );
    return id;
}

export async function updateProduct(
    id: string,
    name: string,
    typeId: string,
    costPrice: number,
    price: number
): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
        'UPDATE products SET name = ?, type_id = ?, cost_price = ?, price = ? WHERE id = ?',
        [name, typeId, costPrice, price, id]
    );
}

export async function deleteProduct(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM inventory WHERE product_id = ?', [id]);
    // Soft delete keeps a tombstone that can be synced without breaking old
    // order rows. Clearing the barcode frees it for a future product.
    await db.runAsync(
        "UPDATE products SET deleted_at = datetime('now'), barcode = NULL WHERE id = ? AND deleted_at IS NULL",
        [id]
    );
}

export async function searchProducts(query: string): Promise<Product[]> {
    const db = await getDatabase();
    return db.getAllAsync<Product>(
        `SELECT p.*, pt.name as type_name 
     FROM products p 
     LEFT JOIN product_types pt ON p.type_id = pt.id 
     WHERE p.deleted_at IS NULL
       AND (p.name LIKE ? OR pt.name LIKE ? OR p.barcode LIKE ?)
     ORDER BY p.name`,
        [`%${query}%`, `%${query}%`, `%${query}%`]
    );
}
