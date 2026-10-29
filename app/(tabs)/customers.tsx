import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    Alert,
    Modal,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/constants/theme';
import SearchBar from '../../src/components/SearchBar';
import AppInput from '../../src/components/AppInput';
import AppButton from '../../src/components/AppButton';
import EmptyState from '../../src/components/EmptyState';
import { getAllCustomers, addCustomer, searchCustomers, deleteCustomer } from '../../src/database/queries/customerQueries';
import { formatCurrency } from '../../src/utils/helpers';
import { useLanguage } from '../../src/i18n';
import { Customer } from '../../src/types/models';

export default function CustomersScreen() {
    const router = useRouter();
    const { t } = useLanguage();
    const [search, setSearch] = useState('');
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPhone, setNewPhone] = useState('');
    const [saving, setSaving] = useState(false);

    const loadData = useCallback(async () => {
        const c = await getAllCustomers();
        setCustomers(c);
    }, []);

    useFocusEffect(
        useCallback(() => {
            loadData();
        }, [loadData])
    );

    const handleSearch = async (q: string) => {
        setSearch(q);
        if (q.trim()) {
            const results = await searchCustomers(q);
            setCustomers(results);
        } else {
            loadData();
        }
    };

    const handleAdd = async () => {
        if (!newName.trim()) {
            Alert.alert(t('common.error'), t('customers.nameRequired'));
            return;
        }
        setSaving(true);
        await addCustomer(newName.trim(), newPhone.trim());
        setNewName('');
        setNewPhone('');
        setShowAdd(false);
        setSaving(false);
        loadData();
    };

    const handleDelete = (customer: Customer) => {
        Alert.alert(t('customers.deleteCustomer'), t('customers.removePrompt', { name: customer.name }), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.delete'),
                style: 'destructive',
                onPress: async () => {
                    await deleteCustomer(customer.id);
                    loadData();
                },
            },
        ]);
    };

    const getInitials = (name: string) =>
        name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();

    const AVATAR_COLORS = ['#6C5CE7', '#00D68F', '#F5A623', '#FF3D71', '#0095FF'];

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.title}>{t('customers.title')}</Text>
                <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
                    <Ionicons name="person-add" size={20} color="#fff" />
                </TouchableOpacity>
            </View>

            <SearchBar value={search} onChangeText={handleSearch} placeholder={t('customers.search')} />

            <FlatList
                data={customers}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                style={styles.list}
                contentContainerStyle={{ paddingBottom: 100 }}
                renderItem={({ item, index }) => (
                    <TouchableOpacity
                        style={styles.customerCard}
                        activeOpacity={0.8}
                        onPress={() => router.push({ pathname: '/customer-detail', params: { id: item.id } } as any)}
                        onLongPress={() => handleDelete(item)}
                    >
                        <View style={[styles.avatar, { backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] + '25' }]}>
                            <Text style={[styles.avatarText, { color: AVATAR_COLORS[index % AVATAR_COLORS.length] }]}>
                                {getInitials(item.name)}
                            </Text>
                        </View>
                        <View style={styles.customerInfo}>
                            <Text style={styles.customerName}>{item.name}</Text>
                            {item.phone ? <Text style={styles.customerPhone}>{item.phone}</Text> : null}
                        </View>
                        <View style={styles.customerStats}>
                            <Text style={styles.customerTotal}>{formatCurrency(item.total_purchase)}</Text>
                            {item.due_amount > 0 && (
                                <Text style={styles.customerDue}>
                                    {t('customers.due', { amount: formatCurrency(item.due_amount) })}
                                </Text>
                            )}
                        </View>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={
                    <EmptyState
                        icon="people-outline"
                        title={t('customers.noCustomers')}
                        subtitle={t('customers.addFirst')}
                    />
                }
            />

            {/* Add Customer Modal */}
            <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
                <KeyboardAvoidingView
                    style={styles.modalOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>{t('customers.add')}</Text>
                            <TouchableOpacity onPress={() => setShowAdd(false)}>
                                <Ionicons name="close" size={24} color={Colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                        <AppInput
                            label={t('customers.name')}
                            value={newName}
                            onChangeText={setNewName}
                            placeholder={t('customers.namePlaceholder')}
                        />
                        <AppInput
                            label={t('customers.phone')}
                            value={newPhone}
                            onChangeText={setNewPhone}
                            placeholder={t('customers.phonePlaceholder')}
                            keyboardType="phone-pad"
                        />
                        <AppButton
                            title={t('customers.add')}
                            onPress={handleAdd}
                            loading={saving}
                            style={{ marginTop: Spacing.md }}
                        />
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.lg, marginBottom: Spacing.lg },
    title: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
    addBtn: { width: 44, height: 44, borderRadius: BorderRadius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
    list: { marginTop: Spacing.md },
    customerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
    avatar: { width: 48, height: 48, borderRadius: BorderRadius.full, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
    avatarText: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
    customerInfo: { flex: 1 },
    customerName: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    customerPhone: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 2 },
    customerStats: { alignItems: 'flex-end' },
    customerTotal: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    customerDue: { color: Colors.warning, fontSize: FontSize.xs, marginTop: 2 },
    modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
    modalContent: { backgroundColor: Colors.background, borderTopLeftRadius: BorderRadius.xxl, borderTopRightRadius: BorderRadius.xxl, padding: Spacing.xxl, paddingBottom: Spacing.xxxl * 2 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xl },
    modalTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
});