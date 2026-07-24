import { useState } from "react";
import type { Game } from "../game/Game";
import type { GameSettings } from "../game/GameSettingsRuntime";
import { OptionsMenuPanel } from "./OptionsMenuPanel";
import { OriginalGuiLayer } from "./OriginalGuiLayer";
import { SaveLoadMenuPanel } from "./SaveLoadMenuPanel";
import styles from "./PauseMenu.module.scss";

interface PauseMenuProps {
    readonly getGame: () => Game | null;
    readonly onClose: () => void;
    readonly onApplySettings: (settings: Readonly<GameSettings>) => void;
    readonly onMainMenu: () => void;
}
export const PauseMenu = ({ getGame, onClose, onMainMenu, onApplySettings }: PauseMenuProps) => {
    const [subpanel, setSubpanel] = useState<"options" | "save" | "load" | null>(null);
    const [message, setMessage] = useState("");
    if (subpanel === "options") return <OptionsMenuPanel onClose={() => setSubpanel(null)} onApply={onApplySettings} />;
    if (subpanel === "save" || subpanel === "load") {
        return <SaveLoadMenuPanel mode={subpanel} game={getGame()} onClose={() => setSubpanel(null)} />;
    }
    return (
        <section className={styles.panel} aria-label="Меню игры">
            <img className={styles.background} src="/assets/engineres/interface/game_menu/background.bmp" alt="" draggable={false} />
            <OriginalGuiLayer
                className={styles.controls}
                script="game_menu"
                onAction={(object) => {
                    switch (object.id) {
                        case 1:
                            onClose();
                            break;
                        case 2:
                            setSubpanel("save");
                            break;
                        case 3:
                            setSubpanel("load");
                            break;
                        case 4:
                            setSubpanel("options");
                            break;
                        case 5:
                            onMainMenu();
                            break;
                        case 6:
                            window.close();
                            setMessage("Для выхода закройте вкладку браузера");
                            break;
                    }
                }}
            />
            {message && <output className={styles.message}>{message}</output>}
        </section>
    );
};
