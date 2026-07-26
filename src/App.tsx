import { CursorProvider } from "./context/CursorContext";
import styles from "./App.module.scss";
import { useState } from "react";
import { MainMenu, type GameLaunchRequest } from "./components/MainMenu";
import { GameWindow } from "./components/gameWindow/GameWindow";
import { singleLevels, multiplayerLevels, type GameMode } from "./constants/levels";


export const App = () => {
    const strictScriptAbi = typeof window !== "undefined"
        && new URLSearchParams(window.location.search).get("strictScriptAbi") === "1";
    const [launch, setLaunch] = useState<GameLaunchRequest | null>(null);
    const [menuVisited, setMenuVisited] = useState(false);
    const gameMode = launch?.gameMode ?? "single";
    const level = launch?.level ?? singleLevels[0];
    const levels = gameMode === "single" ? singleLevels : multiplayerLevels;

    const changeMode = (nextMode: GameMode): void => {
        const nextLevel = nextMode === "single" ? singleLevels[0] : multiplayerLevels[0];
        setLaunch({ gameMode: nextMode, level: nextLevel });
    };

    return (
        <CursorProvider>
            <main className={styles.container}>
                {!launch ? (
                    <MainMenu skipSplash={menuVisited} onLaunch={(request) => { setMenuVisited(true); setLaunch(request); }} />
                ) : (
                    <>
                        <GameWindow
                            key={`${launch.gameMode}-${launch.level}-${launch.entrance ?? ""}-${launch.saveSlot ?? "new"}`}
                            gameMode={launch.gameMode}
                            level={launch.level}
                            entrance={launch.entrance}
                            saveSlot={launch.saveSlot}
                            onMainMenu={() => setLaunch(null)}
                            strictScriptAbi={strictScriptAbi}
                        />

                        <details className={styles.debugControls}>
                            <summary>DEV</summary>
                            <label>
                                Режим
                                <select value={gameMode} onChange={(event) => changeMode(event.target.value as GameMode)}>
                                    <option value="single">Single Player</option>
                                    <option value="multiplayer">Multiplayer</option>
                                </select>
                            </label>
                            <label>
                                Уровень
                                <select value={level} onChange={(event) => setLaunch({ gameMode, level: event.target.value })}>
                                    {levels.map((levelName) => <option key={levelName} value={levelName}>{levelName}</option>)}
                                </select>
                            </label>
                        </details>
                    </>
                )}
            </main>
        </CursorProvider>
    );
};

export default App;
