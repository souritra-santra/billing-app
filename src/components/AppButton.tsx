import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { Colors, BorderRadius, FontSize, FontWeight, Spacing } from '../constants/theme';

interface Props {
    title: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
    style?: ViewStyle;
}

export default function AppButton({
    title,
    onPress,
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    icon,
    style,
}: Props) {
    const buttonStyles: ViewStyle[] = [styles.base, styles[`size_${size}`], styles[`variant_${variant}`]];
    const textStyles: TextStyle[] = [styles.text, styles[`text_${size}`], styles[`textColor_${variant}`]];

    if (disabled) {
        buttonStyles.push(styles.disabled);
    }

    return (
        <TouchableOpacity
            style={[...buttonStyles, style]}
            onPress={onPress}
            disabled={disabled || loading}
            activeOpacity={0.7}
        >
            {loading ? (
                <ActivityIndicator color={variant === 'primary' ? '#fff' : Colors.primary} size="small" />
            ) : (
                <>
                    {icon}
                    <Text style={textStyles}>{title}</Text>
                </>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
    },
    size_sm: {
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.lg,
        borderRadius: BorderRadius.sm,
    },
    size_md: {
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.xl,
        borderRadius: BorderRadius.md,
    },
    size_lg: {
        paddingVertical: Spacing.lg,
        paddingHorizontal: Spacing.xxl,
        borderRadius: BorderRadius.lg,
    },
    variant_primary: {
        backgroundColor: Colors.primary,
    },
    variant_secondary: {
        backgroundColor: Colors.surfaceLight,
        borderWidth: 1,
        borderColor: Colors.borderLight,
    },
    variant_ghost: {
        backgroundColor: 'transparent',
    },
    variant_danger: {
        backgroundColor: Colors.dangerBg,
    },
    disabled: {
        opacity: 0.5,
    },
    text: {
        fontWeight: FontWeight.semibold,
    },
    text_sm: { fontSize: FontSize.sm },
    text_md: { fontSize: FontSize.md },
    text_lg: { fontSize: FontSize.lg },
    textColor_primary: { color: '#FFFFFF' },
    textColor_secondary: { color: Colors.text },
    textColor_ghost: { color: Colors.primary },
    textColor_danger: { color: Colors.danger },
});
