import { PaperWidth } from '../../types/models';

export interface PaperSpec {
    /** Human label, e.g. `58mm (2")`. */
    label: string;
    /** Full roll width in millimetres. Used for the CSS `@page` size. */
    widthMm: number;
    /** Printable width (roll minus margins) in millimetres. */
    printableMm: number;
    /** Printable width in printer dots (203 dpi thermal heads). */
    dots: number;
    /** Characters per line using the printer's default Font A. */
    charWidth: number;
}

export const PAPER_SPECS: Record<PaperWidth, PaperSpec> = {
    58: { label: '58mm (2")', widthMm: 58, printableMm: 48, dots: 384, charWidth: 32 },
    80: { label: '80mm (3")', widthMm: 80, printableMm: 72, dots: 576, charWidth: 48 },
};

export const PAPER_WIDTH_OPTIONS: PaperWidth[] = [58, 80];

export function getPaperSpec(width: PaperWidth): PaperSpec {
    return PAPER_SPECS[width] ?? PAPER_SPECS[80];
}
