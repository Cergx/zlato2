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
const hostCalls = new Map();

const visitExpression = (expression) => {
    switch (expression.type) {
        case "call":
            hostCalls.set(expression.name.toLowerCase(), (hostCalls.get(expression.name.toLowerCase()) ?? 0) + 1);
            expression.arguments.forEach(visitExpression);
            return;
        case "unary":
            visitExpression(expression.operand);
            return;
        case "binary":
            visitExpression(expression.left);
            visitExpression(expression.right);
            return;
        case "literal":
        case "variable":
            return;
    }
};

const visitStatement = (statement) => {
    switch (statement.type) {
        case "declaration":
            if (statement.explicitInitializer) visitExpression(statement.initialValue);
            return;
        case "assignment":
        case "expression":
            visitExpression(statement.type === "assignment" ? statement.expression : statement.expression);
            return;
        case "block":
            statement.statements.forEach(visitStatement);
            return;
        case "if":
            visitExpression(statement.condition);
            visitStatement(statement.consequent);
            if (statement.alternate) visitStatement(statement.alternate);
            return;
    }
};

const visitProgram = (program) => program.statements.forEach(visitStatement);

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
            visitProgram(script.program);
            handlers += Object.keys(script.handlers).length;
            for (const program of Object.values(script.handlers)) statements += program?.statements.length ?? 0;
            for (const program of Object.values(script.handlers)) if (program) visitProgram(program);
        } catch (error) {
            failures.push({ path: relative(process.cwd(), path), error: error instanceof Error ? error.message : String(error) });
        }
    }
};

await walk(root);
console.log(JSON.stringify({
    root,
    files,
    handlers,
    statements,
    hostCalls: Object.fromEntries([...hostCalls].sort(([left], [right]) => left.localeCompare(right))),
    failures,
}));
if (failures.length > 0) process.exitCode = 1;
