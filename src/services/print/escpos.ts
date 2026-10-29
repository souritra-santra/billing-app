/**
 * Builds ESC/POS documents (as plain node objects) for the native Bluetooth
 * thermal printer. These are pure data structures — no native module is loaded
 * here, so this file is safe to import anywhere.
 */
import type { Node, TextStyle, ColumnDef } from 'react-native-thermal-printer-driver';
import { Order, OrderItem, LabelProduct, PrintSettings } from '../../types/models';
import { encodeCostCode } from '../../utils/helpers';
import { getPaperSpec } from './paper';

function text(content: string, style?: TextStyle): Node {
    return { type: 'text', content, style };
}

function rule(width: number, character = '-'): Node {
    return { type: 'text', content: character.repeat(width) };
}

function row(left: string, right: string, width: number, style?: TextStyle): Node {
    const leftWidth = Math.max(1, width - Math.min(width, right.length));
    const columns: ColumnDef[] = [
        { content: left, width: leftWidth, align: 'left', style },
        { content: right, width: width - leftWidth, align: 'right', style },
    ];
    return { type: 'columns', columns };
}

function money(amount: number): string {
    // ESC/POS code pages cannot render the ₹ glyph reliably.
    return `Rs.${(amount || 0).toFixed(2)}`;
}

export function buildInvoiceNodes(
    order: Order,
    items: OrderItem[],
    settings: PrintSettings
): Node[] {
    const width = getPaperSpec(settings.paperWidth).charWidth;
    const nodes: Node[] = [];

    if (settings.storeName?.trim()) {
        nodes.push(text(settings.storeName.trim(), { align: 'center', bold: true, size: 2 }));
    }
    if (settings.storePhone?.trim()) {
        nodes.push(text(settings.storePhone.trim(), { align: 'center' }));
    }
    nodes.push(text('RECEIPT', { align: 'center', bold: true }));
    nodes.push(text(`Order #${order.id.slice(-8)}`, { align: 'center' }));
    nodes.push(text(new Date(order.date).toLocaleString('en-IN'), { align: 'center' }));
    nodes.push(text(`Customer: ${order.customer_name || 'Walk-in'}`));
    nodes.push(text(`Payment: ${(order.payment_mode || 'cash').toUpperCase()}`));
    nodes.push(rule(width));

    for (const item of items) {
        nodes.push(text(item.product_name || 'Item', { bold: true }));
        const detail = [item.size ? `Size ${item.size}` : null, `x${item.quantity}`]
            .filter(Boolean)
            .join('  ');
        nodes.push(row(`  ${detail}`, money((item.price || 0) * (item.quantity || 1)), width));
    }

    nodes.push(rule(width));
    nodes.push(row('Subtotal', money(order.total_amount), width));
    if (order.discount) nodes.push(row('Discount', `-${money(order.discount)}`, width));
    if (order.tax) nodes.push(row('Tax', `+${money(order.tax)}`, width));
    nodes.push(rule(width));
    nodes.push(row('TOTAL', money(order.final_amount), width, { bold: true }));
    nodes.push(text(''));
    nodes.push(text('Thank you!', { align: 'center' }));
    nodes.push({ type: 'feed', lines: 3 });
    if (settings.autoCut) nodes.push({ type: 'cut' });

    return nodes;
}

export function buildLabelNodes(products: LabelProduct[], settings: PrintSettings): Node[] {
    const nodes: Node[] = [];

    products.forEach((product) => {
        const barcodeValue = product.barcode || product.id;
        const copies = Math.max(0, Math.floor(product.qty ?? 1));
        const costCode =
            product.cost_price > 0 ? encodeCostCode(product.cost_price, settings.costCode) : '';

        for (let copy = 0; copy < copies; copy++) {
            nodes.push(text(product.name, { align: 'center', bold: true, size: 2 }));
            nodes.push(text(money(product.price || 0), { align: 'center' }));
            if (product.size) {
                nodes.push(text(`Size: ${product.size}`, { align: 'center' }));
            }
            if (costCode) {
                nodes.push(text(costCode, { align: 'center', bold: true }));
            }
            nodes.push({
                type: 'barcode',
                content: barcodeValue,
                format: 'CODE128',
                height: 60,
                width: 2,
                hri: 'below',
            });
            nodes.push({ type: 'feed', lines: 3 });
        }
    });

    if (settings.autoCut) nodes.push({ type: 'cut' });

    return nodes;
}
