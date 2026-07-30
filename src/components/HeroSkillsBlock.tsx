import type { CSSProperties } from "react";
import { HERO_GENERATOR_NATIVE_LAYOUT } from "../constants/clientDll.ts";
import type { SDBData } from "../game/parsers/SDBParser.ts";
import { skillPerkTooltip, type SkillDerivedValues } from "../game/SkillPerkRuntime.ts";
import { OriginalGuiLayer } from "./OriginalGuiLayer.tsx";
import styles from "./HeroBlocks.module.scss";

interface HeroSkillsBlockProps {
    readonly script: string;
    readonly parameters: Readonly<Record<string, number>>;
    readonly strings: SDBData;
    readonly perkNames?: SDBData;
    readonly perkDescriptions?: SDBData;
    readonly onAdjust?: (parameter: string, direction: -1 | 1) => void;
    readonly extraObjectIds?: readonly number[];
    readonly tooltips?: Readonly<Record<number, string>>;
    readonly tooltipDelayMs?: number;
    readonly derivedValues?: SkillDerivedValues;
}

const rectStyle = ({ left, top, width, height }: Readonly<{ left: number; top: number; width: number; height: number }>): CSSProperties => ({
    left,
    top,
    width,
    height,
});

export const HeroSkillsBlock = ({
    script,
    parameters,
    strings,
    perkNames = {},
    perkDescriptions = {},
    onAdjust,
    extraObjectIds = [],
    tooltips,
    tooltipDelayMs,
    derivedValues = {},
}: HeroSkillsBlockProps) => {
    const { skills, skillPoints, sectionTitles } = HERO_GENERATOR_NATIVE_LAYOUT;
    const objectIds = Array.from(new Set([
        ...Array.from({ length: 54 }, (_, index) => 30 + index),
        ...Array.from({ length: 27 }, (_, index) => 100 + index),
        ...extraObjectIds,
    ]));
    const labels: Record<number, string> = {};
    skills.forEach(({ interfaceStringId }, index) => {
        const name = strings[interfaceStringId] ?? String(interfaceStringId);
        labels[30 + index * 2] = `Уменьшить: ${name}`;
        labels[31 + index * 2] = `Увеличить: ${name}`;
    });
    const resolvedTooltips: Record<number, string> = { ...tooltips };
    skills.forEach(({ parameter }, index) => {
        const objectId = 100 + index;
        const text = skillPerkTooltip(tooltips?.[objectId], parameter, parameters[parameter] ?? 0,
            perkNames, perkDescriptions, parameters, derivedValues);
        if (text) resolvedTooltips[objectId] = text;
    });

    return <section className={styles.block} data-hero-skills-block>
        <OriginalGuiLayer className={styles.controls} script={script} objectIds={objectIds}
            labels={labels} tooltips={resolvedTooltips} tooltipDelayMs={tooltipDelayMs}
            onAction={(object) => {
                if (!onAdjust || object.id < 30 || object.id > 83) return;
                const offset = object.id - 30;
                onAdjust(skills[Math.floor(offset / 2)].parameter, offset % 2 === 0 ? -1 : 1);
            }} />
        <div className={styles.text} aria-hidden="true">
            {sectionTitles.map((draw) => <span className={styles.heading} key={draw.stringId} style={{
                left: draw.x,
                top: draw.y,
                width: draw.boxWidth >= 0 ? draw.boxWidth : undefined,
                height: draw.boxHeight >= 0 ? draw.boxHeight : undefined,
            }}>{strings[draw.stringId] ?? ""}</span>)}
            {skills.map(({ parameter, label, valueRect }) => <span key={parameter}>
                <span className={styles.label} style={{ left: label.x, top: label.y }}>
                    {strings[label.stringId] ?? parameter}
                </span>
                <strong className={styles.value} style={rectStyle(valueRect)}>{parameters[parameter] ?? 0}</strong>
            </span>)}
            <span className={styles.label} style={{ left: skillPoints.label.x, top: skillPoints.label.y }}>
                {strings[skillPoints.label.stringId] ?? ""}
            </span>
            <strong className={styles.value} style={rectStyle(skillPoints.valueRect)}>
                {parameters.skill_points ?? 0}
            </strong>
        </div>
    </section>;
};
