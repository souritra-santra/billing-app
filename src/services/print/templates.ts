import { Order, OrderItem, LabelProduct, PrintSettings } from '../../types/models';
import { formatCurrency, formatDate, formatTime, encodeCostCode } from '../../utils/helpers';
import { code128ToSvg } from '../../utils/barcode';
import { getPaperSpec } from './paper';
import { getT } from '../../i18n/runtime';

const T = getT();

function escapeHtml(value: string | number | null | undefined): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function shortId(id: string): string {
    return id.length > 8 ? id.slice(-8) : id;
}

/** Shared, thermal-friendly base CSS: monochrome, narrow page, no grey fills. */
function baseStyles(settings: PrintSettings): string {
    const spec = getPaperSpec(settings.paperWidth);
    return `
        @page { size: ${spec.widthMm}mm auto; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        body {
            color: #000000;
            font-family: "Courier New", Courier, "Noto Sans Bengali", "Nirmala UI", "SolaimanLipi", monospace;
            font-size: 11px;
            line-height: 1.4;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .page { width: 100%; padding: 4mm 3mm; }
        .center { text-align: center; }
        .right { text-align: right; }
        .bold { font-weight: bold; }
        .store { font-size: 15px; font-weight: bold; text-align: center; letter-spacing: 0.5px; }
        .store-sub { text-align: center; font-size: 10px; margin-top: 1px; }
        .title { text-align: center; font-size: 12px; font-weight: bold; margin: 6px 0 4px; letter-spacing: 1px; }
        .meta { margin: 6px 0; }
        .meta-row { display: flex; justify-content: space-between; gap: 8px; }
        .rule { border-top: 1px dashed #000000; margin: 6px 0; }
        table.items { width: 100%; border-collapse: collapse; margin: 4px 0; }
        table.items th { text-align: left; font-size: 10px; border-bottom: 1px solid #000000; padding: 3px 0; }
        table.items th.qty, table.items td.qty { text-align: center; width: 34px; }
        table.items th.amt, table.items td.amt { text-align: right; white-space: nowrap; }
        table.items td { padding: 3px 0; vertical-align: top; }
        .item-name { font-weight: bold; }
        .item-sub { font-size: 10px; color: #000000; }
        .totals { margin-top: 4px; }
        .totals .row { display: flex; justify-content: space-between; gap: 8px; }
        .totals .grand { font-weight: bold; font-size: 13px; border-top: 1px solid #000000; padding-top: 4px; margin-top: 4px; }
        .footer { text-align: center; margin-top: 10px; font-size: 10px; }
    `;
}

export interface InvoiceTemplateInput {
    storeName: string;
    storePhone: string;
    order: Order;
    items: OrderItem[];
}

export function buildInvoiceHtml(
    order: Order,
    items: OrderItem[],
    settings: PrintSettings
): string {
    const storeName = settings.storeName?.trim() || 'BillingApp';
    const payment = T(
        order.payment_mode === 'card' ? 'payment.card'
            : order.payment_mode === 'upi' ? 'payment.upi'
            : 'payment.cash'
    );
    const dateText = `${formatDate(order.date)}, ${formatTime(order.date)}`;

    const rows = items
        .map((item) => {
            const lineTotal = (item.quantity || 1) * (item.price || 0);
            const meta = item.size
                ? T('print.sizeDetail', { size: item.size, qty: item.quantity })
                : `x${item.quantity}`;
            return `
                <tr>
                    <td>
                        <div class="item-name">${escapeHtml(item.product_name || T('print.itemFallback'))}</div>
                        <div class="item-sub">${escapeHtml(meta)}</div>
                    </td>
                    <td class="qty">${item.quantity}</td>
                    <td class="amt">${escapeHtml(formatCurrency(lineTotal))}</td>
                </tr>`;
        })
        .join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>${baseStyles(settings)}</style>
</head>
<body>
<div class="page">
    <div class="store">${escapeHtml(storeName)}</div>
    ${settings.storePhone?.trim() ? `<div class="store-sub">${escapeHtml(settings.storePhone)}</div>` : ''}
    <div class="title">${escapeHtml(T('print.receipt'))}</div>

    <div class="meta">
        <div class="meta-row"><span>${escapeHtml(T('print.order'))}</span><span class="bold">#${escapeHtml(shortId(order.id))}</span></div>
        <div class="meta-row"><span>${escapeHtml(T('print.date'))}</span><span>${escapeHtml(dateText)}</span></div>
        <div class="meta-row"><span>${escapeHtml(T('print.customer'))}</span><span>${escapeHtml(order.customer_name || T('print.customerFallback'))}</span></div>
        <div class="meta-row"><span>${escapeHtml(T('print.payment'))}</span><span>${escapeHtml(payment)}</span></div>
    </div>

    <div class="rule"></div>
    <table class="items">
        <thead>
            <tr><th>${escapeHtml(T('print.item'))}</th><th class="qty">${escapeHtml(T('print.qty'))}</th><th class="amt">${escapeHtml(T('print.amount'))}</th></tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>
    <div class="rule"></div>

    <div class="totals">
        <div class="row"><span>${escapeHtml(T('print.subtotal'))}</span><span>${escapeHtml(formatCurrency(order.total_amount || 0))}</span></div>
        ${order.discount ? `<div class="row"><span>${escapeHtml(T('print.discount'))}</span><span>-${escapeHtml(formatCurrency(order.discount))}</span></div>` : ''}
        ${order.tax ? `<div class="row"><span>${escapeHtml(T('print.tax'))}</span><span>+${escapeHtml(formatCurrency(order.tax))}</span></div>` : ''}
        <div class="row grand"><span>${escapeHtml(T('print.total'))}</span><span>${escapeHtml(formatCurrency(order.final_amount || 0))}</span></div>
    </div>

    <div class="footer">${escapeHtml(T('print.footer'))}</div>
</div>
</body>
</html>`;
}

export function buildLabelsHtml(products: LabelProduct[], settings: PrintSettings): string {
    // Print one label per unit of stock (plus the optional hidden cost code).
    const blocks: string[] = [];
    products.forEach((product, index) => {
        const copies = Math.max(0, Math.floor(product.qty ?? 1));
        const barcodeValue = product.barcode || product.id;
        const svg = code128ToSvg(barcodeValue);
        const costCode =
            product.cost_price > 0 ? encodeCostCode(product.cost_price, settings.costCode) : '';

        for (let copy = 0; copy < copies; copy++) {
            const isLast = index === products.length - 1 && copy === copies - 1;
            blocks.push(`
            <div class="label"${isLast ? '' : ' style="page-break-after: always;"'}>
                <div class="label-name">${escapeHtml(product.name)}</div>
                <div class="label-price">${escapeHtml(formatCurrency(product.price || 0))}</div>
                ${product.size ? `<div class="label-size">${escapeHtml(T('print.labelSize', { size: product.size }))}</div>` : ''}
                ${costCode ? `<div class="label-cost">${escapeHtml(costCode)}</div>` : ''}
                <div class="barcode">${svg}</div>
                <div class="label-code">${escapeHtml(barcodeValue)}</div>
            </div>`);
        }
    });

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
${baseStyles(settings)}
.label { text-align: center; padding: 4mm 3mm; }
.label + .label { border-top: 1px dashed #000000; }
.label-name { font-size: 14px; font-weight: bold; }
.label-price { font-size: 16px; font-weight: bold; margin-top: 2px; }
.label-size { font-size: 11px; margin-top: 1px; }
.label-cost { font-size: 10px; font-weight: bold; letter-spacing: 2px; margin-top: 2px; }
.barcode { margin-top: 5px; }
.barcode svg { width: 100%; height: 14mm; display: block; }
.label-code { font-size: 10px; letter-spacing: 1px; margin-top: 2px; }
</style>
</head>
<body>
${blocks.join('')}
</body>
</html>`;
}
