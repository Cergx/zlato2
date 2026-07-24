#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const STANDARD_PREFIX = [49, 1, 1, 7, 2, 3];
const XOR_SEED = 0x59;
const asciiDecoder = new TextDecoder('ascii');
const cp1251Decoder = new TextDecoder('windows-1251');

const AGE_FUNCTION_NAMES = {
  0x1000000: 'Exit',
  0x1000001: 'Signal',
  0x1000002: 'Console',
  0x1000003: 'Cmd',
  0x1000004: 'D_Say',
  0x1000005: 'D_CloseDialog',
  0x1000006: 'D_Answer',
  0x1000007: 'D_PlaySound',
  0x2000000: 'LE_CastEffect',
  0x2000001: 'LE_DelEffect',
  0x2000002: 'LE_CastMagic',
  0x3000000: 'WD_LoadArea',
  0x3000001: 'WD_SetCellsGroupFlag',
  0x3000002: 'RS_SetTribesRelation',
  0x3000003: 'RS_GetTribesRelation',
  0x3000004: 'RS_StartDialog',
  0x3000005: 'WD_SetVisible',
  0x3000006: 'C_FINISHED',
  0x3000007: 'WD_TitlesAndLoadArea',
  0x3000008: 'C_TitlesAndFINISHED',
  0x4000000: 'RS_GetPersonParameterI',
  0x4000001: 'RS_SetPersonParameterI',
  0x4000002: 'RS_AddPerson_1',
  0x4000003: 'RS_AddPerson_2',
  0x4000004: 'RS_IsPersonExistsI',
  0x4000005: 'RS_AddExp',
  0x4000006: 'RS_DelPerson',
  0x4000007: 'RS_AddToHeroPartyName',
  0x4000008: 'RS_RemoveFromHeroPartyName',
  0x4000009: 'RS_TestHeroHasPartyName',
  0x400000a: 'RS_AllyCmd',
  0x400000b: 'RS_ShowMessage',
  0x400000c: 'RS_GetPersonSkillI',
  0x5000000: 'RS_TestPersonHasItem',
  0x5000001: 'RS_PersonTransferItemI',
  0x5000002: 'RS_GetItemCountI',
  0x5000003: 'RS_PersonTransferAllItemsI',
  0x5000004: 'RS_PersonAddItem',
  0x5000005: 'RS_PersonRemoveItem',
  0x5000006: 'RS_PersonAddItemToTrade',
  0x5000007: 'RS_PersonRemoveItemToTrade',
  0x5000008: 'RS_GetMoney',
  0x6000000: 'RS_GetDayOrNight',
  0x6000001: 'RS_GetCurrentTimeOfDayI',
  0x6000002: 'RS_GetDaysFromBeginningI',
  0x6000003: 'RS_AddTime',
  0x7000000: 'RS_QuestComplete',
  0x7000001: 'RS_StageEnable',
  0x7000002: 'RS_QuestEnable',
  0x7000003: 'RS_StageComplete',
  0x7000004: 'RS_StorylineQuestEnable',
  0x7000005: 'RS_SetEvent',
  0x7000006: 'RS_GetEvent',
  0x7000007: 'RS_ClearEvent',
  0x7000008: 'RS_SetLocationAccess',
  0x7000009: 'RS_EnableTrigger',
  0x700000a: 'RS_GetRandMinMaxI',
  0x700000b: 'RS_SetWeather',
  0x700000c: 'RS_SetSpecialPerk',
  0x700000d: 'RS_PassToTradePanel',
  0x700000e: 'RS_GetDialogEnabled',
  0x700000f: 'RS_SetUndeadState',
  0x7000010: 'RS_GlobalMap',
  0x7000013: 'RS_SetInjured',
  0x7000014: 'RS_SetDoorState',
};

const AGE_TAG_NAMES = {
  0: 'logicalOr',
  1: 'logicalXor',
  2: 'logicalAnd',
  3: 'bitwiseOr',
  4: 'bitwiseXor',
  5: 'bitwiseAnd',
  6: 'notEqual',
  7: 'equal',
  8: 'greaterOrEqual',
  9: 'lessOrEqual',
  10: 'greater',
  11: 'less',
  12: 'shiftLeft',
  13: 'shiftRightArithmetic',
  14: 'add',
  15: 'subtract',
  16: 'multiply',
  17: 'divide',
  18: 'modulo',
  19: 'bitwiseNot',
  20: 'logicalNot',
  21: 'number',
  22: 'string',
  23: 'variable',
  24: 'number',
  48: 'functionCall',
  49: 'goto',
  50: 'assign',
};

const AGE_BINARY_OPERATORS = {
  0: '||',
  1: '^^',
  2: '&&',
  3: '|',
  4: '^',
  5: '&',
  6: '!=',
  7: '==',
  8: '>=',
  9: '<=',
  10: '>',
  11: '<',
  12: '<<',
  13: '>>',
  14: '+',
  15: '-',
  16: '*',
  17: '/',
  18: '%',
};

async function collectAgeFiles(path) {
  const info = await stat(path);
  if (info.isFile()) {
    if (!path.toLowerCase().endsWith('.age.cs')) throw new Error(`${path} is not an AGE dialogue container`);
    return [path];
  }
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return collectAgeFiles(child);
    return entry.isFile() && extname(entry.name).toLowerCase() === '.cs' && entry.name.toLowerCase().endsWith('.age.cs') ? [child] : [];
  }));
  return nested.flat().sort();
}

function readCString(bytes, offset, end, { asciiOnly, allowEmpty }) {
  let cursor = offset;
  while (cursor < end && bytes[cursor] !== 0) {
    if (asciiOnly && (bytes[cursor] < 0x20 || bytes[cursor] > 0x7e)) return undefined;
    cursor += 1;
  }
  if (cursor === end || (!allowEmpty && cursor === offset)) return undefined;
  const decoder = asciiOnly ? asciiDecoder : cp1251Decoder;
  return { value: decoder.decode(bytes.subarray(offset, cursor)), nextOffset: cursor + 1 };
}

function requireBytes(offset, byteLength, end, context) {
  if (offset + byteLength > end) throw new Error(`${context}: truncated record at byte ${offset}`);
}

function readInt32Words(view, offset, count) {
  return Array.from({ length: count }, (_, index) => view.getInt32(offset + index * 4, true));
}

function parseNode(bytes, view, offset, end, index) {
  requireBytes(offset, 4, end, `record ${index}`);
  const type = view.getUint32(offset, true);
  const payloadOffset = offset + 4;
  if (type <= 0x14 || type === 0x32) {
    requireBytes(payloadOffset, 16, end, `record ${index}`);
    return { index, offset, type, tagName: AGE_TAG_NAMES[type], references: readInt32Words(view, payloadOffset, 4), nextOffset: payloadOffset + 16 };
  }
  if (type === 0x15 || type === 0x18) {
    requireBytes(payloadOffset, 8, end, `record ${index}`);
    return { index, offset, type, tagName: AGE_TAG_NAMES[type], payloadWords: readInt32Words(view, payloadOffset, 2), nextOffset: payloadOffset + 8 };
  }
  if (type === 0x16 || type === 0x17) {
    const string = readCString(bytes, payloadOffset, end, { asciiOnly: type === 0x17, allowEmpty: type === 0x16 });
    if (!string) throw new Error(`record ${index}: invalid type-${type} ASCII string at byte ${payloadOffset}`);
    return { index, offset, type, tagName: AGE_TAG_NAMES[type], value: string.value, nextOffset: string.nextOffset };
  }
  if (type === 0x30) {
    requireBytes(payloadOffset, 20, end, `record ${index}`);
    const payloadWords = readInt32Words(view, payloadOffset, 5);
    let nextOffset = payloadOffset + 20;
    if (payloadWords[4] !== -1) {
      while (payloadWords.at(-1) !== -1 && payloadWords.length < 13) {
        requireBytes(nextOffset, 4, end, `record ${index}`);
        payloadWords.push(view.getInt32(nextOffset, true));
        nextOffset += 4;
      }
    }
    const terminator = payloadWords.indexOf(-1, 4);
    const functionId = decodeDouble(payloadWords.slice(2, 4));
    return {
      index,
      offset,
      type,
      tagName: AGE_TAG_NAMES[type],
      payloadWords,
      branchReferences: payloadWords.slice(0, 2),
      functionId,
      functionName: AGE_FUNCTION_NAMES[functionId],
      unresolvedFunction: functionId === 0,
      argumentReferences: payloadWords.slice(4, terminator === -1 ? undefined : terminator),
      nextOffset,
    };
  }
  if (type === 0x31) {
    requireBytes(payloadOffset, 8, end, `record ${index}`);
    return { index, offset, type, tagName: AGE_TAG_NAMES[type], references: readInt32Words(view, payloadOffset, 2), nextOffset: payloadOffset + 8 };
  }
  throw new Error(`record ${index}: unsupported AGE tag ${type} at byte ${offset}`);
}

function parseTypedRecords(bytes, view, end) {
  const records = [];
  let offset = 4;
  while (offset < end) {
    const record = parseNode(bytes, view, offset, end, records.length);
    records.push(record);
    offset = record.nextOffset;
  }
  if (offset !== end) throw new Error(`AGE record stream ends at byte ${offset}, expected ${end}`);
  return records;
}

function decryptIncrementalXorAge(bytes) {
  const decrypted = new Uint8Array(bytes);
  for (let offset = 4; offset < decrypted.length; offset += 1) {
    decrypted[offset] ^= (XOR_SEED + offset - 4) & 0xff;
  }
  return decrypted;
}

async function readPhraseDatabase(path) {
  const bytes = await readFile(path);
  if (asciiDecoder.decode(bytes.subarray(0, 4)) !== 'SDB ') throw new Error(`${path}: expected SDB header`);
  const phrases = new Map();
  let offset = 4;
  while (offset < bytes.length) {
    requireBytes(offset, 8, bytes.length, 'SDB record');
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const id = view.getInt32(0, true);
    const length = view.getInt32(4, true);
    offset += 8;
    if (length < 0) throw new Error(`${path}: negative SDB string length for ID ${id}`);
    requireBytes(offset, length, bytes.length, `SDB ID ${id}`);
    phrases.set(id, cp1251Decoder.decode(bytes.subarray(offset, offset + length)).trim());
    offset += length;
  }
  return phrases;
}

const numericBuffer = new ArrayBuffer(8);
const numericView = new DataView(numericBuffer);

function decodeDouble(words) {
  numericView.setInt32(0, words[0], true);
  numericView.setInt32(4, words[1], true);
  return numericView.getFloat64(0, true);
}

function findLastPhraseComparisons(records, phrases) {
  const comparisons = [];
  for (const record of records) {
    if (record.type !== 7 || !record.references) continue;
    const symbol = records[record.references[0]];
    const value = records[record.references[1]];
    if (symbol?.type !== 0x17 || symbol.value !== 'LastPhrase' || value?.type !== 0x18) continue;
    const phraseId = decodeDouble(value.payloadWords);
    if (!Number.isInteger(phraseId) || phraseId < 0) continue;
    comparisons.push({
      record: record.index,
      phraseId,
      phrase: phrases?.get(phraseId),
      nonzeroReference: record.references[2],
      zeroReference: record.references[3],
    });
  }
  return comparisons;
}

function inspectEntryGraph(records, file) {
  const root = records[0];
  const dispatch = records[1];
  const symbol = records[2];
  const zero = records[3];
  const valid = root?.type === 0x31
    && root.references[0] === 1
    && root.references[1] === 1
    && dispatch?.type === 7
    && dispatch.references[0] === 2
    && dispatch.references[1] === 3
    && dispatch.references[3] === 4
    && symbol?.type === 0x17
    && symbol.value === 'LastPhrase'
    && zero?.type === 0x18
    && decodeDouble(zero.payloadWords) === 0;
  if (!valid) throw new Error(`${file}: does not have the expected AGE entry dispatch graph`);
  const openingRecord = dispatch.references[2];
  if (!Number.isInteger(openingRecord) || openingRecord < 0 || openingRecord >= records.length) {
    throw new Error(`${file}: opening record ${openingRecord} is outside the record stream`);
  }
  return {
    rootRecord: 0,
    dispatchRecord: 1,
    lastPhraseSymbolRecord: 2,
    zeroLiteralRecord: 3,
    openingRecord,
    phraseDispatchRecord: 4,
  };
}



function parseAge(file, bytes, phrases) {
  if (bytes.length < 4) throw new Error(`${file}: ${bytes.length} bytes cannot contain an AGE length word`);
  let payload = bytes;
  let view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let prefix = Array.from({ length: 6 }, (_, index) => view.getUint32(4 + index * 4, true));
  let encoding = 'plain';
  if (!prefix.every((value, index) => value === STANDARD_PREFIX[index])) {
    const decrypted = decryptIncrementalXorAge(bytes);
    const decryptedView = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength);
    const decryptedPrefix = Array.from({ length: 6 }, (_, index) => decryptedView.getUint32(4 + index * 4, true));
    if (!decryptedPrefix.every((value, index) => value === STANDARD_PREFIX[index])) {
      throw new Error(`${file}: neither plaintext nor incremental-XOR payload has the expected leading records`);
    }
    payload = decrypted;
    view = decryptedView;
    prefix = decryptedPrefix;
    encoding = 'incremental-xor-0x59';
  }
  const declaredLength = view.getUint32(0, true);
  if (declaredLength !== bytes.length) throw new Error(`${file}: declares ${declaredLength} bytes, contains ${bytes.length}`);
  const records = parseTypedRecords(payload, view, declaredLength);
  const entryGraph = inspectEntryGraph(records, file);
  const typeCounts = {};
  for (const { type } of records) typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  const symbols = records.filter(({ type }) => type === 0x17).map(({ index, value }) => ({ index, value }));
  const lastPhraseComparisons = findLastPhraseComparisons(records, phrases);
  const unresolvedFunctionCalls = records
    .filter(({ type, functionId }) => type === 0x30 && functionId === 0)
    .map(({ index, argumentReferences }) => ({ record: index, argumentReferences }));
  return {
    file,
    byteLength: bytes.length,
    declaredLength,
    encoding,
    leadingRecordPrefix: prefix,
    entryGraph,
    recordCount: records.length,
    typeCounts,
    symbols,
    records,
    lastPhraseComparisons,
    unresolvedFunctionCalls,
  };
}

function formatNumber(value) {
  return String(value);
}

function formatExpression(records, index, phrases, visiting = new Set()) {
  if (!Number.isInteger(index) || index < 0 || index >= records.length) return '<none>';
  if (visiting.has(index)) return `#${index}`;
  visiting.add(index);
  const record = records[index];
  const reference = (position) => formatExpression(records, record.references?.[position], phrases, visiting);
  let result;
  if (record.type === 0x15 || record.type === 0x18) {
    result = formatNumber(decodeDouble(record.payloadWords));
  } else if (record.type === 0x16) {
    result = JSON.stringify(record.value);
  } else if (record.type === 0x17) {
    result = record.value;
  } else if (record.type in AGE_BINARY_OPERATORS) {
    const left = reference(0);
    const right = reference(1);
    result = `(${left} ${AGE_BINARY_OPERATORS[record.type]} ${right})`;
    const literal = records[record.references?.[1]];
    if (record.type === 7 && left === 'LastPhrase' && literal?.type === 0x18) {
      const phrase = phrases?.get(decodeDouble(literal.payloadWords));
      if (phrase !== undefined) result = `${result} ${JSON.stringify(phrase)}`;
    }
  } else if (record.type === 19 || record.type === 20) {
    result = `${record.type === 19 ? '~' : '!'}${reference(1)}`;
  } else if (record.type === 0x30) {
    const functionName = record.unresolvedFunction ? 'unresolved_function' : record.functionName ?? `function_${record.functionId.toString(16)}`;
    const argumentsText = record.argumentReferences.map((argument) => formatExpression(records, argument, phrases, visiting));
    const firstArgument = records[record.argumentReferences[0]];
    if ((functionName === 'D_Say' || functionName === 'D_Answer') && firstArgument?.type === 0x18) {
      const phrase = phrases?.get(decodeDouble(firstArgument.payloadWords));
      if (phrase !== undefined) argumentsText[0] = `${argumentsText[0]} ${JSON.stringify(phrase)}`;
    }
    result = `${functionName}(${argumentsText.join(', ')})`;
  } else if (record.type === 0x32) {
    result = `${reference(0)} = ${reference(1)}`;
  } else if (record.type === 0x31) {
    result = record.references[0] === record.references[1] ? `goto #${record.references[0]}` : `flow(#${record.references[0]}, #${record.references[1]})`;
  } else {
    result = record.tagName ?? `tag${record.type}`;
  }
  visiting.delete(index);
  return result;
}

function printFlow(summary, phrases) {
  console.log(`  control flow for ${summary.file}:`);
  for (const record of summary.records) {
    if (record.type === 0x31) {
      console.log(`    #${record.index}: ${formatExpression(summary.records, record.index, phrases)}`);
      continue;
    }
    if (record.type === 0x30) {
      console.log(`    #${record.index}: ${formatExpression(summary.records, record.index, phrases)} → nonzero #${record.branchReferences[0]}, zero #${record.branchReferences[1]}`);
      continue;
    }
    if (record.type === 0x32 || (record.references && record.references[2] >= 0 && record.references[3] >= 0)) {
      console.log(`    #${record.index}: ${formatExpression(summary.records, record.index, phrases)} → nonzero #${record.references[2]}, zero #${record.references[3]}`);
    }
  }
}

function summarizeFunctions(summaries) {
  const functions = new Map();
  for (const summary of summaries) {
    for (const record of summary.records) {
      if (record.type !== 0x30) continue;
      const key = record.functionName ?? (record.functionId === 0 ? 'unresolved_function' : `0x${record.functionId.toString(16)}`);
      const entry = functions.get(key) ?? { name: key, functionId: record.functionId, calls: 0, files: new Set(), arities: new Map(), examples: [] };
      entry.calls += 1;
      entry.files.add(summary.file);
      entry.arities.set(record.argumentReferences.length, (entry.arities.get(record.argumentReferences.length) ?? 0) + 1);
      if (entry.examples.length < 3 && !entry.examples.includes(summary.file)) entry.examples.push(summary.file);
      functions.set(key, entry);
    }
  }
  return [...functions.values()]
    .map(({ name, functionId, calls, files, arities, examples }) => ({ name, functionId, calls, files: files.size, arities: Object.fromEntries([...arities].sort(([left], [right]) => left - right)), examples }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function printFunctionSummary(summaries) {
  for (const entry of summarizeFunctions(summaries)) {
    console.log(`${entry.name}: ${entry.calls} calls in ${entry.files} files; arities ${Object.entries(entry.arities).map(([arity, count]) => `${arity}:${count}`).join(', ')}; examples ${entry.examples.join(', ')}`);
  }
}
function printFunctionCalls(summaries, requestedName, phrases) {
  const normalized = requestedName.toLowerCase();
  let calls = 0;
  for (const summary of summaries) {
    for (const record of summary.records) {
      if (record.type !== 0x30) continue;
      const name = record.functionName ?? (record.functionId === 0 ? 'unresolved_function' : `0x${record.functionId.toString(16)}`);
      if (name.toLowerCase() !== normalized) continue;
      console.log(`${summary.file}#${record.index}: ${formatExpression(summary.records, record.index, phrases)}`);
      calls += 1;
    }
  }
  console.log(`Matched ${calls} ${requestedName} calls.`);
}


function printSummary(summary) {
  const symbols = summary.symbols.map(({ value }) => value).join(', ');
  const types = Object.entries(summary.typeCounts).map(([type, count]) => `${type}:${count}`).join(' ');
  const unresolvedFunctions = summary.unresolvedFunctionCalls.length > 0 ? `; unresolved-function-calls=${summary.unresolvedFunctionCalls.length}` : '';
  console.log(`${summary.file}: ${summary.byteLength} bytes; ${summary.encoding}; ${summary.recordCount} typed records; opening-record=#${summary.entryGraph.openingRecord}; types=${types}; tag-23 symbols=${summary.symbols.length}${symbols ? ` [${symbols}]` : ''}${unresolvedFunctions}`);
  if (summary.lastPhraseComparisons.some(({ phrase }) => phrase !== undefined)) {
    const phrases = summary.lastPhraseComparisons.map(({ record, phraseId, phrase, nonzeroReference, zeroReference }) => `#${record}: ${phraseId}: ${phrase ?? '<missing>'} → nonzero #${nonzeroReference}, zero #${zeroReference}`).join(' | ');
    console.log(`  LastPhrase comparisons: ${phrases}`);
  }
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const flow = args.includes('--flow');
const quiet = args.includes('--quiet');
const functions = args.includes('--functions');
const functionOption = args.indexOf('--function');
const functionName = functionOption === -1 ? undefined : args[functionOption + 1];
const phrasesOption = args.indexOf('--phrases');
const phrasesPath = phrasesOption === -1 ? undefined : args[phrasesOption + 1];
const positional = args.filter((arg, index) => arg !== '--json' && arg !== '--flow' && arg !== '--quiet' && arg !== '--functions' && (functionOption === -1 || (index !== functionOption && index !== functionOption + 1)) && (phrasesOption === -1 || (index !== phrasesOption && index !== phrasesOption + 1)));
if (positional.length !== 1 || (phrasesOption !== -1 && !phrasesPath) || (functionOption !== -1 && !functionName)) {
  console.error('Usage: node tools/inspect-age.mjs <file-or-directory> [--phrases <dialogsphrases.sdb>] [--flow] [--functions] [--function <name>] [--json] [--quiet]');
  process.exitCode = 2;
} else {
  const phrases = phrasesPath ? await readPhraseDatabase(resolve(phrasesPath)) : undefined;
  const files = await collectAgeFiles(resolve(positional[0]));
  const summaries = [];
  const errors = [];
  for (const file of files) {
    try {
      summaries.push(parseAge(file, await readFile(file), phrases));
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ files: summaries, functions: summarizeFunctions(summaries), errors }, null, 2)}\n`);
  } else {
    if (!quiet) summaries.forEach(printSummary);
    if (flow) summaries.forEach((summary) => printFlow(summary, phrases));
    if (functions) printFunctionSummary(summaries);
    if (functionName) printFunctionCalls(summaries, functionName, phrases);
    console.log(`Validated ${summaries.length}/${files.length} AGE files.`);
    errors.forEach((error) => console.error(`ERROR: ${error}`));
  }
  if (errors.length > 0) process.exitCode = 1;
}
