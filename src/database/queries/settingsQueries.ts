import { getDatabase } from '../db';
import { PrintSettings, DEFAULT_PRINT_SETTINGS } from '../../types/models';

const PRINT_SETTINGS_KEY = 'print_settings';

export async function getSetting(key: string): Promise<string | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
        'SELECT value FROM settings WHERE key = ?',
        [key]
    );
    return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        [key, value]
    );
}

export async function getPrintSettings(): Promise<PrintSettings> {
    const raw = await getSetting(PRINT_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_PRINT_SETTINGS };
    try {
        const parsed = JSON.parse(raw) as Partial<PrintSettings>;
        return { ...DEFAULT_PRINT_SETTINGS, ...parsed };
    } catch {
        return { ...DEFAULT_PRINT_SETTINGS };
    }
}

export async function savePrintSettings(settings: PrintSettings): Promise<void> {
    await setSetting(PRINT_SETTINGS_KEY, JSON.stringify(settings));
}
