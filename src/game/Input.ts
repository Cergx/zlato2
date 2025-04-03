type KeyState = { [key: string]: boolean };

export class InputHandler {
    private keys: KeyState = {};

    constructor() {
        window.addEventListener('keydown', (event) => this.handleKeyDown(event));
        window.addEventListener('keyup', (event) => this.handleKeyUp(event));
    }

    private handleKeyDown(event: KeyboardEvent) {
        event.preventDefault(); // 🔹 Блокируем скролл и системные действия
        this.keys[event.key] = true;
    }

    private handleKeyUp(event: KeyboardEvent) {
        event.preventDefault(); // 🔹 Блокируем отпускание системных клавиш
        this.keys[event.key] = false;
    }

    isKeyPressed(key: string): boolean {
        return !!this.keys[key];
    }

    isCommandKeyPressed(): boolean {
        return this.keys['Control'] || this.keys['Alt'] || this.keys['Shift'];
    }
}
