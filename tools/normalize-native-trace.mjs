#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error("Usage: node tools/normalize-native-trace.mjs <input.ndjson> <output.ndjson>");
  process.exit(2);
}

try {
  const source = await readFile(inputPath, "utf8");
  const lines = source.split(/\r?\n/).filter((line) => line.length > 0);
  const records = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid JSON at ${inputPath}:${index + 1}: ${error.message}`);
    }
  });

  const normalized = records.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`record ${index + 1} is not a JSON object`);
    }
    if (record.event !== "host_call") return record;

    for (const field of ["slotOffset", "returnModule", "returnRva"]) {
      if (!(field in record)) throw new Error(`host_call record ${index + 1} is missing ${field}`);
    }
    return {
      event: record.event,
      slotOffset: record.slotOffset,
      returnModule: record.returnModule,
      returnRva: record.returnRva,
    };
  });

  await writeFile(outputPath, normalized.map((record) => JSON.stringify(record)).join("\n") + "\n");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
