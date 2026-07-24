import type { AGEFunctionRecord, AGEProgram, AGERecord } from "../parsers/AGEParser.ts";

export type DialogueValue = number | string;
export type DialogueStatus = "idle" | "active" | "ended";
export type DialogueEndReason = "closed" | "exit" | "exhausted";

export interface DialogueOption {
    id: number;
    text: string;
    enabled: boolean;
    shortcut?: number;
}

export interface DialogueState {
    revision: number;
    status: DialogueStatus;
    speaker: string | null;
    phraseId: number | null;
    text: string | null;
    options: readonly DialogueOption[];
    endReason: DialogueEndReason | null;
}

export interface DialogueFunctionCall {
    id: number;
    name?: string;
    arguments: readonly DialogueValue[];
    record: AGEFunctionRecord;
}

export interface DialogueRuntimeHost {
    resolvePhrase: (phraseId: number) => string;
    readVariable: (name: string) => DialogueValue | undefined;
    writeVariable: (name: string, value: DialogueValue) => void;
    invokeFunction?: (call: DialogueFunctionCall) => DialogueValue | void;
    isOptionEnabled?: (option: Readonly<Pick<DialogueOption, "id" | "text">>) => boolean;
    onStateChange?: (state: DialogueState) => void;
    onEnd?: (state: DialogueState) => void;
}

const EMPTY_OPTIONS: readonly DialogueOption[] = Object.freeze([]);
const IDLE_STATE: DialogueState = Object.freeze({
    revision: 0,
    status: "idle",
    speaker: null,
    phraseId: null,
    text: null,
    options: EMPTY_OPTIONS,
    endReason: null,
});

export class DialogueRuntime {
    private readonly host: DialogueRuntimeHost;
    private program: AGEProgram | null = null;
    private speaker: string | null = null;
    private state: DialogueState = IDLE_STATE;
    private lastPhrase = 0;
    private lastAnswer = 0;
    private pendingPhraseId: number | null = null;
    private pendingOptions: DialogueOption[] = [];
    private requestedEnd: DialogueEndReason | null = null;

    constructor(host: DialogueRuntimeHost) {
        this.host = host;
    }

    public getState(): DialogueState {
        return this.state;
    }

    public start(program: AGEProgram, speaker: string): DialogueState {
        if (speaker.trim().length === 0) throw new Error("Dialogue speaker must not be empty");
        if (program.records.length === 0) throw new Error("Cannot start an AGE program with no records");

        this.program = program;
        this.speaker = speaker;
        this.lastPhrase = 0;
        this.lastAnswer = 0;
        this.requestedEnd = null;
        return this.runTurn();
    }

    public choose(optionId: number): DialogueState {
        if (this.state.status !== "active" || !this.program) throw new Error("Cannot choose an option without an active dialogue");
        const option = this.state.options.find(({ id }) => id === optionId);
        if (!option) throw new Error(`Dialogue option ${optionId} is not available in the current turn`);
        if (!option.enabled) throw new Error(`Dialogue option ${optionId} is disabled`);

        this.lastAnswer = option.id;
        this.requestedEnd = null;
        return this.runTurn();
    }

    public end(reason: DialogueEndReason = "closed"): DialogueState {
        if (this.state.status !== "active") return this.state;
        return this.publishEnded(reason);
    }

    private runTurn(): DialogueState {
        const program = this.program;
        if (!program) throw new Error("Dialogue runtime has no AGE program");

        this.pendingPhraseId = null;
        this.pendingOptions = [];
        this.requestedEnd = null;

        let currentIndex: number = program.entryRecord;
        let steps = 0;
        const maximumSteps = Math.max(64, program.records.length * 8);
        while (currentIndex !== -1 && !this.requestedEnd) {
            if (steps >= maximumSteps) {
                throw new Error(`AGE execution exceeded ${maximumSteps} steps; the dialogue graph may contain an infinite loop`);
            }
            steps += 1;

            const record = program.records[currentIndex];
            if (!record) throw new Error(`AGE execution reached missing record ${currentIndex}`);
            const result = this.evaluate(record, new Set<number>());
            switch (record.kind) {
                case "operation":
                case "assign":
                case "function":
                case "goto":
                    currentIndex = this.isTruthy(result) ? record.nonzeroSuccessor : record.zeroSuccessor;
                    break;
                case "number":
                case "string":
                case "variable":
                    throw new Error(`AGE execution reached non-flow ${record.kind} record ${record.index}`);
            }
        }

        if (this.requestedEnd) return this.publishEnded(this.requestedEnd);
        if (this.pendingPhraseId === null || this.pendingOptions.length === 0) return this.publishEnded("exhausted");

        const phraseId = this.pendingPhraseId;
        const options = Object.freeze(this.pendingOptions.map((option, index) => Object.freeze({
            ...option,
            shortcut: index < 9 ? index + 1 : undefined,
        })));
        const nextState: DialogueState = Object.freeze({
            revision: this.state.revision + 1,
            status: "active",
            speaker: this.speaker,
            phraseId,
            text: this.resolvePhrase(phraseId),
            options,
            endReason: null,
        });
        this.state = nextState;
        this.host.onStateChange?.(nextState);
        return nextState;
    }

    private publishEnded(reason: DialogueEndReason): DialogueState {
        const nextState: DialogueState = Object.freeze({
            revision: this.state.revision + 1,
            status: "ended",
            speaker: this.speaker,
            phraseId: this.pendingPhraseId ?? this.state.phraseId,
            text: this.pendingPhraseId === null ? this.state.text : this.resolvePhrase(this.pendingPhraseId),
            options: EMPTY_OPTIONS,
            endReason: reason,
        });
        this.state = nextState;
        this.host.onStateChange?.(nextState);
        this.host.onEnd?.(nextState);
        return nextState;
    }

    private evaluate(record: AGERecord, visiting: Set<number>): DialogueValue {
        if (visiting.has(record.index)) throw new Error(`AGE expression cycle detected at record ${record.index}`);
        visiting.add(record.index);

        let value: DialogueValue;
        switch (record.kind) {
            case "number":
                value = record.value;
                break;
            case "string":
                value = record.value;
                break;
            case "variable":
                value = this.readVariable(record.name);
                break;
            case "goto":
                value = 0;
                break;
            case "operation":
                value = this.evaluateOperation(record, visiting);
                break;
            case "assign": {
                const target = this.requireRecord(record.targetIndex);
                if (target.kind !== "variable") {
                    throw new Error(`AGE assignment record ${record.index} targets ${target.kind} record ${target.index}, expected variable`);
                }
                value = this.evaluate(this.requireRecord(record.valueIndex), visiting);
                this.writeVariable(target.name, value);
                break;
            }
            case "function":
                value = this.evaluateFunction(record, visiting);
                break;
        }

        visiting.delete(record.index);
        return value;
    }

    private evaluateOperation(record: Extract<AGERecord, { kind: "operation" }>, visiting: Set<number>): DialogueValue {
        const left = this.evaluate(this.requireRecord(record.operandIndexes[0]), visiting);
        const right = this.evaluate(this.requireRecord(record.operandIndexes[1]), visiting);
        const leftInt = typeof left === "number" ? left | 0 : 0;
        const rightInt = typeof right === "number" ? right | 0 : 0;

        switch (record.tag) {
            case 0: return this.isTruthy(left) || this.isTruthy(right) ? 1 : 0;
            case 1: return this.isTruthy(left) !== this.isTruthy(right) ? 1 : 0;
            case 2: return this.isTruthy(left) && this.isTruthy(right) ? 1 : 0;
            case 3: return leftInt | rightInt;
            case 4: return leftInt ^ rightInt;
            case 5: return leftInt & rightInt;
            case 6: return left !== right ? 1 : 0;
            case 7: return left === right ? 1 : 0;
            case 8: return this.requireNumbers(record, left, right, (a, b) => a >= b ? 1 : 0);
            case 9: return this.requireNumbers(record, left, right, (a, b) => a <= b ? 1 : 0);
            case 10: return this.requireNumbers(record, left, right, (a, b) => a > b ? 1 : 0);
            case 11: return this.requireNumbers(record, left, right, (a, b) => a < b ? 1 : 0);
            case 12: return leftInt << (rightInt & 31);
            case 13: return leftInt >> (rightInt & 31);
            case 14: return (leftInt + rightInt) | 0;
            case 15: return (leftInt - rightInt) | 0;
            case 16: return Math.imul(leftInt, rightInt);
            case 17: return rightInt === 0 ? 0 : Math.trunc(leftInt / rightInt) | 0;
            case 18: return rightInt === 0 ? 0 : leftInt % rightInt;
            case 19: return ~rightInt;
            case 20: return this.isTruthy(right) ? 0 : 1;
        }
    }

    private requireNumbers(record: AGERecord, left: DialogueValue, right: DialogueValue, operation: (left: number, right: number) => number): number {
        if (typeof left !== "number" || typeof right !== "number") {
            throw new Error(`AGE ${record.tagName} record ${record.index} requires numeric operands`);
        }
        return operation(left, right);
    }

    private evaluateFunction(record: AGEFunctionRecord, visiting: Set<number>): DialogueValue {
        const args = record.argumentIndexes.map((index) => this.evaluate(this.requireRecord(index), visiting));
        switch (record.functionName) {
            case "D_Say": {
                const phraseId = this.requirePhraseId(record, args[0]);
                this.pendingPhraseId = phraseId;
                this.pendingOptions = [];
                this.lastPhrase = phraseId;
                return 1;
            }
            case "D_Answer": {
                if (this.pendingPhraseId === null) throw new Error(`AGE D_Answer record ${record.index} ran before D_Say`);
                const id = this.requirePhraseId(record, args[0]);
                if (this.pendingOptions.some((option) => option.id === id)) {
                    throw new Error(`AGE dialogue turn contains duplicate option ${id}`);
                }
                const text = this.resolvePhrase(id);
                const enabled = this.host.isOptionEnabled?.({ id, text }) ?? true;
                this.pendingOptions.push({ id, text, enabled });
                return 1;
            }
            case "D_CloseDialog":
                this.requestedEnd = "closed";
                return 1;
            case "Exit":
                this.requestedEnd = "exit";
                return 0;
            default:
                if (record.functionId === 0) return 0;
                if (!this.host.invokeFunction) {
                    const label = record.functionName ?? `0x${record.functionId.toString(16)}`;
                    throw new Error(`AGE function ${label} at record ${record.index} has no host handler`);
                }
                return this.host.invokeFunction({
                    id: record.functionId,
                    name: record.functionName,
                    arguments: args,
                    record,
                }) ?? 0;
        }
    }

    private requirePhraseId(record: AGEFunctionRecord, value: DialogueValue | undefined): number {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
            throw new Error(`AGE ${record.functionName ?? "dialogue"} record ${record.index} requires a positive integer phrase ID`);
        }
        return value;
    }

    private resolvePhrase(phraseId: number): string {
        const text = this.host.resolvePhrase(phraseId);
        if (typeof text !== "string" || text.length === 0) throw new Error(`Dialogue phrase ${phraseId} could not be resolved`);
        return text.replace(/%%(\S+)/g, (marker, name: string) => {
            const value = this.host.readVariable(name);
            return value === undefined ? marker : String(value);
        });
    }


    private readVariable(name: string): DialogueValue {
        if (name === "LastPhrase") return this.lastPhrase;
        if (name === "LastAnswer") return this.lastAnswer;
        return this.host.readVariable(name) ?? 0;
    }

    private writeVariable(name: string, value: DialogueValue): void {
        if (name === "LastPhrase") {
            if (typeof value !== "number") throw new Error("LastPhrase must be assigned a number");
            this.lastPhrase = value;
            return;
        }
        if (name === "LastAnswer") {
            if (typeof value !== "number") throw new Error("LastAnswer must be assigned a number");
            this.lastAnswer = value;
            return;
        }
        this.host.writeVariable(name, value);
    }

    private requireRecord(index: number): AGERecord {
        const record = this.program?.records[index];
        if (!record) throw new Error(`AGE expression references missing record ${index}`);
        return record;
    }

    private isTruthy(value: DialogueValue): boolean {
        return typeof value === "number" ? value !== 0 : value.length > 0;
    }
}
