import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    Switch,
    Modal,
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../src/constants/theme';
import AppButton from '../src/components/AppButton';
import AppInput from '../src/components/AppInput';
import AppCard from '../src/components/AppCard';
import { getPrintSettings, savePrintSettings } from '../src/database/queries/settingsQueries';
import { encodeCostCode } from '../src/utils/helpers';
import {
    scanBluetoothPrinters,
    testBluetoothPrinter,
    isThermalPrintingSupported,
} from '../src/services/printService';
import { PAPER_WIDTH_OPTIONS, getPaperSpec } from '../src/services/print/paper';
import { useLanguage, LANGUAGES } from '../src/i18n';
import {
    PaperWidth,
    PrintSettings,
    PrintTarget,
    DEFAULT_PRINT_SETTINGS,
} from '../src/types/models';

interface DeviceOption {
    name: string;
    address: string;
    deviceType?: string;
}

export default function PrinterSettingsScreen() {
    const router = useRouter();
    const { t, language, setLanguage } = useLanguage();
    const [settings, setSettings] = useState<PrintSettings>({ ...DEFAULT_PRINT_SETTINGS });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    const [showScan, setShowScan] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [devices, setDevices] = useState<DeviceOption[]>([]);

    const bluetoothSupported = isThermalPrintingSupported();

    useEffect(() => {
        (async () => {
            const saved = await getPrintSettings();
            setSettings(saved);
            setLoading(false);
        })();
    }, []);

    const update = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
    };

    const handleScan = useCallback(async () => {
        if (!bluetoothSupported) {
            Alert.alert(t('settings.devBuildRequired'), t('settings.devBuildScanMsg'));
            return;
        }
        setShowScan(true);
        setScanning(true);
        setDevices([]);
        try {
            const result = await scanBluetoothPrinters();
            const all: DeviceOption[] = [...(result.paired ?? []), ...(result.found ?? [])];
            // De-duplicate by address.
            const unique = all.filter(
                (device, index) => all.findIndex((d) => d.address === device.address) === index
            );
            setDevices(unique);
        } catch (e: any) {
            Alert.alert(t('settings.scanFailed'), e?.message ?? t('settings.couldNotScan'));
        }
        setScanning(false);
    }, [bluetoothSupported, t]);

    const selectDevice = (device: DeviceOption) => {
        update('printerAddress', device.address);
        update('printerName', device.name);
        setShowScan(false);
    };

    const handleTestPrint = async () => {
        if (!settings.printerAddress) {
            Alert.alert(t('settings.noPrinterChosen'));
            return;
        }
        setTesting(true);
        try {
            await testBluetoothPrinter(settings);
            Alert.alert(t('common.success'), t('settings.testSent'));
        } catch (e: any) {
            Alert.alert(t('settings.testFailed'), e?.message ?? t('settings.couldNotReach'));
        }
        setTesting(false);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await savePrintSettings(settings);
            router.back();
        } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? t('settings.couldNotSave'));
        }
        setSaving(false);
    };

    const renderMethodChip = (target: PrintTarget, label: string, icon: keyof typeof Ionicons.glyphMap) => {
        const disabled = target === 'bluetooth' && !bluetoothSupported;
        const active = settings.printTarget === target;
        return (
            <TouchableOpacity
                key={target}
                disabled={disabled}
                style={[
                    styles.methodChip,
                    active && styles.methodChipActive,
                    disabled && styles.methodChipDisabled,
                ]}
                onPress={() => update('printTarget', target)}
            >
                <Ionicons
                    name={icon}
                    size={20}
                    color={active ? Colors.primary : Colors.textMuted}
                />
                <Text style={[styles.methodText, active && styles.methodTextActive]}>{label}</Text>
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.container} edges={['top']}>
                <View style={styles.loading}>
                    <ActivityIndicator color={Colors.primary} />
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={Colors.text} />
                </TouchableOpacity>
                <Text style={styles.title}>{t('settings.title')}</Text>
                <View style={{ width: 24 }} />
            </View>

            <KeyboardAvoidingView
                style={styles.keyboardView}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.scroll}
                    keyboardShouldPersistTaps="handled"
                    automaticallyAdjustKeyboardInsets
                >
                    {/* Language */}
                <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
                <View style={styles.languageRow}>
                    {LANGUAGES.map((lang) => {
                        const active = language === lang.id;
                        return (
                            <TouchableOpacity
                                key={lang.id}
                                style={[styles.languageChip, active && styles.languageChipActive]}
                                onPress={() => setLanguage(lang.id)}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.languageChipText, active && styles.languageChipTextActive]}>
                                    {lang.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
                <Text style={styles.hint}>{t('settings.languageHint')}</Text>

                {/* Paper width */}
                <Text style={[styles.sectionTitle, styles.sectionSpacing]}>{t('settings.paperSize')}</Text>
                <View style={styles.chipRow}>
                    {PAPER_WIDTH_OPTIONS.map((width) => {
                        const active = settings.paperWidth === width;
                        return (
                            <TouchableOpacity
                                key={width}
                                style={[styles.paperChip, active && styles.paperChipActive]}
                                onPress={() => update('paperWidth', width as PaperWidth)}
                            >
                                <Text style={[styles.paperChipText, active && styles.paperChipTextActive]}>
                                    {getPaperSpec(width).label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
                <Text style={styles.hint}>
                    {t('settings.paperHint')}
                </Text>

                {/* Print method */}
                <Text style={[styles.sectionTitle, styles.sectionSpacing]}>{t('settings.printMethod')}</Text>
                <View style={styles.methodRow}>
                    {renderMethodChip('system', t('settings.systemDialog'), 'print-outline')}
                    {renderMethodChip('bluetooth', t('settings.bluetooth'), 'bluetooth')}
                </View>
                {!bluetoothSupported && (
                    <View style={styles.notice}>
                        <Ionicons name="information-circle-outline" size={16} color={Colors.warning} />
                        <Text style={styles.noticeText}>
                            {t('settings.devBuildNotice')}
                        </Text>
                    </View>
                )}

                {/* Bluetooth printer selection */}
                {settings.printTarget === 'bluetooth' && (
                    <AppCard style={styles.printerCard}>
                        <Text style={styles.cardLabel}>{t('settings.savedPrinter')}</Text>
                        <View style={styles.printerRow}>
                            <Ionicons
                                name={settings.printerAddress ? 'bluetooth' : 'bluetooth-outline'}
                                size={18}
                                color={settings.printerAddress ? Colors.success : Colors.textMuted}
                            />
                            <View style={styles.printerInfo}>
                                <Text style={styles.printerName}>
                                    {settings.printerName || t('settings.noPrinterSelected')}
                                </Text>
                                {settings.printerAddress && (
                                    <Text style={styles.printerAddress}>{settings.printerAddress}</Text>
                                )}
                            </View>
                        </View>
                        <View style={styles.printerActions}>
                            <AppButton
                                title={t('settings.scan')}
                                onPress={handleScan}
                                size="sm"
                                style={{ flex: 1, marginRight: Spacing.md }}
                            />
                            <AppButton
                                title={t('settings.testPrint')}
                                onPress={handleTestPrint}
                                size="sm"
                                variant="secondary"
                                loading={testing}
                                disabled={!settings.printerAddress}
                                style={{ flex: 1 }}
                            />
                        </View>
                    </AppCard>
                )}

                {/* Auto cut */}
                <View style={styles.switchRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.switchLabel}>{t('settings.autoCut')}</Text>
                        <Text style={styles.hint}>{t('settings.autoCutHint')}</Text>
                    </View>
                    <Switch
                        value={settings.autoCut}
                        onValueChange={(value) => update('autoCut', value)}
                        trackColor={{ true: Colors.primary, false: Colors.surfaceLight }}
                        thumbColor="#fff"
                    />
                </View>

                {/* Store details */}
                <Text style={[styles.sectionTitle, styles.sectionSpacing]}>{t('settings.storeDetails')}</Text>
                <AppInput
                    label={t('settings.storeName')}
                    value={settings.storeName}
                    onChangeText={(value) => update('storeName', value)}
                    placeholder={t('settings.storeNamePlaceholder')}
                />
                <AppInput
                    label={t('settings.phoneOptional')}
                    value={settings.storePhone}
                    onChangeText={(value) => update('storePhone', value)}
                    placeholder={t('settings.phonePlaceholder')}
                    keyboardType="phone-pad"
                />

                {/* Cost price code */}
                <Text style={[styles.sectionTitle, styles.sectionSpacing]}>{t('settings.costCode')}</Text>
                <AppInput
                    label={t('settings.costCode')}
                    value={settings.costCode}
                    onChangeText={(value) => update('costCode', value.toUpperCase())}
                    placeholder="GROUNDSALE"
                />
                <Text style={styles.hint}>{t('settings.costCodeHint')}</Text>
                <View style={styles.costCodePreview}>
                    <Text style={styles.costCodePreviewText}>
                        {t('settings.costCodePreview', { code: encodeCostCode(480, settings.costCode) })}
                    </Text>
                </View>

                <AppButton
                    title={t('settings.saveSettings')}
                    onPress={handleSave}
                    loading={saving}
                    style={styles.saveBtn}
                />
                <View style={{ height: Spacing.xxxl }} />
            </ScrollView>
            </KeyboardAvoidingView>

            {/* Scan modal */}
            <Modal visible={showScan} animationType="slide" transparent onRequestClose={() => setShowScan(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>{t('settings.selectPrinter')}</Text>
                            <TouchableOpacity onPress={() => setShowScan(false)}>
                                <Ionicons name="close" size={24} color={Colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                        {scanning ? (
                            <View style={styles.scanning}>
                                <ActivityIndicator color={Colors.primary} />
                                <Text style={styles.hint}>{t('settings.searching')}</Text>
                            </View>
                        ) : devices.length === 0 ? (
                            <Text style={styles.hint}>
                                {t('settings.noPrinters')}
                            </Text>
                        ) : (
                            devices.map((device) => (
                                <TouchableOpacity
                                    key={device.address}
                                    style={styles.deviceRow}
                                    onPress={() => selectDevice(device)}
                                >
                                    <Ionicons name="print-outline" size={20} color={Colors.primary} />
                                    <View style={styles.printerInfo}>
                                        <Text style={styles.printerName}>{device.name}</Text>
                                        <Text style={styles.printerAddress}>{device.address}</Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                                </TouchableOpacity>
                            ))
                        )}
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    keyboardView: { flex: 1 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    backBtn: { padding: Spacing.xs },
    title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    scroll: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
    sectionTitle: {
        color: Colors.text,
        fontSize: FontSize.lg,
        fontWeight: FontWeight.semibold,
        marginBottom: Spacing.md,
    },
    sectionSpacing: { marginTop: Spacing.xxl },
    languageRow: { flexDirection: 'row', gap: Spacing.md },
    languageChip: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: Spacing.lg,
        borderRadius: BorderRadius.md,
        backgroundColor: Colors.surfaceLight,
        borderWidth: 1,
        borderColor: Colors.border,
    },
    languageChipActive: { backgroundColor: 'rgba(108,92,231,0.15)', borderColor: Colors.primary },
    languageChipText: { color: Colors.textMuted, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    languageChipTextActive: { color: Colors.primary },
    chipRow: { flexDirection: 'row', gap: Spacing.md },
    paperChip: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: Spacing.lg,
        borderRadius: BorderRadius.md,
        backgroundColor: Colors.surfaceLight,
        borderWidth: 1,
        borderColor: Colors.border,
    },
    paperChipActive: { backgroundColor: 'rgba(108,92,231,0.15)', borderColor: Colors.primary },
    paperChipText: { color: Colors.textMuted, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    paperChipTextActive: { color: Colors.primary },
    hint: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: Spacing.sm },
    methodRow: { flexDirection: 'row', gap: Spacing.md },
    methodChip: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.lg,
        borderRadius: BorderRadius.md,
        backgroundColor: Colors.surfaceLight,
        borderWidth: 1,
        borderColor: Colors.border,
    },
    methodChipActive: { backgroundColor: 'rgba(108,92,231,0.15)', borderColor: Colors.primary },
    methodChipDisabled: { opacity: 0.4 },
    methodText: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
    methodTextActive: { color: Colors.primary },
    notice: {
        flexDirection: 'row',
        gap: Spacing.sm,
        alignItems: 'flex-start',
        backgroundColor: Colors.warningBg,
        borderRadius: BorderRadius.md,
        padding: Spacing.md,
        marginTop: Spacing.md,
    },
    noticeText: { color: Colors.warning, fontSize: FontSize.sm, flex: 1 },
    printerCard: { marginTop: Spacing.lg },
    cardLabel: {
        color: Colors.textSecondary,
        fontSize: FontSize.sm,
        fontWeight: FontWeight.semibold,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: Spacing.sm,
    },
    printerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    printerInfo: { flex: 1 },
    printerName: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
    printerAddress: { color: Colors.textMuted, fontSize: FontSize.sm },
    printerActions: { flexDirection: 'row', marginTop: Spacing.lg },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: Spacing.xxl,
        gap: Spacing.lg,
    },
    switchLabel: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
    costCodePreview: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: Spacing.sm,
        backgroundColor: 'rgba(108,92,231,0.12)',
        borderRadius: BorderRadius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        alignSelf: 'flex-start',
    },
    costCodePreviewText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, letterSpacing: 1 },
    saveBtn: { marginTop: Spacing.xxl },
    modalOverlay: { flex: 1, backgroundColor: Colors.overlay },
    modalContent: {
        flex: 1,
        marginTop: 60,
        backgroundColor: Colors.background,
        borderTopLeftRadius: BorderRadius.xxl,
        borderTopRightRadius: BorderRadius.xxl,
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.xl,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: Spacing.xl,
    },
    modalTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    scanning: { alignItems: 'center', paddingVertical: Spacing.xxxl, gap: Spacing.md },
    deviceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        paddingVertical: Spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: Colors.border,
    },
});