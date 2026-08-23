const STANDARD_PREFIX = [49, 1, 1, 7, 2, 3] as const;
const XOR_SEED = 0x59;

const TAG_NAMES: Record<number, string> = {
    0: "logicalOr",
    1: "logicalXor",
    2: "logicalAnd",
    3: "bitwiseOr",
    4: "bitwiseXor",
    5: "bitwiseAnd",
    6: "notEqual",
    7: "equal",
    8: "greaterOrEqual",
    9: "lessOrEqual",
    10: "greater",
    11: "less",
    12: "shiftLeft",
    13: "shiftRightArithmetic",
    14: "add",
    15: "subtract",
    16: "multiply",
    17: "divide",
    18: "modulo",
    19: "bitwiseNot",
    20: "logicalNot",
    21: "number",
    22: "string",
    23: "variable",
    24: "number",
    48: "functionCall",
    49: "goto",
    50: "assign",
};

const FUNCTION_NAMES: Record<number, string> = {
    0x1000000: "Exit",
    0x1000001: "Signal",
    0x1000002: "Console",
    0x1000003: "Cmd",
    0x1000004: "D_Say",
    0x1000005: "D_CloseDialog",
    0x1000006: "D_Answer",
    0x1000007: "D_PlaySound",
    0x2000000: "LE_CastEffect",
    0x2000001: "LE_DelEffect",
    0x2000002: "LE_CastMagic",
    0x3000000: "WD_LoadArea",
    0x3000001: "WD_SetCellsGroupFlag",
    0x3000002: "RS_SetTribesRelation",
    0x3000003: "RS_GetTribesRelation",
    0x3000004: "RS_StartDialog",
    0x3000005: "WD_SetVisible",
    0x3000006: "C_FINISHED",
    0x3000007: "WD_TitlesAndLoadArea",
    0x3000008: "C_TitlesAndFINISHED",
    0x4000000: "RS_GetPersonParameterI",
    0x4000001: "RS_SetPersonParameterI",
    0x4000002: "RS_AddPerson_1",
    0x4000003: "RS_AddPerson_2",
    0x4000004: "RS_IsPersonExistsI",
    0x4000005: "RS_AddExp",
    0x4000006: "RS_DelPerson",
    0x4000007: "RS_AddToHeroPartyName",
    0x4000008: "RS_RemoveFromHeroPartyName",
    0x4000009: "RS_TestHeroHasPartyName",
    0x400000a: "RS_AllyCmd",
    0x400000b: "RS_ShowMessage",
    0x400000c: "RS_GetPersonSkillI",
    0x5000000: "RS_TestPersonHasItem",
    0x5000001: "RS_PersonTransferItemI",
    0x5000002: "RS_GetItemCountI",
    0x5000003: "RS_PersonTransferAllItemsI",
    0x5000004: "RS_PersonAddItem",
    0x5000005: "RS_PersonRemoveItem",
    0x5000006: "RS_PersonAddItemToTrade",
    0x5000007: "RS_PersonRemoveItemToTrade",
    0x5000008: "RS_GetMoney",
    0x6000000: "RS_GetDayOrNight",
    0x6000001: "RS_GetCurrentTimeOfDayI",
    0x6000002: "RS_GetDaysFromBeginningI",
    0x6000003: "RS_AddTime",
    0x7000000: "RS_QuestComplete",
    0x7000001: "RS_StageEnable",
    0x7000002: "RS_QuestEnable",
    0x7000003: "RS_StageComplete",
    0x7000004: "RS_StorylineQuestEnable",
    0x7000005: "RS_SetEvent",
    0x7000006: "RS_GetEvent",
    0x7000007: "RS_ClearEvent",
    0x7000008: "RS_SetLocationAccess",
    0x7000009: "RS_EnableTrigger",
    0x700000a: "RS_GetRandMinMaxI",
    0x700000b: "RS_SetWeather",
    0x700000c: "RS_SetSpecialPerk",
    0x700000d: "RS_PassToTradePanel",
    0x700000e: "RS_GetDialogEnabled",
    0x700000f: "RS_SetUndeadState",
    0x7000010: "RS_GlobalMap",
    0x7000013: "RS_SetInjured",
    0x7000014: "RS_SetDoorState",
};

interface AGERecordBase {
    index: number;
    tag: number;
    tagName: string;
}

export interface AGEOperationRecord extends AGERecordBase {
    kind: "operation";
    tag: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20;
    operandIndexes: readonly [number, number];
    nonzeroSuccessor: number;
    zeroSuccessor: number;
}

export interface AGEAssignRecord extends AGERecordBase {
    kind: "assign";
    tag: 50;
    targetIndex: number;
    valueIndex: number;
    nonzeroSuccessor: number;
    zeroSuccessor: number;
}

export interface AGENumberRecord extends AGERecordBase {
    kind: "number";
    tag: 21 | 24;
    value: number;
}

export interface AGEStringRecord extends AGERecordBase {
    kind: "string";
    tag: 22;
    value: string;
}

export interface AGEVariableRecord extends AGERecordBase {
    kind: "variable";
    tag: 23;
    name: string;
}

export interface AGEFunctionRecord extends AGERecordBase {
    kind: "function";
    tag: 48;
    functionId: number;
    functionName?: string;
    argumentIndexes: readonly number[];
    nonzeroSuccessor: number;
    zeroSuccessor: number;
}

export interface AGEGotoRecord extends AGERecordBase {
    kind: "goto";
    tag: 49;
    nonzeroSuccessor: number;
    zeroSuccessor: number;
}

export type AGERecord =
    | AGEOperationRecord
    | AGEAssignRecord
    | AGENumberRecord
    | AGEStringRecord
    | AGEVariableRecord
    | AGEFunctionRecord
    | AGEGotoRecord;

export interface AGEProgram {
    byteLength: number;
    encoding: "plain" | "incremental-xor-0x59";
    entryRecord: 0;
    openingRecord: number;
    records: readonly AGERecord[];
}

const numericBuffer = new ArrayBuffer(8);
const numericView = new DataView(numericBuffer);

function decodeDouble(lowWord: number, highWord: number): number {
    numericView.setInt32(0, lowWord, true);
    numericView.setInt32(4, highWord, true);
    return numericView.getFloat64(0, true);
}

function readWords(view: DataView, offset: number, count: number): number[] {
    return Array.from({ length: count }, (_, index) => view.getInt32(offset + index * 4, true));
}

export class AGEParser {
    private readonly program: AGEProgram;

    constructor(data: ArrayBuffer) {
        this.program = this.parse(data);
    }

    public getData(): AGEProgram {
        return this.program;
    }

    private parse(data: ArrayBuffer): AGEProgram {
        if (data.byteLength < 28) throw new Error(`AGE data is too short: ${data.byteLength} bytes`);

        const source = new Uint8Array(data);
        let bytes = source;
        let view = new DataView(data);
        let encoding: AGEProgram["encoding"] = "plain";

        if (!this.hasStandardPrefix(view)) {
            bytes = this.decrypt(source);
            view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            if (!this.hasStandardPrefix(view)) {
                throw new Error("AGE data has neither a plaintext nor incremental-XOR record prefix");
            }
            encoding = "incremental-xor-0x59";
        }

        const declaredLength = view.getUint32(0, true);
        if (declaredLength !== data.byteLength) {
            throw new Error(`AGE length mismatch: declares ${declaredLength} bytes, received ${data.byteLength}`);
        }

        const records = this.parseRecords(bytes, view, declaredLength);
        const openingRecord = this.validateProgram(records);
        return { byteLength: declaredLength, encoding, entryRecord: 0, openingRecord, records };
    }

    private hasStandardPrefix(view: DataView): boolean {
        if (view.byteLength < 28) return false;
        return STANDARD_PREFIX.every((expected, index) => view.getUint32(4 + index * 4, true) === expected);
    }

    private decrypt(source: Uint8Array): Uint8Array<ArrayBuffer> {
        const decrypted = new Uint8Array(source);
        for (let offset = 4; offset < decrypted.length; offset += 1) {
            decrypted[offset] ^= (XOR_SEED + offset - 4) & 0xff;
        }
        return decrypted;
    }

    private parseRecords(bytes: Uint8Array, view: DataView, end: number): AGERecord[] {
        const records: AGERecord[] = [];
        let offset = 4;
        while (offset < end) {
            const parsed = this.parseRecord(bytes, view, offset, end, records.length);
            records.push(parsed.record);
            offset = parsed.nextOffset;
        }
        if (offset !== end) throw new Error(`AGE record stream ended at byte ${offset}, expected ${end}`);
        return records;
    }

    private parseRecord(bytes: Uint8Array, view: DataView, offset: number, end: number, index: number): { record: AGERecord; nextOffset: number } {
        this.requireBytes(offset, 4, end, index);
        const tag = view.getUint32(offset, true);
        const tagName = TAG_NAMES[tag];
        if (!tagName) throw new Error(`AGE record ${index} has unsupported tag ${tag} at byte ${offset}`);
        const payloadOffset = offset + 4;

        if (tag <= 20 || tag === 50) {
            this.requireBytes(payloadOffset, 16, end, index);
            const [first, second, nonzeroSuccessor, zeroSuccessor] = readWords(view, payloadOffset, 4);
            const record: AGERecord = tag === 50
                ? { kind: "assign", index, tag: 50, tagName, targetIndex: first, valueIndex: second, nonzeroSuccessor, zeroSuccessor }
                : { kind: "operation", index, tag: tag as AGEOperationRecord["tag"], tagName, operandIndexes: [first, second], nonzeroSuccessor, zeroSuccessor };
            return { record, nextOffset: payloadOffset + 16 };
        }

        if (tag === 21 || tag === 24) {
            this.requireBytes(payloadOffset, 8, end, index);
            const [lowWord, highWord] = readWords(view, payloadOffset, 2);
            return {
                record: { kind: "number", index, tag, tagName, value: decodeDouble(lowWord, highWord) },
                nextOffset: payloadOffset + 8,
            };
        }

        if (tag === 22 || tag === 23) {
            const text = this.readCString(bytes, payloadOffset, end, tag === 23, tag === 22, index);
            const record: AGERecord = tag === 22
                ? { kind: "string", index, tag: 22, tagName, value: text.value }
                : { kind: "variable", index, tag: 23, tagName, name: text.value };
            return { record, nextOffset: text.nextOffset };
        }

        if (tag === 48) {
            this.requireBytes(payloadOffset, 20, end, index);
            const words = readWords(view, payloadOffset, 5);
            let nextOffset = payloadOffset + 20;
            while (words[words.length - 1] !== -1 && words.length < 13) {
                this.requireBytes(nextOffset, 4, end, index);
                words.push(view.getInt32(nextOffset, true));
                nextOffset += 4;
            }
            const terminator = words.indexOf(-1, 4);
            const functionId = decodeDouble(words[2], words[3]);
            if (!Number.isSafeInteger(functionId) || functionId < 0) {
                throw new Error(`AGE function record ${index} has invalid function ID ${functionId}`);
            }
            return {
                record: {
                    kind: "function",
                    index,
                    tag: 48,
                    tagName,
                    nonzeroSuccessor: words[0],
                    zeroSuccessor: words[1],
                    functionId,
                    functionName: FUNCTION_NAMES[functionId],
                    argumentIndexes: words.slice(4, terminator === -1 ? undefined : terminator),
                },
                nextOffset,
            };
        }

        this.requireBytes(payloadOffset, 8, end, index);
        const [nonzeroSuccessor, zeroSuccessor] = readWords(view, payloadOffset, 2);
        return {
            record: { kind: "goto", index, tag: 49, tagName, nonzeroSuccessor, zeroSuccessor },
            nextOffset: payloadOffset + 8,
        };
    }

    private readCString(bytes: Uint8Array, offset: number, end: number, asciiOnly: boolean, allowEmpty: boolean, index: number): { value: string; nextOffset: number } {
        let cursor = offset;
        while (cursor < end && bytes[cursor] !== 0) {
            const byte = bytes[cursor];
            if (asciiOnly && (byte < 0x20 || byte > 0x7e)) {
                throw new Error(`AGE record ${index} has a non-ASCII variable name at byte ${cursor}`);
            }
            cursor += 1;
        }
        if (cursor === end) throw new Error(`AGE record ${index} has an unterminated string at byte ${offset}`);
        if (!allowEmpty && cursor === offset) throw new Error(`AGE record ${index} has an empty variable name`);
        const decoder = new TextDecoder(asciiOnly ? "ascii" : "windows-1251");
        return { value: decoder.decode(bytes.subarray(offset, cursor)), nextOffset: cursor + 1 };
    }

    private requireBytes(offset: number, byteLength: number, end: number, index: number): void {
        if (offset + byteLength > end) throw new Error(`AGE record ${index} is truncated at byte ${offset}`);
    }

    private validateProgram(records: readonly AGERecord[]): number {
        const root = records[0];
        const dispatch = records[1];
        const lastPhrase = records[2];
        const zero = records[3];
        if (root?.kind !== "goto" || root.nonzeroSuccessor !== 1 || root.zeroSuccessor !== 1
            || dispatch?.kind !== "operation" || dispatch.tag !== 7
            || dispatch.operandIndexes[0] !== 2 || dispatch.operandIndexes[1] !== 3 || dispatch.zeroSuccessor !== 4
            || lastPhrase?.kind !== "variable" || lastPhrase.name !== "LastPhrase"
            || zero?.kind !== "number" || zero.value !== 0) {
            throw new Error("AGE data does not contain the expected entry dispatch graph");
        }

        for (const record of records) this.validateRecordReferences(record, records.length);
        return dispatch.nonzeroSuccessor;
    }

    private validateRecordReferences(record: AGERecord, recordCount: number): void {
        const requireRecord = (reference: number, label: string, allowEnd = false) => {
            if ((allowEnd && reference === -1) || (Number.isInteger(reference) && reference >= 0 && reference < recordCount)) return;
            throw new Error(`AGE record ${record.index} has invalid ${label} reference ${reference}`);
        };
        const requireSuccessors = (value: { nonzeroSuccessor: number; zeroSuccessor: number }) => {
            requireRecord(value.nonzeroSuccessor, "nonzero successor", true);
            requireRecord(value.zeroSuccessor, "zero successor", true);
        };

        switch (record.kind) {
            case "operation":
                requireRecord(record.operandIndexes[0], "left operand");
                requireRecord(record.operandIndexes[1], "right operand");
                requireSuccessors(record);
                break;
            case "assign":
                requireRecord(record.targetIndex, "assignment target");
                requireRecord(record.valueIndex, "assignment value");
                requireSuccessors(record);
                break;
            case "function":
                record.argumentIndexes.forEach((reference, index) => requireRecord(reference, `argument ${index + 1}`));
                requireSuccessors(record);
                break;
            case "goto":
                requireSuccessors(record);
                break;
            case "number":
            case "string":
            case "variable":
                break;
        }
    }
}
