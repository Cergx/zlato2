type ParsedData = Record<string, any>;

function parseEngineObject(input: string): ParsedData {
    const rawLines = input.split(/\r?\n/);

    // Убираем комментарии и пустые строки
    const lines = rawLines
        .map((line) => {
            const idx = line.indexOf('//');
            if (idx !== -1) {
                line = line.slice(0, idx);
            }
            return line.trim();
        })
        .filter((l) => l !== '' && !/^[/\\]+$/.test(l));

    const { result } = parseBlock(lines, 0);
    return result;
}

function parseBlock(
    lines: string[],
    startIndex: number
): { result: ParsedData; nextIndex: number } {
    const result: ParsedData = {};
    let i = startIndex;

    while (i < lines.length) {
        const line = lines[i];

        // Закрытие блока
        if (line === '}') {
            return { result, nextIndex: i + 1 };
        }

        const keyValue = parseKeyValue(line);

        if (!keyValue) {
            // Возможно, это просто "{" или какая-то левоватая строка
            i++;
            continue;
        }

        let { key, value } = keyValue;

        // Если value пустое и следующая строка — {
        //   => вложенный блок
        if (
            value === '' &&
            i + 1 < lines.length &&
            lines[i + 1] === '{'
        ) {
            const subBlock = parseBlock(lines, i + 2);
            result[key] = subBlock.result;
            i = subBlock.nextIndex;
            continue;
        }

        // Особая логика для name
        if (key === 'name') {
            const subKey = removeSurroundingQuotes(value);

            if (i + 1 < lines.length && lines[i + 1] === '{') {
                const subBlock = parseBlock(lines, i + 2);
                result[subKey] = subBlock.result;
                i = subBlock.nextIndex;
            } else {
                // Если нет блока, просто записываем как пустой или строку (на ваше усмотрение)
                result[subKey] = {};
                i++;
            }
            continue;
        }

        // Если value === '{' => блок на этой же строке
        if (value === '{') {
            const subBlock = parseBlock(lines, i + 1);
            result[key] = subBlock.result;
            i = subBlock.nextIndex;
            continue;
        }

        // Обычное значение
        result[key] = convertValue(value);
        i++;
    }

    return { result, nextIndex: i };
}

function parseKeyValue(line: string): { key: string; value: string } | null {
    // 1) Кейс "key: value"
    const matchColon = line.match(/^([^:]+):\s*(.*)$/);
    if (matchColon) {
        const key = matchColon[1].trim();
        const value = matchColon[2].trim();
        return { key, value };
    }

    // 2) Кейс "key value" (без двоеточия)
    const parts = line.split(/\s+/);
    if (parts.length > 1) {
        const [key, ...rest] = parts;
        const value = rest.join(' ');
        return { key, value };
    }

    return null;
}

function removeSurroundingQuotes(str: string): string {
    const match = str.match(/^"(.*)"$/);
    if (match) {
        return match[1];
    }
    return str;
}

function convertValue(value: string): string | number | number[] {
    const unquoted = removeSurroundingQuotes(value);
    const parts = unquoted.split(/\s+/);

    if (parts.length > 1) {
        if (parts.every((p) => !isNaN(Number(p)))) {
            return parts.map((p) => Number(p));
        }

        return unquoted;
    }

    const num = Number(unquoted);
    if (!isNaN(num)) {
        return num;
    }
    // Иначе просто строка
    return unquoted;
}

export default parseEngineObject;
