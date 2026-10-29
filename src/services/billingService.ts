import { CartItem } from '../types/models';
import { createOrder } from '../database/queries/orderQueries';
import { reduceStock } from '../database/queries/inventoryQueries';
import { updateCustomerPurchase } from '../database/queries/customerQueries';

export function calculateSubtotal(cart: CartItem[]): number {
    return cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
}

export function calculateDiscount(subtotal: number, discountValue: number, isPercent: boolean): number {
    if (isPercent) {
        return Math.round((subtotal * discountValue) / 100 * 100) / 100;
    }
    return Math.min(discountValue, subtotal);
}

export function calculateTax(amount: number, taxRate: number): number {
    return Math.round((amount * taxRate) / 100 * 100) / 100;
}

export function calculateFinal(subtotal: number, discount: number, tax: number): number {
    return Math.round((subtotal - discount + tax) * 100) / 100;
}

export async function checkout(
    cart: CartItem[],
    customerId: string | null,
    discountAmount: number,
    taxAmount: number,
    paymentMode: string
): Promise<string> {
    const subtotal = calculateSubtotal(cart);
    const finalAmount = calculateFinal(subtotal, discountAmount, taxAmount);

    const items = cart.map((item) => ({
        product_id: item.product.id,
        size: item.size,
        quantity: item.quantity,
        price: item.product.price,
    }));

    const orderId = await createOrder(
        customerId,
        subtotal,
        discountAmount,
        taxAmount,
        finalAmount,
        paymentMode,
        items
    );

    // Reduce stock for each item and keep the movement linked to this bill so
    // other devices can apply the same sale without double-counting it.
    for (const item of cart) {
        await reduceStock(item.product.id, item.size, item.quantity, {
            reason: 'sale',
            orderId,
        });
    }

    // Update customer total purchase
    if (customerId) {
        await updateCustomerPurchase(customerId, finalAmount);
    }

    return orderId;
}
