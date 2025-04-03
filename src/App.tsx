import { CursorProvider } from "./context/CursorContext";
import styles from "./App.module.scss";
import { GameWindow } from "./components/gameWindow/GameWindow";
import { useState } from "react";
import { singleLevels, multiplayerLevels, GameMode } from "./constants/levels";

export const App = () => {
    const [gameMode, setGameMode] = useState<GameMode>("single");
    // const [level, setLevel] = useState(singleLevels[0]);
    // const [level, setLevel] = useState(singleLevels[4]);
    // const [level, setLevel] = useState('l9_2_1');
    // const [level, setLevel] = useState('l1_2_1');
    const [level, setLevel] = useState('l12_2_2');

    const levels = gameMode === "single" ? singleLevels : multiplayerLevels;

    return (
        <CursorProvider>
            <div className={styles.container}>
                {/* Выбор режима игры */}
                <label>
                    Game Mode:
                    <select value={gameMode} onChange={(e) => setGameMode(e.target.value as GameMode)}>
                        <option value="single">Single Player</option>
                        <option value="multiplayer">Multiplayer</option>
                    </select>
                </label>

                {/* Выбор уровня */}
                <label>
                    Level:
                    <select value={level} onChange={(e) => setLevel(e.target.value)}>
                        {levels.map((lvl) => (
                            <option key={lvl} value={lvl}>{lvl}</option>
                        ))}
                    </select>
                </label>

                {/* Окно игры */}
                <GameWindow key={`${gameMode}-${level}`} gameMode={gameMode} level={level} />
            </div>
        </CursorProvider>
    );
};

export default App;
