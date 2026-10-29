/**
 * Minimal, dependency-free Code 128 (Code Set B) encoder that renders to an
 * inline SVG string. Used for label printing so the app stays 100% offline —
 * no more fetching barcode images from a remote service.
 */

// Standard Code 128 module-width patterns for symbols 0..106.
// Each digit is a run length (bar, space, bar, space, bar, space...).
const CODE128_PATTERNS: string[] = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213',
    '122312', '132212', '221213', '221312', '231212', '112232', '122132',
    '122231', '113222', '123122', '123221', '223211', '221132', '221231',
    '213212', '223112', '312131', '311222', '321122', '321221', '312212',
    '322112', '322211', '212123', '212321', '232121', '111323', '131123',
    '131321', '112313', '132113', '132311', '211313', '231113', '231311',
    '112133', '112331', '132131', '113123', '113321', '133121', '313121',
    '211331', '231131', '213113', '213311', '213131', '311123', '311321',
    '331121', '312113', '312311', '332111', '314111', '221411', '431111',
    '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114',
    '413111', '241112', '134111', '111242', '121142', '121241', '114212',
    '124112', '124211', '411212', '421112', '421211', '212141', '214121',
    '412121', '111143', '111341', '131141', '114113', '114311', '411113',
    '411311', '113141', '114131', '311141', '411131', '211412', '211214',
    '211232', '2331112',
];

const START_B = 104;
const STOP = 106;
const QUIET_ZONE_MODULES = 10;

/** True when every character can be represented in Code Set B (ASCII 32-126). */
export function isCode128Encodable(text: string): boolean {
    if (!text) return false;
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        if (code < 32 || code > 126) return false;
    }
    return true;
}

/** Encodes text to a string of '1' (bar) / '0' (space) modules. */
export function encodeCode128B(text: string): string {
    const values = Array.from(text).map((ch) => ch.charCodeAt(0) - 32);
    const codes = [START_B, ...values];

    let checksum = START_B;
    values.forEach((value, index) => {
        checksum += value * (index + 1);
    });
    codes.push(checksum % 103, STOP);

    let modules = '';
    for (const code of codes) {
        const pattern = CODE128_PATTERNS[code];
        let isBar = true;
        for (const run of pattern) {
            modules += (isBar ? '1' : '0').repeat(Number(run));
            isBar = !isBar;
        }
    }
    return modules;
}

/**
 * Renders a scannable Code 128 barcode as an inline SVG string.
 * The SVG stretches to the width of its container while keeping bar ratios.
 */
export function code128ToSvg(text: string, options: { height?: number } = {}): string {
    if (!isCode128Encodable(text)) {
        // Fall back to a plain text marker; caller still shows the raw value.
        return '';
    }

    const modules = encodeCode128B(text);
    const totalWidth = modules.length + QUIET_ZONE_MODULES * 2;
    const height = options.height ?? 100;
    const barTop = height * 0.08;
    const barHeight = height * 0.84;

    let bars = '';
    let runStart = -1;
    for (let i = 0; i <= modules.length; i++) {
        const isBar = modules[i] === '1';
        if (isBar && runStart === -1) {
            runStart = i;
        } else if (!isBar && runStart !== -1) {
            bars += `<rect x="${runStart + QUIET_ZONE_MODULES}" y="${barTop}" width="${i - runStart}" height="${barHeight}" fill="#000000" />`;
            runStart = -1;
        }
    }

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" ` +
        `preserveAspectRatio="none" role="img" aria-label="${text.replace(/[&<>"']/g, '')}">` +
        `<rect x="0" y="0" width="${totalWidth}" height="${height}" fill="#ffffff" />` +
        bars +
        `</svg>`
    );
}
