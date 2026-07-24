export interface SoundShaderDefinition {
    readonly name: string;
    readonly minimumDistance: number;
    readonly maximumDistance: number;
    readonly volume: number;
    readonly eaxFactor: number;
    readonly loop: boolean;
    readonly spatial: boolean;
    readonly selection: "simple" | "random";
    readonly waves: readonly string[];
}

export interface PersonSoundDefinition {
    readonly shaders: Readonly<Record<string, SoundShaderDefinition>>;
    readonly stepFrames: readonly number[];
}

interface ShaderNode {
    readonly values: Map<string, string[]>;
    readonly children: Map<string, ShaderNode[]>;
}

const cleanValue = (value: string): string => value.trim().replace(/^"|"$/g, "");

const parseNode = (lines: readonly string[], start: number): { readonly node: ShaderNode; readonly next: number } => {
    const node: ShaderNode = { values: new Map(), children: new Map() };
    let index = start;
    while (index < lines.length) {
        const line = lines[index];
        if (line === "}") return { node, next: index + 1 };
        const colon = line.indexOf(":");
        const key = (colon >= 0 ? line.slice(0, colon) : line.split(/\s+/, 1)[0]).trim().toLowerCase();
        const value = colon >= 0 ? line.slice(colon + 1).trim() : line.slice(key.length).trim();
        const opensInline = value === "{";
        const opensNext = value === "" && lines[index + 1] === "{";
        if (opensInline || opensNext) {
            const parsed = parseNode(lines, index + (opensInline ? 1 : 2));
            const existing = node.children.get(key) ?? [];
            existing.push(parsed.node);
            node.children.set(key, existing);
            index = parsed.next;
            continue;
        }
        if (line === "{") {
            index += 1;
            continue;
        }
        if (key) {
            const existing = node.values.get(key) ?? [];
            existing.push(cleanValue(value));
            node.values.set(key, existing);
        }
        index += 1;
    }
    return { node, next: index };
};

const last = <T,>(values: readonly T[] | undefined): T | undefined => values?.[values.length - 1];

const scalar = (node: ShaderNode, key: string, fallback: number): number => {
    const parsed = Number(last(node.values.get(key)));
    return Number.isFinite(parsed) ? parsed : fallback;
};

const flattenShaders = (node: ShaderNode, path: readonly string[], output: Record<string, SoundShaderDefinition>): void => {
    const waves = node.values.get("wave") ?? [];
    if (waves.length > 0) {
        const name = path.join(".");
        const selection = last(node.values.get("type"))?.toLowerCase() === "random" ? "random" : "simple";
        output[name] = {
            name,
            minimumDistance: scalar(node, "min_dist", 20),
            maximumDistance: scalar(node, "max_dist", 50),
            volume: scalar(node, "vol", 1),
            eaxFactor: scalar(node, "eax_factor", 1),
            loop: scalar(node, "loop", 0) !== 0,
            spatial: scalar(node, "3d", 1) !== 0,
            selection,
            waves: waves.map((wave) => wave.replace(/\\/g, "/")),
        };
    }
    for (const [name, children] of node.children) {
        for (const child of children) flattenShaders(child, [...path, name], output);
    }
};

export const parsePersonSoundDefinition = (source: string): PersonSoundDefinition => {
    const lines = source
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, "").trim())
        .filter(Boolean);
    const root = parseNode(lines, 0).node;
    const shaders: Record<string, SoundShaderDefinition> = {};
    flattenShaders(root, [], shaders);
    const stepFrames: number[] = [];
    const collectSteps = (node: ShaderNode): void => {
        for (const value of node.values.get("step") ?? []) {
            const frame = Number(value);
            if (Number.isFinite(frame)) stepFrames.push(frame);
        }
        for (const children of node.children.values()) for (const child of children) collectSteps(child);
    };
    collectSteps(root);
    return { shaders, stepFrames };
};

export const soundWaveUrl = (wave: string): string => {
    const normalized = wave.replace(/\\/g, "/").replace(/^\/+/, "");
    return `/assets/${normalized}${/\.[a-z0-9]+$/i.test(normalized) ? "" : ".wav"}`;
};

export const chooseSoundWave = (shader: SoundShaderDefinition, random: () => number = Math.random): string => {
    if (shader.waves.length === 0) throw new Error(`Sound shader ${shader.name} has no waves`);
    const index = shader.selection === "random" ? Math.min(shader.waves.length - 1, Math.floor(random() * shader.waves.length)) : 0;
    return soundWaveUrl(shader.waves[index]);
};
