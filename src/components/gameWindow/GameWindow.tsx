import { useEffect, useRef, useState } from "react";
import { Game } from "../../game/Game";
import { useCursor } from "../../context/CursorContext";
import { CursorType } from "../../enums/CursorTypes.ts";
import styles from "./GameWindow.module.scss";

interface GameWindowProps {
    gameMode: "single" | "multiplayer";
    level: string;
}

export const GameWindow = ({ gameMode, level }: GameWindowProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameRef = useRef<Game | null>(null);
    const { setCursor, cursorClassName } = useCursor();
    const [initialized, setInitialized] = useState(false);

    useEffect(() => {
        if (!canvasRef.current) return;

        setCursor(CursorType.NORMAL);

        if (!gameRef.current) {
            console.log(222)
            gameRef.current = new Game(canvasRef.current);
            gameRef.current?.start(gameMode, level);
            setInitialized(true);
        } else if (initialized) {
            // gameRef.current?.changeLevel(gameMode, level);
        }
    }, [gameMode, level]);

    return (
        <div className={`${styles.gameWindow} ${cursorClassName}`}>
            <canvas width={1240} height={1024} ref={canvasRef} />
        </div>
    );
};
