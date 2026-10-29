import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/constants/theme';
import AppCard from '../../src/components/AppCard';
import EmptyState from '../../src/components/EmptyState';
import { getDailySales, getMonthlySales, getTopSellingProducts } from '../../src/database/queries/orderQueries';
import { formatCurrency, getTodayISO } from '../../src/utils/helpers';
import { useLanguage } from '../../src/i18n';
import { SalesSummary, TopProduct } from '../../src/types/models';

type Period = 'daily' | 'monthly';

export default function ReportsScreen() {
    const { t } = useLanguage();
    const [period, setPeriod] = useState<Period>('daily');
    const [sales, setSales] = useState<SalesSummary>({ total_sales: 0, total_orders: 0, total_items: 0 });
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);

    const loadData = useCallback(async () => {
        const now = new Date();
        let s: SalesSummary;
        if (period === 'daily') {
            s = await getDailySales(getTodayISO());
        } else {
            s = await getMonthlySales(now.getFullYear(), now.getMonth() + 1);
        }
        setSales(s);
        const top = await getTopSellingProducts(10);
        setTopProducts(top);
    }, [period]);

    useFocusEffect(
        useCallback(() => {
            loadData();
        }, [loadData])
    );

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                <Text style={styles.title}>{t('reports.title')}</Text>

                {/* Period Toggle */}
                <View style={styles.toggle}>
                    <TouchableOpacity
                        style={[styles.toggleBtn, period === 'daily' && styles.toggleBtnActive]}
                        onPress={() => setPeriod('daily')}
                    >
                        <Text style={[styles.toggleText, period === 'daily' && styles.toggleTextActive]}>
                            {t('reports.today')}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.toggleBtn, period === 'monthly' && styles.toggleBtnActive]}
                        onPress={() => setPeriod('monthly')}
                    >
                        <Text style={[styles.toggleText, period === 'monthly' && styles.toggleTextActive]}>
                            {t('reports.thisMonth')}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Stats Cards */}
                <View style={styles.statsRow}>
                    <AppCard style={styles.statCard}>
                        <View style={[styles.statIcon, { backgroundColor: Colors.successBg }]}>
                            <Ionicons name="cash" size={22} color={Colors.success} />
                        </View>
                        <Text style={styles.statValue}>{formatCurrency(sales.total_sales)}</Text>
                        <Text style={styles.statLabel}>{t('reports.revenue')}</Text>
                    </AppCard>
                    <AppCard style={styles.statCard}>
                        <View style={[styles.statIcon, { backgroundColor: 'rgba(108,92,231,0.15)' }]}>
                            <Ionicons name="receipt" size={22} color={Colors.primary} />
                        </View>
                        <Text style={styles.statValue}>{sales.total_orders}</Text>
                        <Text style={styles.statLabel}>{t('reports.orders')}</Text>
                    </AppCard>
                </View>

                <View style={styles.statsRow}>
                    <AppCard style={styles.statCard}>
                        <View style={[styles.statIcon, { backgroundColor: 'rgba(245,166,35,0.15)' }]}>
                            <Ionicons name="cube" size={22} color={Colors.accent} />
                        </View>
                        <Text style={styles.statValue}>{sales.total_items}</Text>
                        <Text style={styles.statLabel}>{t('reports.itemsSold')}</Text>
                    </AppCard>
                    <AppCard style={styles.statCard}>
                        <View style={[styles.statIcon, { backgroundColor: 'rgba(0,149,255,0.15)' }]}>
                            <Ionicons name="trending-up" size={22} color={Colors.info} />
                        </View>
                        <Text style={styles.statValue}>
                            {sales.total_orders > 0
                                ? formatCurrency(sales.total_sales / sales.total_orders)
                                : formatCurrency(0)}
                        </Text>
                        <Text style={styles.statLabel}>{t('reports.avgOrder')}</Text>
                    </AppCard>
                </View>

                {/* Top Products */}
                <Text style={styles.sectionTitle}>🏆 {t('reports.topSelling')}</Text>
                {topProducts.length === 0 ? (
                    <EmptyState icon="trophy-outline" title={t('reports.noData')} subtitle={t('reports.salesAppear')} />
                ) : (
                    topProducts.map((product, idx) => (
                        <AppCard key={product.product_id} style={styles.topCard}>
                            <View style={styles.topRow}>
                                <View style={[styles.rank, idx < 3 && styles.rankTop]}>
                                    <Text style={[styles.rankText, idx < 3 && styles.rankTextTop]}>#{idx + 1}</Text>
                                </View>
                                <View style={styles.topInfo}>
                                    <Text style={styles.topName}>{product.product_name}</Text>
                                    <Text style={styles.topSold}>
                                        {t('reports.unitsSold', { n: product.total_sold })}
                                    </Text>
                                </View>
                                <Text style={styles.topRevenue}>{formatCurrency(product.total_revenue)}</Text>
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
    container: { flex: 1, backgroundColor: Colors.background },
    scrollContent: { paddingHorizontal: Spacing.xl },
    title: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: FontWeight.bold, marginTop: Spacing.lg, marginBottom: Spacing.lg },
    toggle: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: 4, marginBottom: Spacing.xl, borderWidth: 1, borderColor: Colors.border },
    toggleBtn: { flex: 1, paddingVertical: Spacing.md, borderRadius: BorderRadius.sm, alignItems: 'center' },
    toggleBtnActive: { backgroundColor: Colors.primary },
    toggleText: { color: Colors.textMuted, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    toggleTextActive: { color: '#fff' },
    statsRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md },
    statCard: { flex: 1, alignItems: 'center' },
    statIcon: { width: 44, height: 44, borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
    statValue: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    statLabel: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 2 },
    sectionTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, marginTop: Spacing.xxl, marginBottom: Spacing.md },
    topCard: { marginBottom: Spacing.sm },
    topRow: { flexDirection: 'row', alignItems: 'center' },
    rank: { width: 36, height: 36, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
    rankTop: { backgroundColor: 'rgba(245,166,35,0.15)' },
    rankText: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
    rankTextTop: { color: Colors.accent },
    topInfo: { flex: 1 },
    topName: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
    topSold: { color: Colors.textMuted, fontSize: FontSize.sm },
    topRevenue: { color: Colors.success, fontSize: FontSize.md, fontWeight: FontWeight.bold },
    bottomSpacer: { height: Spacing.xxxl },
});