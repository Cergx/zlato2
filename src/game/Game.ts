import { Level } from "./Level";
import { GameMode } from "../constants/levels.ts";

export class Game {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private level: Level | null = null;
    private gameLoopActive = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");

        if (!this.ctx) {
            throw new Error("Не удалось получить контекст `2d`");
        }
    }

    public async start(gameMode: GameMode, levelName: string) {
        console.log(`Запуск игры: режим ${gameMode}, уровень ${levelName}`);

        this.level = new Level(this.canvas);
        await this.level.loadLevel(gameMode, levelName);

        this.gameLoopActive = true;
        this.gameLoop();
    }

    public stop() {
        console.log("Остановка игрового цикла");
        this.gameLoopActive = false;
    }

    public async changeLevel(gameMode: GameMode, levelName: string) {
        if (!this.level) return;

        console.log(`Смена уровня: режим ${gameMode}, новый уровень ${levelName}`);
        await this.level.changeLevel(gameMode, levelName);
    }

    private gameLoop = () => {
        if (!this.gameLoopActive) return;
        requestAnimationFrame(this.gameLoop);

        this.ctx!.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.level?.draw();
    };
}
