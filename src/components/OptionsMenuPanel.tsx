import { useEffect, useState } from "react";
import {
    DEFAULT_GAME_SETTINGS,
    readGameSettings,
    writeGameSettings,
    type GameSettingValue,
    type GameSettings,
} from "../game/GameSettingsRuntime";
import { SDBParser, type SDBData } from "../game/parsers/SDBParser";
import { OriginalGuiLayer } from "./OriginalGuiLayer";
import styles from "./OptionsMenuPanel.module.scss";

interface OptionsMenuPanelProps {
    readonly onClose: () => void;
    readonly onApply?: (settings: Readonly<GameSettings>) => void;
}

const OPTION_LABELS = [
    { id: 145, left: 512, top: 55 },
    { id: 146, left: 172, top: 145 },
    { id: 147, left: 512, top: 145 },
    { id: 148, left: 852, top: 145 },
    { id: 149, left: 172, top: 230 },
    { id: 150, left: 172, top: 336 },
    { id: 151, left: 172, top: 401 },
    { id: 152, left: 512, top: 230 },
    { id: 153, left: 512, top: 328 },
    { id: 154, left: 512, top: 424 },
    { id: 155, left: 512, top: 529 },
    { id: 156, left: 852, top: 230 },
    { id: 157, left: 852, top: 328 },
    { id: 158, left: 852, top: 424 },
    { id: 159, left: 852, top: 529 },
    { id: 160, left: 852, top: 598 },
    { id: 161, left: 852, top: 665 },
] as const;

export const OptionsMenuPanel = ({ onClose, onApply }: OptionsMenuPanelProps) => {
    const [values, setValues] = useState<GameSettings>(() => readGameSettings());
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
    const changeValue = (id: number, value: GameSettingValue): void => setValues((current) => ({ ...current, [id]: value }));
    return (
        <div className={styles.panel}>
            <img className={styles.background} src="/assets/engineres/interface/options_menu/background.bmp" alt="" draggable={false} />
            <div className={styles.labels}>
                {OPTION_LABELS.map((label) => (
                    <span key={label.id} style={{ left: `${label.left / 10.24}%`, top: `${label.top / 7.68}%` }}>
                        {strings[label.id]}
                    </span>
                ))}
            </div>
            <OriginalGuiLayer
                script="options_menu"
                values={values}
                onValueChange={(object, value) => changeValue(object.id, value)}
                onAction={(object) => {
                    if (object.id === 1) onClose();
                    if (object.id === 15) {
                        const stored = writeGameSettings(values);
                        onApply?.(stored);
                        onClose();
                    }
                    if (object.id === 16) setValues({ ...DEFAULT_GAME_SETTINGS });
                }}
            />
        </div>
    );
};
