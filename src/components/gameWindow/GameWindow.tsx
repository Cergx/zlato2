import { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "../../game/Game";
import { useCursor } from "../../context/CursorContext";
import { CursorType } from "../../enums/CursorTypes.ts";
import styles from "./GameWindow.module.scss";
import { DialoguePanel } from "../dialogue/DialoguePanel.tsx";
import type { DialogueState } from "../../game/dialogue/DialogueRuntime.ts";
import { WorldMapPanel } from "./WorldMapPanel.tsx";
import { GameHud } from "./GameHud.tsx";
import type { WorldMapLocationState } from "../../game/WorldMapRuntime.ts";
import InventoryPanel from "../InventoryPanel.tsx";
import { GameMenuPanel, type GameMenuPanelKind } from "./GameMenuPanel.tsx";
import { PauseMenu } from "../PauseMenu.tsx";
import { readGameSettings, type GameSettings } from "../../game/GameSettingsRuntime.ts";
import { LoadingScreen } from "./LoadingScreen";
import { ItemTransferPanel } from "../ItemTransferPanel";
import { RelaxPanel } from "./RelaxPanel.tsx";

interface GameWindowProps {
    gameMode: "single" | "multiplayer";
    level: string;
    entrance?: string;
    saveSlot?: string;
    onMainMenu: () => void;

}

const WeatherOverlay = ({ getGame }: { getGame: () => Game | null }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const startedAt = performance.now();
        const draw = (now: number) => {
            context.clearRect(0, 0, canvas.width, canvas.height);
            const parsedWeather = getGame()?.getLevel()?.getData()?.lvlData.weather;
            const weatherKind = ["clear", "rain", "snow", "snowstorm", "sand", "sandstorm"][parsedWeather?.type ?? 0] ?? "unknown";
            const intensity = parsedWeather?.intensity ?? 0;
            if (weatherKind !== "clear" && intensity > 0) {
                const time = now - startedAt;
                const density = Math.max(.15, Math.min(1, intensity));
                if (weatherKind === "rain" || weatherKind === "snowstorm") {
                    const count = Math.round(150 * density);
                    context.strokeStyle = weatherKind === "snowstorm" ? "rgb(225 232 229 / 52%)" : "rgb(180 198 204 / 38%)";
                    context.lineWidth = weatherKind === "snowstorm" ? 1.5 : 1;
                    context.beginPath();
                    for (let index = 0; index < count; index += 1) {
                        const x = (index * 83 + time * .42) % (canvas.width + 100) - 50;
                        const y = (index * 137 + time * .88) % (canvas.height + 60) - 30;
                        context.moveTo(x, y);
                        context.lineTo(x - 9, y + 24);
                    }
                    context.stroke();
                } else if (weatherKind === "snow") {
                    const count = Math.round(90 * density);
                    context.fillStyle = "rgb(240 241 225 / 62%)";
                    for (let index = 0; index < count; index += 1) {
                        const y = (index * 97 + time * .08) % (canvas.height + 20) - 10;
                        const x = (index * 151 + Math.sin(time * .001 + index) * 28) % canvas.width;
                        context.fillRect(x, y, index % 3 === 0 ? 2 : 1, index % 3 === 0 ? 2 : 1);
                    }
                } else if (weatherKind === "sand" || weatherKind === "sandstorm") {
                    context.fillStyle = weatherKind === "sandstorm" ? "rgb(129 91 45 / 22%)" : "rgb(155 119 67 / 10%)";
                    context.fillRect(0, 0, canvas.width, canvas.height);
                    const count = Math.round((weatherKind === "sandstorm" ? 130 : 55) * density);
                    context.fillStyle = "rgb(213 179 113 / 38%)";
                    for (let index = 0; index < count; index += 1) {
                        const x = (index * 89 + time * .3) % canvas.width;
                        const y = (index * 53 + Math.sin(time * .002 + index) * 22) % canvas.height;
                        context.fillRect(x, y, 3, 1);
                    }
                }
            }
        };
        draw(performance.now());
        const interval = window.setInterval(() => draw(performance.now()), 33);
        return () => window.clearInterval(interval);
    }, [getGame]);

    return <canvas className={styles.weather} width={1024} height={768} ref={canvasRef} aria-hidden="true" />;
};

export const GameWindow = ({ gameMode, level, entrance, saveSlot, onMainMenu }: GameWindowProps) => {

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameRef = useRef<Game | null>(null);
    const { setCursor, cursorClassName } = useCursor();
    const [dialogueState, setDialogueState] = useState<DialogueState | null>(null);
    const [worldMapLocations, setWorldMapLocations] = useState<readonly WorldMapLocationState[] | null>(null);
    const [finishedEnding, setFinishedEnding] = useState<number | null>(null);
    const [runtimeError, setRuntimeError] = useState<string | null>(null);
    const [statusText, setStatusText] = useState("");
    const [loadingLevel, setLoadingLevel] = useState(level);
    const [loading, setLoading] = useState(true);
    const [transferPanel, setTransferPanel] = useState<{ owner: string; title: string; mode: "loot" | "trade" } | null>(null);
    const [activePanel, setActivePanel] = useState<GameMenuPanelKind | "inventory" | "skills" | "characteristics" | "pause" | "relax" | null>(null);
    const [settings, setSettings] = useState<GameSettings>(() => readGameSettings());
    const chooseDialogue = useCallback((optionId: number) => {
        gameRef.current?.chooseDialogue(optionId);
    }, []);
    const travelWorldMap = useCallback((locationId: string) => gameRef.current?.travelWorldMap(locationId), []);
    const closeWorldMap = useCallback(() => gameRef.current?.closeWorldMap(), []);
    const togglePanel = useCallback((panel: GameMenuPanelKind | "inventory" | "skills" | "characteristics" | "pause" | "relax") => {
        setActivePanel((current) => current === panel ? null : panel);
    }, []);
    const closePanel = useCallback(() => setActivePanel(null), []);
    const getGame = useCallback(() => gameRef.current, []);

    useEffect(() => gameRef.current?.applySettings(settings), [settings]);


    useEffect(() => {
        if (!canvasRef.current) return;

        setCursor(CursorType.NORMAL);
        setFinishedEnding(null);
        setRuntimeError(null);
        setActivePanel(null);
        if (!gameRef.current) {
            gameRef.current = new Game(canvasRef.current, {
                onDialogueStateChange: setDialogueState,
                onWorldMapStateChange: setWorldMapLocations,
                onGameFinished: setFinishedEnding,
                onHeroDeath: () => {
                    setActivePanel(null);
                    setTransferPanel(null);
                    setDialogueState(null);
                    setWorldMapLocations(null);
                },
                onCursorChange: setCursor,
                onError: (error) => setRuntimeError(error instanceof Error ? error.message : String(error)),
                onStatusTextChange: (text) => setStatusText(text ?? ""),
                onLoadingStateChange: (active, loadingName) => {
                    setLoadingLevel(loadingName);
                    setLoading(active);
                },
                onContainerOpen: (owner, title) => setTransferPanel({ owner, title, mode: "loot" }),
                onTradeRequest: (owner, title) => setTransferPanel({ owner, title, mode: "trade" }),
            });
            const start = async (): Promise<void> => {
                await gameRef.current?.start(gameMode, level, entrance);
                if (saveSlot) await gameRef.current?.load(saveSlot);
            };
            void start().catch((error) => setRuntimeError(error instanceof Error ? error.message : String(error)));
            return;
        }
        const change = saveSlot
            ? gameRef.current.load(saveSlot)
            : gameRef.current.changeLevel(gameMode, level, entrance);
        void change.catch((error) => setRuntimeError(error instanceof Error ? error.message : String(error)));
    }, [entrance, gameMode, level, saveSlot, setCursor]);

    useEffect(() => () => {
        gameRef.current?.stop();
        gameRef.current = null;
    }, []);

    useEffect(() => {
        const handleSaveLoad = (event: KeyboardEvent) => {
            if (event.key !== "F5" && event.key !== "F9") return;
            event.preventDefault();
            if (event.key === "F5") {
                try {
                    gameRef.current?.quickSave();
                } catch (error) {
                    setRuntimeError(error instanceof Error ? error.message : String(error));
                }
            } else {
                void gameRef.current?.quickLoad().catch((error) => setRuntimeError(error instanceof Error ? error.message : String(error)));
            }
        };
        window.addEventListener("keydown", handleSaveLoad);
        return () => window.removeEventListener("keydown", handleSaveLoad);
    }, []);

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setActivePanel((current) => current === "pause" ? null : "pause");
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, []);

    return (
        <div className={`${styles.gameWindow} ${cursorClassName}`} style={{ filter: `brightness(${Number(settings[2]) || 100}%)` }}>
            <canvas width={1024} height={768} ref={canvasRef} />
            <WeatherOverlay getGame={getGame} />

            <GameHud
                getGame={getGame}
                statusText={statusText}

                onSkills={() => togglePanel("skills")}
                onInventory={() => togglePanel("inventory")}
                onJournal={() => togglePanel("journal")}
                onMagic={() => togglePanel("magic")}
                onPause={() => togglePanel("pause")}
                onRest={() => togglePanel("relax")}
                skillsActive={activePanel === "skills"}
            />
            {(activePanel === "inventory" || activePanel === "skills" || activePanel === "characteristics") && gameRef.current && <InventoryPanel game={gameRef.current} initialView={activePanel} onClose={closePanel} />}
            {activePanel && activePanel !== "inventory" && activePanel !== "skills" && activePanel !== "characteristics" && activePanel !== "pause" && activePanel !== "relax" && gameRef.current && <GameMenuPanel game={gameRef.current} kind={activePanel} onClose={closePanel} />}
            {activePanel === "pause" && (
                <PauseMenu getGame={getGame} onClose={closePanel} onMainMenu={onMainMenu} onApplySettings={setSettings} />
            )}
            {activePanel === "relax" && gameRef.current && <RelaxPanel game={gameRef.current} onClose={closePanel} />}

            {transferPanel && gameRef.current && (
                <ItemTransferPanel game={gameRef.current} {...transferPanel} onClose={() => setTransferPanel(null)} />
            )}
            {dialogueState && (
                <DialoguePanel
                    className={styles.dialogue}
                    state={dialogueState}
                    onChoose={chooseDialogue}
                />
            )}
            {worldMapLocations && (
                <WorldMapPanel
                    locations={worldMapLocations}
                    onTravel={travelWorldMap}
                    onClose={closeWorldMap}
                />
            )}
            {loading && <LoadingScreen level={loadingLevel} />}
            {finishedEnding !== null && (
                <section className={styles.finished} role="status">
                    <h2>Игра завершена</h2>
                    <p>Финал {finishedEnding + 1}</p>
                </section>
            )}
            {runtimeError && (
                <section className={styles.runtimeError} role="alert">
                    <h2>Ошибка игры</h2>
                    <p>{runtimeError}</p>
                </section>
            )}
        </div>
    );
};
