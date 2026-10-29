import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { getSetting, setSetting } from '../database/queries/settingsQueries';
import { Colors } from '../constants/theme';
import { Language, LANGUAGES } from './translations';
import { setRuntimeLanguage, translate } from './runtime';

interface LanguageContextValue {
    language: Language;
    t: (key: string, params?: Record<string, string | number>) => string;
    setLanguage: (language: Language) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
    language: 'en',
    t: (key) => key,
    setLanguage: async () => {},
});

export function useLanguage(): LanguageContextValue {
    return useContext(LanguageContext);
}

const LANGUAGE_SETTING_KEY = 'language';

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [language, setLanguageState] = useState<Language>('en');
    const [loaded, setLoaded] = useState(false);

    // Load the saved language once; the DB is already open by RootLayout.
    useEffect(() => {
        (async () => {
            try {
                const saved = await getSetting(LANGUAGE_SETTING_KEY);
                if (saved === 'en' || saved === 'bn') {
                    setLanguageState(saved);
                    setRuntimeLanguage(saved);
                }
            } catch {
                // Keep the default language if the DB read fails.
            }
            setLoaded(true);
        })();
    }, []);

    const setLanguage = useCallback(async (next: Language) => {
        setLanguageState(next);
        setRuntimeLanguage(next);
        try {
            await setSetting(LANGUAGE_SETTING_KEY, next);
        } catch {
            // Persisting is best-effort; the UI language still updates.
        }
    }, []);

    const t = useCallback(
        (key: string, params?: Record<string, string | number>) =>
            translate(language, key, params),
        [language]
    );

    const value = useMemo(
        () => ({ language, t, setLanguage }),
        [language, t, setLanguage]
    );

    if (!loaded) {
        return (
            <View style={styles.loading}>
                <ActivityIndicator size="large" color={Colors.primary} />
            </View>
        );
    }

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export { LANGUAGES };
export type { Language };

const styles = StyleSheet.create({
    loading: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Colors.background,
    },
});