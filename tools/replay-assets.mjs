#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AGEParser } from "../src/game/parsers/AGEParser.ts";
import { DialogueRuntime } from "../src/game/dialogue/DialogueRuntime.ts";
import { SCRRuntime, parseSCR } from "../src/game/scripts/SCRRuntime.ts";

const strictHost = process.argv.includes("--strict-host");
const simulateOnly = !strictHost;

const failWithAsset = (asset, error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`replay_failed asset=${asset} error=${message}`);
    process.exitCode = 1;
};
const root = resolve(process.cwd());
const events = [];
const emit = (event) => events.push(event);
const readBytes = async (relativePath) => readFile(resolve(root, relativePath));
const exactArrayBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const readCP1251 = async (relativePath) => new TextDecoder("windows-1251").decode(await readBytes(relativePath));

const parsePhrases = async () => {
    const bytes = await readBytes("public/assets/sdb/dialogs/dialogsphrases.sdb");
    const view = new DataView(exactArrayBuffer(bytes));
    const data = new TextDecoder("windows-1251");
    let offset = data.decode(bytes.subarray(0, 4)) === "SDB " ? 4 : 0;
    const phrases = {};
    while (offset + 8 <= view.byteLength) {
        const id = view.getInt32(offset, true);
        const length = view.getInt32(offset + 4, true);
        offset += 8;
        if (length < 0 || offset + length > view.byteLength) throw new Error(`Invalid SDB phrase record at ${offset}`);
        phrases[id] = data.decode(bytes.subarray(offset, offset + length)).trim();
        offset += length;
    }
    return phrases;
};

const parseAge = async () => {
    const bytes = await readBytes("public/assets/scripts/dialogs/demon.d1.age.cs");
    return new AGEParser(exactArrayBuffer(bytes)).getData();
};

const replayDialogue = async () => {
    const phrases = await parsePhrases();
    const variables = new Map([["HeroName", "Hero"], ["money", 0], ["price", 0]]);
    const runtime = new DialogueRuntime({
        resolvePhrase: (phraseId) => phrases[phraseId] ?? `#missing:${phraseId}`,
        readVariable: (name) => variables.get(name),
        writeVariable: (name, value) => variables.set(name, value),
        onFunctionCall: ({ id, name, arguments: args, record }) => {
            emit({ event: "age_function", id, name: name ?? null, record: record.index, arguments: args });
        },
        invokeFunction: () => 0,
        onStateChange: (state) => emit({
            event: "dialogue_state",
            revision: state.revision,
            status: state.status,
            phraseId: state.phraseId,
            options: state.options.map(({ id, enabled }) => ({ id, enabled })),
        }),
        onEnd: (state) => emit({ event: "dialogue_end", reason: state.endReason }),
    });
    const program = await parseAge();
    emit({ event: "age_program", bytes: program.byteLength, encoding: program.encoding, records: program.records.length, openingRecord: program.openingRecord });
    const first = runtime.start(program, "demon_univ");
    if (first.status === "active" && first.options[0]?.enabled) runtime.choose(first.options[0].id);
};

const replayScript = async (relativePath) => {
    const source = await readCP1251(relativePath);
    const calls = [];
    const runtime = new SCRRuntime({
        host: {
            call: (name, args) => {
                if (!simulateOnly) throw new Error(`SCR host call '${name}' requires --simulate-only or omit --strict-host until native traces exist`);
                calls.push({ name, arguments: args });
                const result = name === "rs_gettribesrelation" ? 1 : 0;
                emit({ event: "scr_host_call", source: relativePath, name, arguments: args, result, simulated: true });
                return result;
            },
        },
    });
    const program = parseSCR(source, relativePath);
    emit({ event: "scr_program", source: relativePath, statements: program.statements.length });
    runtime.executeProgram(program);
    emit({ event: "scr_result", source: relativePath, calls: calls.length, variables: Object.fromEntries(runtime.variableEntries()) });
};

try {
    await replayDialogue();
} catch (error) {
    failWithAsset("public/assets/scripts/dialogs/demon.d1.age.cs", error);
}
try {
    await replayScript("public/assets/levels/single/l1_1/scripts/init.scr");
} catch (error) {
    failWithAsset("public/assets/levels/single/l1_1/scripts/init.scr", error);
}
try {
    await replayScript("public/assets/levels/single/l1_1/scripts/core.scr");
} catch (error) {
    failWithAsset("public/assets/levels/single/l1_1/scripts/core.scr", error);
}
process.stdout.write(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
