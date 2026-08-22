#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AGEParser } from "../src/game/parsers/AGEParser.ts";
import { DialogueRuntime } from "../src/game/dialogue/DialogueRuntime.ts";

const args = process.argv.slice(2);
const asset = args[0];
const functionLimitIndex = args.indexOf("--function-limit");
const functionLimit = functionLimitIndex === -1 ? 0 : Number(args[functionLimitIndex + 1]);
const replyFirst = args.includes("--reply-first");
const hostResults = new Map();
for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--host-result") continue;
    const [name, rawValue] = (args[index + 1] ?? "").split("=");
    const value = Number(rawValue);
    if (!name || !Number.isFinite(value)) {
        console.error("--host-result requires NAME=NUMBER");
        process.exit(2);
    }
    hostResults.set(name.toLowerCase(), value);
}
if (!asset || (functionLimitIndex !== -1 && (!Number.isSafeInteger(functionLimit) || functionLimit <= 0))) {
    console.error("Usage: node tools/trace-age-dialogue.mjs <asset> [--function-limit N] [--reply-first] [--host-result NAME=NUMBER]");
    process.exit(2);
}

const exactArrayBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const events = [];
const emit = (event) => events.push(event);
const bytes = await readFile(resolve(asset));
const program = new AGEParser(exactArrayBuffer(bytes)).getData();
const variables = new Map();
let evaluationSequence = 0;
let flowStep = 0;
let functionCount = 0;
let stopAfterRecord = -1;
const stopSignal = Object.freeze({ type: "age-function-limit" });

const runtime = new DialogueRuntime({
    resolvePhrase: (phraseId) => `#${phraseId}`,
    readVariable: (name) => variables.get(name) ?? 0,
    writeVariable: (name, value) => variables.set(name, value),
    onFunctionCall: ({ id, name, arguments: arguments_, record }) => {
        functionCount += 1;
        emit({ event: "age_function", id, name: name ?? null, record: record.index, arguments: arguments_ });
        if (functionLimit !== 0 && functionCount >= functionLimit) stopAfterRecord = record.index;
    },
    onRecordEvaluated: ({ record, result, depth }) => {
        evaluationSequence += 1;
        emit({ event: "age_evaluation", sequence: evaluationSequence, depth, record: record.index, kind: record.tag, result });
        if (record.index === stopAfterRecord) throw stopSignal;
    },
    onNodeEvaluated: ({ record, result, branch, successor }) => {
        flowStep += 1;
        emit({ event: "age_node", step: flowStep, record: record.index, result, branch, successor });
    },
    onStateChange: (state) => emit({
        event: "dialogue_state",
        revision: state.revision,
        status: state.status,
        phraseId: state.phraseId,
        options: state.options.map(({ id, enabled }) => ({ id, enabled })),
        voiceBasename: state.voiceBasename,
        endReason: state.endReason,
    }),
    invokeFunction: ({ name }) => hostResults.get(name?.toLowerCase() ?? "") ?? 0,
});

emit({
    event: "age_program",
    asset: asset.replace(/\\/g, "/").replace(/^public\/assets\//, ""),
    bytes: program.byteLength,
    encoding: program.encoding,
    records: program.records.length,
});
try {
    const state = runtime.start(program, "trace");
    if (replyFirst && state.status === "active" && state.options[0]?.enabled) {
        runtime.choose(state.options[0].id);
    }
} catch (error) {
    if (error !== stopSignal) throw error;
    emit({ event: "age_trace_stopped", reason: "function_limit", functions: functionCount });
}
process.stdout.write(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
