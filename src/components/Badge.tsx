import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, BorderRadius, Spacing, FontSize, FontWeight } from '../constants/theme';

interface Props {
    label: string;
    color?: string;
    bgColor?: string;
    size?: 'sm' | 'md';
}

export default function Badge({ label, color, bgColor, size = 'sm' }: Props) {
    return (
        <View
            style={[
                styles.badge,
                size === 'md' && styles.badgeMd,
                { backgroundColor: bgColor || Colors.surfaceHighlight },
            ]}
        >
            <Text style={[styles.text, size === 'md' && styles.textMd, { color: color || Colors.textSecondary }]}>
                {label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    badge: {
        paddingHorizontal: Spacing.sm,
        paddingVertical: 2,
        borderRadius: BorderRadius.full,
    },
    badgeMd: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
    },
    text: {
        fontSize: FontSize.xs,
        fontWeight: FontWeight.semibold,
    },
    textMd: {
        fontSize: FontSize.sm,
    },
});
