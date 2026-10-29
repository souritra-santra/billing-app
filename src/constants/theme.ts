export const Colors = {
    // Base
    background: '#0F0D23',
    surface: '#1A1832',
    surfaceLight: '#252344',
    surfaceHighlight: '#312F54',

    // Text
    text: '#FFFFFF',
    textSecondary: '#9896B0',
    textMuted: '#6B6985',

    // Accent
    primary: '#6C5CE7',
    primaryLight: '#8577ED',
    primaryDark: '#5A4BD4',

    // Warm accent
    accent: '#F5A623',
    accentLight: '#F7B84E',

    // Status
    success: '#00D68F',
    successBg: 'rgba(0, 214, 143, 0.12)',
    warning: '#FFAA00',
    warningBg: 'rgba(255, 170, 0, 0.12)',
    danger: '#FF3D71',
    dangerBg: 'rgba(255, 61, 113, 0.12)',
    info: '#0095FF',

    // Borders
    border: 'rgba(255, 255, 255, 0.06)',
    borderLight: 'rgba(255, 255, 255, 0.10)',

    // Overlays
    overlay: 'rgba(15, 13, 35, 0.8)',
    glass: 'rgba(26, 24, 50, 0.7)',
};

export const Spacing = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
};

export const BorderRadius = {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    full: 999,
};

export const FontSize = {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    xxxl: 32,
    display: 40,
};

export const FontWeight = {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
};

export const Shadows = {
    sm: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 2,
    },
    md: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    lg: {
        shadowColor: '#6C5CE7',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 6,
    },
};
