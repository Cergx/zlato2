import { CursorProvider } from './context/CursorContext';
import styles from './App.module.scss';
import { GameWindow } from './components/gameWindow/GameWindow';
import { useState } from 'react';
import { singleLevels, multiplayerLevels, GameMode } from './constants/levels';

const App = () => {
    const [gameMode, setGameMode] = useState<GameMode>('single');
    // const [singleLevel, setSingleLevel] = useState(singleLevels[0]);
    // const [singleLevel, setSingleLevel] = useState(singleLevels[4]);
    // const [singleLevel, setSingleLevel] = useState('l9_2_1');
    // const [singleLevel, setSingleLevel] = useState('l1_2_1');
    // const [singleLevel, setSingleLevel] = useState('l12_2_2');
    const [singleLevel, setSingleLevel] = useState('l7_1_1');
    // const [singleLevel, setSingleLevel] = useState('l5_2_3');
    const [multiplayerLevel, setMultiplayerLevel] = useState(multiplayerLevels[0]);

    const currentLevel = gameMode === 'single' ? singleLevel : multiplayerLevel;

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

                {/* Выбор single уровня */}
                {gameMode === 'single' && (
                    <label>
                        Level:
                        <select value={singleLevel} onChange={(e) => setSingleLevel(e.target.value)}>
                            {singleLevels.map((lvl) => (
                                <option key={lvl} value={lvl}>
                                    {lvl}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {/* Выбор multiplayer уровня */}
                {gameMode === 'multiplayer' && (
                    <label>
                        Level:
                        <select value={multiplayerLevel} onChange={(e) => setMultiplayerLevel(e.target.value)}>
                            {multiplayerLevels.map((lvl) => (
                                <option key={lvl} value={lvl}>
                                    {lvl}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {/* Окно игры */}
                <GameWindow key={`${gameMode}-${currentLevel}`} gameMode={gameMode} level={currentLevel} />
            </div>
        </CursorProvider>
    );
};

export default App;
