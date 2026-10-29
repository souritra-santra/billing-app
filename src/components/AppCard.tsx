import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, BorderRadius, Spacing, Shadows } from '../constants/theme';

interface Props {
    children: React.ReactNode;
    style?: ViewStyle;
    variant?: 'default' | 'elevated' | 'outlined';
}

export default function AppCard({ children, style, variant = 'default' }: Props) {
    return (
        <View style={[styles.card, variant === 'elevated' && styles.elevated, variant === 'outlined' && styles.outlined, style]}>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: Colors.surface,
        borderRadius: BorderRadius.lg,
        padding: Spacing.lg,
        borderWidth: 1,
        borderColor: Colors.border,
    },
    elevated: {
        ...Shadows.md,
        borderColor: 'transparent',
    },
    outlined: {
        backgroundColor: 'transparent',
        borderColor: Colors.borderLight,
    },
});
