import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/constants/theme';
import SearchBar from '../../src/components/SearchBar';
import Badge from '../../src/components/Badge';
import EmptyState from '../../src/components/EmptyState';
import { getAllProducts, getProductsByType, searchProducts, deleteProduct } from '../../src/database/queries/productQueries';
import { getProductTypes } from '../../src/database/queries/productQueries';
import { getTotalStock } from '../../src/database/queries/inventoryQueries';
import { formatCurrency } from '../../src/utils/helpers';
import { useLanguage } from '../../src/i18n';
import { Product, ProductType } from '../../src/types/models';

export default function InventoryScreen() {
    const router = useRouter();
    const { t } = useLanguage();
    const [search, setSearch] = useState('');
    const [products, setProducts] = useState<(Product & { totalStock?: number })[]>([]);
    const [types, setTypes] = useState<ProductType[]>([]);
    const [activeType, setActiveType] = useState<string>('all');

    const loadData = useCallback(async () => {
        const t = await getProductTypes();
        setTypes(t);
        let prods: Product[];
        if (activeType === 'all') {
            prods = await getAllProducts();
        } else {
            prods = await getProductsByType(activeType);
        }
        const withStock = await Promise.all(
            prods.map(async (p) => {
                const totalStock = await getTotalStock(p.id);
                return { ...p, totalStock };
            })
        );
        setProducts(withStock);
    }, [activeType]);

    useFocusEffect(
        useCallback(() => {
            loadData();
        }, [loadData])
    );

    const handleSearch = async (q: string) => {
        setSearch(q);
        if (q.trim()) {
            const results = await searchProducts(q);
            const withStock = await Promise.all(
                results.map(async (p) => {
                    const totalStock = await getTotalStock(p.id);
                    return { ...p, totalStock };
                })
            );
            setProducts(withStock);
        } else {
            loadData();
        }
    };

    const handleDelete = (product: Product) => {
        Alert.alert(t('inventory.deleteProduct'), t('inventory.confirmDelete', { name: product.name }), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.delete'),
                style: 'destructive',
                onPress: async () => {
                    await deleteProduct(product.id);
                    loadData();
                },
            },
        ]);
    };

    const getStockColor = (qty: number) => {
        if (qty === 0) return { color: Colors.danger, bg: Colors.dangerBg };
        if (qty <= 5) return { color: Colors.warning, bg: Colors.warningBg };
        return { color: Colors.success, bg: Colors.successBg };
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.title}>{t('inventory.title')}</Text>
                <View style={styles.headerActions}>
                    <TouchableOpacity
                        style={styles.aiBtn}
                        onPress={() => router.push('/ai-import' as any)}
                        activeOpacity={0.7}
                        accessibilityLabel={t('inventory.aiImport')}
                    >
                        <Ionicons name="sparkles" size={19} color={Colors.primaryLight} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.addBtn}
                        onPress={() => router.push('/add-product' as any)}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="add" size={22} color="#fff" />
                    </TouchableOpacity>
                </View>
            </View>

            <SearchBar value={search} onChangeText={handleSearch} placeholder={t('inventory.search')} />

            {/* Category Filter */}
            <FlatList
                data={[{ id: 'all', name: t('inventory.all'), created_at: '' }, ...types]}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(item) => item.id}
                style={styles.typeList}
                contentContainerStyle={{ gap: Spacing.sm }}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={[styles.typeChip, activeType === item.id && styles.typeChipActive]}
                        onPress={() => { setActiveType(item.id); setSearch(''); }}
                    >
                        <Text style={[styles.typeChipText, activeType === item.id && styles.typeChipTextActive]}>
                            {item.name}
                        </Text>
                    </TouchableOpacity>
                )}
            />

            {/* Product List */}
            <FlatList
                data={products}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 100 }}
                renderItem={({ item }) => {
                    const stockInfo = getStockColor(item.totalStock ?? 0);
                    return (
                        <TouchableOpacity
                            style={styles.productCard}
                            activeOpacity={0.8}
                            onPress={() => router.push({ pathname: '/add-product', params: { id: item.id } } as any)}
                            onLongPress={() => handleDelete(item)}
                        >
                            <View style={styles.productIcon}>
                                <Ionicons name="shirt" size={22} color={Colors.primary} />
                            </View>
                            <View style={styles.productInfo}>
                                <Text style={styles.productName}>{item.name}</Text>
                                <View style={styles.productMeta}>
                                    <Text style={styles.productType}>{item.type_name}</Text>
                                    <Text style={styles.productDot}>·</Text>
                                    <Text style={styles.productPrice}>{formatCurrency(item.price)}</Text>
                                </View>
                                {!!item.cost_price && item.price > item.cost_price && (
                                    <Text style={styles.productProfit}>
                                        {t('inventory.profit', { amount: formatCurrency(item.price - item.cost_price) })}
                                    </Text>
                                )}
                            </View>
                            <Badge
                                label={`${item.totalStock ?? 0}`}
                                color={stockInfo.color}
                                bgColor={stockInfo.bg}
                                size="md"
                            />
                        </TouchableOpacity>
                    );
                }}
                ListEmptyComponent={
                    <EmptyState
                        icon="cube-outline"
                        title={t('inventory.noProducts')}
                        subtitle={t('inventory.addFirst')}
                    />
                }
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.lg, marginBottom: Spacing.lg },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    title: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
    aiBtn: { width: 44, height: 44, borderRadius: BorderRadius.md, backgroundColor: 'rgba(108,92,231,0.14)', borderWidth: 1, borderColor: 'rgba(108,92,231,0.35)', alignItems: 'center', justifyContent: 'center' },
    addBtn: { width: 44, height: 44, borderRadius: BorderRadius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
    typeList: { marginTop: Spacing.md, marginBottom: Spacing.md, maxHeight: 40 },
    typeChip: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: Colors.surfaceLight, borderWidth: 1, borderColor: Colors.border },
    typeChipActive: { backgroundColor: 'rgba(108,92,231,0.15)', borderColor: Colors.primary },
    typeChipText: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
    typeChipTextActive: { color: Colors.primary },
    productCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
    productIcon: { width: 48, height: 48, borderRadius: BorderRadius.md, backgroundColor: 'rgba(108,92,231,0.1)', alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
    productInfo: { flex: 1 },
    productName: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    productMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    productType: { color: Colors.textMuted, fontSize: FontSize.sm },
    productDot: { color: Colors.textMuted, marginHorizontal: 6 },
    productPrice: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
    productProfit: { color: Colors.success, fontSize: FontSize.sm, fontWeight: FontWeight.medium, marginTop: 2 },
});