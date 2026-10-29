import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../src/constants/theme';
import AppInput from '../src/components/AppInput';
import AppButton from '../src/components/AppButton';
import SizeQuantityEditor from '../src/components/SizeQuantityEditor';
import { getProductTypes, addProduct, updateProduct, getProductById } from '../src/database/queries/productQueries';
import { setInventory, getInventoryForProduct } from '../src/database/queries/inventoryQueries';
import { generateBarcode, formatCurrency } from '../src/utils/helpers';
import { useLanguage } from '../src/i18n';
import { ProductType, LabelProduct } from '../src/types/models';

export default function AddProductScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const { t } = useLanguage();
    const productId = params.id as string | undefined;

    const [name, setName] = useState('');
    const [costPrice, setCostPrice] = useState('');
    const [price, setPrice] = useState('');
    const [barcode, setBarcode] = useState('');
    const [types, setTypes] = useState<ProductType[]>([]);
    const [selectedType, setSelectedType] = useState('');

    // Inventory Sizes
    const [sizes, setSizes] = useState<{ size: string; qty: string }[]>([]);
    const [saving, setSaving] = useState(false);
    // Set after a new product is first created; re-saving then updates it
    // instead of inserting a duplicate (same barcode -> UNIQUE constraint).
    const [createdId, setCreatedId] = useState<string | null>(null);

    // Keyboard fallback: bring the focused field into view on Android, where
    // the OS auto-scroll can be unreliable while the keyboard overlays the app.
    const scrollRef = useRef<ScrollView>(null);
    const fieldRowY = useRef<Record<string, number>>({});
    const sizeEditorY = useRef(0);

    const scrollToField = (key: string) => {
        const y = fieldRowY.current[key];
        if (typeof y !== 'number') return;
        requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
        });
    };

    useEffect(() => {
        loadTypes();
        if (productId) {
            loadProduct(productId);
        } else {
            setBarcode(generateBarcode());
        }
    }, [productId]);

    const loadTypes = async () => {
        const typeData = await getProductTypes();
        setTypes(typeData);
    };

    const loadProduct = async (id: string) => {
        const p = await getProductById(id);
        if (p) {
            setName(p.name);
            setCostPrice(p.cost_price ? p.cost_price.toString() : '');
            setPrice(p.price.toString());
            setBarcode(p.barcode);
            setSelectedType(p.type_id);

            const inv = await getInventoryForProduct(id);
            if (inv.length > 0) {
                setSizes(inv.map(i => ({ size: i.size, qty: i.quantity.toString() })));
            }
        }
    };

    const getProfitInfo = () => {
        const cost = parseFloat(costPrice) || 0;
        const sell = parseFloat(price) || 0;
        if (sell <= 0) return null;
        const profit = sell - cost;
        const pct = sell > 0 ? Math.round((profit / sell) * 100) : 0;
        return (
            <Text
                style={[
                    styles.profitHint,
                    profit >= 0 ? styles.profitPositive : styles.profitNegative,
                ]}
            >
                {t('addProduct.profitPerItem', { amount: formatCurrency(profit), pct })}
                {profit < 0 ? t('addProduct.belowCost') : ''}
            </Text>
        );
    };

    const handleSave = async () => {
        if (saving) return;
        if (!name.trim()) return Alert.alert(t('common.error'), t('addProduct.nameRequired'));
        if (!selectedType) return Alert.alert(t('common.error'), t('addProduct.typeRequired'));
        if (!price || isNaN(Number(price))) return Alert.alert(t('common.error'), t('addProduct.validPriceRequired'));

        const costNum = costPrice.trim() === '' ? 0 : Number(costPrice);
        if (costPrice.trim() !== '' && (isNaN(costNum) || costNum < 0)) {
            return Alert.alert(t('common.error'), t('addProduct.invalidCost'));
        }
        const sellNum = Number(price);

        setSaving(true);
        try {
            let id = productId || createdId;

            if (id) {
                await updateProduct(id, name.trim(), selectedType, costNum, sellNum);
            } else {
                id = await addProduct(name.trim(), selectedType, costNum, sellNum, barcode);
                setCreatedId(id);
            }
            let products: LabelProduct[] = [];
            // Update inventory sizes
            for (const s of sizes) {
                const qty = parseInt(s.qty) || 0;
                await setInventory(id, s.size, qty);
                products.push({
                    id: String(id),
                    name: name.trim(),
                    size: s.size,
                    type_id: selectedType,
                    cost_price: costNum,
                    price: sellNum,
                    barcode: barcode || String(id),
                    created_at: new Date().toISOString(),
                    qty,
                });
            }

            Alert.alert(
                t('common.success'),
                productId ? t('addProduct.updated') : t('addProduct.added'),
                [
                    {
                        text: t('addProduct.printLabel'),
                        onPress: async () => {
                            try {
                                const { printProductLabels } = await import('../src/services/printService');
                                await printProductLabels(products as any);
                            } catch (e: any) {
                                Alert.alert(t('addProduct.printFailed'), e?.message ?? t('addProduct.couldNotPrint'));
                            }
                            router.back();
                        }
                    },
                    {
                        text: t('addProduct.savePdf'),
                        onPress: async () => {
                            try {
                                const { saveLabelsPdf } = await import('../src/services/printService');
                                await saveLabelsPdf(products as any);
                            } catch (e: any) {
                                Alert.alert(t('addProduct.saveFailed'), e?.message ?? t('addProduct.couldNotSave'));
                            }
                            router.back();
                        }
                    },
                    { text: t('common.ok'), onPress: () => router.back() }
                ]
            );
        } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? t('addProduct.saveError'));
        }
        setSaving(false);
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={Colors.text} />
                </TouchableOpacity>
                <Text style={styles.title}>{productId ? t('addProduct.editTitle') : t('addProduct.addTitle')}</Text>
                <View style={{ width: 24 }} />
            </View>

            <KeyboardAvoidingView
                style={styles.keyboardView}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    ref={scrollRef}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.scroll}
                    keyboardShouldPersistTaps="handled"
                    automaticallyAdjustKeyboardInsets
                >
                    <AppInput
                        label={t('addProduct.name')}
                        value={name}
                        onChangeText={setName}
                        placeholder={t('addProduct.namePlaceholder')}
                    />

                <Text style={styles.label}>{t('addProduct.category')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typesRow}>
                    {types.map(typeItem => (
                        <TouchableOpacity
                            key={typeItem.id}
                            style={[styles.typeChip, selectedType === typeItem.id && styles.typeChipActive]}
                            onPress={() => setSelectedType(typeItem.id)}
                        >
                            <Text style={[styles.typeText, selectedType === typeItem.id && styles.typeTextActive]}>
                                {typeItem.name}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>

                <View style={styles.row}>
                    <AppInput
                        label={t('addProduct.buyingPrice')}
                        value={costPrice}
                        onChangeText={setCostPrice}
                        keyboardType="numeric"
                        style={{ flex: 1 }}
                        placeholder={t('addProduct.costPlaceholder')}
                    />
                    <AppInput
                        label={t('addProduct.sellingPrice')}
                        value={price}
                        onChangeText={setPrice}
                        keyboardType="numeric"
                        style={{ flex: 1 }}
                        placeholder={t('addProduct.mrpPlaceholder')}
                    />
                </View>
                {getProfitInfo()}

                <AppInput
                    label={t('addProduct.barcode')}
                    value={barcode}
                    onChangeText={setBarcode}
                    editable={!productId}
                />
                {productId ? null : (
                    <TouchableOpacity onPress={() => setBarcode(generateBarcode())} style={styles.regenBtn}>
                        <Ionicons name="refresh" size={16} color={Colors.primary} />
                        <Text style={styles.regenText}>{t('addProduct.generateNew')}</Text>
                    </TouchableOpacity>
                )}

                <View style={styles.divider} />

                <View
                    onLayout={(event) => {
                        sizeEditorY.current = event.nativeEvent.layout.y;
                    }}
                >
                    <SizeQuantityEditor
                        sizes={sizes}
                        onChange={setSizes}
                        onFieldFocus={scrollToField}
                        onFieldLayout={(key, y) => {
                            fieldRowY.current[key] = sizeEditorY.current + y;
                        }}
                    />
                </View>

                <AppButton
                    title={saving ? t('addProduct.saving') : t('addProduct.saveProduct')}
                    onPress={handleSave}
                    loading={saving}
                    style={styles.saveBtn}
                />
                <View style={{ height: Spacing.xxxl * 2 }} />
            </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    keyboardView: { flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.md },
    backBtn: { padding: Spacing.xs },
    title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    scroll: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
    label: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium, marginBottom: Spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
    typesRow: { flexDirection: 'row', marginBottom: Spacing.lg },
    typeChip: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: Colors.surfaceLight, marginRight: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
    typeChipActive: { backgroundColor: 'rgba(108,92,231,0.15)', borderColor: Colors.primary },
    typeText: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
    typeTextActive: { color: Colors.primary },
    row: { flexDirection: 'row', gap: Spacing.md },
    regenBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xs, marginBottom: Spacing.lg },
    regenText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
    divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.lg },
    profitHint: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, marginTop: Spacing.sm, marginBottom: Spacing.lg },
    profitPositive: { color: Colors.success },
    profitNegative: { color: Colors.danger },
    saveBtn: { marginTop: Spacing.lg }
});