#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { extractSCRHandlerSources, parseSCR, SCRRuntime } from "../src/game/scripts/SCRRuntime.ts";

const sourcePath = process.argv[2];
if (!sourcePath) {
    console.error("Usage: node --experimental-strip-types tools/trace-scr.mjs <asset.scr> [--empty-factions] [--handler <name>]");
    process.exit(2);
}
const emptyFactions = process.argv.includes("--empty-factions");
const handlerOption = process.argv.indexOf("--handler");
const handler = handlerOption >= 0 ? process.argv[handlerOption + 1] : undefined;
if (handlerOption >= 0 && !handler) throw new Error("--handler requires a handler name");

const absolutePath = resolve(sourcePath);
const asset = relative(resolve("public/assets"), absolutePath).replaceAll("\\", "/");
const bytes = await readFile(absolutePath);
const source = new TextDecoder("windows-1251").decode(bytes);
const events = [];
const emit = (event) => events.push(event);
const executableSource = handler
    ? extractSCRHandlerSources(source)[handler]
    : source;
if (executableSource === undefined) throw new Error(`SCR handler ${handler} is missing`);
const program = parseSCR(executableSource, handler ? `${asset}:${handler}` : asset);
emit({
    event: "clean_scr_program",
    asset,
    handler: handler ?? null,
    bytes: bytes.byteLength,
    bodyBytes: handler ? Buffer.byteLength(executableSource) : bytes.byteLength,
    statements: program.statements.length,
});

const runtime = new SCRRuntime({
    variables: {
        L1_Svetlograd_n7_Helper: 0,
        result: 0,
    },
    host: {
        call: (name, arguments_) => {
            const result = name === "rs_gettribesrelation" ? (emptyFactions ? 2 : 1)
                : name === "rs_settribesrelation" || name === "wd_loadarea"
                    || name === "le_casteffect" || name === "le_castmagic" ? 0
                    : undefined;
            if (result === undefined) {
                throw new Error(`Unexpected host call ${name}(${arguments_.join(",")})`);
            }
            if (name === "wd_loadarea") {
                emit({ event: "clean_scr_command", command: `map ${arguments_[0]}`, immediate: 1 });
                emit({ event: "clean_scr_trigger_state", entrance: arguments_[1], entranceLength: String(arguments_[1]).length, commands: 1 });
            }
            emit({ event: "clean_scr_host_call", name, arguments: arguments_, result });
            return result;
        },
    },
    onEvaluation: ({ sequence, depth, kind, nodeType, result }) => emit({
        event: "clean_scr_evaluation",
        sequence,
        depth,
        kind,
        nodeType,
        result,
    }),
});
const result = runtime.executeProgram(program);
emit({
    event: "clean_scr_trace_summary",
    evaluations: events.filter(({ event }) => event === "clean_scr_evaluation").length,
    steps: result.steps,
    variables: Object.fromEntries(runtime.variableEntries()),
});
process.stdout.write(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
