import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { Session } from '@supabase/supabase-js';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../src/constants/theme';
import AppButton from '../src/components/AppButton';
import AppInput from '../src/components/AppInput';
import AppCard from '../src/components/AppCard';
import { useLanguage } from '../src/i18n';
import { CLOUD_SYNC_ENABLED } from '../src/sync/config';
import { supabase } from '../src/sync/client';
import { setActiveShop } from '../src/sync/activeShop';
import { closeDatabase } from '../src/database/db';
import {
    clearOutbox,
    enqueueLocalSnapshot,
    getSyncStatus,
    syncNow,
    SyncStatus,
} from '../src/sync/engine';

interface CloudShop {
    id: string;
    name: string;
    invite_code: string;
    owner_id: string;
}

type ActivateMode = 'upload' | 'pull' | 'sync';

function errorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as { message?: string }).message);
    }
    return String(error);
}

export default function CloudSyncScreen() {
    const router = useRouter();
    const { t } = useLanguage();

    const [session, setSession] = useState<Session | null>(null);
    const [initialising, setInitialising] = useState(true);
    const [busy, setBusy] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [shops, setShops] = useState<CloudShop[]>([]);
    const [shopName, setShopName] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [status, setStatus] = useState<SyncStatus | null>(null);

    const refreshStatus = useCallback(async () => {
        try {
            setStatus(await getSyncStatus());
        } catch {
            // Status is best-effort; the action buttons surface real errors.
        }
    }, []);

    const loadShops = useCallback(async () => {
        if (!supabase) return;
        const { data, error } = await supabase
            .from('shops')
            .select('id, name, invite_code, owner_id')
            .order('created_at', { ascending: true });
        if (error) throw new Error(error.message);
        setShops((data ?? []) as CloudShop[]);
    }, []);

    useEffect(() => {
        if (!supabase) {
            setInitialising(false);
            void refreshStatus();
            return;
        }

        let mounted = true;
        supabase.auth.getSession().then(({ data }) => {
            if (!mounted) return;
            setSession(data.session);
            setInitialising(false);
        });

        const { data: subscription } = supabase.auth.onAuthStateChange(
            (_event, nextSession) => {
                setSession(nextSession);
            }
        );

        return () => {
            mounted = false;
            subscription.subscription.unsubscribe();
        };
    }, [refreshStatus]);

    useEffect(() => {
        (async () => {
            if (session) {
                try {
                    await loadShops();
                } catch (error) {
                    Alert.alert(t('cloud.error'), errorMessage(error));
                }
            } else {
                setShops([]);
            }
            await refreshStatus();
        })();
    }, [session, loadShops, refreshStatus, t]);

    const handleAuth = async () => {
        if (!supabase) return;
        const cleanEmail = email.trim();
        if (!cleanEmail || password.length < 6) {
            Alert.alert(t('cloud.error'), 'Enter an email and a password of at least 6 characters.');
            return;
        }

        setBusy(true);
        try {
            if (session) return;
            const { data, error } = await supabase.auth.signInWithPassword({
                email: cleanEmail,
                password,
            });
            if (error) throw error;
            setSession(data.session);
            setPassword('');
        } catch (error) {
            Alert.alert(t('cloud.error'), errorMessage(error));
        } finally {
            setBusy(false);
        }
    };

    const handleSignUp = async () => {
        if (!supabase) return;
        const cleanEmail = email.trim();
        if (!cleanEmail || password.length < 6) {
            Alert.alert(t('cloud.error'), 'Enter an email and a password of at least 6 characters.');
            return;
        }

        setBusy(true);
        try {
            const { data, error } = await supabase.auth.signUp({
                email: cleanEmail,
                password,
            });
            if (error) throw error;
            setPassword('');
            if (!data.session) {
                Alert.alert(t('cloud.success'), t('cloud.checkEmail'));
            }
        } catch (error) {
            Alert.alert(t('cloud.error'), errorMessage(error));
        } finally {
            setBusy(false);
        }
    };

    const handleSignOut = async () => {
        if (!supabase) return;
        setBusy(true);
        try {
            await supabase.auth.signOut();
            setSession(null);
            setShops([]);
            await refreshStatus();
        } catch (error) {
            Alert.alert(t('cloud.error'), errorMessage(error));
        } finally {
            setBusy(false);
        }
    };

    const activate = async (shop: CloudShop, mode: ActivateMode) => {
        await setActiveShop({ id: shop.id, name: shop.name });
        await closeDatabase();

        if (mode === 'upload') {
            await enqueueLocalSnapshot();
        } else if (mode === 'pull') {
            await clearOutbox();
        }

        const next = await syncNow();
        await refreshStatus();
        if (next.lastError) {
            Alert.alert(
                t('cloud.error'),
                t('cloud.syncFailed', { message: next.lastError })
            );
        }
    };

    const handleCreateShop = async () => {
        if (!supabase) return;
        const name = shopName.trim();
        if (!name) {
            Alert.alert(t('cloud.error'), t('cloud.shopName'));
            return;
        }

        setBusy(true);
        try {
            const { data, error } = await supabase.rpc('create_shop', { p_name: name });
            if (error) throw error;
            const shop = data as CloudShop;
            setShopName('');
            await loadShops();
            await activate(shop, 'upload');
            Alert.alert(t('cloud.success'), shop.name);
        } catch (error) {
            Alert.alert(t('cloud.error'), errorMessage(error));
        } finally {
            setBusy(false);
        }
    };

    const joinShop = async (mode: 'pull' | 'upload') => {
        if (!supabase) return;
        const code = inviteCode.trim();
        if (!code) {
            Alert.alert(t('cloud.error'), t('cloud.inviteCode'));
            return;
        }

        setBusy(true);
        try {
            const { data, error } = await supabase.rpc('join_shop', {
                p_invite_code: code,
            });
            if (error) throw error;
            const shop = data as CloudShop;
            setInviteCode('');
            await loadShops();
            await activate(shop, mode);
            Alert.alert(t('cloud.success'), shop.name);
        } catch (error) {
            Alert.alert(t('cloud.error'), errorMessage(error));
        } finally {
            setBusy(false);
        }
    };

    const confirmJoin = (mode: 'pull' | 'upload') => {
        Alert.alert(
            t('cloud.joinShop'),
            t(mode === 'pull' ? 'cloud.joinPullConfirm' : 'cloud.joinUploadConfirm'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('cloud.joinShop'), onPress: () => void joinShop(mode) },
            ]
        );
    };

    const handleUseShop = (shop: CloudShop) => {
        if (status?.shopId === shop.id) return;
        Alert.alert(
            t('cloud.useShop'),
            t('cloud.switchConfirm', { name: shop.name }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('cloud.useShop'),
                    onPress: async () => {
                        setBusy(true);
                        try {
                            await activate(shop, 'sync');
                        } catch (error) {
                            Alert.alert(t('cloud.error'), errorMessage(error));
                        } finally {
                            setBusy(false);
                        }
                    },
                },
            ]
        );
    };

    const handleSync = async () => {
        setBusy(true);
        try {
            const next = await syncNow();
            await refreshStatus();
            if (next.lastError) {
                Alert.alert(
                    t('cloud.error'),
                    t('cloud.syncFailed', { message: next.lastError })
                );
            } else {
                Alert.alert(t('cloud.success'), t('cloud.syncNow'));
            }
        } finally {
            setBusy(false);
        }
    };

    const shareInvite = async (shop: CloudShop) => {
        await Share.share({
            message: `${shop.name} — ${t('cloud.inviteCode')}: ${shop.invite_code}`,
        });
    };

    if (initialising) {
        return (
            <SafeAreaView style={styles.container} edges={['top']}>
                <View style={styles.loading}>
                    <ActivityIndicator color={Colors.primary} />
                </View>
            </SafeAreaView>
        );
    }

    const activeShop = shops.find((shop) => shop.id === status?.shopId) ?? null;

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={Colors.text} />
                </TouchableOpacity>
                <Text style={styles.title}>{t('cloud.title')}</Text>
                <View style={{ width: 24 }} />
            </View>

            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.scroll}
                    keyboardShouldPersistTaps="handled"
                    automaticallyAdjustKeyboardInsets
                >
                    <Text style={styles.subtitle}>{t('cloud.subtitle')}</Text>

                    {!CLOUD_SYNC_ENABLED || !supabase ? (
                        <AppCard style={styles.card}>
                            <Text style={styles.sectionTitle}>{t('cloud.configureTitle')}</Text>
                            <Text style={styles.body}>{t('cloud.configureBody')}</Text>
                        </AppCard>
                    ) : !session ? (
                        <AppCard style={styles.card}>
                            <Text style={styles.sectionTitle}>{t('cloud.accountRequired')}</Text>
                            <AppInput
                                label={t('cloud.email')}
                                value={email}
                                onChangeText={setEmail}
                                placeholder="you@example.com"
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            <AppInput
                                label={t('cloud.password')}
                                value={password}
                                onChangeText={setPassword}
                                placeholder="••••••••"
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            <View style={styles.buttonRow}>
                                <AppButton
                                    title={t('cloud.signIn')}
                                    onPress={handleAuth}
                                    loading={busy}
                                    style={styles.flexButton}
                                />
                                <AppButton
                                    title={t('cloud.signUp')}
                                    onPress={handleSignUp}
                                    variant="secondary"
                                    disabled={busy}
                                    style={styles.flexButton}
                                />
                            </View>
                            <Text style={styles.note}>{t('cloud.localOnlyNote')}</Text>
                        </AppCard>
                    ) : (
                        <>
                            <AppCard style={styles.card}>
                                <View style={styles.accountRow}>
                                    <View style={styles.accountInfo}>
                                        <Text style={styles.accountLabel}>
                                            {session.user.email}
                                        </Text>
                                        <Text style={styles.note}>{t('cloud.localOnlyNote')}</Text>
                                    </View>
                                    <AppButton
                                        title={t('cloud.signOut')}
                                        onPress={handleSignOut}
                                        variant="ghost"
                                        size="sm"
                                        disabled={busy}
                                    />
                                </View>
                            </AppCard>

                            {activeShop ? (
                                <AppCard style={styles.activeCard}>
                                    <View style={styles.activeHeader}>
                                        <View style={styles.flex}>
                                            <Text style={styles.activeLabel}>{t('cloud.active')}</Text>
                                            <Text style={styles.activeName}>{activeShop.name}</Text>
                                        </View>
                                        <View style={styles.activeDot} />
                                    </View>
                                    <Text style={styles.inviteText}>
                                        {t('cloud.invite', { code: activeShop.invite_code })}
                                    </Text>
                                    <Text style={styles.note}>
                                        {status?.pending
                                            ? t('cloud.pending', { count: status.pending })
                                            : t('cloud.lastSync', {
                                                  time: status?.lastSyncedAt
                                                      ? new Date(status.lastSyncedAt).toLocaleString()
                                                      : t('cloud.never'),
                                              })}
                                    </Text>
                                    {status?.lastError ? (
                                        <Text style={styles.errorText}>{status.lastError}</Text>
                                    ) : null}
                                    <View style={styles.buttonRow}>
                                        <AppButton
                                            title={busy ? t('cloud.syncing') : t('cloud.syncNow')}
                                            onPress={handleSync}
                                            loading={busy}
                                            style={styles.flexButton}
                                        />
                                        <AppButton
                                            title={t('cloud.shareInvite')}
                                            onPress={() => void shareInvite(activeShop)}
                                            variant="secondary"
                                            disabled={busy}
                                            style={styles.flexButton}
                                        />
                                    </View>
                                </AppCard>
                            ) : null}

                            <Text style={styles.sectionTitle}>{t('cloud.shops')}</Text>
                            {shops.length === 0 ? (
                                <AppCard>
                                    <Text style={styles.body}>{t('cloud.noShops')}</Text>
                                </AppCard>
                            ) : (
                                shops.map((shop) => {
                                    const active = shop.id === status?.shopId;
                                    return (
                                        <AppCard key={shop.id} style={styles.shopCard}>
                                            <View style={styles.shopRow}>
                                                <View style={styles.shopIcon}>
                                                    <Ionicons
                                                        name="storefront-outline"
                                                        size={18}
                                                        color={Colors.primary}
                                                    />
                                                </View>
                                                <View style={styles.flex}>
                                                    <Text style={styles.shopName}>{shop.name}</Text>
                                                    <Text style={styles.shopMeta}>
                                                        {t('cloud.invite', {
                                                            code: shop.invite_code,
                                                        })}
                                                    </Text>
                                                </View>
                                                {active ? (
                                                    <View style={styles.activePill}>
                                                        <Text style={styles.activePillText}>
                                                            {t('cloud.active')}
                                                        </Text>
                                                    </View>
                                                ) : (
                                                    <AppButton
                                                        title={t('cloud.useShop')}
                                                        onPress={() => handleUseShop(shop)}
                                                        variant="secondary"
                                                        size="sm"
                                                        disabled={busy}
                                                    />
                                                )}
                                            </View>
                                        </AppCard>
                                    );
                                })
                            )}
                            <Text style={styles.note}>{t('cloud.mergeNote')}</Text>

                            <AppCard style={styles.card}>
                                <Text style={styles.sectionTitle}>{t('cloud.createShop')}</Text>
                                <AppInput
                                    label={t('cloud.shopName')}
                                    value={shopName}
                                    onChangeText={setShopName}
                                    placeholder="My Shop"
                                />
                                <AppButton
                                    title={t('cloud.create')}
                                    onPress={handleCreateShop}
                                    loading={busy}
                                />
                            </AppCard>

                            <AppCard style={styles.card}>
                                <Text style={styles.sectionTitle}>{t('cloud.joinShop')}</Text>
                                <AppInput
                                    label={t('cloud.inviteCode')}
                                    value={inviteCode}
                                    onChangeText={setInviteCode}
                                    placeholder="ABC12345"
                                    autoCapitalize="characters"
                                    autoCorrect={false}
                                />
                                <View style={styles.buttonRow}>
                                    <AppButton
                                        title={t('cloud.joinPull')}
                                        onPress={() => confirmJoin('pull')}
                                        variant="secondary"
                                        disabled={busy}
                                        style={styles.flexButton}
                                    />
                                    <AppButton
                                        title={t('cloud.joinUpload')}
                                        onPress={() => confirmJoin('upload')}
                                        disabled={busy}
                                        style={styles.flexButton}
                                    />
                                </View>
                            </AppCard>
                        </>
                    )}

                    <View style={styles.bottomSpacer} />
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    flex: { flex: 1 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
    },
    backBtn: { padding: Spacing.xs },
    title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    scroll: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl },
    subtitle: {
        color: Colors.textSecondary,
        fontSize: FontSize.md,
        marginBottom: Spacing.xl,
        lineHeight: 22,
    },
    card: { marginBottom: Spacing.lg, padding: Spacing.lg },
    sectionTitle: {
        color: Colors.text,
        fontSize: FontSize.md,
        fontWeight: FontWeight.semibold,
        marginBottom: Spacing.md,
    },
    body: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20 },
    note: {
        color: Colors.textMuted,
        fontSize: FontSize.xs,
        lineHeight: 18,
        marginTop: Spacing.sm,
    },
    buttonRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
    flexButton: { flex: 1 },
    accountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    accountInfo: { flex: 1 },
    accountLabel: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
    activeCard: {
        marginBottom: Spacing.lg,
        padding: Spacing.lg,
        borderWidth: 1,
        borderColor: Colors.primary,
    },
    activeHeader: { flexDirection: 'row', alignItems: 'center' },
    activeLabel: {
        color: Colors.primary,
        fontSize: FontSize.xs,
        fontWeight: FontWeight.bold,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
    },
    activeName: {
        color: Colors.text,
        fontSize: FontSize.lg,
        fontWeight: FontWeight.bold,
        marginTop: Spacing.xs,
    },
    activeDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: Colors.success,
    },
    inviteText: {
        color: Colors.textSecondary,
        fontSize: FontSize.sm,
        marginTop: Spacing.sm,
    },
    errorText: {
        color: Colors.danger,
        fontSize: FontSize.xs,
        marginTop: Spacing.sm,
        lineHeight: 18,
    },
    shopCard: { marginBottom: Spacing.sm, padding: Spacing.md },
    shopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    shopIcon: {
        width: 36,
        height: 36,
        borderRadius: BorderRadius.md,
        backgroundColor: Colors.successBg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    shopName: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    shopMeta: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 },
    activePill: {
        backgroundColor: Colors.successBg,
        borderRadius: BorderRadius.full,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
    },
    activePillText: {
        color: Colors.primary,
        fontSize: FontSize.xs,
        fontWeight: FontWeight.semibold,
    },
    bottomSpacer: { height: Spacing.xxl },
});
