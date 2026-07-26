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
