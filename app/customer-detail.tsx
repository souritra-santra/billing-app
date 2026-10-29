import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../src/constants/theme';
import AppCard from '../src/components/AppCard';
import EmptyState from '../src/components/EmptyState';
import { getCustomerById } from '../src/database/queries/customerQueries';
import { getOrdersByCustomer, getOrderItems } from '../src/database/queries/orderQueries';
import { formatCurrency, formatDate, formatTime } from '../src/utils/helpers';
import { useLanguage } from '../src/i18n';
import { Customer, Order, OrderItem } from '../src/types/models';

export default function CustomerDetailScreen() {
    const router = useRouter();
    const { t } = useLanguage();
    const { id } = useLocalSearchParams();
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [orders, setOrders] = useState<(Order & { items?: OrderItem[] })[]>([]);

    const loadData = useCallback(async () => {
        if (!id) return;
        const cid = Array.isArray(id) ? id[0] : id;
        const c = await getCustomerById(cid);
        if (c) {
            setCustomer(c);
            const custOrders = await getOrdersByCustomer(c.id);

            const enriched = await Promise.all(
                custOrders.map(async (o) => {
                    const items = await getOrderItems(o.id);
                    return { ...o, items };
                })
            );
            setOrders(enriched);
        }
    }, [id]);

    useFocusEffect(
        useCallback(() => {
            loadData();
        }, [loadData])
    );

    if (!customer) return null;

    const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={Colors.text} />
                </TouchableOpacity>
                <Text style={styles.title}>{t('detail.title')}</Text>
                <View style={{ width: 24 }} />
            </View>

            <FlatList
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
                data={orders}
                keyExtractor={(item) => item.id}
                ListHeaderComponent={
                    <>
                        <View style={styles.profileHeader}>
                            <View style={styles.avatar}>
                                <Text style={styles.avatarText}>{getInitials(customer.name)}</Text>
                            </View>
                            <Text style={styles.name}>{customer.name}</Text>
                            <Text style={styles.phone}>{customer.phone || t('detail.noPhone')}</Text>
                        </View>

                        <View style={styles.statsRow}>
                            <AppCard style={styles.statCard}>
                                <Text style={styles.statLabel}>{t('detail.totalSpent')}</Text>
                                <Text style={[styles.statValue, { color: Colors.success }]}>
                                    {formatCurrency(customer.total_purchase)}
                                </Text>
                            </AppCard>
                            <AppCard style={styles.statCard}>
                                <Text style={styles.statLabel}>{t('detail.orders')}</Text>
                                <Text style={styles.statValue}>{orders.length}</Text>
                            </AppCard>
                        </View>

                        <Text style={styles.sectionTitle}>{t('detail.purchaseHistory')}</Text>
                    </>
                }
                renderItem={({ item }) => (
                    <AppCard style={styles.orderCard}>
                        <View style={styles.orderHeader}>
                            <View>
                                <Text style={styles.orderDate}>{formatDate(item.date)}</Text>
                                <Text style={styles.orderTime}>{formatTime(item.date)}</Text>
                            </View>
                            <Text style={styles.orderAmount}>{formatCurrency(item.final_amount)}</Text>
                        </View>
                        <View style={styles.divider} />
                        <View style={styles.itemsList}>
                            {item.items?.map((i) => (
                                <View key={i.id} style={styles.itemRow}>
                                    <Text style={styles.itemName}>
                                        {t('detail.itemName', { qty: i.quantity, name: i.product_name || t('detail.item'), size: i.size })}
                                    </Text>
                                    <Text style={styles.itemPrice}>{formatCurrency(i.price * i.quantity)}</Text>
                                </View>
                            ))}
                        </View>
                    </AppCard>
                )}
                ListEmptyComponent={
                    <EmptyState
                        icon="receipt-outline"
                        title={t('detail.noPurchases')}
                        subtitle={t('detail.notBoughtYet')}
                    />
                }
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.md },
    backBtn: { padding: Spacing.xs },
    title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    scrollContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxxl * 2 },
    profileHeader: { alignItems: 'center', marginVertical: Spacing.xl },
    avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(108,92,231,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md, borderWidth: 2, borderColor: Colors.primary },
    avatarText: { color: Colors.primary, fontSize: FontSize.xxxl, fontWeight: FontWeight.bold },
    name: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: FontWeight.bold, marginBottom: 4 },
    phone: { color: Colors.textMuted, fontSize: FontSize.md },
    statsRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.xxl },
    statCard: { flex: 1, alignItems: 'center', paddingVertical: Spacing.lg },
    statLabel: { color: Colors.textMuted, fontSize: FontSize.sm, marginBottom: Spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
    statValue: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    sectionTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, marginBottom: Spacing.md },
    orderCard: { marginBottom: Spacing.md },
    orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    orderDate: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    orderTime: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 2 },
    orderAmount: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
    divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
    itemsList: { gap: Spacing.sm },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between' },
    itemName: { color: Colors.textSecondary, fontSize: FontSize.sm, flex: 1 },
    itemPrice: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
});