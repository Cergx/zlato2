import { useEffect, useState } from "react";
import { NEW_GAME_START, type GameMode } from "../constants/levels";
import { readGameSettings, type GameSettings } from "../game/GameSettingsRuntime";
import { loadCSX } from "../game/Assets";
import type { GameSaveData } from "../game/PersistenceRuntime";
import { CreditsPanel } from "./CreditsPanel";
import { OptionsMenuPanel } from "./OptionsMenuPanel";
import { OriginalGuiLayer } from "./OriginalGuiLayer";
import { MainMenuAnimationLayer } from "./MainMenuAnimationLayer";
import { SaveLoadMenuPanel } from "./SaveLoadMenuPanel";
import styles from "./MainMenu.module.scss";

export interface GameLaunchRequest {
    readonly gameMode: GameMode;
    readonly level: string;
    readonly entrance?: string;
    readonly quickLoad?: boolean;
    readonly saveSlot?: string;
}

interface MainMenuProps {
    readonly onLaunch: (request: GameLaunchRequest) => void;
    readonly skipSplash?: boolean;
}

type MenuPanel = "main" | "options" | "about" | "load";

const CsxBackdrop = ({ path }: { readonly path: string }) => {
    const [source, setSource] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        void loadCSX(path).then((canvas) => {
            if (!cancelled && canvas) setSource(canvas.toDataURL("image/png"));
        });
        return () => { cancelled = true; };
    }, [path]);
    return source ? <img className={styles.backdrop} src={source} alt="" draggable={false} /> : null;
};



const SplashSequence = ({ onFinished }: { readonly onFinished: () => void }) => {
    const [index, setIndex] = useState(0);
    const logos = [
        "/assets/engineres/interface/logos/russobit.bmp",
        "/assets/engineres/interface/logos/burut ct.bmp",
    ];
    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (index + 1 >= logos.length) onFinished();
            else setIndex((current) => current + 1);
        }, 1300);
        return () => window.clearTimeout(timer);
    }, [index, logos.length, onFinished]);
    const skip = (): void => {
        if (index + 1 >= logos.length) onFinished();
        else setIndex((current) => current + 1);
    };
    return (
        <button className={styles.splash} type="button" aria-label="Пропустить заставку" onClick={skip}>
            <img key={logos[index]} src={logos[index]} alt="" draggable={false} />
        </button>
    );
};

export const MainMenu = ({ onLaunch, skipSplash = false }: MainMenuProps) => {
    const [splash, setSplash] = useState(!skipSplash);
    const [panel, setPanel] = useState<MenuPanel>("main");
    const [options, setOptions] = useState<GameSettings>(() => readGameSettings());
    const [aboutSlide, setAboutSlide] = useState(0);
    const [message, setMessage] = useState("");
    

    useEffect(() => {
        if (panel !== "about") return;
        const timer = window.setInterval(() => setAboutSlide((current) => (current + 1) % 15), 2800);
        const music = new Audio("/assets/music/about.ogg");
        music.loop = true;
        music.volume = 0.45;
        void music.play().catch(() => undefined);
        return () => {
            window.clearInterval(timer);
            music.pause();
        };
    }, [panel]);

    if (splash) return <SplashSequence onFinished={() => setSplash(false)} />;

    const launchNewGame = (gameMode: GameMode): void => {
        const start = gameMode === "single"
            ? NEW_GAME_START
            : { gameMode, level: "l10_1", entrance: undefined } as const;
        onLaunch({ gameMode: start.gameMode, level: start.level, entrance: start.entrance });
    };
    const loadGame = (slot: string, save: GameSaveData): void => {
        onLaunch({
            gameMode: save.location.gameMode,
            level: save.location.level,
            entrance: save.location.entrance ?? undefined,
            saveSlot: slot,
        });
    };
    const openOptions = (): void => setPanel("options");

    return (
        <main className={styles.viewport} style={{ filter: `brightness(${Number(options[2]) || 100}%)` }}>
            {panel === "main" && (
                <>
                    <MainMenuAnimationLayer />
                    <OriginalGuiLayer
                        script="main_menu"
                        onAction={(object) => {
                            switch (object.id) {
                                case 1: launchNewGame("single"); break;
                                case 2: setPanel("load"); break;
                                case 3: launchNewGame("multiplayer"); break;
                                case 4: openOptions(); break;
                                case 5: setPanel("about"); break;
                                case 6:
                                    window.close();
                                    setMessage("Для выхода закройте вкладку браузера");
                                    break;
                            }
                        }}
                    />
                    {message && <output className={styles.message}>{message}</output>}
                </>
            )}

            {panel === "load" && (
                <SaveLoadMenuPanel mode="load" onClose={() => setPanel("main")} onLoad={loadGame} />
            )}

            {panel === "options" && (
                <OptionsMenuPanel
                    onClose={() => setPanel("main")}
                    onApply={(stored) => setOptions({ ...stored })}
                />
            )}

            {panel === "about" && (
                <>
                    <CsxBackdrop path="/assets/engineres/interface/about_menu/background.csx" />
                    <img className={styles.aboutSlide} src={`/assets/engineres/interface/about_menu/slide/${aboutSlide}.bmp`} alt="" draggable={false} />
                    <CreditsPanel />
                    <OriginalGuiLayer script="about_menu" onAction={(object) => { if (object.id === 1) setPanel("main"); }} />
                </>
            )}
        </main>
    );
};
