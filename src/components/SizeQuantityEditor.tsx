import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../constants/theme';
import { LABEL_OFFSET, SIZE_GROUPS } from '../constants/sizes';
import AppCard from './AppCard';
import AppInput from './AppInput';
import { useLanguage } from '../i18n';
import { EditableSize } from '../ai/sizes';

interface Props {
  sizes: EditableSize[];
  onChange: (sizes: EditableSize[]) => void;
  disabled?: boolean;
  title?: string;
  hint?: string;
  /** Optional keyboard-scroll hooks used by the Add Product screen. */
  onFieldFocus?: (key: string) => void;
  onFieldLayout?: (key: string, y: number) => void;
}

/**
 * Size-group picker + per-size quantity rows. Mirrors the Add Product screen
 * so stock received from an AI import uses the same size model.
 */
export default function SizeQuantityEditor({
  sizes,
  onChange,
  disabled = false,
  title,
  hint,
  onFieldFocus,
  onFieldLayout,
}: Props) {
  const { t } = useLanguage();
  const [activeGroup, setActiveGroup] = useState('letter');
  const [customSize, setCustomSize] = useState('');

  const addSize = (sizeName: string) => {
    const size = sizeName.trim();
    if (!size || sizes.some((entry) => entry.size.toLowerCase() === size.toLowerCase())) {
      return;
    }
    onChange([...sizes, { size, qty: '0' }]);
  };

  const addCustom = () => {
    const size = customSize.trim();
    if (!size) {
      Alert.alert(t('addProduct.customSize'), t('addProduct.customSizeError'));
      return;
    }
    addSize(size);
    setCustomSize('');
  };

  const updateQuantity = (index: number, value: string) => {
    onChange(
      sizes.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, qty: value } : entry
      )
    );
  };

  const removeSize = (index: number) => {
    onChange(sizes.filter((_, entryIndex) => entryIndex !== index));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>{title ?? t('addProduct.inventorySizes')}</Text>
      <Text style={styles.subtitle}>{hint ?? t('addProduct.sizeHint')}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.groupRow}
      >
        {SIZE_GROUPS.map((group) => {
          const active = activeGroup === group.id;
          return (
            <TouchableOpacity
              key={group.id}
              disabled={disabled}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setActiveGroup(group.id)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {t(group.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.sizeOptions}>
        {(SIZE_GROUPS.find((group) => group.id === activeGroup)?.sizes ?? []).map(
          (size) => {
            const selected = sizes.some(
              (entry) => entry.size.toLowerCase() === size.toLowerCase()
            );
            return (
              <TouchableOpacity
                key={size}
                disabled={disabled}
                style={[styles.sizeButton, selected && styles.sizeButtonSelected]}
                onPress={() => addSize(size)}
              >
                <Text
                  style={[
                    styles.sizeButtonText,
                    selected && styles.sizeButtonTextSelected,
                  ]}
                >
                  {size}
                </Text>
              </TouchableOpacity>
            );
          }
        )}
        {customSize.trim() !== '' &&
        !sizes.some(
          (entry) => entry.size.toLowerCase() === customSize.trim().toLowerCase()
        ) ? (
          <TouchableOpacity
            disabled={disabled}
            style={[styles.sizeButton, styles.customButton]}
            onPress={addCustom}
          >
            <Text style={styles.customButtonText}>+ {customSize.trim()}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View
        style={styles.customRow}
        onLayout={(event) =>
          onFieldLayout?.('customSize', event.nativeEvent.layout.y)
        }
      >
        <AppInput
          label={t('addProduct.customSize')}
          value={customSize}
          onChangeText={setCustomSize}
          placeholder={t('addProduct.customPlaceholder')}
          style={styles.flexInput}
          editable={!disabled}
          onFocus={() => onFieldFocus?.('customSize')}
        />
        <TouchableOpacity
          style={[styles.addCustomButton, disabled && styles.disabledButton]}
          onPress={addCustom}
          disabled={disabled}
        >
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {sizes.length > 0 ? (
        <AppCard style={styles.sizesCard}>
          {sizes.map((entry, index) => (
            <View
              key={`${entry.size}-${index}`}
              style={styles.sizeInputRow}
              onLayout={(event) =>
                onFieldLayout?.(`sizeQty_${index}`, event.nativeEvent.layout.y)
              }
            >
              <View style={styles.sizeLabelWrap}>
                <Text style={styles.sizeLabel}>{entry.size}</Text>
              </View>
              <AppInput
                label={t('addProduct.quantity')}
                value={entry.qty}
                onChangeText={(value) => updateQuantity(index, value)}
                keyboardType="numeric"
                style={styles.flexInput}
                editable={!disabled}
                onFocus={() => onFieldFocus?.(`sizeQty_${index}`)}
              />
              {!disabled ? (
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => removeSize(index)}
                >
                  <Ionicons name="trash-outline" size={20} color={Colors.danger} />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </AppCard>
      ) : (
        <Text style={styles.emptyText}>{t('ai.noSizes')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.md },
  sectionTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    marginBottom: Spacing.md,
    marginTop: Spacing.xs,
  },
  groupRow: { flexDirection: 'row', marginBottom: Spacing.md },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: Spacing.sm,
  },
  chipActive: {
    backgroundColor: 'rgba(108,92,231,0.15)',
    borderColor: Colors.primary,
  },
  chipText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  chipTextActive: { color: Colors.primary },
  sizeOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  sizeButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sizeButtonSelected: { backgroundColor: Colors.primary },
  sizeButtonText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  sizeButtonTextSelected: { color: '#fff' },
  customButton: {
    width: 'auto',
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surfaceHighlight,
    borderColor: Colors.primary,
  },
  customButtonText: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flexInput: { flex: 1, marginBottom: 0 },
  addCustomButton: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: LABEL_OFFSET,
  },
  disabledButton: { opacity: 0.5 },
  sizesCard: { marginTop: Spacing.lg, marginBottom: 0 },
  sizeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  sizeLabelWrap: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    marginTop: LABEL_OFFSET,
  },
  sizeLabel: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  removeButton: {
    padding: Spacing.sm,
    marginTop: LABEL_OFFSET,
    marginLeft: Spacing.sm,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    marginTop: Spacing.sm,
  },
});
