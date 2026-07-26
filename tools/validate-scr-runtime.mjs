#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { parseSCRScript } from "../src/game/scripts/SCRRuntime.ts";

const root = process.argv[2] ?? "public/assets/levels";
const decoder = new TextDecoder("windows-1251", { fatal: true });
const failures = [];
let files = 0;
let handlers = 0;
let statements = 0;

const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            await walk(path);
            continue;
        }
        if (extname(entry.name).toLowerCase() !== ".scr") continue;
        files += 1;
        try {
            const source = decoder.decode(await readFile(path));
            const script = parseSCRScript(source, relative(process.cwd(), path));
            statements += script.program.statements.length;
            handlers += Object.keys(script.handlers).length;
            for (const program of Object.values(script.handlers)) statements += program?.statements.length ?? 0;
        } catch (error) {
            failures.push({ path: relative(process.cwd(), path), error: error instanceof Error ? error.message : String(error) });
        }
    }
};

await walk(root);
console.log(JSON.stringify({ root, files, handlers, statements, failures }));
if (failures.length > 0) process.exitCode = 1;
