import React, { useState, useCallback, useEffect } from 'react';
import {
    View,
    Text,
    Modal,
    TouchableOpacity,
    FlatList,
    StyleSheet,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SearchBar from './SearchBar';
import AppInput from './AppInput';
import AppButton from './AppButton';
import EmptyState from './EmptyState';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../constants/theme';
import {
    getAllCustomers,
    searchCustomers,
    addCustomer,
    getCustomerById,
} from '../database/queries/customerQueries';
import { useLanguage } from '../i18n';
import { Customer } from '../types/models';

interface Props {
    visible: boolean;
    selected: Customer | null;
    /** Called with the picked customer, or `null` for a Walk-in customer. */
    onSelect: (customer: Customer | null) => void;
    onClose: () => void;
}

/**
 * Bottom-sheet picker used inside billing: search existing customers by name
 * or phone, tap to select (null = Walk-in), or add a brand-new customer inline.
 */
export default function CustomerPicker({ visible, selected, onSelect, onClose }: Props) {
    const { t } = useLanguage();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPhone, setNewPhone] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async (q: string) => {
        setLoading(true);
        try {
            const list = q.trim() ? await searchCustomers(q.trim()) : await getAllCustomers();
            setCustomers(list);
        } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? t('picker.couldNotLoad'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    // Reset + refresh every time the sheet opens.
    useEffect(() => {
        if (visible) {
            setQuery('');
            setShowAdd(false);
            setNewName('');
            setNewPhone('');
            load('');
        }
    }, [visible, load]);

    const handleSearch = (q: string) => {
        setQuery(q);
        load(q);
    };

    const handleAdd = async () => {
        if (!newName.trim()) {
            Alert.alert(t('common.error'), t('picker.nameRequired'));
            return;
        }
        setSaving(true);
        try {
            const id = await addCustomer(newName.trim(), newPhone.trim());
            const created = await getCustomerById(id);
            if (created) {
                onSelect(created);
                onClose();
            }
        } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? t('picker.couldNotAdd'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <KeyboardAvoidingView
                style={styles.overlay}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <View style={styles.sheet}>
                    <View style={styles.handle} />

                    <View style={styles.header}>
                        <View style={styles.headerText}>
                            <Text style={styles.title}>{t('picker.title')}</Text>
                            <Text style={styles.subtitle}>{t('picker.subtitle')}</Text>
                        </View>
                        <TouchableOpacity onPress={onClose} hitSlop={8}>
                            <Ionicons name="close" size={24} color={Colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    <SearchBar value={query} onChangeText={handleSearch} placeholder={t('picker.search')} />

                    {/* Walk-in */}
                    <TouchableOpacity
                        style={[styles.walkinRow, !selected && styles.rowActive]}
                        onPress={() => {
                            onSelect(null);
                            onClose();
                        }}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="person-outline" size={20} color={!selected ? Colors.primary : Colors.textMuted} />
                        <Text style={[styles.walkinText, !selected && styles.rowActiveText]}>{t('picker.walkIn')}</Text>
                        {!selected && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
                    </TouchableOpacity>

                    {/* Add new customer */}
                    {!showAdd ? (
                        <TouchableOpacity style={styles.addNewBtn} onPress={() => setShowAdd(true)} activeOpacity={0.7}>
                            <Ionicons name="person-add" size={18} color={Colors.primary} />
                            <Text style={styles.addNewText}>{t('picker.addNew')}</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={styles.addForm}>
                            <AppInput
                                label={t('picker.name')}
                                value={newName}
                                onChangeText={setNewName}
                                placeholder={t('picker.namePlaceholder')}
                                editable={!saving}
                            />
                            <AppInput
                                label={t('picker.phone')}
                                value={newPhone}
                                onChangeText={setNewPhone}
                                placeholder={t('picker.phonePlaceholder')}
                                keyboardType="phone-pad"
                                editable={!saving}
                            />
                            <View style={styles.addFormBtns}>
                                <AppButton title={t('picker.cancel')} variant="ghost" size="sm" onPress={() => setShowAdd(false)} style={styles.addFormBtn} />
                                <AppButton title={t('picker.saveCustomer')} size="sm" onPress={handleAdd} loading={saving} style={styles.addFormBtn} />
                            </View>
                        </View>
                    )}

                    <FlatList
                        data={customers}
                        keyExtractor={(item) => item.id}
                        style={styles.list}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        renderItem={({ item }) => {
                            const active = selected?.id === item.id;
                            return (
                                <TouchableOpacity
                                    style={[styles.customerRow, active && styles.rowActive]}
                                    onPress={() => {
                                        onSelect(item);
                                        onClose();
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.customerInfo}>
                                        <Text style={[styles.customerName, active && styles.rowActiveText]} numberOfLines={1}>
                                            {item.name}
                                        </Text>
                                        {item.phone ? (
                                            <Text style={styles.customerPhone} numberOfLines={1}>
                                                {item.phone}
                                            </Text>
                                        ) : null}
                                    </View>
                                    {active && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
                                </TouchableOpacity>
                            );
                        }}
                        ListEmptyComponent={
                            !loading ? (
                                <EmptyState
                                    icon="people-outline"
                                    title={t('picker.noCustomers')}
                                    subtitle={query.trim() ? t('picker.noMatch') : t('picker.addPrompt')}
                                />
                            ) : null
                        }
                    />
                    {loading && <Text style={styles.loadingText}>{t('picker.searching')}</Text>}
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
    sheet: {
        maxHeight: '85%',
        backgroundColor: Colors.background,
        borderTopLeftRadius: BorderRadius.xxl,
        borderTopRightRadius: BorderRadius.xxl,
        paddingHorizontal: Spacing.xl,
        paddingBottom: Spacing.xxxl,
    },
    handle: { width: 40, height: 4, borderRadius: BorderRadius.full, backgroundColor: Colors.border, alignSelf: 'center', marginTop: Spacing.md, marginBottom: Spacing.lg },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
    headerText: { flex: 1 },
    title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    subtitle: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 2 },
    walkinRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
        borderRadius: BorderRadius.md,
        backgroundColor: Colors.surfaceLight,
        borderWidth: 1,
        borderColor: Colors.border,
        marginTop: Spacing.md,
    },
    rowActive: { backgroundColor: 'rgba(108,92,231,0.12)', borderColor: Colors.primary },
    walkinText: { flex: 1, color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
    rowActiveText: { color: Colors.primary },
    addNewBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.md,
        marginTop: Spacing.md,
        borderRadius: BorderRadius.md,
        backgroundColor: 'rgba(108,92,231,0.08)',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(108,92,231,0.35)',
    },
    addNewText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    addForm: { marginTop: Spacing.md, padding: Spacing.lg, backgroundColor: Colors.surfaceLight, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border },
    addFormBtns: { flexDirection: 'row', gap: Spacing.md },
    addFormBtn: { flex: 1 },
    list: { flexGrow: 0, marginTop: Spacing.md },
    customerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
        borderRadius: BorderRadius.md,
        marginBottom: Spacing.sm,
        backgroundColor: Colors.surfaceLight,
        borderWidth: 1,
        borderColor: Colors.border,
    },
    customerInfo: { flex: 1 },
    customerName: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
    customerPhone: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 2 },
    loadingText: { textAlign: 'center', color: Colors.textMuted, fontSize: FontSize.sm, paddingVertical: Spacing.md },
});