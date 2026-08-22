#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [nativePath, cleanRoomPath] = process.argv.slice(2);
if (!nativePath || !cleanRoomPath) {
    console.error("Usage: node tools/compare-dialogue-traces.mjs <native.ndjson> <clean-room.ndjson>");
    process.exit(2);
}

const readEvents = async (path) => {
    const source = await readFile(path, "utf8");
    return source.split(/\r?\n/).filter(Boolean).map((line, index) => {
        try {
            return JSON.parse(line);
        } catch (error) {
            throw new Error(`${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
};

const assertEqual = (actual, expected, label) => {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) throw new Error(`${label}: native=${actualJson} clean-room=${expectedJson}`);
};

try {
    const [nativeEvents, cleanRoomEvents] = await Promise.all([readEvents(nativePath), readEvents(cleanRoomPath)]);
    const nativeProgram = nativeEvents.find(({ event }) => event === "native_age_program");
    const cleanRoomProgram = cleanRoomEvents.find(({ event }) => event === "age_program");
    if (!nativeProgram || !cleanRoomProgram) throw new Error("Both traces must contain an AGE program event");
    assertEqual(nativeProgram.bytes, cleanRoomProgram.bytes, "AGE byte length");
    const nativeEvaluations = nativeEvents.filter(({ event }) => event === "native_age_evaluation");
    const cleanRoomEvaluations = cleanRoomEvents.filter(({ event }) => event === "age_evaluation");
    assertEqual(nativeEvaluations.length, cleanRoomEvaluations.length, "AGE evaluation count");
    for (let index = 0; index < nativeEvaluations.length; index += 1) {
        const fields = ["turn", "sequence", "depth", "record", "kind", "result"];
        for (const field of fields) {
            assertEqual(
                nativeEvaluations[index][field],
                cleanRoomEvaluations[index][field],
                `AGE evaluation ${index + 1} ${field}`,
            );
        }
    }

    const nativeFunctions = nativeEvents.filter(({ event }) => event === "native_age_function");
    const cleanRoomFunctions = cleanRoomEvents
        .map((entry, eventIndex) => ({ entry, eventIndex }))
        .filter(({ entry }) => entry.event === "age_function");
    assertEqual(nativeFunctions.length, cleanRoomFunctions.length, "AGE function-call count");
    for (let index = 0; index < nativeFunctions.length; index += 1) {
        const nativeFunction = nativeFunctions[index];
        const { entry: cleanRoomFunction, eventIndex } = cleanRoomFunctions[index];
        for (const field of ["record", "id", "name", "arguments"]) {
            assertEqual(nativeFunction[field], cleanRoomFunction[field], `AGE function ${index + 1} ${field}`);
        }
        assertEqual(nativeFunction.slot, cleanRoomFunction.id & 0x00ffffff, `AGE function ${index + 1} dispatch slot`);
        const cleanRoomResult = cleanRoomEvents.slice(eventIndex + 1).find((event) =>
            event.event === "age_evaluation" && event.record === cleanRoomFunction.record);
        if (!cleanRoomResult) throw new Error(`AGE function ${index + 1} has no matching clean-room evaluation`);
        assertEqual(nativeFunction.result, cleanRoomResult.result, `AGE function ${index + 1} result`);
    }

    const nativeNodes = nativeEvents.filter(({ event }) => event === "native_age_node");
    const cleanRoomNodes = cleanRoomEvents.filter(({ event }) => event === "age_node");
    assertEqual(nativeNodes.length, cleanRoomNodes.length, "AGE flow-node count");
    for (let index = 0; index < nativeNodes.length; index += 1) {
        const fields = ["turn", "step", "record", "result", "branch", "successor"];
        for (const field of fields) {
            assertEqual(nativeNodes[index][field], cleanRoomNodes[index][field], `AGE node ${index + 1} ${field}`);
        }
    }
    const nativePackets = nativeEvents.filter(({ event }) => event === "native_dialogue_packet");
    const cleanRoomPackets = cleanRoomEvents.filter(({ event }) => event === "dialogue_packet");
    assertEqual(nativePackets.length, cleanRoomPackets.length, "Dialogue packet count");
    for (let index = 0; index < nativePackets.length; index += 1) {
        const fields = ["direction", "turn", "opcode", "byteLength", "bytes"];
        for (const field of fields) {
            assertEqual(nativePackets[index][field], cleanRoomPackets[index][field], `Dialogue packet ${index + 1} ${field}`);
        }
    }



    const nativeTurns = nativeEvents.filter(({ event }) => event === "native_dialogue_snapshot");
    const cleanRoomTurns = cleanRoomEvents.filter(({ event, status }) => event === "dialogue_state" && status === "active");
    assertEqual(nativeTurns.length, cleanRoomTurns.length, "Dialogue turn count");

    for (let index = 0; index < nativeTurns.length; index += 1) {
        const nativeTurn = nativeTurns[index];
        const cleanRoomTurn = cleanRoomTurns[index];
        const cleanRoomReplies = cleanRoomTurn.options.map(({ id, enabled }) => {
            if (!enabled) throw new Error(`Clean-room turn ${index + 1} contains disabled reply ${id}`);
            return id;
        });
        assertEqual(nativeTurn.updateCounter, cleanRoomTurn.revision, `Turn ${index + 1} revision`);
        assertEqual(nativeTurn.phraseId, cleanRoomTurn.phraseId, `Turn ${index + 1} phrase`);
        assertEqual(nativeTurn.replies, cleanRoomReplies, `Turn ${index + 1} replies`);
        if (index > 0) assertEqual(nativeTurn.submittedAnswer, nativeTurns[index - 1].replies[0], `Turn ${index + 1} submitted answer`);
    }

    const closed = nativeEvents.find(({ event }) => event === "native_dialogue_closed");
    if (!closed || closed.active !== 0 || closed.hasContext !== false) {
        throw new Error("Native trace did not destroy the active dialogue context cleanly");
    }
    const functionSummary = `${nativeFunctions.length} function calls`;
    console.log(`Matched ${nativeEvaluations.length} AGE evaluations, ${nativeNodes.length} flow nodes, ${functionSummary}, ${nativePackets.length} packet payloads, and ${nativeTurns.length} dialogue turns for ${nativeProgram.asset}: ${nativeTurns.map(({ phraseId, replies }) => `${phraseId} -> [${replies.join(",")}]`).join("; ")}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
