export type ParsedValue = string | number | number[] | ParsedData | ParsedData[];

export interface ParsedData {
    [key: string]: ParsedValue;
}

export function isParsedData(value: ParsedValue | undefined): value is ParsedData {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isParsedDataArray(value: ParsedValue | undefined): value is ParsedData[] {
    return Array.isArray(value) && value.every((entry) => isParsedData(entry));
}

function parseEngineObject(input: string): ParsedData {
    const rawLines = input.split(/\r?\n/);
    const lines = rawLines
        .map((line) => {
            const idx = line.indexOf("//");
            return (idx === -1 ? line : line.slice(0, idx)).trim();
        })
        .filter((line) => line !== "" && !/^[/\\]+$/.test(line));

    return parseBlock(lines, 0).result;
}

function parseBlock(lines: string[], startIndex: number): { result: ParsedData; nextIndex: number } {
    const result: ParsedData = {};
    let index = startIndex;

    while (index < lines.length) {
        const line = lines[index];
        if (line === "}") return { result, nextIndex: index + 1 };

        const keyValue = parseKeyValue(line);
        if (!keyValue) {
            index += 1;
            continue;
        }

        const { key, value } = keyValue;
        if (value === "" && lines[index + 1] === "{") {
            const subBlock = parseBlock(lines, index + 2);
            result[key] = subBlock.result;
            index = subBlock.nextIndex;
            continue;
        }

        if (key === "name") {
            const name = removeSurroundingQuotes(value);
            if (lines[index + 1] === "{") {
                const subBlock = parseBlock(lines, index + 2);
                appendNamedBlock(result, name, subBlock.result);
                index = subBlock.nextIndex;
            } else {
                appendNamedBlock(result, name, {});
                index += 1;
            }
            continue;
        }

        if (value === "{") {
            const subBlock = parseBlock(lines, index + 1);
            result[key] = subBlock.result;
            index = subBlock.nextIndex;
            continue;
        }

        result[key] = convertValue(value);
        index += 1;
    }

    return { result, nextIndex: index };
}

function appendNamedBlock(result: ParsedData, name: string, block: ParsedData): void {
    const existing = result[name];
    if (existing === undefined) {
        result[name] = block;
    } else if (isParsedDataArray(existing)) {
        existing.push(block);
    } else if (isParsedData(existing)) {
        result[name] = [existing, block];
    } else {
        throw new Error(`Named block ${name} conflicts with a scalar value`);
    }
}

function parseKeyValue(line: string): { key: string; value: string } | null {
    const colonMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (colonMatch) return { key: colonMatch[1].trim(), value: colonMatch[2].trim() };

    const [key, ...rest] = line.split(/\s+/);
    return rest.length > 0 ? { key, value: rest.join(" ") } : null;
}

function removeSurroundingQuotes(value: string): string {
    const match = value.match(/^"(.*)"$/);
    return match ? match[1] : value;
}

function convertValue(value: string): string | number | number[] {
    const unquoted = removeSurroundingQuotes(value);
    const parts = unquoted.split(/\s+/);
    if (parts.length > 1) {
        return parts.every((part) => !Number.isNaN(Number(part))) ? parts.map(Number) : unquoted;
    }

    const numericValue = Number(unquoted);
    return Number.isNaN(numericValue) ? unquoted : numericValue;
}

export default parseEngineObject;
