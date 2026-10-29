import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadows } from '../../src/constants/theme';
import AppCard from '../../src/components/AppCard';
import { getDailySales, getRecentOrders } from '../../src/database/queries/orderQueries';
import { getLowStockProducts } from '../../src/database/queries/inventoryQueries';
import { getAllProducts } from '../../src/database/queries/productQueries';
import { getAllCustomers } from '../../src/database/queries/customerQueries';
import { formatCurrency, formatShortDate, getTodayISO } from '../../src/utils/helpers';
import { useLanguage } from '../../src/i18n';
import { Order, SalesSummary } from '../../src/types/models';

type IconName = keyof typeof Ionicons.glyphMap;

const QUICK_ACTIONS: { icon: IconName; labelKey: string; route: string; color: string; bg: string }[] = [
    { icon: 'receipt', labelKey: 'dashboard.newBill', route: '/(tabs)/billing', color: Colors.primary, bg: 'rgba(108,92,231,0.15)' },
    { icon: 'add-circle', labelKey: 'dashboard.addProduct', route: '/add-product', color: Colors.success, bg: Colors.successBg },
    { icon: 'scan', labelKey: 'dashboard.scan', route: '/scanner', color: Colors.accent, bg: 'rgba(245,166,35,0.15)' },
    { icon: 'sparkles', labelKey: 'dashboard.aiImport', route: '/ai-import', color: Colors.primaryLight, bg: 'rgba(108,92,231,0.16)' },
    { icon: 'people', labelKey: 'dashboard.customers', route: '/(tabs)/customers', color: Colors.info, bg: 'rgba(0,149,255,0.15)' },
];

export default function DashboardScreen() {
    const router = useRouter();
    const { t } = useLanguage();
    const [sales, setSales] = useState<SalesSummary>({ total_sales: 0, total_orders: 0, total_items: 0 });
    const [recentOrders, setRecentOrders] = useState<Order[]>([]);
    const [lowStock, setLowStock] = useState<any[]>([]);
    const [productCount, setProductCount] = useState(0);
    const [customerCount, setCustomerCount] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    const loadData = useCallback(async () => {
        const [s, orders, low, prods, custs] = await Promise.all([
            getDailySales(getTodayISO()),
            getRecentOrders(5),
            getLowStockProducts(5),
            getAllProducts(),
            getAllCustomers(),
        ]);
        setSales(s);
        setRecentOrders(orders);
        setLowStock(low);
        setProductCount(prods.length);
        setCustomerCount(custs.length);
    }, []);

    useFocusEffect(
        useCallback(() => {
            loadData();
        }, [loadData])
    );

    const onRefresh = async () => {
        setRefreshing(true);
        await loadData();
        setRefreshing(false);
    };

    const payLabel = (mode: string) =>
        mode === 'card' ? t('payment.card') : mode === 'upi' ? t('payment.upi') : t('payment.cash');

    const todayBadge = formatShortDate(new Date().toISOString());

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
            >
                {/* Header */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.greeting}>{t('dashboard.welcomeBack')}</Text>
                        <Text style={styles.title}>{t('dashboard.title')}</Text>
                    </View>
                    <View style={styles.headerRight}>
                        <View style={styles.dateBadge}>
                            <Ionicons name="calendar-outline" size={14} color={Colors.textSecondary} />
                            <Text style={styles.dateText}>
                                {todayBadge}
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={styles.settingsBtn}
                            activeOpacity={0.7}
                            onPress={() => router.push('/cloud-sync' as any)}
                        >
                            <Ionicons name="cloud-outline" size={20} color={Colors.text} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.settingsBtn}
                            activeOpacity={0.7}
                            onPress={() => router.push('/printer-settings' as any)}
                        >
                            <Ionicons name="settings-outline" size={20} color={Colors.text} />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Today's Sales Card */}
                <View style={styles.salesCard}>
                    <View style={styles.salesHeader}>
                        <Text style={styles.salesLabel}>{t('dashboard.todayRevenue')}</Text>
                        <View style={styles.liveDot} />
                    </View>
                    <Text style={styles.salesAmount}>{formatCurrency(sales.total_sales)}</Text>
                    <View style={styles.salesStats}>
                        <View style={styles.stat}>
                            <Text style={styles.statValue}>{sales.total_orders}</Text>
                            <Text style={styles.statLabel}>{t('dashboard.orders')}</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.stat}>
                            <Text style={styles.statValue}>{sales.total_items}</Text>
                            <Text style={styles.statLabel}>{t('dashboard.itemsSold')}</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.stat}>
                            <Text style={styles.statValue}>{productCount}</Text>
                            <Text style={styles.statLabel}>{t('dashboard.products')}</Text>
                        </View>
                    </View>
                </View>

                {/* Quick Actions */}
                <Text style={styles.sectionTitle}>{t('dashboard.quickActions')}</Text>
                <View style={styles.actionsGrid}>
                    {QUICK_ACTIONS.map((action) => (
                        <TouchableOpacity
                            key={action.labelKey}
                            style={styles.actionCard}
                            activeOpacity={0.7}
                            onPress={() => router.push(action.route as any)}
                        >
                            <View style={[styles.actionIcon, { backgroundColor: action.bg }]}>
                                <Ionicons name={action.icon} size={22} color={action.color} />
                            </View>
                            <Text style={styles.actionLabel}>{t(action.labelKey)}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Low Stock Alert */}
                {lowStock.length > 0 && (
                    <>
                        <Text style={styles.sectionTitle}>⚠️ {t('dashboard.lowStock')}</Text>
                        <AppCard style={styles.alertCard}>
                            {lowStock.slice(0, 3).map((item, idx) => (
                                <View key={idx} style={[styles.alertRow, idx > 0 && styles.alertRowBorder]}>
                                    <View style={styles.alertInfo}>
                                        <Text style={styles.alertProduct}>{item.name}</Text>
                                        <Text style={styles.alertSize}>{t('dashboard.sizeWarn', { size: item.size })}</Text>
                                    </View>
                                    <View style={styles.alertQty}>
                                        <Text style={styles.alertQtyText}>{t('dashboard.left', { qty: item.quantity })}</Text>
                                    </View>
                                </View>
                            ))}
                        </AppCard>
                    </>
                )}

                {/* Recent Orders */}
                <Text style={styles.sectionTitle}>{t('dashboard.recentTransactions')}</Text>
                {recentOrders.length === 0 ? (
                    <AppCard>
                        <Text style={styles.emptyText}>{t('dashboard.noTransactions')}</Text>
                    </AppCard>
                ) : (
                    recentOrders.map((order) => (
                        <AppCard key={order.id} style={styles.orderCard}>
                            <View style={styles.orderRow}>
                                <View style={styles.orderIcon}>
                                    <Ionicons name="receipt" size={18} color={Colors.primary} />
                                </View>
                                <View style={styles.orderInfo}>
                                    <Text style={styles.orderCustomer}>
                                        {order.customer_name || t('dashboard.walkInCustomer')}
                                    </Text>
                                    <Text style={styles.orderDate}>{payLabel(order.payment_mode)}</Text>
                                </View>
                                <Text style={styles.orderAmount}>{formatCurrency(order.final_amount)}</Text>
                            </View>
                        </AppCard>
                    ))
                )}

                <View style={styles.bottomSpacer} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.background,
    },
    scrollContent: {
        paddingHorizontal: Spacing.xl,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginTop: Spacing.lg,
        marginBottom: Spacing.xxl,
    },
    greeting: {
        color: Colors.textSecondary,
        fontSize: FontSize.sm,
        fontWeight: FontWeight.medium,
    },
    title: {
        color: Colors.text,
        fontSize: FontSize.xxl,
        fontWeight: FontWeight.bold,
        marginTop: 2,
    },
    dateBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.surfaceLight,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: BorderRadius.full,
        gap: 6,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    settingsBtn: {
        width: 36,
        height: 36,
        borderRadius: BorderRadius.full,
        backgroundColor: Colors.surfaceLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dateText: {
        color: Colors.textSecondary,
        fontSize: FontSize.sm,
        fontWeight: FontWeight.medium,
    },
    salesCard: {
        backgroundColor: Colors.primary,
        borderRadius: BorderRadius.xl,
        padding: Spacing.xxl,
        marginBottom: Spacing.xxl,
        ...Shadows.lg,
    },
    salesHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    salesLabel: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: FontSize.sm,
        fontWeight: FontWeight.medium,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    liveDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: Colors.success,
    },
    salesAmount: {
        color: '#FFFFFF',
        fontSize: FontSize.display,
        fontWeight: FontWeight.bold,
        marginTop: Spacing.sm,
        marginBottom: Spacing.xl,
    },
    salesStats: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.12)',
        borderRadius: BorderRadius.md,
        padding: Spacing.md,
    },
    stat: {
        flex: 1,
        alignItems: 'center',
    },
    statDivider: {
        width: 1,
        height: 28,
        backgroundColor: 'rgba(255,255,255,0.2)',
    },
    statValue: {
        color: '#FFFFFF',
        fontSize: FontSize.lg,
        fontWeight: FontWeight.bold,
    },
    statLabel: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: FontSize.xs,
        fontWeight: FontWeight.medium,
        marginTop: 2,
    },
    sectionTitle: {
        color: Colors.text,
        fontSize: FontSize.lg,
        fontWeight: FontWeight.semibold,
        marginBottom: Spacing.md,
        marginTop: Spacing.sm,
    },
    actionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.md,
        marginBottom: Spacing.xxl,
    },
    actionCard: {
        width: '47%',
        backgroundColor: Colors.surface,
        borderRadius: BorderRadius.lg,
        padding: Spacing.lg,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: Colors.border,
    },
    actionIcon: {
        width: 48,
        height: 48,
        borderRadius: BorderRadius.md,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: Spacing.sm,
    },
    actionLabel: {
        color: Colors.text,
        fontSize: FontSize.sm,
        fontWeight: FontWeight.medium,
    },
    alertCard: {
        marginBottom: Spacing.xxl,
        backgroundColor: 'rgba(255, 170, 0, 0.05)',
        borderColor: 'rgba(255, 170, 0, 0.15)',
    },
    alertRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: Spacing.sm,
    },
    alertRowBorder: {
        borderTopWidth: 1,
        borderTopColor: Colors.border,
    },
    alertInfo: {
        flex: 1,
    },
    alertProduct: {
        color: Colors.text,
        fontSize: FontSize.md,
        fontWeight: FontWeight.medium,
    },
    alertSize: {
        color: Colors.textMuted,
        fontSize: FontSize.sm,
    },
    alertQty: {
        backgroundColor: Colors.warningBg,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
        borderRadius: BorderRadius.full,
    },
    alertQtyText: {
        color: Colors.warning,
        fontSize: FontSize.sm,
        fontWeight: FontWeight.semibold,
    },
    orderCard: {
        marginBottom: Spacing.sm,
    },
    orderRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    orderIcon: {
        width: 40,
        height: 40,
        borderRadius: BorderRadius.sm,
        backgroundColor: 'rgba(108,92,231,0.15)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: Spacing.md,
    },
    orderInfo: {
        flex: 1,
    },
    orderCustomer: {
        color: Colors.text,
        fontSize: FontSize.md,
        fontWeight: FontWeight.medium,
    },
    orderDate: {
        color: Colors.textMuted,
        fontSize: FontSize.sm,
    },
    orderAmount: {
        color: Colors.success,
        fontSize: FontSize.md,
        fontWeight: FontWeight.bold,
    },
    emptyText: {
        color: Colors.textMuted,
        fontSize: FontSize.sm,
        textAlign: 'center',
        paddingVertical: Spacing.lg,
    },
    bottomSpacer: {
        height: Spacing.xxxl,
    },
});