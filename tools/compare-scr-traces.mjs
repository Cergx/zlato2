#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [nativePath, cleanPath] = process.argv.slice(2);
if (!nativePath || !cleanPath) {
    console.error("Usage: node tools/compare-scr-traces.mjs <native.ndjson> <clean.ndjson>");
    process.exit(2);
}

const readEvents = async (path) => (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
        try {
            return JSON.parse(line);
        } catch (error) {
            throw new Error(`${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

const [nativeEvents, cleanEvents] = await Promise.all([readEvents(nativePath), readEvents(cleanPath)]);
const nativeProgram = nativeEvents.find(({ event }) => event === "native_scr_program");
const cleanProgram = cleanEvents.find(({ event }) => event === "clean_scr_program");
assert.ok(nativeProgram, "Native SCR program event missing");
assert.ok(cleanProgram, "Clean-room SCR program event missing");
assert.equal(cleanProgram.asset, nativeProgram.asset);
assert.equal(cleanProgram.bytes, nativeProgram.bytes);
assert.equal(cleanProgram.handler ?? null, nativeProgram.handler ?? null);

const nativeKinds = new Map(nativeEvents
    .filter(({ event }) => event === "native_scr_node_layout")
    .map(({ record, kind }) => [record, kind]));
const nativeEvaluations = nativeEvents
    .filter(({ event }) => event === "native_scr_evaluation")
    .map(({ depth, record, kind, result }) => ({ depth, kind: kind ?? nativeKinds.get(record), result }))
    .filter(({ kind }) => kind !== 49);
const cleanEvaluationEvents = cleanEvents.filter(({ event }) => event === "clean_scr_evaluation");
// Server.dll 0x14038FA8 materializes string call arguments outside 0x1403A010;
// exact argument values remain covered by the host-call events below.
const cleanEvaluations = cleanEvaluationEvents
    .map(({ depth, kind, result }) => ({ depth, kind, result }))
    .filter(({ kind }) => kind !== 22);
assert.deepEqual(cleanEvaluations, nativeEvaluations, "SCR evaluator trace diverged");

const nativeHostCalls = nativeEvents
    .filter(({ event }) => event === "native_scr_host_call")
    .map(({ name, arguments: arguments_, result }) => ({ name, arguments: arguments_, result }));
const cleanHostCalls = cleanEvents
    .filter(({ event }) => event === "clean_scr_host_call")
    .map(({ name, arguments: arguments_, result }) => ({ name, arguments: arguments_, result }));
const nativeHostSummary = nativeEvents.find(({ event }) => event === "native_scr_host_summary");
if (nativeHostSummary) {
    assert.deepEqual(cleanHostCalls, nativeHostCalls, "SCR host-call trace diverged");
    assert.equal(nativeHostSummary.calls, nativeHostCalls.length);
}

const nativeCommands = nativeEvents
    .filter(({ event }) => event === "native_scr_command")
    .map(({ command, immediate }) => ({ command, immediate }));
const cleanCommands = cleanEvents
    .filter(({ event }) => event === "clean_scr_command")
    .map(({ command, immediate }) => ({ command, immediate }));
if (nativeCommands.length > 0) assert.deepEqual(cleanCommands, nativeCommands, "SCR command trace diverged");
const nativeTriggerState = nativeEvents.find(({ event }) => event === "native_scr_trigger_state");
const cleanTriggerState = cleanEvents.find(({ event }) => event === "clean_scr_trigger_state");
if (nativeTriggerState) {
    assert.deepEqual(cleanTriggerState, { event: "clean_scr_trigger_state",
        entrance: nativeTriggerState.entrance,
        entranceLength: nativeTriggerState.entranceLength,
        commands: nativeTriggerState.commands });
}

const nativeSummary = nativeEvents.find(({ event }) => event === "native_scr_trace_summary");
const cleanSummary = cleanEvents.find(({ event }) => event === "clean_scr_trace_summary");
const nativeClosed = nativeEvents.find(({ event }) => event === "native_scr_closed");
assert.ok(nativeSummary, "Native SCR summary missing");
assert.ok(cleanSummary, "Clean-room SCR summary missing");
assert.equal(nativeSummary.evaluations,
    nativeEvents.filter(({ event }) => event === "native_scr_evaluation").length);
assert.equal(cleanSummary.evaluations, cleanEvaluationEvents.length);
const nativeAssignmentResults = nativeEvents
    .filter(({ event, record, kind }) =>
        event === "native_scr_evaluation" && (kind ?? nativeKinds.get(record)) === 50)
    .map(({ result }) => result);
assert.equal(cleanSummary.variables.l1_svetlograd_n7_helper, 0);
assert.equal(cleanSummary.variables.result,
    nativeProgram.handler ? 0 : (nativeAssignmentResults.at(-1) ?? 0));
assert.deepEqual(nativeClosed, { event: "native_scr_closed", loaded: 0 });

console.log(`Matched ${cleanEvaluations.length} SCR evaluator results, ${nativeHostSummary ? cleanHostCalls.length : 0} traced host calls, and ${nativeCommands.length} commands for ${nativeProgram.asset}; native context destroyed cleanly`);
