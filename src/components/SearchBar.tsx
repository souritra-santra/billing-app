import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/theme';

interface Props {
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
}

export default function SearchBar({ value, onChangeText, placeholder = 'Search...' }: Props) {
    return (
        <View style={styles.container}>
            <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
            <TextInput
                style={styles.input}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={Colors.textMuted}
                selectionColor={Colors.primary}
            />
            {value.length > 0 && (
                <Ionicons name="close-circle" size={18} color={Colors.textMuted} onPress={() => onChangeText('')} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.surfaceLight,
        borderRadius: BorderRadius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        gap: Spacing.sm,
        borderWidth: 1,
        borderColor: Colors.border,
    },
    input: {
        flex: 1,
        color: Colors.text,
        fontSize: FontSize.md,
        paddingVertical: Spacing.xs,
    },
});
