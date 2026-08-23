export interface ShippedFontDefinition {
    readonly fileName: string;
    readonly typeFace: string;
    readonly size: number;
    readonly weight?: number;
    readonly strikeout?: boolean;
}

/** Exact `name: "main_interface"` record from public/assets/scripts/fonts.scr. */
export const MAIN_INTERFACE_FONT = Object.freeze({
    fileName: "pala.ttf",
    typeFace: "palatino linotype",
    size: 12,
    weight: 500,
} satisfies ShippedFontDefinition);

/** Exact `name: "main_interface_so"` record from public/assets/scripts/fonts.scr. */
export const MAIN_INTERFACE_STRIKEOUT_FONT = Object.freeze({
    fileName: "pala.ttf",
    typeFace: "palatino linotype",
    size: 12,
    weight: 500,
    strikeout: true,
} satisfies ShippedFontDefinition);

/** Exact `name: "heads_interface"` record from public/assets/scripts/fonts.scr. */
export const HEADS_INTERFACE_FONT = Object.freeze({
    fileName: "pala.ttf",
    typeFace: "palatino linotype",
    size: 14,
    weight: 600,
} satisfies ShippedFontDefinition);

/** Exact `name: "button_heads_interface"` record from public/assets/scripts/fonts.scr. */
export const BUTTON_HEADS_INTERFACE_FONT = Object.freeze({
    fileName: "pala.ttf",
    typeFace: "palatino linotype",
    size: 18,
    weight: 600,
} satisfies ShippedFontDefinition);

/** Exact `name: "console"` record from public/assets/scripts/fonts.scr. */
export const CONSOLE_FONT = Object.freeze({
    fileName: "console.ttf",
    typeFace: "lucida console",
    size: 10,
} satisfies ShippedFontDefinition);

/** Exact `name: "extra_small_interface"` record from public/assets/scripts/fonts.scr. */
export const EXTRA_SMALL_INTERFACE_FONT = Object.freeze({
    fileName: "pala.ttf",
    typeFace: "palatino linotype",
    size: 7,
    weight: 300,
} satisfies ShippedFontDefinition);

/** Exact `name: "n_small_interface"` record from public/assets/scripts/fonts.scr. */
export const N_SMALL_INTERFACE_FONT = Object.freeze({
    fileName: "pala.ttf",
    typeFace: "palatino linotype",
    size: 10,
    weight: 400,
} satisfies ShippedFontDefinition);

/** Exact `name: "arial"` record from public/assets/scripts/fonts.scr. */
export const ARIAL_FONT = Object.freeze({
    fileName: "arial.ttf",
    typeFace: "Arial",
    size: 8,
    weight: 700,
} satisfies ShippedFontDefinition);

/**
 * Native font loader treats fonts.scr `size` as a POINT size and converts it to
 * a GDI em height: CreateFontA(-MulDiv(size, LOGPIXELSY, 72), ...)
 * (Client.dll 0x1203018f GetDeviceCaps(LOGPIXELSY=90) -> 0x120301a1 MulDiv -> 0x120301b0 negl).
 * The native DPI is the runtime GetDeviceCaps(hdc, LOGPIXELSY) value, not a
 * constant; 96 is our CSS-reference choice (1 CSS px = 1/96 in). So size 7 -> 9px
 * and size 8 -> 11px at the chosen 96-DPI reference.
 */
export function pointSizeToPixels(size: number): number {
    return Math.round((size * 96) / 72);
}
