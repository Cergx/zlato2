import { Paths } from "../constants/paths";

export type GuiObjectType =
    | "GUI_SIMPLE_BUTTON"
    | "GUI_CHECK_BUTTON"
    | "GUI_SLIDER"
    | "GUI_VSLIDER"
    | "GUI_EDIT"
    | "GUI_LISTBOX"
    | "GUI_DD_OBJECT"
    | "GUI_DD_CONTAINER";

export interface GuiObjectDefinition {
    readonly id: number;
    readonly type: GuiObjectType;
    readonly visible: boolean;
    readonly enabled: boolean;
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly text?: string;
    readonly font?: string;
    readonly textColor?: number;
    readonly imageBase?: string;
    readonly imageLighted?: string;
    readonly imagePressed?: string;
    readonly imageAdditional?: string;
    readonly clickSound?: string;
    readonly sliderLowLimit?: number;
    readonly sliderHighLimit?: number;
    readonly sliderStep?: number;
    readonly sliderValue?: number;
    readonly attributes: Readonly<Record<string, string>>;
}

export interface GuiDefinition {
    readonly name: string;
    readonly objects: readonly GuiObjectDefinition[];
}

const SCRIPT_TYPES: Readonly<Record<string, GuiObjectType>> = {
    GUI_SIMPLE_BUTTON: "GUI_SIMPLE_BUTTON",
    GUI_CHECK_BUTTON: "GUI_CHECK_BUTTON",
    GUI_SLIDER: "GUI_SLIDER",
    GUI_VSLIDER: "GUI_VSLIDER",
    GUI_EDIT: "GUI_EDIT",
    GUI_LISTBOX: "GUI_LISTBOX",
    GUI_DD_OBJECT: "GUI_DD_OBJECT",
    GUI_DD_CONTAINER: "GUI_DD_CONTAINER",
};

const definitionCache = new Map<string, Promise<GuiDefinition>>();

const parseBoolean = (value: string, fallback: boolean): boolean => {
    if (value.toUpperCase() === "TRUE") return true;
    if (value.toUpperCase() === "FALSE") return false;
    return fallback;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const unquote = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
    return trimmed;
};

export const parseGuiDefinition = (name: string, source: string): GuiDefinition => {
    const objects: GuiObjectDefinition[] = [];
    let attributes: Record<string, string> | null = null;

    for (const rawLine of source.replace(/\r/g, "").split("\n")) {
        const comment = rawLine.indexOf("//");
        const line = (comment < 0 ? rawLine : rawLine.slice(0, comment)).trim();
        if (!line || line.startsWith("#")) continue;
        if (line === "OBJECT_START") {
            if (attributes) throw new Error(`${name}: nested OBJECT_START`);
            attributes = {};
            continue;
        }
        if (line === "OBJECT_END") {
            if (!attributes) throw new Error(`${name}: OBJECT_END without OBJECT_START`);
            const id = parseNumber(attributes.OBJECT_ID, -1);
            const type = SCRIPT_TYPES[attributes.OBJECT_TYPE];
            if (id >= 0 && type) {
                objects.push({
                    id,
                    type,
                    visible: parseBoolean(attributes.OBJECT_VISIBLE ?? "TRUE", true),
                    enabled: parseBoolean(attributes.OBJECT_ENABLED ?? "TRUE", true),
                    left: parseNumber(attributes.OBJECT_LEFT, 0),
                    top: parseNumber(attributes.OBJECT_TOP, 0),
                    width: parseNumber(attributes.OBJECT_WIDTH, 0),
                    height: parseNumber(attributes.OBJECT_HEIGHT, 0),
                    text: unquote(attributes.OBJECT_BTN_TEXT),
                    font: unquote(attributes.OBJECT_FONT),
                    textColor: parseNumber(attributes.OBJECT_TEXT_COLOR, 0),
                    imageBase: unquote(attributes.IMAGE_BASE),
                    imageLighted: unquote(attributes.IMAGE_LIGHTED),
                    imagePressed: unquote(attributes.IMAGE_PRESSED),
                    imageAdditional: unquote(attributes.IMAGE_ADDITIONAL),
                    clickSound: unquote(attributes.PLAY_ON_CLICK),
                    sliderLowLimit: attributes.OBJECT_SLIDER_LOWLIMIT === undefined ? undefined : parseNumber(attributes.OBJECT_SLIDER_LOWLIMIT, 0),
                    sliderHighLimit: attributes.OBJECT_SLIDER_HIGHLIMIT === undefined ? undefined : parseNumber(attributes.OBJECT_SLIDER_HIGHLIMIT, 100),
                    sliderStep: attributes.OBJECT_SLIDER_STEP === undefined ? undefined : parseNumber(attributes.OBJECT_SLIDER_STEP, 1),
                    sliderValue: attributes.OBJECT_SLIDER_VALUE === undefined ? undefined : parseNumber(attributes.OBJECT_SLIDER_VALUE, 0),
                    attributes: { ...attributes },
                });
            }
            attributes = null;
            continue;
        }
        if (!attributes) continue;
        const separator = line.search(/\s/);
        if (separator < 0) continue;
        attributes[line.slice(0, separator)] = line.slice(separator).trim();
    }

    if (attributes) throw new Error(`${name}: unterminated OBJECT_START`);
    return { name, objects };
};

export const loadGuiDefinition = (name: string): Promise<GuiDefinition> => {
    const normalized = name.toLowerCase().replace(/\.scr$/i, "");
    let cached = definitionCache.get(normalized);
    if (!cached) {
        cached = fetch(`${Paths.SCRIPTS}/ui/${normalized}.scr`).then(async (response) => {
            if (!response.ok) throw new Error(`GUI script ${normalized}.scr failed: HTTP ${response.status}`);
            const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
            return parseGuiDefinition(normalized, source);
        });
        definitionCache.set(normalized, cached);
    }
    return cached;
};

export const guiImageUrl = (reference: string | undefined): string | undefined => {
    if (!reference) return undefined;
    const normalized = reference.replace(/\\/g, "/").replace(/^\/+/, "");
    return `/assets/${normalized}${/\.[a-z0-9]+$/i.test(normalized) ? "" : ".bmp"}`;
};

export const guiSoundUrl = (reference: string | undefined): string | undefined => {
    if (!reference) return undefined;
    const normalized = reference.replace(/\\/g, "/").replace(/^\/+/, "");
    return `/assets/${normalized}${/\.[a-z0-9]+$/i.test(normalized) ? "" : ".wav"}`;
};
