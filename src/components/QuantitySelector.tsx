import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, BorderRadius, Spacing, FontSize, FontWeight } from '../constants/theme';

interface Props {
    value: number;
    onIncrement: () => void;
    onDecrement: () => void;
    max?: number;
}

export default function QuantitySelector({ value, onIncrement, onDecrement, max }: Props) {
    return (
        <View style={styles.container}>
            <TouchableOpacity
                style={[styles.btn, value <= 1 && styles.btnDisabled]}
                onPress={onDecrement}
                disabled={value <= 1}
                activeOpacity={0.7}
            >
                <Ionicons name="remove" size={18} color={value <= 1 ? Colors.textMuted : Colors.text} />
            </TouchableOpacity>
            <Text style={styles.value}>{value}</Text>
            <TouchableOpacity
                style={[styles.btn, max !== undefined && value >= max && styles.btnDisabled]}
                onPress={onIncrement}
                disabled={max !== undefined && value >= max}
                activeOpacity={0.7}
            >
                <Ionicons name="add" size={18} color={max !== undefined && value >= max ? Colors.textMuted : Colors.text} />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.surfaceLight,
        borderRadius: BorderRadius.sm,
        borderWidth: 1,
        borderColor: Colors.border,
    },
    btn: {
        padding: Spacing.sm,
    },
    btnDisabled: {
        opacity: 0.4,
    },
    value: {
        color: Colors.text,
        fontSize: FontSize.md,
        fontWeight: FontWeight.semibold,
        minWidth: 32,
        textAlign: 'center',
    },
});
