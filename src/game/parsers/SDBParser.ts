export type SDBData = Record<number, string>;

export class SDBParser {
    private mapping: SDBData = {};

    constructor(private data: ArrayBuffer) {
        this.parse();
    }

    private parse() {
        const view = new DataView(this.data);
        let offset = 0;

        // Проверяем заголовок "SDB "
        const header = new TextDecoder("windows-1251").decode(new Uint8Array(this.data, 0, 4));
        const xorRequired = header !== "SDB ";

        if (!xorRequired) {
            offset = 4; // Пропускаем заголовок
        }

        while (offset < view.byteLength) {
            // Читаем ID
            if (offset + 4 > view.byteLength) break;
            const itemId = view.getInt32(offset, true);
            offset += 4;

            // Читаем длину строки
            if (offset + 4 > view.byteLength) break;
            const textLength = view.getInt32(offset, true);
            offset += 4;

            // Читаем текст
            if (offset + textLength > view.byteLength) break;
            let textBytes = new Uint8Array(this.data, offset, textLength);
            offset += textLength;

            // Применяем XOR-декодирование (если файл был зашифрован)
            if (xorRequired) {
                textBytes = textBytes.map(byte => byte ^ 0xAA);
            }

            // Декодируем строку в Windows-1251
            const text = new TextDecoder("windows-1251").decode(textBytes).trim();
            this.mapping[itemId] = text;
        }
    }

    getName = (id: number) => this.mapping[id] || 'Unknown';

    getData = () => this.mapping;
}
