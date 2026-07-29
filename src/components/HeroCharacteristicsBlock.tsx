import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
    INVENTORY_NATIVE_TEXT_DRAWS,
    INVENTORY_ROLE_STATE_OBJECT_IDS,
    type NativeHeroStateBinding,
    type InventoryTextDraw,
} from "../constants/clientDll.ts";
import { MAIN_INTERFACE_FONT } from "../constants/fontsScr.ts";
import { loadGuiDefinition, type GuiDefinition } from "../game/GuiDefinitionRuntime.ts";
import type { SDBData } from "../game/parsers/SDBParser.ts";
import { ColorKeyImage } from "./ColorKeyImage.tsx";
import { guiObjectStyle, OriginalGuiLayer } from "./OriginalGuiLayer.tsx";
import styles from "./HeroBlocks.module.scss";

interface HeroCharacteristicsBlockProps {
    readonly script: string;
    readonly strings: SDBData;
    readonly values: readonly (number | string)[];
    readonly roleStates?: readonly NativeHeroStateBinding[];
    readonly tooltips?: Readonly<Record<number, string>>;
    readonly tooltipDelayMs?: number;
}

const SECONDARY_VALUE_RIGHT: Readonly<Record<number, number>> = Object.freeze({
    160: 632, 161: 632, 162: 632, 163: 632, 164: 632, 165: 632, 166: 632, 167: 632,
    168: 632, 169: 632, 170: 632, 171: 632, 172: 632, 173: 632, 174: 632, 175: 630,
    176: 1002, 177: 1002, 178: 1002, 179: 1002, 180: 1002, 181: 1002,
    182: 1002, 183: 1002, 184: 1002, 185: 1002, 186: 1002, 187: 1002,
    188: 820, 189: 820, 190: 820, 191: 1002, 192: 1002, 193: 1002,
});

const drawStyle = (draw: InventoryTextDraw): CSSProperties => ({
    left: draw.x,
    top: draw.y,
    ...(draw.boxWidth === -1 ? {} : { width: draw.boxWidth, textAlign: "center" }),
    ...(draw.boxHeight === -1 ? {} : { height: draw.boxHeight, display: "grid", alignItems: "center" }),
    fontFamily: `ZlatoPalatino, "${MAIN_INTERFACE_FONT.typeFace}", serif`,
    fontSize: MAIN_INTERFACE_FONT.size,
    fontWeight: MAIN_INTERFACE_FONT.weight,
});

export const HeroCharacteristicsBlock = ({
    script,
    strings,
    values,
    roleStates = [],
    tooltips,
    tooltipDelayMs,
}: HeroCharacteristicsBlockProps) => {
    const [definition, setDefinition] = useState<GuiDefinition | null>(null);
    useEffect(() => {
        let cancelled = false;
        void loadGuiDefinition(script).then((loaded) => { if (!cancelled) setDefinition(loaded); });
        return () => { cancelled = true; };
    }, [script]);
    const definitionById = useMemo(
        () => new Map(definition?.objects.map((object) => [object.id, object]) ?? []),
        [definition],
    );

    return <section className={styles.block} data-hero-characteristics-block>
        <OriginalGuiLayer className={styles.controls} script={script}
            objectIds={Array.from({ length: 44 }, (_, index) => 160 + index)}
            tooltips={tooltips} tooltipDelayMs={tooltipDelayMs} />
        <div className={styles.text} aria-hidden="true">
            {INVENTORY_NATIVE_TEXT_DRAWS.characteristics.map((draw) => <span className={styles.label}
                data-interface-string-id={draw.stringId} style={drawStyle(draw)} key={draw.stringId}>
                {strings[draw.stringId] ?? ""}
            </span>)}
            {values.map((value, index) => {
                const objectId = 160 + index;
                const object = definitionById.get(objectId);
                const right = SECONDARY_VALUE_RIGHT[objectId];
                if (!object || right === undefined) return null;
                return <strong className={styles.fieldValue} key={objectId} style={{
                    left: object.left + object.width,
                    top: object.top,
                    width: Math.max(0, right - object.left - object.width),
                    height: object.height,
                }}>{value}</strong>;
            })}
        </div>
        {roleStates.slice(0, INVENTORY_ROLE_STATE_OBJECT_IDS.length).map((binding, slot) => {
            const object = definitionById.get(INVENTORY_ROLE_STATE_OBJECT_IDS[slot]);
            return object && <ColorKeyImage key={binding.stateId} className={styles.roleState}
                src={`/assets/engineres/hero_states/${binding.resource}.bmp`} style={guiObjectStyle(object)} />;
        })}
    </section>;
};
