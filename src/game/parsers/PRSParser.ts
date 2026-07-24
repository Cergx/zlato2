import parseEngineObject, { isParsedData, type ParsedData, type ParsedValue } from "./engineObjectParser";

export interface PersonResourceDefinition {
    readonly height: number;
    readonly shader?: string;
    readonly containerAfterDie: boolean;
    readonly playToEnd: boolean;
    readonly distanceAttack: number;
    readonly frameApply: Readonly<Record<string, number>>;
    readonly materialArmor?: string;
    readonly materialWeapon?: string;
    readonly bodyParts: Readonly<Record<string, string>>;
    readonly soundShaders: Readonly<Record<string, string>>;
}

const numberValue = (value: ParsedValue | undefined, fallback = 0): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const stringValue = (value: ParsedValue | undefined): string | undefined => typeof value === "string" ? value : undefined;

const numericRecord = (value: ParsedValue | undefined): Record<string, number> => {
    if (!isParsedData(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => typeof entry === "number" ? [[key, entry]] : []));
};

const stringRecord = (value: ParsedValue | undefined): Record<string, string> => {
    if (!isParsedData(value)) return {};
    const result: Record<string, string> = {};
    const visit = (node: ParsedData, path: readonly string[]): void => {
        for (const [key, entry] of Object.entries(node)) {
            if (typeof entry === "string") result[[...path, key].join(".")] = entry;
            else if (isParsedData(entry)) visit(entry, [...path, key]);
        }
    };
    visit(value, []);
    return result;
};

export const parsePersonResourceDefinition = (source: string): PersonResourceDefinition => {
    const raw = parseEngineObject(source);
    return {
        height: numberValue(raw.height),
        shader: stringValue(raw.shader),
        containerAfterDie: numberValue(raw.container_after_die) !== 0,
        playToEnd: numberValue(raw.play_to_the_end) !== 0,
        distanceAttack: numberValue(raw.distance_attack),
        frameApply: numericRecord(raw.frame_apply),
        materialArmor: stringValue(raw.material_armor),
        materialWeapon: stringValue(raw.material_weapon),
        bodyParts: stringRecord(raw.body_part),
        soundShaders: stringRecord(raw.snd_shader),
    };
};

export const personSoundShaderUrl = (reference: string): string => {
    const normalized = reference.replace(/\\/g, "/").replace(/^\/+/, "");
    return `/assets/scripts/shaders/${normalized}`;
};
