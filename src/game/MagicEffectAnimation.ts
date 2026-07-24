import { loadCSX, loadImage } from "./Assets.ts";
import { MDFParser, mdfSpriteUrl, type MDFSpriteReference } from "./parsers/MDFParser.ts";

interface MagicEffectLayer {
    readonly definition: MDFSpriteReference;
    readonly image: HTMLCanvasElement | HTMLImageElement;
    readonly frameHeight: number;
    readonly frameCount: number;
}

export class MagicEffectAnimation {
    private static readonly cache = new Map<string, Promise<MagicEffectAnimation>>();
    private constructor(
        public readonly durationMs: number,
        private readonly layers: readonly MagicEffectLayer[],
    ) {}

    public static load(technicalName: string): Promise<MagicEffectAnimation> {
        const normalized = technicalName.toLowerCase();
        let cached = this.cache.get(normalized);
        if (!cached) {
            cached = this.loadUncached(normalized).catch((error) => {
                this.cache.delete(normalized);
                throw error;
            });
            this.cache.set(normalized, cached);
        }
        return cached;
    }

    private static async loadUncached(normalized: string): Promise<MagicEffectAnimation> {
        const response = await fetch(`/assets/magic/${normalized}.mdf`);
        if (!response.ok) throw new Error(`Magic descriptor ${normalized}.mdf failed: HTTP ${response.status}`);
        const data = new MDFParser(await response.arrayBuffer()).getData();
        const headerFrameCounts = data.headerWords.flatMap((value, index) => {
            const next = data.headerWords[index + 1];
            return value >= 1 && value <= 8 && next >= 2 && next <= 1_000 ? [next] : [];
        });
        const loaded = await Promise.all(data.sprites.map(async (definition): Promise<MagicEffectLayer | undefined> => {
            const url = mdfSpriteUrl(definition.path);
            const image = url.endsWith(".csx") ? await loadCSX(url) : await loadImage(url);
            if (!image) return undefined;
            const frameCount = [...new Set([
                definition.frameCount,
                definition.frameCount - 1,
                definition.frameCount + 1,
                ...headerFrameCounts,
            ])].find((candidate) => candidate > 0 && image.height % candidate === 0);
            if (!frameCount) return undefined;
            return { definition, image, frameHeight: image.height / frameCount, frameCount };
        }));
        const layers = loaded.filter((layer): layer is MagicEffectLayer => layer !== undefined);
        if (layers.length === 0) throw new Error(`Magic descriptor ${normalized}.mdf has no renderable layers`);
        return new MagicEffectAnimation(data.durationMs, layers);
    }

    public draw(context: CanvasRenderingContext2D, worldX: number, worldY: number, elapsedMs: number): void {
        context.save();
        context.globalCompositeOperation = "screen";
        for (const layer of this.layers) {
            const { definition, image, frameHeight, frameCount } = layer;
            if (elapsedMs < definition.startMs || elapsedMs > definition.endMs) continue;
            const layerDuration = definition.endMs - definition.startMs;
            const progress = layerDuration === 0 ? 1 : (elapsedMs - definition.startMs) / layerDuration;
            const frame = Math.min(frameCount - 1, Math.max(0, Math.floor(progress * frameCount)));
            context.drawImage(
                image,
                0,
                frame * frameHeight,
                image.width,
                frameHeight,
                worldX - image.width / 2,
                worldY - frameHeight / 2,
                image.width,
                frameHeight,
            );
        }
        context.restore();
    }
}
