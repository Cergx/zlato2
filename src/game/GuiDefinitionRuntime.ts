import {
    loadAssetScript,
    type AssetScriptLine,
} from "./scripts/AssetScriptRuntime";

export type GuiObjectType =
    | "GUI_SIMPLE_BUTTON"
    | "GUI_CHECK_BUTTON"
    | "GUI_SLIDER"
    | "GUI_VSLIDER"
    | "GUI_EDIT"
    | "GUI_LISTBOX"
    | "GUI_DD_OBJECT"
    | "GUI_DD_CONTAINER";

export interface GuiSourceLocation {
    readonly sourceName: string;
    readonly line: number;
}

export interface GuiObjectDefinition {
    readonly id: number;
    readonly type: GuiObjectType;
    readonly typeId: number;
    readonly visible: boolean;
    readonly enabled: boolean;
    readonly visuallyTransparent: boolean;
    readonly logicallyTransparent: boolean;
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
    readonly listboxStringHeight?: number;
    readonly listboxStringStep?: number;
    readonly editboxMaxLength?: number;
    readonly attributes: Readonly<Record<string, string>>;
    readonly source: GuiSourceLocation;
}

export interface GuiDefinition {
    readonly name: string;
    readonly sourcePath: string;
    readonly dependencies: readonly string[];
    readonly symbols: Readonly<Record<string, number | string>>;
    readonly objects: readonly GuiObjectDefinition[];
}

const GUI_OBJECT_TYPES = new Set<GuiObjectType>([
    "GUI_SIMPLE_BUTTON",
    "GUI_CHECK_BUTTON",
    "GUI_SLIDER",
    "GUI_VSLIDER",
    "GUI_EDIT",
    "GUI_LISTBOX",
    "GUI_DD_OBJECT",
    "GUI_DD_CONTAINER",
]);

const definitionCache = new Map<string, Promise<GuiDefinition>>();

const failAt = (location: GuiSourceLocation, message: string): never => {
    throw new Error(`${location.sourceName}:${location.line}: ${message}`);
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
    if (value === undefined) return fallback;
    if (value.toUpperCase() === "TRUE") return true;
    if (value.toUpperCase() === "FALSE") return false;
    return fallback;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const optionalNumber = (value: string | undefined): number | undefined => value === undefined ? undefined : parseNumber(value, 0);

const unquote = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1);
    return trimmed;
};

const resolveObjectType = (
    rawType: string | undefined,
    symbols: Readonly<Record<string, number | string>>,
    location: GuiSourceLocation,
): { readonly type: GuiObjectType; readonly typeId: number } => {
    if (!rawType) return failAt(location, "GUI object has no OBJECT_TYPE");
    const type = rawType.trim() as GuiObjectType;
    if (!GUI_OBJECT_TYPES.has(type)) return failAt(location, `Unsupported GUI object type ${rawType}`);
    const typeId = symbols[type];
    if (typeof typeId !== "number") return failAt(location, `GUI type ${type} is not defined by an included asset script`);
    return { type, typeId };
};

const materializeObject = (
    attributes: Readonly<Record<string, string>>,
    symbols: Readonly<Record<string, number | string>>,
    source: GuiSourceLocation,
): GuiObjectDefinition => {
    const id = parseNumber(attributes.OBJECT_ID, -1);
    if (!Number.isInteger(id) || id < 0) return failAt(source, `Invalid OBJECT_ID ${attributes.OBJECT_ID ?? "<missing>"}`);
    const { type, typeId } = resolveObjectType(attributes.OBJECT_TYPE, symbols, source);
    return Object.freeze({
        id,
        type,
        typeId,
        visible: parseBoolean(attributes.OBJECT_VISIBLE, true),
        enabled: parseBoolean(attributes.OBJECT_ENABLED, true),
        visuallyTransparent: parseBoolean(attributes.OBJECT_VIS_TRANSPARENT, false),
        logicallyTransparent: parseBoolean(attributes.OBJECT_LOG_TRANSPARENT, false),
        left: parseNumber(attributes.OBJECT_LEFT, 0),
        top: parseNumber(attributes.OBJECT_TOP, 0),
        width: parseNumber(attributes.OBJECT_WIDTH, 0),
        height: parseNumber(attributes.OBJECT_HEIGHT, 0),
        text: unquote(attributes.OBJECT_BTN_TEXT),
        font: unquote(attributes.OBJECT_FONT),
        textColor: optionalNumber(attributes.OBJECT_TEXT_COLOR),
        imageBase: unquote(attributes.IMAGE_BASE),
        imageLighted: unquote(attributes.IMAGE_LIGHTED),
        imagePressed: unquote(attributes.IMAGE_PRESSED),
        imageAdditional: unquote(attributes.IMAGE_ADDITIONAL),
        clickSound: unquote(attributes.PLAY_ON_CLICK),
        sliderLowLimit: optionalNumber(attributes.OBJECT_SLIDER_LOWLIMIT),
        sliderHighLimit: optionalNumber(attributes.OBJECT_SLIDER_HIGHLIMIT),
        sliderStep: optionalNumber(attributes.OBJECT_SLIDER_STEP),
        sliderValue: optionalNumber(attributes.OBJECT_SLIDER_VALUE),
        listboxStringHeight: optionalNumber(attributes.OBJECT_LISTBOX_STRING_HEIGHT),
        listboxStringStep: optionalNumber(attributes.OBJECT_LISTBOX_STRING_STEP),
        editboxMaxLength: optionalNumber(attributes.OBJECT_EDITBOX_MAX_LENGTH),
        attributes: Object.freeze({ ...attributes }),
        source: Object.freeze({ ...source }),
    });
};

const parseGuiLines = (
    name: string,
    sourcePath: string,
    lines: readonly AssetScriptLine[],
    symbols: Readonly<Record<string, number | string>>,
    dependencies: readonly string[],
): GuiDefinition => {
    const objects: GuiObjectDefinition[] = [];
    let attributes: Record<string, string> | null = null;
    let objectSource: GuiSourceLocation | null = null;

    for (const sourceLine of lines) {
        const comment = sourceLine.text.indexOf("//");
        const line = (comment < 0 ? sourceLine.text : sourceLine.text.slice(0, comment)).trim();
        if (!line) continue;
        const location = { sourceName: sourceLine.sourceName, line: sourceLine.line };
        if (line === "OBJECT_START") {
            if (attributes) failAt(location, "Nested OBJECT_START");
            attributes = {};
            objectSource = location;
            continue;
        }
        if (line === "OBJECT_END") {
            const completedAttributes = attributes;
            const completedSource = objectSource;
            if (!completedAttributes || !completedSource) return failAt(location, "OBJECT_END without OBJECT_START");
            objects.push(materializeObject(completedAttributes, symbols, completedSource));
            attributes = null;
            objectSource = null;
            continue;
        }
        if (!attributes) continue;
        const separator = line.search(/\s/);
        if (separator < 0) failAt(location, `Malformed GUI attribute ${line}`);
        const key = line.slice(0, separator);
        if (attributes[key] !== undefined) failAt(location, `Duplicate GUI attribute ${key}`);
        attributes[key] = line.slice(separator).trim();
    }

    if (attributes && objectSource) failAt(objectSource, "Unterminated OBJECT_START");
    return Object.freeze({
        name,
        sourcePath,
        dependencies: Object.freeze([...dependencies]),
        symbols: Object.freeze({ ...symbols }),
        objects: Object.freeze(objects),
    });
};

export const parseGuiDefinition = (
    name: string,
    source: string,
    symbols: Readonly<Record<string, number | string>>,
): GuiDefinition => parseGuiLines(
    name,
    name,
    source.replace(/\r/g, "").split("\n").map((text, index) => ({ sourceName: name, line: index + 1, text })),
    symbols,
    [name],
);

export const loadGuiDefinition = (name: string): Promise<GuiDefinition> => {
    const normalized = name.toLowerCase().replace(/\.scr$/i, "");
    let cached = definitionCache.get(normalized);
    if (!cached) {
        const sourcePath = `scripts/ui/${normalized}.scr`;
        cached = loadAssetScript(sourcePath).then((source) => parseGuiLines(
            normalized,
            source.entry,
            source.lines,
            source.symbols,
            source.dependencies,
        ));
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
