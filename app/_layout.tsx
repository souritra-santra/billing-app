import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppState, View, ActivityIndicator, StyleSheet } from 'react-native';
import { getDatabase } from '../src/database/db';
import { syncNow } from '../src/sync/engine';
import { Colors } from '../src/constants/theme';
import { LanguageProvider } from '../src/i18n';

export default function RootLayout() {
    const [dbReady, setDbReady] = useState(false);

    useEffect(() => {
        (async () => {
            await getDatabase();
            setDbReady(true);
            // Best-effort background sync. It is a no-op when no cloud shop is
            // linked, and failures are surfaced on the Cloud Sync screen.
            void syncNow().catch(() => {});
        })();
    }, []);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
                void syncNow().catch(() => {});
            }
        });
        return () => subscription.remove();
    }, []);

    if (!dbReady) {
        return (
            <View style={styles.loading}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <StatusBar style="light" />
            </View>
        );
    }

    return (
        <LanguageProvider>
            <StatusBar style="light" />
            <Stack
                screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: Colors.background },
                    animation: 'slide_from_right',
                }}
            />
        </LanguageProvider>
    );
}

const styles = StyleSheet.create({
    loading: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Colors.background,
    },
});