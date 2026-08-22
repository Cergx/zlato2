#!/usr/bin/env node
// Extract every Burut PAK from the game Data directory, applying each base
// archive first and its matching *.update.3.pak patch over it (patch wins on
// path conflict).
//
// Usage: node tools/extract-pak-tree.mjs [dataDir] [outputRoot] [--keep]
//
// By default the output root is wiped first (clean staging). Pass --keep to
// overlay into an existing tree (e.g. public/assets) without deleting files
// that are not produced by the archives (cursors, generated PNGs).
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const positional = args.filter((arg) => !arg.startsWith("--"));
const dataDir = positional[0] ?? "E:/Games/zlato22/Data";
const outputRoot = positional[1] ?? "dist/stage";

const burutPak = resolve("dist/extract/BurutPak.exe");
const files = readdirSync(dataDir).filter((name) => extname(name).toLowerCase() === ".pak").sort();
const bases = files.filter((name) => !name.includes(".update."));
const updates = files.filter((name) => name.includes(".update."));

// Updates overlay the base with the same stem (items.update.3.pak -> items.pak).
const baseFor = (updateName) => updateName.replace(/\.update\.\d+\.pak$/, ".pak");

if (!keep) rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const extract = (archive) => {
    execFileSync(burutPak, ["x", "-o", "-y", join(dataDir, archive), resolve(outputRoot) + "\\"], { stdio: "inherit" });
};

for (const base of bases) {
    console.log(`Extract base ${base}`);
    extract(base);
}
for (const update of updates) {
    console.log(`Overlay patch ${update} -> ${baseFor(update)}`);
    extract(update);
}

const count = (dir) => readdirSync(dir, { recursive: true }).filter((name) => name !== "pak-manifest.json").length;
console.log(`Wrote ${count(outputRoot)} entries into ${outputRoot}`);
