import React from 'react';
import { View, TextInput, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors, BorderRadius, Spacing, FontSize, FontWeight } from '../constants/theme';

interface Props {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'email-address';
    multiline?: boolean;
    style?: ViewStyle;
    editable?: boolean;
    /** Fired when the wrapped TextInput gains focus. */
    onFocus?: () => void;
    onBlur?: () => void;
    secureTextEntry?: boolean;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    autoCorrect?: boolean;
}

export default function AppInput({
    label,
    value,
    onChangeText,
    placeholder,
    keyboardType = 'default',
    multiline = false,
    style,
    editable = true,
    onFocus,
    onBlur,
    secureTextEntry = false,
    autoCapitalize = 'sentences',
    autoCorrect = true,
}: Props) {
    return (
        <View style={[styles.container, style]}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
                style={[styles.input, multiline && styles.multiline, !editable && styles.disabled]}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={Colors.textMuted}
                keyboardType={keyboardType}
                multiline={multiline}
                editable={editable}
                onFocus={onFocus}
                onBlur={onBlur}
                secureTextEntry={secureTextEntry}
                autoCapitalize={autoCapitalize}
                autoCorrect={autoCorrect}
                selectionColor={Colors.primary}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: Spacing.lg,
    },
    label: {
        color: Colors.textSecondary,
        fontSize: FontSize.sm,
        fontWeight: FontWeight.medium,
        marginBottom: Spacing.sm,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    input: {
        backgroundColor: Colors.surfaceLight,
        borderRadius: BorderRadius.md,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        color: Colors.text,
        fontSize: FontSize.md,
        borderWidth: 1,
        borderColor: Colors.border,
    },
    multiline: {
        minHeight: 80,
        textAlignVertical: 'top',
    },
    disabled: {
        opacity: 0.6,
    },
});
