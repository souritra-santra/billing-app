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
import AppCard from '../src/components/AppCard';
import { getProductTypes, addProduct, updateProduct, getProductById } from '../src/database/queries/productQueries';
import { setInventory, getInventoryForProduct } from '../src/database/queries/inventoryQueries';
import { generateBarcode, formatCurrency } from '../src/utils/helpers';
import { useLanguage } from '../src/i18n';
import { ProductType, InventoryItem, LabelProduct } from '../src/types/models';

const SIZE_GROUPS = [
    { id: 'letter', labelKey: 'addProduct.groupLetter', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Free'] },
    { id: 'shirt', labelKey: 'addProduct.groupShirt', sizes: ['34', '36', '38', '40', '42', '44', '46'] },
    { id: 'waist', labelKey: 'addProduct.groupWaist', sizes: ['28', '30', '32', '34', '36', '38', '40', '42'] },
    { id: 'kids', labelKey: 'addProduct.groupKids', sizes: ['2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '10Y', '12Y', '14Y'] },
    { id: 'shoe', labelKey: 'addProduct.groupShoe', sizes: ['5', '6', '7', '8', '9', '10', '11'] },
];

// Aligns action buttons (add size, remove size) with the AppInput field
// that sits right of the label in `row` layouts.
const LABEL_OFFSET = 22;

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
    const [activeSizeGroup, setActiveSizeGroup] = useState('letter');
    const [customSize, setCustomSize] = useState('');
    const [saving, setSaving] = useState(false);
    // Set after a new product is first created; re-saving then updates it
    // instead of inserting a duplicate (same barcode -> UNIQUE constraint).
    const [createdId, setCreatedId] = useState<string | null>(null);

    // Keyboard fallback: bring the focused field into view on Android, where
    // the OS auto-scroll can be unreliable while the keyboard overlays the app.
    const scrollRef = useRef<ScrollView>(null);
    const fieldRowY = useRef<Record<string, number>>({});

    const scrollToField = (key: string) => {
        const y = fieldRowY.current[key];
        if (typeof y !== 'number') return;
        requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
        });
    };

    const rememberFieldY = (key: string) => (e: { nativeEvent: { layout: { y: number } } }) => {
        fieldRowY.current[key] = e.nativeEvent.layout.y;
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

    const handleAddSize = (sizeName: string) => {
        if (!sizes.find(s => s.size === sizeName)) {
            setSizes([...sizes, { size: sizeName, qty: '0' }]);
        }
    };

    const handleUpdateSizeQty = (index: number, val: string) => {
        const updated = [...sizes];
        updated[index].qty = val;
        setSizes(updated);
    };

    const handleRemoveSize = (index: number) => {
        setSizes(sizes.filter((_, i) => i !== index));
    };

    const handleAddCustom = () => {
        const sizeName = customSize.trim();
        if (!sizeName) return Alert.alert(t('addProduct.customSize'), t('addProduct.customSizeError'));
        if (!sizes.find(s => s.size === sizeName)) {
            setSizes([...sizes, { size: sizeName, qty: '0' }]);
        }
        setCustomSize('');
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

                <Text style={styles.sectionTitle}>{t('addProduct.inventorySizes')}</Text>
                <Text style={styles.subtitle}>{t('addProduct.sizeHint')}</Text>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sizeGroupRow}>
                    {SIZE_GROUPS.map(g => (
                        <TouchableOpacity
                            key={g.id}
                            style={[styles.typeChip, activeSizeGroup === g.id && styles.typeChipActive]}
                            onPress={() => setActiveSizeGroup(g.id)}
                        >
                            <Text style={[styles.typeText, activeSizeGroup === g.id && styles.typeTextActive]}>
                                {t(g.labelKey)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>

                <View style={styles.sizeOptions}>
                    {(SIZE_GROUPS.find(g => g.id === activeSizeGroup)?.sizes ?? []).map(s => (
                        <TouchableOpacity
                            key={s}
                            style={[
                                styles.sizeBtn,
                                sizes.find(sz => sz.size === s) && styles.sizeBtnSelected
                            ]}
                            onPress={() => handleAddSize(s)}
                        >
                            <Text style={[
                                styles.sizeBtnText,
                                sizes.find(sz => sz.size === s) && styles.sizeBtnTextSelected
                            ]}>{s}</Text>
                        </TouchableOpacity>
                    ))}
                    {customSize.trim() !== '' && !sizes.find(sz => sz.size === customSize.trim()) && (
                        <TouchableOpacity style={[styles.sizeBtn, styles.sizeBtnCustom]} onPress={handleAddCustom}>
                            <Text style={styles.sizeBtnTextCustom}>+ {customSize.trim()}</Text>
                        </TouchableOpacity>
                    )}
                </View>

                <View style={styles.row} onLayout={rememberFieldY('customSize')}>
                    <AppInput
                        label={t('addProduct.customSize')}
                        value={customSize}
                        onChangeText={setCustomSize}
                        placeholder={t('addProduct.customPlaceholder')}
                        style={{ flex: 1, marginBottom: 0 }}
                        onFocus={() => scrollToField('customSize')}
                    />
                    <TouchableOpacity style={styles.addCustomBtn} onPress={handleAddCustom}>
                        <Ionicons name="add" size={24} color="#fff" />
                    </TouchableOpacity>
                </View>

                {sizes.length > 0 && (
                    <AppCard style={styles.sizesCard}>
                        {sizes.map((s, idx) => (
                            <View key={idx} style={styles.sizeInputRow} onLayout={rememberFieldY(`sizeQty_${idx}`)}>
                                <View style={styles.sizeLabelWrap}>
                                    <Text style={styles.sizeInputLabel}>{s.size}</Text>
                                </View>
                                <AppInput
                                    label={t('addProduct.quantity')}
                                    value={s.qty}
                                    onChangeText={(val) => handleUpdateSizeQty(idx, val)}
                                    keyboardType="numeric"
                                    style={{ flex: 1, marginBottom: 0 }}
                                    onFocus={() => scrollToField(`sizeQty_${idx}`)}
                                />
                                <TouchableOpacity style={styles.removeSizeBtn} onPress={() => handleRemoveSize(idx)}>
                                    <Ionicons name="trash-outline" size={20} color={Colors.danger} />
                                </TouchableOpacity>
                            </View>
                        ))}
                    </AppCard>
                )}

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
    sectionTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
    subtitle: { color: Colors.textMuted, fontSize: FontSize.sm, marginBottom: Spacing.md, marginTop: Spacing.xs },
    sizeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
    sizeGroupRow: { flexDirection: 'row', marginBottom: Spacing.md },
    sizeBtn: { width: 44, height: 44, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
    sizeBtnSelected: { backgroundColor: Colors.primary },
    sizeBtnCustom: { width: 'auto', paddingHorizontal: Spacing.md, backgroundColor: Colors.surfaceHighlight, borderColor: Colors.primary },
    sizeBtnText: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
    sizeBtnTextSelected: { color: '#fff' },
    sizeBtnTextCustom: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
    addCustomBtn: { width: 48, height: 48, borderRadius: BorderRadius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: LABEL_OFFSET, marginLeft: Spacing.sm },
    profitHint: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, marginTop: Spacing.sm, marginBottom: Spacing.lg },
    profitPositive: { color: Colors.success },
    profitNegative: { color: Colors.danger },
    sizesCard: { marginBottom: Spacing.xl },
    sizeInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
    sizeLabelWrap: { width: 48, height: 48, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md, marginTop: LABEL_OFFSET },
    sizeInputLabel: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.bold },
    removeSizeBtn: { padding: Spacing.sm, marginTop: LABEL_OFFSET, marginLeft: Spacing.sm },
    saveBtn: { marginTop: Spacing.lg }
});