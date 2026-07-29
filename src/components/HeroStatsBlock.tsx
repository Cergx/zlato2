import type { CSSProperties } from "react";
import { HERO_GENERATOR_NATIVE_LAYOUT } from "../constants/clientDll.ts";
import type { SDBData } from "../game/parsers/SDBParser.ts";
import { OriginalGuiLayer } from "./OriginalGuiLayer.tsx";
import styles from "./HeroBlocks.module.scss";

interface HeroStatsBlockProps {
    readonly script: string;
    readonly parameters: Readonly<Record<string, number>>;
    readonly strings: SDBData;
    readonly onAdjust?: (parameter: string, direction: -1 | 1) => void;
    readonly extraObjectIds?: readonly number[];
    readonly tooltips?: Readonly<Record<number, string>>;
    readonly tooltipDelayMs?: number;
}

const rectStyle = ({ left, top, width, height }: Readonly<{ left: number; top: number; width: number; height: number }>): CSSProperties => ({
    left,
    top,
    width,
    height,
});

export const HeroStatsBlock = ({
    script,
    parameters,
    strings,
    onAdjust,
    extraObjectIds = [],
    tooltips,
    tooltipDelayMs,
}: HeroStatsBlockProps) => {
    const { characteristics, primaryPoints } = HERO_GENERATOR_NATIVE_LAYOUT;
    const objectIds = [
        ...Array.from({ length: 14 }, (_, index) => 16 + index),
        ...extraObjectIds,
    ];
    const labels: Record<number, string> = {};
    characteristics.forEach(({ interfaceStringId }, index) => {
        const name = strings[interfaceStringId] ?? String(interfaceStringId);
        labels[16 + index] = `Уменьшить: ${name}`;
        labels[23 + index] = `Увеличить: ${name}`;
    });

    return <section className={styles.block} data-hero-stats-block>
        <OriginalGuiLayer className={styles.controls} script={script} objectIds={objectIds}
            labels={labels} tooltips={tooltips} tooltipDelayMs={tooltipDelayMs}
            onAction={(object) => {
                if (!onAdjust) return;
                if (object.id >= 16 && object.id <= 22) onAdjust(characteristics[object.id - 16].parameter, -1);
                else if (object.id >= 23 && object.id <= 29) onAdjust(characteristics[object.id - 23].parameter, 1);
            }} />
        <div className={styles.text} aria-hidden="true">
            {characteristics.map(({ parameter, label, valueRect }) => <span key={parameter}>
                <span className={styles.label} style={{ left: label.x, top: label.y }}>
                    {strings[label.stringId] ?? parameter}
                </span>
                <strong className={styles.value} style={rectStyle(valueRect)}>{parameters[parameter] ?? 0}</strong>
            </span>)}
            <span className={styles.label} style={{ left: primaryPoints.label.x, top: primaryPoints.label.y }}>
                {strings[primaryPoints.label.stringId] ?? ""}
            </span>
            <strong className={styles.value} style={rectStyle(primaryPoints.valueRect)}>
                {parameters.person_points ?? 0}
            </strong>
        </div>
    </section>;
};
