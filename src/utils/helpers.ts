import { getRuntimeLanguage } from '../i18n/runtime';

const BN_DIGITS: Record<string, string> = {
    '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
    '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
};

const BN_MONTHS_SHORT: Record<string, string> = {
    Jan: 'জানু', Feb: 'ফেব্রু', Mar: 'মার্চ', Apr: 'এপ্রি', May: 'মে', Jun: 'জুন',
    Jul: 'জুলা', Aug: 'আগ', Sep: 'সেপ্টে', Oct: 'অক্টো', Nov: 'নভে', Dec: 'ডিসে',
};

function isBengali(): boolean {
    return getRuntimeLanguage() === 'bn';
}

/** Convert ASCII digits inside a string to Bengali digits when in Bengali. */
export function localizeDigits(value: string): string {
    if (!isBengali()) return value;
    return value.replace(/[0-9]/g, (d) => BN_DIGITS[d]);
}

/**
 * Encode an amount into a mnemonic letter code so the cost price stays hidden
 * on printed labels. The code word's letters map to digits 1..9,0 in order —
 * with the default `GROUNDSALE`, 480 becomes UAE (U=4, A=8, E=0). Falls back
 * to the default word when the configured word isn't exactly 10 letters.
 */
export function encodeCostCode(amount: number, codeWord?: string): string {
    const word = (codeWord ?? '').trim().toUpperCase();
    const code = /^[A-Z]{10}$/.test(word) ? word : 'GROUNDSALE';
    const digits = String(Math.trunc(Math.abs(amount)));
    return [...digits].map((d) => code[(Number(d) + 9) % 10]).join('') || '' ;
}

export function generateBarcode(): string {
    const prefix = 'BC';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

export function formatCurrency(amount: number): string {
    return `₹${localizeDigits(amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}`;
}

export function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    let formatted = date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
    if (isBengali()) {
        for (const [en, bn] of Object.entries(BN_MONTHS_SHORT)) {
            formatted = formatted.replace(en, bn);
        }
    }
    return localizeDigits(formatted);
}

/** Short date such as `12 Oct` — localized digits and month names. */
export function formatShortDate(dateStr: string): string {
    const date = new Date(dateStr);
    let formatted = date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
    });
    if (isBengali()) {
        for (const [en, bn] of Object.entries(BN_MONTHS_SHORT)) {
            formatted = formatted.replace(en, bn);
        }
    }
    return localizeDigits(formatted);
}

export function formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    return localizeDigits(
        date.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
        })
    );
}

export function getTodayISO(): string {
    return new Date().toISOString().split('T')[0];
}