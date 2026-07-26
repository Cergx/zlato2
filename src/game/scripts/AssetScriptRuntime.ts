import { AssetsBase } from "../../constants/paths";

export interface AssetScriptLine {
    readonly sourceName: string;
    readonly line: number;
    readonly text: string;
}

export interface AssetScriptSource {
    readonly entry: string;
    readonly lines: readonly AssetScriptLine[];
    readonly symbols: Readonly<Record<string, number | string>>;
    readonly dependencies: readonly string[];
}

const INCLUDE_PATTERN = /^\s*#INCLUDE\s+"([^"]+)"\s*$/i;
const DEFINE_PATTERN = /^\s*#DEFINE\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*$/i;
const sourceCache = new Map<string, Promise<string>>();

const normalizeAssetPath = (path: string): string => {
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    const withoutAssets = normalized.toLowerCase().startsWith("assets/") ? normalized.slice(7) : normalized;
    if (withoutAssets.split("/").some((part) => part === "..")) throw new Error(`Asset script path escapes the asset root: ${path}`);
    return withoutAssets;
};

const loadSourceText = (path: string): Promise<string> => {
    const normalized = normalizeAssetPath(path);
    let cached = sourceCache.get(normalized);
    if (!cached) {
        cached = fetch(`${AssetsBase}/${normalized}`).then(async (response) => {
            if (!response.ok) throw new Error(`Asset script ${normalized} failed: HTTP ${response.status}`);
            return new TextDecoder("windows-1251", { fatal: true }).decode(await response.arrayBuffer());
        });
        sourceCache.set(normalized, cached);
    }
    return cached;
};

const parseSymbolValue = (raw: string, symbols: Readonly<Record<string, number | string>>): number | string => {
    const value = raw.trim();
    const referenced = symbols[value];
    if (referenced !== undefined) return referenced;
    if (/^[-+]?0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value, 16);
    if (/^[-+]?\d+$/.test(value)) return Number.parseInt(value, 10);
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
    return value;
};

export const loadAssetScript = async (entryPath: string): Promise<AssetScriptSource> => {
    const entry = normalizeAssetPath(entryPath);
    const lines: AssetScriptLine[] = [];
    const symbols: Record<string, number | string> = {};
    const dependencies: string[] = [];
    const loaded = new Set<string>();
    const active: string[] = [];

    const visit = async (path: string): Promise<void> => {
        const normalized = normalizeAssetPath(path);
        const cycleStart = active.indexOf(normalized);
        if (cycleStart >= 0) throw new Error(`Asset script include cycle: ${[...active.slice(cycleStart), normalized].join(" -> ")}`);
        if (loaded.has(normalized)) return;

        active.push(normalized);
        const source = await loadSourceText(normalized);
        const sourceLines = source.replace(/\r/g, "").split("\n");
        for (let index = 0; index < sourceLines.length; index += 1) {
            const text = sourceLines[index];
            const include = INCLUDE_PATTERN.exec(text);
            if (include) {
                await visit(include[1]);
                continue;
            }
            const define = DEFINE_PATTERN.exec(text);
            if (define) {
                symbols[define[1]] = parseSymbolValue(define[2].replace(/\/\/.*$/, ""), symbols);
                continue;
            }
            lines.push({ sourceName: normalized, line: index + 1, text });
        }
        active.pop();
        loaded.add(normalized);
        dependencies.push(normalized);
    };

    await visit(entry);
    return Object.freeze({
        entry,
        lines: Object.freeze(lines),
        symbols: Object.freeze({ ...symbols }),
        dependencies: Object.freeze(dependencies),
    });
};
