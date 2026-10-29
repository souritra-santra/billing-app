import { getDatabase, generateId } from '../db';
import { Order, OrderItem, SalesSummary, TopProduct } from '../../types/models';

export async function createOrder(
    customerId: string | null,
    totalAmount: number,
    discount: number,
    tax: number,
    finalAmount: number,
    paymentMode: string,
    items: Omit<OrderItem, 'id' | 'order_id'>[]
): Promise<string> {
    const db = await getDatabase();
    const orderId = generateId();

    await db.runAsync(
        `INSERT INTO orders (id, customer_id, total_amount, discount, tax, final_amount, payment_mode) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, customerId, totalAmount, discount, tax, finalAmount, paymentMode]
    );

    for (const item of items) {
        const itemId = generateId();
        await db.runAsync(
            `INSERT INTO order_items (id, order_id, product_id, size, quantity, price) 
       VALUES (?, ?, ?, ?, ?, ?)`,
            [itemId, orderId, item.product_id, item.size, item.quantity, item.price]
        );
    }

    return orderId;
}

export async function getRecentOrders(limit: number = 10): Promise<Order[]> {
    const db = await getDatabase();
    return db.getAllAsync<Order>(
        `SELECT o.*, c.name as customer_name 
     FROM orders o 
     LEFT JOIN customers c ON o.customer_id = c.id 
     ORDER BY o.date DESC 
     LIMIT ?`,
        [limit]
    );
}

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
    const db = await getDatabase();
    return db.getAllAsync<OrderItem>(
        `SELECT oi.*, p.name as product_name 
     FROM order_items oi 
     LEFT JOIN products p ON oi.product_id = p.id 
     WHERE oi.order_id = ?`,
        [orderId]
    );
}

export async function getOrdersByCustomer(customerId: string): Promise<Order[]> {
    const db = await getDatabase();
    return db.getAllAsync<Order>(
        `SELECT * FROM orders WHERE customer_id = ? ORDER BY date DESC`,
        [customerId]
    );
}

export async function getDailySales(date: string): Promise<SalesSummary> {
    const db = await getDatabase();
    const result = await db.getFirstAsync<SalesSummary>(
        `SELECT 
       COALESCE(SUM(final_amount), 0) as total_sales, 
       COUNT(*) as total_orders,
       COALESCE((SELECT SUM(quantity) FROM order_items WHERE order_id IN 
         (SELECT id FROM orders WHERE date(date) = date(?))), 0) as total_items
     FROM orders 
     WHERE date(date) = date(?)`,
        [date, date]
    );
    return result ?? { total_sales: 0, total_orders: 0, total_items: 0 };
}

export async function getMonthlySales(year: number, month: number): Promise<SalesSummary> {
    const db = await getDatabase();
    const monthStr = String(month).padStart(2, '0');
    const result = await db.getFirstAsync<SalesSummary>(
        `SELECT 
       COALESCE(SUM(final_amount), 0) as total_sales, 
       COUNT(*) as total_orders,
       COALESCE((SELECT SUM(quantity) FROM order_items WHERE order_id IN 
         (SELECT id FROM orders WHERE strftime('%Y-%m', date) = ?)), 0) as total_items
     FROM orders 
     WHERE strftime('%Y-%m', date) = ?`,
        [`${year}-${monthStr}`, `${year}-${monthStr}`]
    );
    return result ?? { total_sales: 0, total_orders: 0, total_items: 0 };
}

export async function getTopSellingProducts(limit: number = 10): Promise<TopProduct[]> {
    const db = await getDatabase();
    return db.getAllAsync<TopProduct>(
        `SELECT 
       oi.product_id, 
       p.name as product_name, 
       SUM(oi.quantity) as total_sold, 
       SUM(oi.price * oi.quantity) as total_revenue
     FROM order_items oi
     JOIN products p ON oi.product_id = p.id
     GROUP BY oi.product_id
     ORDER BY total_sold DESC
     LIMIT ?`,
        [limit]
    );
}
