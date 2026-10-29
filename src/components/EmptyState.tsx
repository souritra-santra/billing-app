import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../constants/theme';

interface Props {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle?: string;
}

export default function EmptyState({ icon, title, subtitle }: Props) {
    return (
        <View style={styles.container}>
            <View style={styles.iconWrap}>
                <Ionicons name={icon} size={48} color={Colors.textMuted} />
            </View>
            <Text style={styles.title}>{title}</Text>
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: Spacing.xxxl * 2,
        paddingHorizontal: Spacing.xxl,
    },
    iconWrap: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: Colors.surfaceLight,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: Spacing.lg,
    },
    title: {
        color: Colors.textSecondary,
        fontSize: FontSize.lg,
        fontWeight: FontWeight.semibold,
        textAlign: 'center',
    },
    subtitle: {
        color: Colors.textMuted,
        fontSize: FontSize.sm,
        textAlign: 'center',
        marginTop: Spacing.sm,
        lineHeight: 20,
    },
});
