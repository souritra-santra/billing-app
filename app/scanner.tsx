import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../src/constants/theme';
import AppButton from '../src/components/AppButton';
import { useLanguage } from '../src/i18n';

export default function ScannerScreen() {
    const router = useRouter();
    const { t } = useLanguage();
    const [hasPermission, setHasPermission] = useState<boolean | null>(null);
    const [scanned, setScanned] = useState(false);

    useEffect(() => {
        (async () => {
            const { status } = await Camera.requestCameraPermissionsAsync();
            setHasPermission(status === 'granted');
        })();
    }, []);

    const handleBarCodeScanned = ({ data, type, raw }: { data: string, type: string, raw?: string }) => {
        setScanned(true);
        // Navigate back with the scanned code as a param for the billing screen.
        console.log(data, type, raw);
        router.navigate({
            pathname: '/(tabs)/billing',
            params: { scanned_barcode: data }
        } as any);
    };

    if (hasPermission === null) {
        return <View style={styles.container}><Text style={styles.text}>{t('scanner.requesting')}</Text></View>;
    }
    if (hasPermission === false) {
        return (
            <View style={styles.container}>
                <Text style={styles.text}>{t('scanner.noAccess')}</Text>
                <AppButton title={t('common.back')} onPress={() => router.back()} style={{ marginTop: Spacing.xl }} />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.title}>{t('scanner.title')}</Text>
                <View style={{ width: 28 }} />
            </View>

            <View style={styles.cameraContainer}>
                <CameraView
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    // By omitting barcodeScannerSettings, it defaults to scanning all supported types
                    onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                />

                {/* Scanner overlay */}
                <View style={styles.overlay}>
                    <View style={styles.scanFrame} />
                    <Text style={styles.scanText}>{t('scanner.pointer')}</Text>
                </View>
            </View>

            {scanned && (
                <View style={styles.footer}>
                    <AppButton title={t('scanner.scanAgain')} onPress={() => setScanned(false)} />
                </View>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    text: { color: '#fff', textAlign: 'center', marginTop: 100 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
    backBtn: { padding: Spacing.xs, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: BorderRadius.full },
    title: { color: '#fff', fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
    cameraContainer: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center' },
    overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    scanFrame: { width: 250, height: 250, borderWidth: 2, borderColor: Colors.primary, backgroundColor: 'transparent', borderRadius: BorderRadius.md },
    scanText: { color: '#fff', marginTop: Spacing.xl, fontSize: FontSize.md, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full },
    footer: { position: 'absolute', bottom: 50, left: Spacing.xl, right: Spacing.xl },
});