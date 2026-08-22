#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [nativePath, cleanPath] = process.argv.slice(2);
if (!nativePath || !cleanPath) {
    console.error("Usage: node tools/compare-age-function-traces.mjs <native.ndjson> <clean.ndjson>");
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
const equal = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label}: native=${JSON.stringify(actual)} clean-room=${JSON.stringify(expected)}`);
    }
};

try {
    const [nativeEvents, cleanEvents] = await Promise.all([readEvents(nativePath), readEvents(cleanPath)]);
    const nativeProgram = nativeEvents.find(({ event }) => event === "native_age_program");
    const cleanProgram = cleanEvents.find(({ event }) => event === "age_program");
    if (!nativeProgram || !cleanProgram) throw new Error("Both traces must contain an AGE program event");
    equal(nativeProgram.asset, cleanProgram.asset, "AGE asset");

    const nativeFunctions = nativeEvents.filter(({ event }) => event === "native_age_function");
    const cleanFunctions = cleanEvents
        .map((entry, eventIndex) => ({ entry, eventIndex }))
        .filter(({ entry }) => entry.event === "age_function");
    equal(nativeFunctions.length, cleanFunctions.length, "AGE function prefix count");
    for (let index = 0; index < nativeFunctions.length; index += 1) {
        const nativeFunction = nativeFunctions[index];
        const { entry: cleanFunction, eventIndex } = cleanFunctions[index];
        for (const field of ["record", "id", "name", "arguments"]) {
            equal(nativeFunction[field], cleanFunction[field], `AGE function ${index + 1} ${field}`);
        }
        equal(nativeFunction.slot, cleanFunction.id & 0x00ffffff, `AGE function ${index + 1} slot`);
        const cleanResult = cleanEvents.slice(eventIndex + 1).find((event) =>
            event.event === "age_evaluation" && event.record === cleanFunction.record);
        if (!cleanResult) throw new Error(`AGE function ${index + 1} has no clean evaluation result`);
        equal(nativeFunction.result, cleanResult.result, `AGE function ${index + 1} result`);
    }
    console.log(`Matched ${nativeFunctions.length} AGE function calls for ${nativeProgram.asset}: ${nativeFunctions.map(({ name, arguments: arguments_ }) => `${name}(${arguments_.map((value) => JSON.stringify(value)).join(",")})`).join("; ")}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
