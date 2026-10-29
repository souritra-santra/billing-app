import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    Alert,
    FlatList,
    Modal,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/constants/theme';
import AppCard from '../../src/components/AppCard';
import AppButton from '../../src/components/AppButton';
import AppInput from '../../src/components/AppInput';
import SearchBar from '../../src/components/SearchBar';
import QuantitySelector from '../../src/components/QuantitySelector';
import EmptyState from '../../src/components/EmptyState';
import CustomerPicker from '../../src/components/CustomerPicker';
import { getProductByBarcode, getAllProducts, searchProducts } from '../../src/database/queries/productQueries';
import { getInventoryForProduct } from '../../src/database/queries/inventoryQueries';
import { generateId } from '../../src/database/db';
import {
    calculateSubtotal,
    calculateDiscount,
    calculateTax,
    calculateFinal,
    checkout,
} from '../../src/services/billingService';
import { formatCurrency } from '../../src/utils/helpers';
import { useLanguage } from '../../src/i18n';
import { Product, CartItem, InventoryItem, Customer } from '../../src/types/models';

/** One ongoing bill on the billing screen. Any number can be open at once. */
interface Bill {
    id: string;
    num: number;
    items: CartItem[];
    customer: Customer | null;
    discountVal: string;
    isPercentDiscount: boolean;
    taxRate: string;
    paymentMode: string;
}

function createBill(num: number): Bill {
    return {
        id: generateId(),
        num,
        items: [],
        customer: null,
        discountVal: '0',
        isPercentDiscount: true,
        taxRate: '0',
        paymentMode: 'cash',
    };
}

export default function BillingScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{ scanned_barcode?: string }>();
    const { t } = useLanguage();
    const [search, setSearch] = useState('');
    const [products, setProducts] = useState<Product[]>([]);
    const [bills, setBills] = useState<Bill[]>(() => [createBill(1)]);
    const [activeBillId, setActiveBillId] = useState<string | null>(null);
    const billCounter = useRef(1);
    const [showCheckout, setShowCheckout] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [sizeInventory, setSizeInventory] = useState<InventoryItem[]>([]);
    const [selectedSize, setSelectedSize] = useState('');
    const [qty, setQty] = useState(1);
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [showCustomerPicker, setShowCustomerPicker] = useState(false);
    const [showCheckoutCustomerPicker, setShowCheckoutCustomerPicker] = useState(false);

    const billLabel = (bill: Bill) => t('billing.billLabel', { n: bill.num });

    const payLabel = (mode: string) =>
        mode === 'card' ? t('payment.card') : mode === 'upi' ? t('payment.upi') : t('payment.cash');

    // ----- Active bill helpers -----
    const activeBill = bills.find((b) => b.id === activeBillId) ?? bills[0];
    const cart = activeBill?.items ?? [];

    const updateActiveBill = (patch: Partial<Bill>) => {
        const id = activeBill?.id ?? '';
        setBills((prev) => prev.map((bill) => (bill.id === id ? { ...bill, ...patch } : bill)));
    };

    const updateActiveBillItems = (updater: (items: CartItem[]) => CartItem[]) => {
        const id = activeBill?.id ?? '';
        setBills((prev) => prev.map((bill) => (bill.id === id ? { ...bill, items: updater(bill.items) } : bill)));
    };

    const addBill = () => {
        billCounter.current += 1;
        const nb = createBill(billCounter.current);
        setBills((prev) => [...prev, nb]);
        setActiveBillId(nb.id);
    };

    const removeBill = (billId: string) => {
        const target = bills.find((b) => b.id === billId);
        if (!target) return;
        const count = target.items.reduce((s, i) => s + i.quantity, 0);
        const message = count > 0
            ? t('billing.removeBillCount', { label: billLabel(target), count })
            : t('billing.removeBill', { label: billLabel(target) });
        Alert.alert(
            t('billing.deleteBill'),
            message,
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () => {
                        const remaining = bills.filter((b) => b.id !== billId);
                        if (remaining.length === 0) {
                            billCounter.current += 1;
                            const nb = createBill(billCounter.current);
                            setBills([nb]);
                            setActiveBillId(nb.id);
                        } else {
                            setBills(remaining);
                            setActiveBillId(remaining[0].id);
                        }
                    },
                },
            ]
        );
    };

    /** Remove the just-checked-out bill and start/switch to another one. */
    const shopBill = () => {
        const id = activeBill?.id ?? '';
        const remaining = bills.filter((b) => b.id !== id);
        if (remaining.length === 0) {
            billCounter.current += 1;
            const nb = createBill(billCounter.current);
            setBills([nb]);
            setActiveBillId(nb.id);
        } else {
            setBills(remaining);
            setActiveBillId(remaining[0].id);
        }
        setShowCheckout(false);
    };

    // ----- Products & cart -----
    useFocusEffect(
        useCallback(() => {
            loadProducts();
        }, [])
    );

    // Handle scanned barcode
    useEffect(() => {
        if (params.scanned_barcode) {
            handleScannedBarcode(params.scanned_barcode);
            // Clear the param so it doesn't trigger again on re-focus
            router.setParams({ scanned_barcode: undefined } as any);
        }
    }, [params.scanned_barcode]);

    const handleScannedBarcode = async (barcode: string) => {
        try {
            const product = await getProductByBarcode(barcode);
            if (!product) {
                Alert.alert(t('billing.notFound'), t('billing.productNotFound', { barcode }));
                return;
            }

            const inv = await getInventoryForProduct(product.id);
            if (inv.length === 0) {
                Alert.alert(t('billing.outOfStock'), t('billing.noInventory', { name: product.name }));
                return;
            }

            // If only one size, add it directly.
            // If multiple, select it so the user can see the size picker.
            if (inv.length === 1) {
                const item = inv[0];
                if (item.quantity <= 0) {
                    Alert.alert(t('billing.outOfStock'), t('billing.sizeOut', { size: item.size }));
                    return;
                }

                updateActiveBillItems((prevItems) => {
                    const existingIdx = prevItems.findIndex((c) => c.product.id === product.id && c.size === item.size);
                    if (existingIdx >= 0) {
                        const updated = [...prevItems];
                        const available = item.quantity;
                        const newQty = updated[existingIdx].quantity + 1;
                        if (newQty > available) {
                            Alert.alert(
                                t('billing.insufficientStock'),
                                t('billing.onlyAvailable', { available, size: item.size })
                            );
                            return prevItems;
                        }
                        updated[existingIdx].quantity = newQty;
                        return updated;
                    } else {
                        return [...prevItems, { product, size: item.size, quantity: 1, available_qty: item.quantity }];
                    }
                });
            } else {
                // Multiple sizes - open the product selection UI automatically
                setSelectedProduct(product);
                setSizeInventory(inv);
                setSelectedSize(inv[0].size);
                setQty(1);
            }
        } catch (e: any) {
            Alert.alert(t('common.error'), t('billing.scanError', { msg: e.message }));
        }
    };

    const loadProducts = async () => {
        const p = await getAllProducts();
        setProducts(p);
    };

    const handleSearch = async (q: string) => {
        setSearch(q);
        if (q.trim()) {
            const results = await searchProducts(q);
            setProducts(results);
        } else {
            loadProducts();
        }
    };

    const selectProduct = async (product: Product) => {
        setSelectedProduct(product);
        const inv = await getInventoryForProduct(product.id);
        setSizeInventory(inv);
        setSelectedSize(inv.length > 0 ? inv[0].size : '');
        setQty(1);
    };

    const addToCart = () => {
        if (!selectedProduct || !selectedSize) return;
        const sizeInv = sizeInventory.find((i) => i.size === selectedSize);
        const available = sizeInv?.quantity ?? 0;

        const existingIdx = cart.findIndex(
            (c) => c.product.id === selectedProduct.id && c.size === selectedSize
        );

        if (existingIdx >= 0) {
            const newQty = cart[existingIdx].quantity + qty;
            if (newQty > available) {
                Alert.alert(
                    t('billing.insufficientStock'),
                    t('billing.onlyAvailable', { available, size: selectedSize })
                );
                return;
            }
            updateActiveBillItems((items) =>
                items.map((c, i) => (i === existingIdx ? { ...c, quantity: newQty } : c))
            );
        } else {
            if (qty > available) {
                Alert.alert(
                    t('billing.insufficientStock'),
                    t('billing.onlyAvailable', { available, size: selectedSize })
                );
                return;
            }
            updateActiveBillItems((items) => [
                ...items,
                { product: selectedProduct, size: selectedSize, quantity: qty, available_qty: available },
            ]);
        }

        setSelectedProduct(null);
        setSizeInventory([]);
        setSelectedSize('');
        setQty(1);
    };

    const removeFromCart = (index: number) => {
        updateActiveBillItems((items) => items.filter((_, i) => i !== index));
    };

    // ----- Per-bill calculations -----
    const subtotal = calculateSubtotal(cart);
    const discountVal = activeBill?.discountVal ?? '0';
    const isPercentDiscount = activeBill?.isPercentDiscount ?? true;
    const taxRate = activeBill?.taxRate ?? '0';
    const paymentMode = activeBill?.paymentMode ?? 'cash';

    const discountAmount = calculateDiscount(subtotal, parseFloat(discountVal) || 0, isPercentDiscount);
    const taxAmount = calculateTax(subtotal - discountAmount, parseFloat(taxRate) || 0);
    const finalAmount = calculateFinal(subtotal, discountAmount, taxAmount);

    // ----- Checkout -----
    const handleCheckout = async () => {
        if (!activeBill || cart.length === 0) return;
        setCheckoutLoading(true);
        try {
            const orderId = await checkout(
                cart,
                activeBill.customer?.id ?? null,
                discountAmount,
                taxAmount,
                paymentMode
            );

            const order = {
                id: orderId,
                date: new Date().toISOString(),
                customer_id: activeBill.customer?.id ?? null,
                customer_name: activeBill.customer?.name,
                total_amount: subtotal,
                discount: discountAmount,
                tax: taxAmount,
                final_amount: finalAmount,
                payment_mode: paymentMode,
            };
            const orderItems = cart.map((item) => ({
                id: '',
                order_id: orderId,
                product_id: item.product.id,
                product_name: item.product.name,
                size: item.size,
                quantity: item.quantity,
                price: item.product.price,
            }));

            // Bill is complete - remove it now (before the alert) so a second
            // tap of Pay can never place a duplicate order.
            shopBill();

            Alert.alert(t('common.success'), t('billing.orderPlaced'), [
                {
                    text: t('billing.printBill'),
                    onPress: async () => {
                        try {
                            const { printInvoice } = await import('../../src/services/printService');
                            await printInvoice(order, orderItems);
                        } catch (e: any) {
                            Alert.alert(t('billing.printFailed'), e?.message ?? t('billing.couldNotPrint'));
                        }
                    }
                },
                {
                    text: t('billing.savePdf'),
                    onPress: async () => {
                        try {
                            const { saveInvoicePdf } = await import('../../src/services/printService');
                            await saveInvoicePdf(order, orderItems);
                        } catch (e: any) {
                            Alert.alert(t('billing.saveFailed'), e?.message ?? t('billing.couldNotSavePdf'));
                        }
                    }
                },
                { text: t('common.ok') },
            ]);
        } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? t('billing.couldNotPlace'));
        }
        setCheckoutLoading(false);
    };

    const getAvailableQty = () => {
        const sizeInv = sizeInventory.find((i) => i.size === selectedSize);
        return sizeInv?.quantity ?? 0;
    };

    const isActiveBill = (billId: string) => billId === activeBill?.id;

    const customerDisplay = (customer: Customer | null | undefined) => {
        if (!customer) return null;
        return customer.phone
            ? t('billing.customerJoined', { name: customer.name, phone: customer.phone })
            : customer.name;
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.title}>{t('billing.title')}</Text>
                <TouchableOpacity style={styles.scanBtn} onPress={() => router.push('/scanner' as any)}>
                    <Ionicons name="scan" size={20} color={Colors.text} />
                </TouchableOpacity>
            </View>

            {/* Open bills (multiple at once) */}
            <View style={styles.billTabs}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {bills.map((bill) => {
                        const active = isActiveBill(bill.id);
                        const count = bill.items.reduce((s, i) => s + i.quantity, 0);
                        return (
                            <TouchableOpacity
                                key={bill.id}
                                style={[styles.billChip, active && styles.billChipActive]}
                                onPress={() => setActiveBillId(bill.id)}
                                onLongPress={() => removeBill(bill.id)}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.billChipLabel, active && styles.billChipLabelActive]}>
                                    {billLabel(bill)}
                                </Text>
                                <Text style={[styles.billChipMeta, active && styles.billChipMetaActive]}>
                                    {count > 0
                                        ? (count === 1
                                            ? t('billing.itemCount', { count })
                                            : t('billing.itemsCount', { count }))
                                        : t('billing.empty')}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                    <TouchableOpacity style={styles.billAdd} onPress={addBill} activeOpacity={0.8}>
                        <Ionicons name="add" size={24} color={Colors.primary} />
                    </TouchableOpacity>
                </ScrollView>
                {bills.length > 1 && (
                    <Text style={styles.billsHint}>{t('billing.billsHint')}</Text>
                )}
            </View>

            {/* Active bill customer (search / add) */}
            <TouchableOpacity style={styles.billCustomerBar} onPress={() => setShowCustomerPicker(true)} activeOpacity={0.7}>
                <Ionicons
                    name={activeBill?.customer ? 'person-circle' : 'person-circle-outline'}
                    size={26}
                    color={activeBill?.customer ? Colors.primary : Colors.textMuted}
                />
                <View style={styles.billCustomerInfo}>
                    <Text style={styles.billCustomerLabel}>{activeBill ? billLabel(activeBill) : ''}</Text>
                    <Text style={styles.billCustomerName} numberOfLines={1}>
                        {activeBill?.customer
                            ? customerDisplay(activeBill.customer)
                            : t('billing.walkInBar')}
                    </Text>
                </View>
                <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            <SearchBar value={search} onChangeText={handleSearch} placeholder={t('billing.searchProducts')} />

            {/* Size Selection (when product selected) */}
            {selectedProduct && (
                <AppCard style={styles.sizeCard}>
                    <View style={styles.sizeHeader}>
                        <View>
                            <Text style={styles.sizeProductName}>{selectedProduct.name}</Text>
                            <Text style={styles.sizeProductPrice}>{formatCurrency(selectedProduct.price)}</Text>
                        </View>
                        <TouchableOpacity onPress={() => setSelectedProduct(null)}>
                            <Ionicons name="close" size={22} color={Colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    {sizeInventory.length > 0 ? (
                        <>
                            <Text style={styles.sizeLabel}>{t('billing.selectSize')}</Text>
                            <View style={styles.sizeRow}>
                                {sizeInventory.map((inv) => (
                                    <TouchableOpacity
                                        key={inv.size}
                                        style={[styles.sizeChip, selectedSize === inv.size && styles.sizeChipActive]}
                                        onPress={() => { setSelectedSize(inv.size); setQty(1); }}
                                    >
                                        <Text style={[styles.sizeChipText, selectedSize === inv.size && styles.sizeChipTextActive]}>
                                            {inv.size}
                                        </Text>
                                        <Text style={[styles.sizeChipQty, selectedSize === inv.size && styles.sizeChipQtyActive]}>
                                            ({inv.quantity})
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <View style={styles.qtyRow}>
                                <Text style={styles.sizeLabel}>{t('billing.quantity')}</Text>
                                <QuantitySelector
                                    value={qty}
                                    onIncrement={() => setQty((q) => q + 1)}
                                    onDecrement={() => setQty((q) => Math.max(1, q - 1))}
                                    max={getAvailableQty()}
                                />
                            </View>
                            <AppButton title={t('billing.addToCart')} onPress={addToCart} size="sm" />
                        </>
                    ) : (
                        <Text style={styles.noStock}>{t('billing.noStockAvailable')}</Text>
                    )}
                </AppCard>
            )}

            {/* Product List (when no product selected) */}
            {!selectedProduct && (
                <FlatList
                    data={products}
                    keyExtractor={(item) => item.id}
                    style={styles.productList}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item }) => (
                        <TouchableOpacity style={styles.productRow} activeOpacity={0.7} onPress={() => selectProduct(item)}>
                            <View style={styles.productIcon}>
                                <Ionicons name="shirt-outline" size={20} color={Colors.primary} />
                            </View>
                            <View style={styles.productInfo}>
                                <Text style={styles.productName}>{item.name}</Text>
                                <Text style={styles.productType}>{item.type_name}</Text>
                            </View>
                            <Text style={styles.productPrice}>{formatCurrency(item.price)}</Text>
                        </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                        <EmptyState
                            icon="cube-outline"
                            title={t('billing.noProducts')}
                            subtitle={t('billing.addProductsToStart')}
                        />
                    }
                />
            )}

            {/* Cart Summary Bar */}
            {cart.length > 0 && (
                <View style={styles.cartBar}>
                    <View style={styles.cartBarInfo}>
                        <Text style={styles.cartBarCount}>
                            {activeBill ? billLabel(activeBill) : ''} • {t('billing.itemsCount', { count: cart.reduce((s, i) => s + i.quantity, 0) })}
                        </Text>
                        <Text style={styles.cartBarTotal}>{formatCurrency(subtotal)}</Text>
                    </View>
                    <TouchableOpacity style={styles.cartBarBtn} onPress={() => setShowCheckout(true)}>
                        <Text style={styles.cartBarBtnText}>{t('billing.checkout')}</Text>
                        <Ionicons name="arrow-forward" size={18} color="#fff" />
                    </TouchableOpacity>
                </View>
            )}

            {/* Checkout Modal */}
            <Modal visible={showCheckout} animationType="slide" transparent onRequestClose={() => setShowCheckout(false)}>
                <KeyboardAvoidingView
                    style={styles.modalOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <View>
                                <Text style={styles.modalTitle}>
                                    {activeBill ? t('billing.checkoutTitle', { label: billLabel(activeBill) }) : ''}
                                </Text>
                                <Text style={styles.modalSubtitle} numberOfLines={1}>
                                    {activeBill?.customer
                                        ? t('billing.customerName', { name: activeBill.customer.name })
                                        : t('billing.walkInNoCustomer')}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => setShowCheckout(false)}>
                                <Ionicons name="close" size={24} color={Colors.textMuted} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                            {/* Cart Items */}
                            <Text style={styles.checkoutSection}>{t('billing.cartItems')}</Text>
                            {cart.map((item, idx) => (
                                <View key={idx} style={styles.checkoutItem}>
                                    <View style={styles.checkoutItemInfo}>
                                        <Text style={styles.checkoutItemName}>{item.product.name}</Text>
                                        <Text style={styles.checkoutItemDetail}>
                                            {t('billing.sizeDetail', { size: item.size, qty: item.quantity })}
                                        </Text>
                                    </View>
                                    <Text style={styles.checkoutItemPrice}>
                                        {formatCurrency(item.product.price * item.quantity)}
                                    </Text>
                                    <TouchableOpacity onPress={() => removeFromCart(idx)} style={styles.removeBtn}>
                                        <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                                    </TouchableOpacity>
                                </View>
                            ))}

                            {/* Customer (search / add) */}
                            <Text style={styles.checkoutSection}>{t('billing.customerOptional')}</Text>
                            <TouchableOpacity
                                style={styles.customerSelectRow}
                                onPress={() => setShowCheckoutCustomerPicker(true)}
                                activeOpacity={0.7}
                            >
                                <Ionicons
                                    name={activeBill?.customer ? 'person-circle' : 'person-circle-outline'}
                                    size={22}
                                    color={activeBill?.customer ? Colors.primary : Colors.textMuted}
                                />
                                <Text
                                    style={[styles.customerSelectText, activeBill?.customer && styles.customerSelectTextActive]}
                                    numberOfLines={1}
                                >
                                    {activeBill?.customer
                                        ? customerDisplay(activeBill.customer)
                                        : t('billing.walkInTap')}
                                </Text>
                                <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
                            </TouchableOpacity>

                            {/* Discount */}
                            <View style={styles.discountRow}>
                                <AppInput
                                    label={t('billing.discount')}
                                    value={discountVal}
                                    onChangeText={(v) => updateActiveBill({ discountVal: v })}
                                    keyboardType="numeric"
                                    style={{ flex: 1 }}
                                />
                                <TouchableOpacity
                                    style={[styles.discountToggle, isPercentDiscount && styles.discountToggleActive]}
                                    onPress={() => updateActiveBill({ isPercentDiscount: !isPercentDiscount })}
                                >
                                    <Text style={styles.discountToggleText}>{isPercentDiscount ? '%' : '₹'}</Text>
                                </TouchableOpacity>
                            </View>

                            <AppInput
                                label={t('billing.taxRate')}
                                value={taxRate}
                                onChangeText={(v) => updateActiveBill({ taxRate: v })}
                                keyboardType="numeric"
                            />

                            {/* Payment Mode */}
                            <Text style={styles.checkoutSection}>{t('billing.paymentMode')}</Text>
                            <View style={styles.paymentRow}>
                                {['cash', 'card', 'upi'].map((mode) => (
                                    <TouchableOpacity
                                        key={mode}
                                        style={[styles.paymentChip, paymentMode === mode && styles.paymentChipActive]}
                                        onPress={() => updateActiveBill({ paymentMode: mode })}
                                    >
                                        <Ionicons
                                            name={mode === 'cash' ? 'cash' : mode === 'card' ? 'card' : 'phone-portrait'}
                                            size={18}
                                            color={paymentMode === mode ? Colors.primary : Colors.textMuted}
                                        />
                                        <Text style={[styles.paymentChipText, paymentMode === mode && styles.paymentChipTextActive]}>
                                            {payLabel(mode)}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* Summary */}
                            <AppCard style={styles.summaryCard}>
                                <View style={styles.summaryRow}>
                                    <Text style={styles.summaryLabel}>{t('billing.subtotal')}</Text>
                                    <Text style={styles.summaryValue}>{formatCurrency(subtotal)}</Text>
                                </View>
                                {discountAmount > 0 && (
                                    <View style={styles.summaryRow}>
                                        <Text style={styles.summaryLabel}>{t('billing.discountLabel')}</Text>
                                        <Text style={[styles.summaryValue, { color: Colors.danger }]}>-{formatCurrency(discountAmount)}</Text>
                                    </View>
                                )}
                                {taxAmount > 0 && (
                                    <View style={styles.summaryRow}>
                                        <Text style={styles.summaryLabel}>{t('billing.tax')}</Text>
                                        <Text style={styles.summaryValue}>+{formatCurrency(taxAmount)}</Text>
                                    </View>
                                )}
                                <View style={[styles.summaryRow, styles.summaryTotal]}>
                                    <Text style={styles.totalLabel}>{t('billing.total')}</Text>
                                    <Text style={styles.totalValue}>{formatCurrency(finalAmount)}</Text>
                                </View>
                            </AppCard>

                            <AppButton
                                title={t('billing.pay', { amount: formatCurrency(finalAmount) })}
                                onPress={handleCheckout}
                                size="lg"
                                loading={checkoutLoading}
                                disabled={cart.length === 0}
                                style={{ marginTop: Spacing.lg, marginBottom: Spacing.xxxl }}
                            />
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* Customer pickers: main page + checkout */}
            <CustomerPicker
                visible={showCustomerPicker}
                selected={activeBill?.customer ?? null}
                onSelect={(customer) => {
                    updateActiveBill({ customer });
                    setShowCustomerPicker(false);
                }}
                onClose={() => setShowCustomerPicker(false)}
            />
            <CustomerPicker
                visible={showCheckoutCustomerPicker}
                selected={activeBill?.customer ?? null}
                onSelect={(customer) => {
                    updateActiveBill({ customer });
                    setShowCheckoutCustomerPicker(false);
                }}
                onClose={() => setShowCheckoutCustomerPicker(false)}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.lg, marginBottom: Spacing.lg },
    title: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
    scanBtn: { width: 44, height: 44, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center' },
    billTabs: { marginBottom: Spacing.md },
    billChip: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: Colors.surfaceLight, marginRight: Spacing.sm, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
    billChipActive: { backgroundColor: 'rgba(108,92,231,0.15)', borderColor: Colors.primary },
    billChipLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
    billChipLabelActive: { color: Colors.primary },
    billChipMeta: { color: Colors.textMuted, fontSize: FontSize.xs },
    billChipMetaActive: { color: Colors.primaryLight },
    billAdd: { width: 40, height: 40, borderRadius: BorderRadius.full, backgroundColor: 'rgba(108,92,231,0.08)', borderWidth: 1, borderColor: 'rgba(108,92,231,0.35)', alignItems: 'center', justifyContent: 'center' },
    billsHint: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: Spacing.sm },
    billCustomerBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md },
    billCustomerInfo: { flex: 1 },
    billCustomerLabel: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: FontWeight.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
    billCustomerName: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold, marginTop: 2 },
    sizeCard: { marginTop: Spacing.lg },
    sizeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
    sizeProductName: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
    sizeProductPrice: { color: Colors.primary, fontSize: FontSize.md, fontWeight: FontWeight.medium },
    sizeLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium, marginBottom: Spacing.sm, marginTop: Spacing.sm },
    sizeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
    sizeChip: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceLight, borderWidth: 1, borderColor: Colors.border, flexDirection: 'row', alignItems: 'center', gap: 4 },
    sizeChipActive: { backgroundColor: 'rgba(108,92,231,0.15)', borderColor: Colors.primary },
    sizeChipText: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    sizeChipTextActive: { color: Colors.primary },
    sizeChipQty: { color: Colors.textMuted, fontSize: FontSize.xs },
    sizeChipQtyActive: { color: Colors.primaryLight },
    qtyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
    noStock: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: Spacing.sm },
    productList: { flex: 1, marginTop: Spacing.md },
    productRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
    productIcon: { width: 40, height: 40, borderRadius: BorderRadius.sm, backgroundColor: 'rgba(108,92,231,0.1)', alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
    productInfo: { flex: 1 },
    productName: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
    productType: { color: Colors.textMuted, fontSize: FontSize.sm },
    productPrice: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    cartBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.sm },
    cartBarInfo: { flex: 1 },
    cartBarCount: { color: Colors.textSecondary, fontSize: FontSize.sm },
    cartBarTotal: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
    cartBarBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderRadius: BorderRadius.md },
    cartBarBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    modalOverlay: { flex: 1, backgroundColor: Colors.overlay },
    modalContent: { flex: 1, marginTop: 60, backgroundColor: Colors.background, borderTopLeftRadius: BorderRadius.xxl, borderTopRightRadius: BorderRadius.xxl, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xl },
    modalTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    modalSubtitle: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 2 },
    checkoutSection: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: Spacing.lg, marginBottom: Spacing.sm },
    checkoutItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
    checkoutItemInfo: { flex: 1 },
    checkoutItemName: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
    checkoutItemDetail: { color: Colors.textMuted, fontSize: FontSize.sm },
    checkoutItemPrice: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold, marginRight: Spacing.md },
    removeBtn: { padding: Spacing.sm },
    customerSelectRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceLight, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.border },
    customerSelectText: { flex: 1, color: Colors.textMuted, fontSize: FontSize.sm },
    customerSelectTextActive: { color: Colors.text, fontWeight: FontWeight.medium },
    discountRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.md },
    discountToggle: { width: 44, height: 44, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.border },
    discountToggleActive: { backgroundColor: 'rgba(108,92,231,0.15)', borderColor: Colors.primary },
    discountToggleText: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
    paymentRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
    paymentChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceLight, borderWidth: 1, borderColor: Colors.border },
    paymentChipActive: { backgroundColor: 'rgba(108,92,231,0.15)', borderColor: Colors.primary },
    paymentChipText: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
    paymentChipTextActive: { color: Colors.primary },
    summaryCard: { marginTop: Spacing.md },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.xs },
    summaryLabel: { color: Colors.textSecondary, fontSize: FontSize.md },
    summaryValue: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
    summaryTotal: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Spacing.sm, paddingTop: Spacing.md },
    totalLabel: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
    totalValue: { color: Colors.success, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
});