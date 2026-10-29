import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BorderRadius,
  Colors,
  FontSize,
  FontWeight,
  Spacing,
} from '../src/constants/theme';
import AppButton from '../src/components/AppButton';
import AppCard from '../src/components/AppCard';
import AppInput from '../src/components/AppInput';
import Badge from '../src/components/Badge';
import EmptyState from '../src/components/EmptyState';
import SizeQuantityEditor from '../src/components/SizeQuantityEditor';
import { useLanguage } from '../src/i18n';
import {
  findDuplicateProduct,
  validateDraftForCreate,
  validateDraftForStock,
} from '../src/ai/drafts';
import {
  EditableSize,
  editableSizesFromDraft,
  primarySize,
  sizeRowsIssue,
  sizeRowsToDraftSizes,
  totalSizeQuantity,
} from '../src/ai/sizes';
import {
  AiDraftError,
  aiDraftErrorMessageKey,
} from '../src/ai/errors';
import { parseMoney, parseQuantity } from '../src/ai/parse';
import {
  getAiDraftsForSession,
  getAiImportSession,
  setAiDraftStatus,
  updateAiDraft,
} from '../src/database/queries/aiImportQueries';
import { getAllProducts, getProductById, getProductTypes } from '../src/database/queries/productQueries';
import { confirmAiDraft } from '../src/services/aiImportService';
import {
  AiDraftStatus,
  AiImportSession,
  AiProductDraft,
  LabelProduct,
  Product,
  ProductType,
} from '../src/types/models';

interface DraftForm {
  id: string;
  sessionId: string;
  name: string;
  brand: string;
  typeId: string;
  typeHint: string;
  cost: string;
  mrp: string;
  quantity: string;
  size: string;
  sizes: EditableSize[];
  colour: string;
  barcode: string;
  supplier: string;
  invoiceNumber: string;
  confidence: number | null;
  status: AiDraftStatus;
  productId: string | null;
  receiveStock: boolean;
}

interface ConfirmedDraft {
  form: DraftForm;
  status: AiDraftStatus;
  productId: string;
}

function numberText(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function draftToForm(draft: AiProductDraft): DraftForm {
  const sizes = editableSizesFromDraft(draft);
  return {
    id: draft.id,
    sessionId: draft.session_id,
    name: draft.name ?? '',
    brand: draft.brand ?? '',
    typeId: draft.type_id ?? '',
    typeHint: draft.type_hint ?? '',
    cost: numberText(draft.cost_price),
    mrp: numberText(draft.mrp),
    quantity: numberText(draft.quantity),
    size: draft.size ?? '',
    sizes,
    colour: draft.colour ?? '',
    barcode: draft.barcode ?? '',
    supplier: draft.supplier_name ?? '',
    invoiceNumber: draft.invoice_number ?? '',
    confidence: draft.confidence,
    status: draft.status,
    productId: draft.product_id,
    receiveStock: true,
  };
}

function formToDraft(form: DraftForm): AiProductDraft {
  const sizes = sizeRowsToDraftSizes(form.sizes);
  return {
    id: form.id,
    session_id: form.sessionId,
    name: trimOrNull(form.name),
    brand: trimOrNull(form.brand),
    type_id: trimOrNull(form.typeId),
    type_hint: trimOrNull(form.typeHint),
    cost_price: parseMoney(form.cost),
    mrp: parseMoney(form.mrp),
    quantity: sizes.length > 0 ? totalSizeQuantity(sizes) : parseQuantity(form.quantity),
    size: primarySize(sizes) ?? trimOrNull(form.size),
    sizes,
    colour: trimOrNull(form.colour),
    barcode: trimOrNull(form.barcode),
    supplier_name: trimOrNull(form.supplier),
    invoice_number: trimOrNull(form.invoiceNumber),
    confidence: form.confidence,
    status: form.status,
    product_id: form.productId,
    created_at: '',
    updated_at: '',
  };
}

function formPatch(form: DraftForm) {
  const draft = formToDraft(form);
  return {
    name: draft.name,
    brand: draft.brand,
    type_id: draft.type_id,
    type_hint: draft.type_hint,
    cost_price: draft.cost_price,
    mrp: draft.mrp,
    quantity: draft.quantity,
    size: draft.size,
    sizes: draft.sizes ?? [],
    colour: draft.colour,
    barcode: draft.barcode,
    supplier_name: draft.supplier_name,
    invoice_number: draft.invoice_number,
  };
}

function statusColor(status: AiDraftStatus): { color: string; bg: string } {
  switch (status) {
    case 'created':
      return { color: Colors.success, bg: Colors.successBg };
    case 'stock_added':
      return { color: Colors.info, bg: 'rgba(0,149,255,0.12)' };
    case 'discarded':
      return { color: Colors.textMuted, bg: Colors.surfaceLight };
    default:
      return { color: Colors.warning, bg: Colors.warningBg };
  }
}

function statusKey(status: AiDraftStatus): string {
  return `ai.draftStatus.${status}`;
}

const KNOWN_AI_ERRORS = new Set([
  'not_configured',
  'offline',
  'timeout',
  'api_error',
  'invalid_json',
  'invalid_response',
  'blurry_image',
  'no_products',
  'cancelled',
]);

export default function AiImportReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { t } = useLanguage();
  const sessionId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [session, setSession] = useState<AiImportSession | null>(null);
  const [forms, setForms] = useState<DraftForm[]>([]);
  const [types, setTypes] = useState<ProductType[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [links, setLinks] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    try {
      const [loadedSession, drafts, loadedTypes, loadedProducts] =
        await Promise.all([
          getAiImportSession(sessionId),
          getAiDraftsForSession(sessionId),
          getProductTypes(),
          getAllProducts(),
        ]);
      setSession(loadedSession);
      setForms(drafts.map(draftToForm));
      setTypes(loadedTypes);
      setProducts(loadedProducts);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateField = (index: number, patch: Partial<DraftForm>) => {
    setForms((previous) =>
      previous.map((form, formIndex) =>
        formIndex === index ? { ...form, ...patch } : form
      )
    );
  };

  const updateSizes = (index: number, sizes: EditableSize[]) => {
    const form = forms[index];
    if (!form) return;
    const complete = sizeRowsToDraftSizes(sizes);
    const next: DraftForm = {
      ...form,
      sizes,
      quantity: complete.length > 0 ? String(totalSizeQuantity(complete)) : '',
      size: primarySize(complete) ?? '',
    };
    setForms((previous) =>
      previous.map((form, formIndex) =>
        formIndex === index ? next : form
      )
    );
    void updateAiDraft(form.id, formPatch(next)).catch(() => {
      // Edits are also persisted again on confirm.
    });
  };

  const persistForm = (form: DraftForm) => {
    void updateAiDraft(form.id, formPatch(form)).catch(() => {
      // Edits are also persisted again on confirm.
    });
  };

  const persistType = (index: number, typeId: string) => {
    const form = forms[index];
    if (!form) return;
    updateField(index, { typeId });
    void updateAiDraft(form.id, { type_id: typeId }).catch(() => {});
  };

  const labelCopies = (form: DraftForm, status: AiDraftStatus): number => {
    const entries = sizeRowsToDraftSizes(form.sizes);
    const selectedSizes = form.sizes
      .map((entry) => entry.size.trim())
      .filter(Boolean);
    if (status === 'stock_added') {
      return entries.length > 0
        ? Math.max(1, totalSizeQuantity(entries))
        : Math.max(1, Math.floor(parseQuantity(form.quantity) ?? 1));
    }
    return Math.max(1, selectedSizes.length || 1);
  };

  const labelButtonTitle = (form: DraftForm, status: AiDraftStatus): string => {
    const copies = labelCopies(form, status);
    return copies > 1
      ? t('ai.printLabelsCount', { count: copies })
      : t('ai.printLabel');
  };

  const buildLabels = async (entry: ConfirmedDraft): Promise<LabelProduct[]> => {
    const product = await getProductById(entry.productId);
    if (!product) return [];

    const sizes = sizeRowsToDraftSizes(entry.form.sizes);
    const selectedSizes = entry.form.sizes
      .map((row) => row.size.trim())
      .filter(Boolean);
    const fallbackSize = entry.form.size.trim() || product.size || '';
    const fallbackQty = Math.max(
      1,
      Math.floor(parseQuantity(entry.form.quantity) ?? 1)
    );
    const rows =
      entry.status === 'stock_added'
        ? sizes.length > 0
          ? sizes
          : [{ size: fallbackSize, quantity: fallbackQty }]
        : selectedSizes.length > 0
          ? selectedSizes.map((size) => ({ size, quantity: 1 }))
          : [{ size: fallbackSize, quantity: 1 }];

    return rows.map((row) => ({
      ...product,
      name: product.name?.trim() || entry.form.name.trim() || t('ai.untitledProduct'),
      size: row.size,
      cost_price: product.cost_price ?? parseMoney(entry.form.cost) ?? 0,
      price: product.price ?? parseMoney(entry.form.mrp) ?? 0,
      barcode: product.barcode?.trim() || entry.form.barcode.trim() || product.id,
      qty: entry.status === 'stock_added' ? row.quantity : 1,
    }));
  };

  const printLabels = async (entries: ConfirmedDraft[]) => {
    if (entries.length === 0 || printingId !== null) return;
    setPrintingId(entries.length === 1 ? entries[0].form.id : 'all');
    try {
      const labelGroups = await Promise.all(entries.map(buildLabels));
      const labels = labelGroups.flat();
      if (labels.length === 0) {
        Alert.alert(t('ai.printFailed'), t('ai.error.not_found'));
        return;
      }
      // Loaded on demand: Expo printing is only needed after a confirmation.
      const { printProductLabels } = await import('../src/services/printService');
      await printProductLabels(labels);
    } catch (error: any) {
      Alert.alert(t('ai.printFailed'), error?.message ?? t('ai.couldNotPrint'));
    } finally {
      setPrintingId(null);
    }
  };

  const discardDraft = (index: number) => {
    const form = forms[index];
    if (!form) return;
    Alert.alert(t('ai.discardTitle'), t('ai.discardPrompt'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('ai.discard'),
        style: 'destructive',
        onPress: async () => {
          try {
            await setAiDraftStatus(form.id, 'discarded');
            updateField(index, { status: 'discarded' });
          } catch {
            Alert.alert(t('ai.error.title'), t('ai.error.generic'));
          }
        },
      },
    ]);
  };

  const resolveLinkedId = (form: DraftForm): string | null => {
    const draft = formToDraft(form);
    const duplicate = findDuplicateProduct(draft, products);
    const override = links[form.id];

    if (override === null && duplicate?.reason === 'barcode') {
      // A duplicate barcode can never become a second product.
      return duplicate.product.id;
    }
    if (override !== undefined) return override;
    return duplicate?.reason === 'barcode' ? duplicate.product.id : null;
  };

  const showValidation = (issues: string[]) => {
    if (issues.length === 0) return;
    Alert.alert(t('ai.error.title'), t(`ai.error.${issues[0]}`));
  };

  const confirmOne = async (index: number) => {
    const form = forms[index];
    if (!form || form.status !== 'pending' || busyId || busyAll) return;

    const draft = formToDraft(form);
    const linkedId = resolveLinkedId(form);
    const stockEntries = sizeRowsToDraftSizes(form.sizes);
    const sizeIssue =
      linkedId || form.receiveStock
        ? sizeRowsIssue(form.sizes, true)
        : null;
    if (sizeIssue) {
      showValidation([sizeIssue]);
      return;
    }
    const issues = linkedId
      ? validateDraftForStock(draft)
      : validateDraftForCreate(draft, form.receiveStock);
    if (issues.length > 0) {
      showValidation(issues);
      return;
    }

    setBusyId(form.id);
    try {
      const result = await confirmAiDraft(draft, {
        typeId: form.typeId || null,
        receiveStock: linkedId ? true : form.receiveStock,
        existingProductId: linkedId,
        stockEntries,
      });
      setForms((previous) =>
        previous.map((item, itemIndex) =>
          itemIndex === index
            ? { ...item, status: result.status, productId: result.productId }
            : item
        )
      );
      try {
        setProducts(await getAllProducts());
      } catch {
        // The draft is already saved; a refresh failure is not fatal.
      }
      const entry: ConfirmedDraft = {
        form,
        status: result.status,
        productId: result.productId,
      };
      Alert.alert(
        t('common.success'),
        result.created && !result.stockAdded
          ? t('ai.created')
          : t('ai.stockAdded'),
        [
          { text: t('common.ok'), style: 'cancel' },
          {
            text: labelButtonTitle(form, result.status),
            onPress: () => {
              void printLabels([entry]);
            },
          },
        ]
      );
    } catch (error) {
      const key =
        error instanceof AiDraftError
          ? aiDraftErrorMessageKey(error.code)
          : 'ai.error.generic';
      Alert.alert(t('ai.error.title'), t(key));
    } finally {
      setBusyId(null);
    }
  };

  const runConfirmAll = async () => {
    const pending = forms.filter((form) => form.status === 'pending');
    if (pending.length === 0) return;

    setBusyAll(true);
    const workingProducts = [...products];
    const updates: Record<string, { status: AiDraftStatus; productId: string }> = {};
    const confirmed: ConfirmedDraft[] = [];
    let created = 0;
    let stocked = 0;
    let failed = 0;
    let skipped = 0;

    for (const form of pending) {
      const draft = formToDraft(form);
      const duplicate = findDuplicateProduct(draft, workingProducts);
      const override = links[form.id];
      let linkedId =
        override === null && duplicate?.reason === 'barcode'
          ? duplicate.product.id
          : override !== undefined
            ? override
            : duplicate?.reason === 'barcode'
              ? duplicate.product.id
              : null;

      if (!linkedId && duplicate?.reason === 'name' && override === undefined) {
        // Leave ambiguous name matches for manual review.
        skipped += 1;
        continue;
      }

      const stockEntries = sizeRowsToDraftSizes(form.sizes);
      const sizeIssue =
        linkedId || form.receiveStock
          ? sizeRowsIssue(form.sizes, true)
          : null;
      if (sizeIssue) {
        failed += 1;
        continue;
      }
      const issues = linkedId
        ? validateDraftForStock(draft)
        : validateDraftForCreate(draft, form.receiveStock);
      if (issues.length > 0) {
        failed += 1;
        continue;
      }

      try {
        const result = await confirmAiDraft(draft, {
          typeId: form.typeId || null,
          receiveStock: linkedId ? true : form.receiveStock,
          existingProductId: linkedId,
          stockEntries,
        });
        updates[form.id] = {
          status: result.status,
          productId: result.productId,
        };
        confirmed.push({
          form,
          status: result.status,
          productId: result.productId,
        });
        if (result.created) {
          created += 1;
          workingProducts.push({
            id: result.productId,
            name: form.name.trim(),
            type_id: form.typeId,
            size: '',
            brand: form.brand.trim() || null,
            colour: form.colour.trim() || null,
            cost_price: parseMoney(form.cost) ?? 0,
            price: parseMoney(form.mrp) ?? 0,
            barcode: form.barcode.trim(),
            created_at: new Date().toISOString(),
          });
        }
        if (result.stockAdded) stocked += 1;
      } catch {
        failed += 1;
      }
    }

    setForms((previous) =>
      previous.map((form) => {
        const update = updates[form.id];
        return update ? { ...form, ...update } : form;
      })
    );
    try {
      setProducts(await getAllProducts());
    } catch {
      // Statuses are already persisted; a refresh failure is not fatal.
    } finally {
      setBusyAll(false);
    }

    const totalLabels = confirmed.reduce(
      (sum, entry) => sum + labelCopies(entry.form, entry.status),
      0
    );
    Alert.alert(
      t('ai.confirmAllDoneTitle'),
      t('ai.confirmAllDone', { created, stocked, failed, skipped }),
      confirmed.length > 0
        ? [
            { text: t('common.ok'), style: 'cancel' },
            {
              text:
                totalLabels > 1
                  ? t('ai.printLabelsCount', { count: totalLabels })
                  : t('ai.printLabel'),
              onPress: () => {
                void printLabels(confirmed);
              },
            },
          ]
        : [{ text: t('common.ok') }]
    );
  };

  const confirmAll = () => {
    if (busyAll || busyId) return;
    const pendingCount = forms.filter((form) => form.status === 'pending').length;
    if (pendingCount === 0) {
      Alert.alert(t('ai.noReadyDrafts'), t('ai.noReadyDraftsHint'));
      return;
    }
    Alert.alert(
      t('ai.confirmAllTitle'),
      t('ai.confirmAllPrompt', { count: pendingCount }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('ai.confirmAll'), onPress: runConfirmAll },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const pendingCount = forms.filter((form) => form.status === 'pending').length;
  const sessionErrorKey =
    session?.error_code && KNOWN_AI_ERRORS.has(session.error_code)
      ? `ai.error.${session.error_code}`
      : 'ai.error.generic';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('ai.reviewTitle')}</Text>
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
        {!session ? (
          <EmptyState
            icon="alert-circle-outline"
            title={t('ai.sessionNotFound')}
            subtitle={t('ai.sessionNotFoundHint')}
          />
        ) : (
          <>
            <AppCard style={styles.summaryCard}>
              <View style={styles.summaryHeader}>
                <View style={styles.summaryIcon}>
                  <Ionicons
                    name={session.mode === 'invoice' ? 'receipt-outline' : 'pricetag-outline'}
                    size={22}
                    color={Colors.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryTitle} numberOfLines={1}>
                    {session.supplier_name ||
                      session.invoice_number ||
                      (session.mode === 'invoice' ? t('ai.invoice') : t('ai.label'))}
                  </Text>
                  <Text style={styles.summaryMeta}>
                    {t(session.mode === 'invoice' ? 'ai.invoice' : 'ai.label')}
                    {session.invoice_number ? ` · ${session.invoice_number}` : ''}
                  </Text>
                </View>
                {session.image_quality ? (
                  <Badge
                    label={t(`ai.quality.${session.image_quality}`)}
                    color={
                      session.image_quality === 'good' ? Colors.success : Colors.warning
                    }
                    bgColor={
                      session.image_quality === 'good' ? Colors.successBg : Colors.warningBg
                    }
                  />
                ) : null}
              </View>

              {session.status === 'failed' && (
                <View style={styles.failedBox}>
                  <Text style={styles.failedTitle}>{t('ai.sessionFailed')}</Text>
                  <Text style={styles.failedText}>{t(sessionErrorKey)}</Text>
                  {session.error_message ? (
                    <Text style={styles.failedDetail}>{session.error_message}</Text>
                  ) : null}
                </View>
              )}

              {session.warnings.length > 0 && (
                <View style={styles.warningsBox}>
                  <Text style={styles.warningsTitle}>{t('ai.warningTitle')}</Text>
                  {session.warnings.map((warning, index) => (
                    <Text key={index} style={styles.warningItem}>
                      • {warning}
                    </Text>
                  ))}
                </View>
              )}
            </AppCard>

            {forms.length > 0 && (
              <View style={styles.reviewBar}>
                <Text style={styles.reviewCount}>
                  {forms.length === 1
                    ? t('ai.oneProduct')
                    : t('ai.productCount', { count: forms.length })}
                </Text>
                <AppButton
                  title={
                    busyAll
                      ? t('common.saving')
                      : t('ai.confirmAllCount', { count: pendingCount })
                  }
                  size="sm"
                  onPress={confirmAll}
                  loading={busyAll}
                  disabled={pendingCount === 0 || busyId !== null}
                  icon={<Ionicons name="checkmark-done" size={16} color="#fff" />}
                />
              </View>
            )}

            {forms.length === 0 ? (
              <EmptyState
                icon="documents-outline"
                title={t('ai.reviewEmpty')}
                subtitle={t('ai.reviewEmptyHint')}
              />
            ) : (
              forms.map((form, index) => {
                const draft = formToDraft(form);
                const duplicate = findDuplicateProduct(draft, products);
                const override = links[form.id];
                const linkedId = resolveLinkedId(form);
                const linkedProduct = linkedId
                  ? products.find((product) => product.id === linkedId)
                  : null;
                const isPending = form.status === 'pending';
                const savedProductId = form.productId;
                const colors = statusColor(form.status);

                return (
                  <AppCard key={form.id} style={styles.draftCard}>
                    <View style={styles.draftHeader}>
                      <View style={styles.draftNumber}>
                        <Text style={styles.draftNumberText}>{index + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.draftTitle} numberOfLines={1}>
                          {form.name.trim() || t('ai.untitledProduct')}
                        </Text>
                        {form.confidence !== null ? (
                          <Text style={styles.confidence}>
                            {t('ai.confidence', {
                              pct: Math.round(form.confidence * 100),
                            })}
                          </Text>
                        ) : null}
                      </View>
                      <Badge
                        label={t(statusKey(form.status))}
                        color={colors.color}
                        bgColor={colors.bg}
                      />
                    </View>

                    {duplicate && (
                      <View style={styles.duplicateBox}>
                        <Ionicons
                          name="copy-outline"
                          size={18}
                          color={Colors.warning}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.duplicateTitle}>
                            {duplicate.reason === 'barcode'
                              ? t('ai.duplicateBarcode', {
                                  name: duplicate.product.name,
                                })
                              : t('ai.duplicateName', {
                                  name: duplicate.product.name,
                                })}
                          </Text>
                          {linkedId ? (
                            <Text style={styles.duplicateHint}>
                              {t('ai.linkedTo', {
                                name: linkedProduct?.name ?? duplicate.product.name,
                              })}
                            </Text>
                          ) : (
                            <Text style={styles.duplicateHint}>
                              {t('ai.duplicateHint')}
                            </Text>
                          )}
                        </View>
                        <View style={styles.duplicateActions}>
                          {linkedId ? (
                            duplicate.reason !== 'barcode' ? (
                              <TouchableOpacity
                                onPress={() =>
                                  setLinks((previous) => ({
                                    ...previous,
                                    [form.id]: null,
                                  }))
                                }
                              >
                                <Text style={styles.duplicateAction}>
                                  {t('ai.createNew')}
                                </Text>
                              </TouchableOpacity>
                            ) : null
                          ) : (
                            <TouchableOpacity
                              onPress={() =>
                                setLinks((previous) => ({
                                  ...previous,
                                  [form.id]: duplicate.product.id,
                                }))
                              }
                            >
                              <Text style={styles.duplicateAction}>
                                {t('ai.useExisting')}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    )}

                    <AppInput
                      label={t('ai.name')}
                      value={form.name}
                      onChangeText={(value) => updateField(index, { name: value })}
                      onBlur={() => persistForm(form)}
                      placeholder={t('ai.namePlaceholder')}
                      editable={isPending}
                    />

                    <View style={styles.row}>
                      <AppInput
                        label={t('ai.brand')}
                        value={form.brand}
                        onChangeText={(value) => updateField(index, { brand: value })}
                        onBlur={() => persistForm(form)}
                        placeholder={t('ai.brandPlaceholder')}
                        style={{ flex: 1 }}
                        editable={isPending}
                      />
                      <AppInput
                        label={t('ai.colour')}
                        value={form.colour}
                        onChangeText={(value) => updateField(index, { colour: value })}
                        onBlur={() => persistForm(form)}
                        placeholder={t('ai.colourPlaceholder')}
                        style={{ flex: 1 }}
                        editable={isPending}
                      />
                    </View>

                    <Text style={styles.fieldLabel}>{t('ai.category')}</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.typeRow}
                      contentContainerStyle={{ gap: Spacing.sm }}
                    >
                      {types.map((type) => {
                        const active = form.typeId === type.id;
                        return (
                          <TouchableOpacity
                            key={type.id}
                            disabled={!isPending}
                            style={[styles.typeChip, active && styles.typeChipActive]}
                            onPress={() => persistType(index, type.id)}
                          >
                            <Text
                              style={[
                                styles.typeChipText,
                                active && styles.typeChipTextActive,
                              ]}
                            >
                              {type.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    <Text style={styles.fieldHint}>{t('ai.categoryHint')}</Text>
                    {form.typeHint ? (
                      <Text style={styles.suggestion}>
                        {t('ai.suggestedType', { hint: form.typeHint })}
                      </Text>
                    ) : null}

                    <View style={styles.row}>
                      <AppInput
                        label={t('ai.costPrice')}
                        value={form.cost}
                        onChangeText={(value) => updateField(index, { cost: value })}
                        onBlur={() => persistForm(form)}
                        keyboardType="numeric"
                        placeholder={t('ai.costPlaceholder')}
                        style={{ flex: 1 }}
                        editable={isPending}
                      />
                      <AppInput
                        label={t('ai.mrp')}
                        value={form.mrp}
                        onChangeText={(value) => updateField(index, { mrp: value })}
                        onBlur={() => persistForm(form)}
                        keyboardType="numeric"
                        placeholder={t('ai.mrpPlaceholder')}
                        style={{ flex: 1 }}
                        editable={isPending}
                      />
                    </View>

                    <SizeQuantityEditor
                      sizes={form.sizes}
                      onChange={(sizes) => updateSizes(index, sizes)}
                      disabled={!isPending}
                      title={t('ai.sizes')}
                      hint={t('ai.sizesHint')}
                    />

                    <AppInput
                      label={t('ai.barcode')}
                      value={form.barcode}
                      onChangeText={(value) => updateField(index, { barcode: value })}
                      onBlur={() => persistForm(form)}
                      placeholder={t('ai.barcodePlaceholder')}
                      editable={isPending}
                    />

                    {linkedId ? (
                      <View style={styles.linkedBox}>
                        <Ionicons name="link-outline" size={18} color={Colors.info} />
                        <Text style={styles.linkedText}>
                          {t('ai.linkedStockHint', {
                            name: linkedProduct?.name ?? t('ai.existingProduct'),
                          })}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.switchRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.switchTitle}>{t('ai.receiveStock')}</Text>
                          <Text style={styles.switchHint}>{t('ai.receiveStockHint')}</Text>
                        </View>
                        <Switch
                          value={form.receiveStock}
                          onValueChange={(value) => updateField(index, { receiveStock: value })}
                          disabled={!isPending}
                          trackColor={{ false: Colors.surfaceHighlight, true: Colors.primary }}
                          thumbColor="#fff"
                        />
                      </View>
                    )}

                    {isPending ? (
                      <View style={styles.actions}>
                        <AppButton
                          title={t('ai.confirm')}
                          onPress={() => confirmOne(index)}
                          loading={busyId === form.id}
                          disabled={busyAll || (busyId !== null && busyId !== form.id)}
                          style={{ flex: 1 }}
                        />
                        <AppButton
                          title={t('ai.discard')}
                          variant="danger"
                          size="sm"
                          onPress={() => discardDraft(index)}
                          disabled={busyId !== null || busyAll}
                        />
                      </View>
                    ) : (
                      <View style={styles.doneRow}>
                        <View style={styles.doneStatus}>
                          <Ionicons
                            name={
                              form.status === 'discarded'
                                ? 'close-circle-outline'
                                : 'checkmark-circle'
                            }
                            size={18}
                            color={colors.color}
                          />
                          <Text style={[styles.doneText, { color: colors.color }]}>
                            {t(statusKey(form.status))}
                          </Text>
                        </View>
                        {savedProductId && form.status !== 'discarded' ? (
                          <AppButton
                            title={labelButtonTitle(form, form.status)}
                            variant="secondary"
                            size="sm"
                            icon={<Ionicons name="print-outline" size={16} color={Colors.text} />}
                            onPress={() => {
                              void printLabels([
                                { form, status: form.status, productId: savedProductId },
                              ]);
                            }}
                            loading={printingId === form.id}
                            disabled={printingId !== null && printingId !== form.id}
                          />
                        ) : null}
                      </View>
                    )}
                  </AppCard>
                );
              })
            )}
          </>
        )}

          <View style={{ height: Spacing.xxxl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  keyboardView: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  summaryCard: { marginBottom: Spacing.lg },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  summaryIcon: {
    width: 46,
    height: 46,
    borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(108,92,231,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  summaryMeta: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 2 },
  failedBox: {
    backgroundColor: Colors.dangerBg,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  failedTitle: { color: Colors.danger, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  failedText: { color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 2, lineHeight: 18 },
  failedDetail: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 4 },
  warningsBox: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  warningsTitle: {
    color: Colors.warning,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    marginBottom: 4,
  },
  warningItem: { color: Colors.textMuted, fontSize: FontSize.xs, lineHeight: 17 },
  reviewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  reviewCount: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  draftCard: { marginBottom: Spacing.md },
  draftHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  draftNumber: {
    width: 30,
    height: 30,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftNumberText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  draftTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  confidence: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 },
  duplicateBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: 'rgba(255,170,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,170,0,0.18)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  duplicateTitle: { color: Colors.warning, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, lineHeight: 18 },
  duplicateHint: { color: Colors.textMuted, fontSize: FontSize.xs, lineHeight: 16, marginTop: 2 },
  duplicateActions: { paddingTop: 1 },
  duplicateAction: { color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  row: { flexDirection: 'row', gap: Spacing.md },
  fieldLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  typeRow: { flexDirection: 'row', marginBottom: Spacing.xs, maxHeight: 40 },
  typeChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: Spacing.sm,
  },
  typeChipActive: { backgroundColor: 'rgba(108,92,231,0.15)', borderColor: Colors.primary },
  typeChipText: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  typeChipTextActive: { color: Colors.primary },
  fieldHint: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 4, marginBottom: Spacing.sm },
  suggestion: { color: Colors.textSecondary, fontSize: FontSize.xs, marginBottom: Spacing.md },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  switchTitle: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  switchHint: { color: Colors.textMuted, fontSize: FontSize.xs, lineHeight: 16, marginTop: 2 },
  linkedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(0,149,255,0.08)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  linkedText: { color: Colors.info, fontSize: FontSize.sm, flex: 1, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  doneStatus: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1 },
  doneText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
