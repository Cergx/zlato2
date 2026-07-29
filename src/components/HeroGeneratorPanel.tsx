import { useEffect, useState, type CSSProperties } from "react";
import { HERO_GENERATOR_NATIVE_LAYOUT, type NativeRect } from "../constants/clientDll.ts";
import { BUTTON_HEADS_INTERFACE_FONT, HEADS_INTERFACE_FONT } from "../constants/fontsScr.ts";
import { DEFAULT_HERO_NAME, parseHeroProfiles, type HeroProfile } from "../game/HeroProfileRuntime.ts";
import { SDBParser, type SDBData } from "../game/parsers/SDBParser.ts";
import { HeroSkillsBlock } from "./HeroSkillsBlock.tsx";
import { HeroStatsBlock } from "./HeroStatsBlock.tsx";
import { OriginalGuiLayer, type GuiControlValue } from "./OriginalGuiLayer.tsx";
import styles from "./HeroGeneratorPanel.module.scss";

interface CharacterGeneratorPanelProps {
    readonly onClose: () => void;
    readonly onCreate: (profile: HeroProfile) => void;
}


const INTERACTIVE_OBJECT_IDS = [1, 2, 3, 4, 5, 6, 7] as const;

const {
    characteristics: CHARACTERISTICS,
    skills: HERO_SKILLS,
    limits: HERO_GENERATOR_LIMITS,
} = HERO_GENERATOR_NATIVE_LAYOUT;

const nativeRectStyle = ({ left, top, width, height }: NativeRect): CSSProperties => ({ left, top, width, height });

const presetCaptionStyle = (rect: NativeRect): CSSProperties => ({
    ...nativeRectStyle(rect),
    fontFamily: `ZlatoPalatino, "${BUTTON_HEADS_INTERFACE_FONT.typeFace}", serif`,
    fontSize: `${BUTTON_HEADS_INTERFACE_FONT.size}px`,
    fontWeight: BUTTON_HEADS_INTERFACE_FONT.weight,
});

const topTitleStyle = (): CSSProperties => ({
    left: HERO_GENERATOR_NATIVE_LAYOUT.topTitle.x,
    top: HERO_GENERATOR_NATIVE_LAYOUT.topTitle.y,
    fontFamily: `ZlatoPalatino, "${HEADS_INTERFACE_FONT.typeFace}", serif`,
    fontSize: `${HEADS_INTERFACE_FONT.size}px`,
    fontWeight: HEADS_INTERFACE_FONT.weight,
});

const loadGeneratorData = async (): Promise<{
    readonly profiles: readonly HeroProfile[];
    readonly strings: SDBData;
}> => {
    const [profileResponse, stringsResponse] = await Promise.all([
        fetch("/assets/scripts/hero.scr"),
        fetch("/assets/sdb/user_interface.sdb"),
    ]);
    if (!profileResponse.ok) throw new Error(`Не удалось загрузить профили героя: HTTP ${profileResponse.status}`);
    if (!stringsResponse.ok) throw new Error(`Не удалось загрузить подписи генератора: HTTP ${stringsResponse.status}`);
    const profileSource = new TextDecoder("windows-1251").decode(await profileResponse.arrayBuffer());
    return {
        profiles: parseHeroProfiles(profileSource),
        strings: new SDBParser(await stringsResponse.arrayBuffer()).getData(),
    };
};

const copyParameters = (profile: HeroProfile): Record<string, number> => {
    const parameters = Object.fromEntries(CHARACTERISTICS.map(({ parameter }) => [
        parameter,
        profile.parameters[parameter] ?? HERO_GENERATOR_LIMITS.primaryMinimum,
    ]));
    for (const { parameter } of HERO_SKILLS) {
        parameters[parameter] = profile.parameters[parameter] ?? HERO_GENERATOR_LIMITS.skillMinimum;
    }
    parameters.reputation = profile.parameters.reputation ?? 0;
    parameters.person_points = profile.parameters.person_points ?? 0;
    parameters.skill_points = profile.parameters.skill_points ?? 0;
    return parameters;
};

export const CharacterGeneratorPanel = ({ onClose, onCreate }: CharacterGeneratorPanelProps) => {
    const [profiles, setProfiles] = useState<readonly HeroProfile[]>([]);
    const [strings, setStrings] = useState<SDBData>({});
    const [selectedProfile, setSelectedProfile] = useState(0);
    const [parameters, setParameters] = useState<Record<string, number>>({});
    const [heroName, setHeroName] = useState(DEFAULT_HERO_NAME);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        void loadGeneratorData().then(({ profiles: loadedProfiles, strings: loadedStrings }) => {
            if (cancelled) return;
            setProfiles(loadedProfiles);
            setStrings(loadedStrings);
            setParameters(copyParameters(loadedProfiles[0]));
        }).catch((reason: unknown) => {
            if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
        });
        return () => { cancelled = true; };
    }, []);

    const values: Readonly<Record<number, GuiControlValue>> = {
        1: selectedProfile === 0,
        2: selectedProfile === 1,
        3: selectedProfile === 2,
        4: selectedProfile === 3,
        7: heroName,
    };
    const labels: Record<number, string> = {
        5: "Создать героя",
        6: "Вернуться в главное меню",
        7: strings[5] ?? "Имя",
    };
    HERO_GENERATOR_NATIVE_LAYOUT.presetCaptions.forEach((caption) => {
        labels[caption.objectId] = strings[caption.stringId] ?? "";
    });

    const selectProfile = (index: number): void => {
        const profile = profiles[index];
        if (!profile) return;
        setSelectedProfile(index);
        setParameters(copyParameters(profile));
        setError("");
    };
    const changeCharacteristic = (parameter: string, direction: -1 | 1): void => {
        setParameters((current) => {
            const value = current[parameter] ?? HERO_GENERATOR_LIMITS.primaryMinimum;
            const points = current.person_points ?? 0;
            if (direction < 0) {
                if (value <= HERO_GENERATOR_LIMITS.primaryMinimum) return current;
                return { ...current, [parameter]: value - 1, person_points: points + value };
            }
            if (value >= HERO_GENERATOR_LIMITS.primaryMaximum || value + 1 > points) return current;
            return { ...current, [parameter]: value + 1, person_points: points - value - 1 };
        });
    };
    const changeSkill = (parameter: string, direction: -1 | 1): void => {
        setParameters((current) => {
            const value = current[parameter] ?? HERO_GENERATOR_LIMITS.skillMinimum;
            const points = current.skill_points ?? 0;
            if (direction < 0) {
                if (value <= HERO_GENERATOR_LIMITS.skillMinimum) return current;
                return { ...current, [parameter]: value - 1, skill_points: points + value };
            }
            if (value >= HERO_GENERATOR_LIMITS.skillMaximum || value + 1 > points) return current;
            return { ...current, [parameter]: value + 1, skill_points: points - value - 1 };
        });
    };
    const createHero = (): void => {
        const name = heroName.trim();
        if (!name) {
            setError("Введите имя героя");
            return;
        }
        onCreate({ name, parameters: { ...parameters }, experience: profiles[selectedProfile]?.experience ?? 0 });
    };


    return <section className={styles.panel} aria-label="Создание героя">
        <img className={styles.backdrop} src="/assets/engineres/hero_generator/main.bmp" alt="" draggable={false} />
        <OriginalGuiLayer script="hero_generator" objectIds={INTERACTIVE_OBJECT_IDS}
            values={values} labels={labels}
            onValueChange={(object, value) => {
                if (object.id === 7 && typeof value === "string") {
                    setHeroName(value);
                    setError("");
                }
            }}
            onAction={(object) => {
                if (object.id >= 1 && object.id <= 4) selectProfile(object.id - 1);
                else if (object.id === 5) createHero();
                else if (object.id === 6) onClose();
            }} />

        <HeroStatsBlock script="hero_generator" parameters={parameters} strings={strings}
            onAdjust={changeCharacteristic} />
        <HeroSkillsBlock script="hero_generator" parameters={parameters} strings={strings}
            onAdjust={changeSkill} />

        <div className={styles.nativeText} aria-hidden="true">
            <span className={styles.topTitle} data-interface-string-id={HERO_GENERATOR_NATIVE_LAYOUT.topTitle.stringId}
                style={topTitleStyle()}>{strings[HERO_GENERATOR_NATIVE_LAYOUT.topTitle.stringId] ?? ""}</span>
            {HERO_GENERATOR_NATIVE_LAYOUT.presetCaptions.map((caption) => <span
                className={styles.presetCaption}
                data-interface-string-id={caption.stringId}
                key={`preset-${caption.objectId}`}
                style={presetCaptionStyle(caption.rect)}>
                {strings[caption.stringId] ?? ""}
            </span>)}
        </div>
        {error && <output className={styles.error} role="alert">{error}</output>}
    </section>;
};
