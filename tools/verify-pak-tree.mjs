#!/usr/bin/env node
// Hash-compare a staging tree against the merged base+patch expectation
// derived from the manifest. Confirms the extraction produced exactly
// base files with patch files overriding them (patch wins on conflict).
//
// Usage: node tools/verify-pak-tree.mjs [stageDir] [manifestPath]
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const stageDir = process.argv[2] ?? "dist/stage";
const manifestPath = process.argv[3] ?? "dist/extract/pak-manifest.json";

const root = resolve(stageDir);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// Merge in archive name order: base archives sort before their .update.3.pak
// siblings, so the patch entry overwrites the base entry on conflict.
const merged = new Map();
for (const archive of Object.keys(manifest).sort()) {
    for (const [path, entry] of Object.entries(manifest[archive])) {
        merged.set(path, entry);
    }
}

const sha256 = (filePath) => createHash("sha256").update(readFileSync(filePath)).digest("hex");

// relPath (forward slashes) -> absolute path.
const files = new Map();
const walk = (dir) => {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.set(relative(root, full).replace(/\\/g, "/"), full);
    }
};
walk(root);

let mismatches = 0;
let checked = 0;
for (const [rel, abs] of files) {
    const expected = merged.get(rel);
    if (!expected) {
        console.log(`UNEXPECTED (not in any pak): ${rel}`);
        mismatches += 1;
        continue;
    }
    if (statSync(abs).size !== expected.size) {
        console.log(`SIZE MISMATCH ${rel}: staged ${statSync(abs).size}, expected ${expected.size}`);
        mismatches += 1;
        continue;
    }
    const actualHash = sha256(abs);
    checked += 1;
    if (actualHash !== expected.sha256) {
        console.log(`HASH MISMATCH ${rel}: staged ${actualHash}, expected ${expected.sha256}`);
        mismatches += 1;
    }
}

const missing = [...merged.keys()].filter((path) => !files.has(path));
for (const path of missing) {
    console.log(`MISSING from stage: ${path}`);
    mismatches += 1;
}

console.log(`Staged ${files.size} files, ${checked} hash-checked, ${missing.length} missing, ${mismatches} total mismatches.`);
process.exitCode = mismatches === 0 ? 0 : 1;
