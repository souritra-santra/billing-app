import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  BorderRadius,
  Colors,
  FontSize,
  FontWeight,
  Spacing,
} from '../src/constants/theme';
import AppButton from '../src/components/AppButton';
import AppCard from '../src/components/AppCard';
import Badge from '../src/components/Badge';
import EmptyState from '../src/components/EmptyState';
import { useLanguage } from '../src/i18n';
import { isAiProxyConfigured } from '../src/ai/config';
import { aiErrorMessageKey, isAiImportError } from '../src/ai/errors';
import {
  deleteAiImportSession,
  getRecentAiImportSessions,
} from '../src/database/queries/aiImportQueries';
import { runAiImport } from '../src/services/aiImportService';
import { formatShortDate } from '../src/utils/helpers';
import { AiImportMode, AiImportSession } from '../src/types/models';

type CaptureSource = 'camera' | 'library';

const MODES: {
  id: AiImportMode;
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  descKey: string;
}[] = [
  {
    id: 'invoice',
    icon: 'receipt-outline',
    titleKey: 'ai.invoice',
    descKey: 'ai.invoiceDesc',
  },
  {
    id: 'label',
    icon: 'pricetag-outline',
    titleKey: 'ai.label',
    descKey: 'ai.labelDesc',
  },
];

function formatSessionDate(value: string): string {
  // SQLite datetime('now') uses "YYYY-MM-DD HH:MM:SS" (UTC).
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return formatShortDate(date.toISOString());
}

export default function AiImportScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const [mode, setMode] = useState<AiImportMode>('invoice');
  const [sessions, setSessions] = useState<AiImportSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const configured = isAiProxyConfigured();

  const loadHistory = useCallback(async () => {
    try {
      const rows = await getRecentAiImportSessions(25);
      setSessions(rows);
    } catch {
      // History is non-critical; the capture flow still works.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  const handleDelete = (session: AiImportSession) => {
    Alert.alert(t('ai.deleteSession'), t('ai.confirmDeleteSession'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteAiImportSession(session.id);
          loadHistory();
        },
      },
    ]);
  };

  const capture = async (source: CaptureSource) => {
    if (busy) return;
    if (!configured) {
      Alert.alert(t('ai.notConfigured'), t('ai.notConfiguredHint'));
      return;
    }

    try {
      let result: ImagePicker.ImagePickerResult;

      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(t('ai.cameraDenied'), t('ai.cameraDeniedHint'));
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.9,
          exif: false,
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: false,
          quality: 0.9,
          exif: false,
        });
      }

      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setBusy(true);
      const { sessionId } = await runAiImport(asset.uri, mode, {
        width: asset.width,
        height: asset.height,
      });
      await loadHistory();
      router.push({
        pathname: '/ai-import-review',
        params: { id: sessionId },
      } as any);
    } catch (error) {
      const importError = isAiImportError(error) ? error : null;
      const messageKey = importError
        ? aiErrorMessageKey(importError.code)
        : 'ai.error.generic';
      const buttons: { text: string; onPress?: () => void }[] = [
        { text: t('common.ok') },
      ];
      if (importError?.retryable) {
        buttons.push({
          text: t('ai.error.retry'),
          onPress: () => capture(source),
        });
      }
      Alert.alert(t('ai.error.title'), t(messageKey), buttons);
      loadHistory();
    } finally {
      setBusy(false);
    }
  };

  const openSession = (session: AiImportSession) => {
    router.push({
      pathname: '/ai-import-review',
      params: { id: session.id },
    } as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('ai.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.subtitle}>{t('ai.subtitle')}</Text>

        {!configured && (
          <AppCard style={styles.warningCard}>
            <View style={styles.warningHeader}>
              <Ionicons name="warning-outline" size={20} color={Colors.warning} />
              <Text style={styles.warningTitle}>{t('ai.notConfigured')}</Text>
            </View>
            <Text style={styles.warningText}>{t('ai.notConfiguredHint')}</Text>
          </AppCard>
        )}

        <Text style={styles.sectionLabel}>{t('ai.chooseMode')}</Text>
        <View style={styles.modeRow}>
          {MODES.map((item) => {
            const active = mode === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                activeOpacity={0.8}
                style={[styles.modeCard, active && styles.modeCardActive]}
                onPress={() => setMode(item.id)}
              >
                <View
                  style={[
                    styles.modeIcon,
                    { backgroundColor: active ? Colors.primary : Colors.surfaceLight },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={22}
                    color={active ? '#fff' : Colors.primary}
                  />
                </View>
                <Text style={[styles.modeTitle, active && styles.modeTitleActive]}>
                  {t(item.titleKey)}
                </Text>
                <Text style={styles.modeDesc}>{t(item.descKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <AppCard style={styles.captureCard}>
          <View style={styles.captureHeader}>
            <View style={styles.captureIcon}>
              <Ionicons
                name={mode === 'invoice' ? 'scan-outline' : 'pricetags-outline'}
                size={24}
                color={Colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.captureTitle}>
                {mode === 'invoice' ? t('ai.invoice') : t('ai.label')}
              </Text>
              <Text style={styles.captureDesc}>
                {mode === 'invoice' ? t('ai.invoiceCaptureHint') : t('ai.labelCaptureHint')}
              </Text>
            </View>
          </View>

          <View style={styles.tipBox}>
            <Text style={styles.tipTitle}>{t('ai.tipsTitle')}</Text>
            <Text style={styles.tipText}>• {t('ai.tipLight')}</Text>
            <Text style={styles.tipText}>• {t('ai.tipFlat')}</Text>
            <Text style={styles.tipText}>• {t('ai.tipWhole')}</Text>
          </View>

          {busy ? (
            <View style={styles.busyBox}>
              <ActivityIndicator color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.busyTitle}>{t('ai.analyzing')}</Text>
                <Text style={styles.busyHint}>{t('ai.analyzingHint')}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.captureButtons}>
              <AppButton
                title={t('ai.takePhoto')}
                onPress={() => capture('camera')}
                disabled={!configured}
                icon={<Ionicons name="camera-outline" size={18} color="#fff" />}
                style={{ flex: 1 }}
              />
              <AppButton
                title={t('ai.uploadImage')}
                variant="secondary"
                onPress={() => capture('library')}
                disabled={!configured}
                icon={<Ionicons name="image-outline" size={18} color={Colors.text} />}
                style={{ flex: 1 }}
              />
            </View>
          )}
        </AppCard>

        <View style={styles.historyHeader}>
          <Text style={styles.sectionTitle}>{t('ai.history')}</Text>
          <TouchableOpacity onPress={loadHistory} style={styles.refreshBtn}>
            <Ionicons name="refresh" size={16} color={Colors.textMuted} />
            <Text style={styles.refreshText}>{t('ai.refresh')}</Text>
          </TouchableOpacity>
        </View>

        {historyLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon="sparkles-outline"
            title={t('ai.noHistory')}
            subtitle={t('ai.noHistoryHint')}
          />
        ) : (
          sessions.map((session) => {
            const isFailed = session.status === 'failed';
            const isProcessing = session.status === 'processing';
            const statusColor = isFailed
              ? Colors.danger
              : isProcessing
                ? Colors.warning
                : Colors.success;
            const statusBg = isFailed
              ? Colors.dangerBg
              : isProcessing
                ? Colors.warningBg
                : Colors.successBg;
            const draftCount = session.draft_count ?? 0;

            return (
              <TouchableOpacity
                key={session.id}
                activeOpacity={0.8}
                style={styles.historyCard}
                onPress={() => openSession(session)}
                onLongPress={() => handleDelete(session)}
              >
                <View style={styles.historyIcon}>
                  <Ionicons
                    name={session.mode === 'invoice' ? 'receipt-outline' : 'pricetag-outline'}
                    size={20}
                    color={Colors.primary}
                  />
                </View>
                <View style={styles.historyInfo}>
                  <Text style={styles.historyTitle} numberOfLines={1}>
                    {session.supplier_name ||
                      session.invoice_number ||
                      (session.mode === 'invoice' ? t('ai.invoice') : t('ai.label'))}
                  </Text>
                  <Text style={styles.historyMeta} numberOfLines={1}>
                    {formatSessionDate(session.created_at)}
                    {draftCount > 0
                      ? ` · ${draftCount === 1 ? t('ai.oneDraft') : t('ai.draftCount', { count: draftCount })}`
                      : ''}
                  </Text>
                  {isFailed && session.error_message ? (
                    <Text style={styles.historyError} numberOfLines={1}>
                      {session.error_message}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.historyRight}>
                  <Badge
                    label={
                      isFailed
                        ? t('ai.status.failed')
                        : isProcessing
                          ? t('ai.status.processing')
                          : t('ai.status.completed')
                    }
                    color={statusColor}
                    bgColor={statusBg}
                  />
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDelete(session)}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={16} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        <Text style={styles.footerHint}>{t('ai.footerHint')}</Text>
        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  backBtn: { padding: Spacing.xs },
  title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  scroll: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm },
  subtitle: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.lg },
  warningCard: {
    backgroundColor: 'rgba(255,170,0,0.06)',
    borderColor: 'rgba(255,170,0,0.2)',
    marginBottom: Spacing.lg,
  },
  warningHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  warningTitle: { color: Colors.warning, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  warningText: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 19 },
  sectionLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: Spacing.sm,
  },
  modeRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  modeCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  modeCardActive: { borderColor: Colors.primary, backgroundColor: 'rgba(108,92,231,0.08)' },
  modeIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  modeTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  modeTitleActive: { color: Colors.primaryLight },
  modeDesc: { color: Colors.textMuted, fontSize: FontSize.xs, lineHeight: 16, marginTop: 4 },
  captureCard: { marginBottom: Spacing.xxl },
  captureHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  captureIcon: {
    width: 46,
    height: 46,
    borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(108,92,231,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  captureDesc: { color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 18, marginTop: 2 },
  tipBox: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  tipTitle: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginBottom: 4 },
  tipText: { color: Colors.textMuted, fontSize: FontSize.xs, lineHeight: 17 },
  captureButtons: { flexDirection: 'row', gap: Spacing.md },
  busyBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  busyTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  busyHint: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 2 },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  sectionTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  refreshText: { color: Colors.textMuted, fontSize: FontSize.xs },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  historyIcon: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(108,92,231,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  historyInfo: { flex: 1, paddingRight: Spacing.sm },
  historyTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  historyMeta: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 },
  historyError: { color: Colors.danger, fontSize: FontSize.xs, marginTop: 2 },
  historyRight: { alignItems: 'flex-end', gap: 6 },
  deleteBtn: { padding: 2 },
  footerHint: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    textAlign: 'center',
    marginTop: Spacing.lg,
    lineHeight: 17,
  },
});
