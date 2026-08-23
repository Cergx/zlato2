import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
    OPTIONS_MENU_HEADING_DRAWS,
    OPTIONS_MENU_LABEL_DRAWS,
    OPTIONS_MENU_TITLE_DRAW,
    OPTIONS_MENU_VALUE_RECTS,
    type NativeRect,
    type OptionsMenuTextDraw,
} from "../constants/clientDll";
import {
    BUTTON_HEADS_INTERFACE_FONT,
    HEADS_INTERFACE_FONT,
    MAIN_INTERFACE_FONT,
    pointSizeToPixels,
    type ShippedFontDefinition,
} from "../constants/fontsScr";
import {
    gameAnimationSpeed,
    gameScrollSpeed,
    readGameSettings,
    resetGameSettings,
    writeGameSettings,
    type GameSettingValue,
    type GameSettings,
} from "../game/GameSettingsRuntime";
import { SDBParser, type SDBData } from "../game/parsers/SDBParser";
import { ColorKeyImage } from "./ColorKeyImage";
import { OriginalGuiLayer } from "./OriginalGuiLayer";
import styles from "./OptionsMenuPanel.module.scss";

interface OptionsMenuPanelProps {
    readonly onClose: () => void;
    readonly onApply?: (settings: Readonly<GameSettings>) => void;
}

const positionStyle = ({ left, top, width, height }: NativeRect): CSSProperties => ({
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
});

const fontStyle = (font: ShippedFontDefinition): CSSProperties => ({
    fontFamily: `ZlatoPalatino, "${font.typeFace}", serif`,
    fontSize: `${pointSizeToPixels(font.size)}px`,
    fontWeight: font.weight,
});

const drawText = (draw: OptionsMenuTextDraw, text: string | undefined, className: string, font: ShippedFontDefinition) => (
    <span className={className} data-interface-string-id={draw.stringId}
        style={{ ...positionStyle(draw.rect), ...fontStyle(font) }} key={draw.stringId}>{text}</span>
);

const displayValue = (id: number, settings: Readonly<GameSettings>): string => {
    const value = Number(settings[id]);
    if (!Number.isFinite(value)) return "";
    switch (id) {
        case 2: return String(value / 100);
        case 9: return gameAnimationSpeed(settings).toFixed(1);
        case 10: return gameScrollSpeed(settings).toFixed(2);
        default: return String(Math.round(value));
    }
};

export const OptionsMenuPanel = ({ onClose, onApply }: OptionsMenuPanelProps) => {
    const initialValues = useRef<GameSettings>(readGameSettings());
    const [values, setValues] = useState<GameSettings>(() => ({ ...initialValues.current }));
    const [strings, setStrings] = useState<SDBData>({});
    useEffect(() => {
        let cancelled = false;
        void fetch("/assets/sdb/user_interface.sdb")
            .then(async (response) => {
                if (!response.ok) throw new Error(`Interface strings failed: HTTP ${response.status}`);
                return new SDBParser(await response.arrayBuffer()).getData();
            })
            .then((loaded) => { if (!cancelled) setStrings(loaded); });
        return () => { cancelled = true; };
    }, []);

    const preview = (next: GameSettings): void => {
        setValues(next);
        onApply?.(next);
    };
    const changeValue = (id: number, value: GameSettingValue): void => preview({ ...values, [id]: value });
    const cancel = (): void => {
        onApply?.(initialValues.current);
        onClose();
    };

    return (
        <div className={styles.panel} role="dialog" aria-label={strings[145]}>
            <ColorKeyImage className={styles.background} src="/assets/engineres/interface/options_menu/background.bmp" />
            <div className={styles.text}>
                {drawText(OPTIONS_MENU_TITLE_DRAW, strings[OPTIONS_MENU_TITLE_DRAW.stringId], styles.title, BUTTON_HEADS_INTERFACE_FONT)}
                {OPTIONS_MENU_HEADING_DRAWS.map((draw) => drawText(draw, strings[draw.stringId], styles.heading, HEADS_INTERFACE_FONT))}
                {OPTIONS_MENU_LABEL_DRAWS.map((draw) => drawText(draw, strings[draw.stringId], styles.label, MAIN_INTERFACE_FONT))}
                {Object.entries(OPTIONS_MENU_VALUE_RECTS).map(([idText, rect]) => {
                    const id = Number(idText);
                    return <span className={styles.value} data-setting-value-id={id}
                        style={{ ...positionStyle(rect), ...fontStyle(MAIN_INTERFACE_FONT) }} key={id}>{displayValue(id, values)}</span>;
                })}
            </div>
            <OriginalGuiLayer
                script="options_menu"
                values={values}
                onValueChange={(object, value) => changeValue(object.id, value)}
                onAction={(object) => {
                    if (object.id === 1) cancel();
                    if (object.id === 15) {
                        const stored = writeGameSettings(values);
                        onApply?.(stored);
                        onClose();
                    }
                    if (object.id === 16 && window.confirm(strings[144] ?? "Восстановить настройки?")) {
                        preview(resetGameSettings(values));
                    }
                }}
            />
        </div>
    );
};
