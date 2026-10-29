import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { Order, OrderItem, LabelProduct, PrintSettings, PaperWidth } from '../types/models';
import { getPrintSettings } from '../database/queries/settingsQueries';
import { buildInvoiceHtml, buildLabelsHtml } from './print/templates';
import { buildInvoiceNodes, buildLabelNodes } from './print/escpos';
import { getThermalDriver, isThermalPrintingSupported } from './print/nativeDriver';
import { getT } from '../i18n/runtime';

const tr = getT();

/** Where a print job should go. */
export type PrintTarget = 'system' | 'pdf' | 'bluetooth';

export interface PrintOptions {
    /** Force a specific destination. Defaults to the saved print settings. */
    target?: PrintTarget;
    /** Override the saved settings (mostly for tests/previews). */
    settings?: PrintSettings;
    /** Override the saved paper width. */
    paperWidth?: PaperWidth;
}

export { isThermalPrintingSupported };

async function resolveSettings(options?: PrintOptions): Promise<PrintSettings> {
    if (options?.settings) {
        return options.paperWidth
            ? { ...options.settings, paperWidth: options.paperWidth }
            : options.settings;
    }
    const saved = await getPrintSettings();
    return options?.paperWidth ? { ...saved, paperWidth: options.paperWidth } : saved;
}

function resolveTarget(requested: PrintTarget | undefined, settings: PrintSettings): PrintTarget {
    if (requested) return requested;
    return settings.printTarget === 'bluetooth' ? 'bluetooth' : 'system';
}

async function sharePdf(uri: string, title: string): Promise<void> {
    if (!(await Sharing.isAvailableAsync())) {
        throw new Error(tr('printService.sharingUnavailable'));
    }
    await Sharing.shareAsync(uri, {
        UTI: 'com.adobe.pdf',
        mimeType: 'application/pdf',
        dialogTitle: title,
    });
}

/**
 * Android: expo-sharing only permits sharing files that live under the app
 * cache/documents directory. expo-print writes its PDFs to `<cache>/Print/…`,
 * which Expo Go's scoped permission service rejects with
 * "Not allowed to read file under given URL" when sharing. Copying the PDF
 * into expo-file-system's cache directory fixes sharing in Expo Go and is a
 * no-op change for standalone builds.
 */
async function shareablePdfUri(uri: string): Promise<string> {
    if (Platform.OS !== 'android') return uri;
    try {
        const target = new File(Paths.cache, `print-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`);
        await new File(uri).copy(target, { overwrite: true });
        return target.uri;
    } catch {
        return uri;
    }
}

async function savePdf(html: string, title: string): Promise<void> {
    const { uri } = await Print.printToFileAsync({ html });
    const shareUri = await shareablePdfUri(uri);
    await sharePdf(shareUri, title);
}

function requireDriver() {
    const driver = getThermalDriver();
    if (!driver) {
        throw new Error(tr('printService.btDevBuild'));
    }
    return driver;
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

export async function printInvoice(
    order: Order,
    items: OrderItem[],
    options?: PrintOptions
): Promise<void> {
    const settings = await resolveSettings(options);
    const target = resolveTarget(options?.target, settings);
    const html = buildInvoiceHtml(order, items, settings);

    if (target === 'pdf') {
        await savePdf(html, tr('printService.shareBillTitle'));
        return;
    }

    if (target === 'bluetooth') {
        const driver = requireDriver();
        if (!settings.printerAddress) {
            throw new Error(tr('printService.noPrinterSelected'));
        }
        const nodes = buildInvoiceNodes(order, items, settings);
        const result = await driver.default.print(settings.printerAddress, nodes, {
            paperWidthMm: settings.paperWidth,
            disableCutPaper: !settings.autoCut,
            timeout: 15000,
        });
        if (!result.success) {
            throw new Error(result.error?.message || tr('printService.rejectedBill'));
        }
        return;
    }

    await Print.printAsync({ html });
}

export function saveInvoicePdf(
    order: Order,
    items: OrderItem[],
    options?: PrintOptions
): Promise<void> {
    return printInvoice(order, items, { ...options, target: 'pdf' });
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export async function printProductLabels(
    products: LabelProduct[],
    options?: PrintOptions
): Promise<void> {
    const settings = await resolveSettings(options);
    const target = resolveTarget(options?.target, settings);
    const html = buildLabelsHtml(products, settings);

    if (target === 'pdf') {
        await savePdf(html, tr('printService.shareLabelsTitle'));
        return;
    }

    if (target === 'bluetooth') {
        const driver = requireDriver();
        if (!settings.printerAddress) {
            throw new Error(tr('printService.noPrinterSelected'));
        }
        const nodes = buildLabelNodes(products, settings);
        const result = await driver.default.print(settings.printerAddress, nodes, {
            paperWidthMm: settings.paperWidth,
            disableCutPaper: !settings.autoCut,
            timeout: 15000,
        });
        if (!result.success) {
            throw new Error(result.error?.message || tr('printService.rejectedLabels'));
        }
        return;
    }

    await Print.printAsync({ html });
}

export function saveLabelsPdf(
    products: LabelProduct[],
    options?: PrintOptions
): Promise<void> {
    return printProductLabels(products, { ...options, target: 'pdf' });
}

/** Backwards-compatible alias for the previous single-label entry point. */
export const printProductLabel = printProductLabels;

// ---------------------------------------------------------------------------
// Bluetooth printer management (used by the Printer Settings screen)
// ---------------------------------------------------------------------------

export async function scanBluetoothPrinters() {
    return requireDriver().default.scan();
}

export async function testBluetoothPrinter(settings: PrintSettings): Promise<void> {
    const driver = requireDriver();
    if (!settings.printerAddress) {
        throw new Error(tr('printService.noPrinter'));
    }
    const params = await driver.default.testConnection(settings.printerAddress);
    if (!params.success) {
        throw new Error(params.error?.message || tr('printService.couldNotReach'));
    }

    const sample: Order = {
        id: 'TEST-0000',
        date: new Date().toISOString(),
        customer_id: null,
        customer_name: 'Test Print',
        total_amount: 100,
        discount: 0,
        tax: 0,
        final_amount: 100,
        payment_mode: 'cash',
    };
    const items: OrderItem[] = [
        {
            id: 'test',
            order_id: 'TEST-0000',
            product_id: 'test',
            product_name: 'Sample item',
            size: 'M',
            quantity: 1,
            price: 100,
        },
    ];
    const nodes = buildInvoiceNodes(sample, items, settings);
    const result = await driver.default.print(settings.printerAddress, nodes, {
        paperWidthMm: settings.paperWidth,
        disableCutPaper: !settings.autoCut,
        timeout: 15000,
    });
    if (!result.success) {
        throw new Error(result.error?.message || tr('printService.testFailed'));
    }
}
