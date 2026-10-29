import { translations, Language } from './translations';

/**
 * Module-level current language, kept in sync by LanguageProvider.
 * Lets non-component code (e.g. print templates, helpers) translate and
 * format numbers without needing React context.
 */
let currentLanguage: Language = 'en';

export function setRuntimeLanguage(language: Language): void {
    currentLanguage = language;
}

export function getRuntimeLanguage(): Language {
    return currentLanguage;
}

/** Translate a key, falling back to English, then to the raw key. */
export function translate(
    language: Language,
    key: string,
    params?: Record<string, string | number>
): string {
    const table = translations[language] ?? translations.en;
    let text = table[key] ?? translations.en[key] ?? key;
    if (params) {
        for (const [name, value] of Object.entries(params)) {
            text = text.split(`{${name}}`).join(String(value));
        }
    }
    return text;
}

/** Translation helper bound to the current runtime language (for non-React code). */
export function getT() {
    return (key: string, params?: Record<string, string | number>) =>
        translate(getRuntimeLanguage(), key, params);
}