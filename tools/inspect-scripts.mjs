#!/usr/bin/env node

import { access, readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { SEFParser } from '../src/game/parsers/SEFParser.ts';

const decoder = new TextDecoder('windows-1251', { fatal: true });
const transitionPattern = /WD_LoadArea\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
const globalMapPattern = /RS_GlobalMap\s*\(/g;
const eventHandlerPattern = /^\s*(OnLeave|OnHover|OnClick|OnEnter)\s*$/gm;
const exitScriptPattern = /^tg_exit.*\.scr$/i;
const expectedExitHandlers = ['OnLeave', 'OnHover', 'OnClick', 'OnEnter'];

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function collectFilesWithExtension(path, extension) {
  if (!await pathExists(path)) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return collectFilesWithExtension(child, extension);
    return entry.isFile() && entry.name.toLowerCase().endsWith(extension) ? [child] : [];
  }));
  return nested.flat().sort();
}

async function collectScenarios(levelsRoot) {
  const scenarios = [];
  for (const mode of ['single', 'multiplayer']) {
    const modeRoot = join(levelsRoot, mode);
    if (!await pathExists(modeRoot)) continue;
    const entries = await readdir(modeRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const root = join(modeRoot, entry.name);
      const files = await readdir(root, { withFileTypes: true });
      const sefEntry = files.find((file) => file.isFile() && file.name.toLowerCase() === `${entry.name.toLowerCase()}.sef`);
      if (!sefEntry) continue;
      const sefFile = join(root, sefEntry.name);
      const sef = new SEFParser(decoder.decode(await readFile(sefFile))).getData();
      scenarios.push({
        id: `${mode}/${entry.name}`,
        idKey: `${mode}/${entry.name}`.toLowerCase(),
        mode,
        name: entry.name,
        root,
        pack: sef.pack,
        entrances: new Set(sef.entrancePoints.map(({ name }) => name)),
        triggerScripts: sef.triggers.flatMap(({ name, scriptName }) => scriptName ? [{ name, scriptName }] : []),
        dialogScripts: sef.persons.flatMap(({ name, scriptDialog }) => scriptDialog ? [{ name, scriptDialog }] : []),
        scriptFiles: await collectFilesWithExtension(join(root, 'scripts'), '.scr'),
      });
    }
  }
  return scenarios.sort((left, right) => left.id.localeCompare(right.id));
}


async function inspect(levelsRoot) {
  const scenarios = await collectScenarios(levelsRoot);
  const scenariosById = new Map(scenarios.map((scenario) => [scenario.idKey, scenario]));
  const triggerBindings = [];
  const transitions = [];
  let globalMapCalls = 0;
  let scriptFileCount = 0;
  let initScripts = 0;
  let coreScripts = 0;
  let exitScripts = 0;
  const invalidExitHandlers = [];
  const dialogRoot = resolve(levelsRoot, '..', 'scripts', 'dialogs');
  const dialogFiles = await collectFilesWithExtension(dialogRoot, '.cs');
  const dialogFilesByRelativePath = new Map(dialogFiles.map((file) => [relative(dialogRoot, file).split(sep).join('/').toLowerCase(), file]));
  const dialogFilesByBasename = new Map();
  const dialogBindings = [];
  const missingDialogs = [];
  let dialogsResolvedByBasename = 0;

  for (const file of dialogFiles) {
    const key = basename(file).toLowerCase();
    const files = dialogFilesByBasename.get(key) ?? [];
    files.push(file);
    dialogFilesByBasename.set(key, files);
  }

  for (const scenario of scenarios) {
    scriptFileCount += scenario.scriptFiles.length;
    for (const trigger of scenario.triggerScripts) {
      const file = join(scenario.root, 'scripts', trigger.scriptName);
      triggerBindings.push({ scenario: scenario.id, trigger: trigger.name, script: trigger.scriptName, file });
    }
    for (const dialog of scenario.dialogScripts) {
      const normalizedName = dialog.scriptDialog.replaceAll('\\', '/').replace(/\.scr$/i, '');
      const relativeFile = `${normalizedName}.cs`.toLowerCase();
      let file = dialogFilesByRelativePath.get(relativeFile);
      if (!file) {
        const candidates = dialogFilesByBasename.get(basename(relativeFile)) ?? [];
        if (candidates.length === 1) {
          file = candidates[0];
          dialogsResolvedByBasename += 1;
        }
      }
      const binding = { scenario: scenario.id, person: dialog.name, dialog: dialog.scriptDialog, file };
      if (file) dialogBindings.push(binding);
      else missingDialogs.push(binding);
    }
    for (const scriptFile of scenario.scriptFiles) {
      const source = decoder.decode(await readFile(scriptFile));
      const scriptName = basename(scriptFile).toLowerCase();
      if (scriptName === 'init.scr') initScripts += 1;
      if (scriptName === 'core.scr') coreScripts += 1;
      if (exitScriptPattern.test(scriptName)) {
        exitScripts += 1;
        const handlers = [...source.matchAll(eventHandlerPattern)].map((match) => match[1]);
        if (handlers.length !== expectedExitHandlers.length || handlers.some((handler, index) => handler !== expectedExitHandlers[index])) {
          invalidExitHandlers.push({
            script: relative(levelsRoot, scriptFile).split(sep).join('/'),
            handlers,
          });
        }
      }
      globalMapCalls += [...source.matchAll(globalMapPattern)].length;
      for (const [, destination, entrance] of source.matchAll(transitionPattern)) {
        transitions.push({ scenario: scenario.id, script: relative(levelsRoot, scriptFile).split(sep).join('/'), destination, entrance });
      }
    }
  }

  const missingTriggerScripts = [];
  const resolvedTriggerFiles = new Set();
  for (const binding of triggerBindings) {
    if (await pathExists(binding.file)) resolvedTriggerFiles.add(binding.file);
    else missingTriggerScripts.push({ ...binding, file: relative(levelsRoot, binding.file).split(sep).join('/') });
  }

  const missingTargets = [];
  const missingEntrances = [];
  for (const transition of transitions) {
    const sourceMode = transition.scenario.split('/', 1)[0];
    const target = scenariosById.get(`${sourceMode}/${transition.destination}`.toLowerCase());
    if (!target) {
      missingTargets.push(transition);
    } else if (!target.entrances.has(transition.entrance)) {
      missingEntrances.push(transition);
    }
  }

  const packUseCounts = new Map();
  for (const scenario of scenarios) packUseCounts.set(scenario.pack, (packUseCounts.get(scenario.pack) ?? 0) + 1);

  return {
    levelsRoot,
    scenarios: scenarios.length,
    geometryPacks: packUseCounts.size,
    sharedGeometryPacks: [...packUseCounts.values()].filter((count) => count > 1).length,
    scripts: {
      files: scriptFileCount,
      triggerBindings: triggerBindings.length,
      resolvedBindings: triggerBindings.length - missingTriggerScripts.length,
      distinctTriggerFiles: resolvedTriggerFiles.size,
      missing: missingTriggerScripts,
    },
    lifecycle: {
      initScripts,
      coreScripts,
      exitScripts,
      validExitHandlers: exitScripts - invalidExitHandlers.length,
      invalidExitHandlers,
    },
    dialogs: {
      compiledFiles: dialogFiles.length,
      bindings: dialogBindings.length + missingDialogs.length,
      resolvedBindings: dialogBindings.length,
      resolvedByBasename: dialogsResolvedByBasename,
      missing: missingDialogs,
    },
    transitions: {
      total: transitions.length,
      globalMapCalls,
      resolved: transitions.length - missingTargets.length - missingEntrances.length,
      missingTargets,
      missingEntrances,
    },
  };
}

function printSummary(summary) {
  console.log(`${summary.scenarios} scenarios; ${summary.geometryPacks} geometry packs; ${summary.sharedGeometryPacks} packs shared by multiple scenarios`);
  console.log(`${summary.scripts.files} scenario scripts; ${summary.scripts.resolvedBindings}/${summary.scripts.triggerBindings} trigger bindings resolve to ${summary.scripts.distinctTriggerFiles} files`);
  console.log(`${summary.lifecycle.initScripts} init scripts; ${summary.lifecycle.coreScripts} core scripts; ${summary.lifecycle.validExitHandlers}/${summary.lifecycle.exitScripts} exit scripts have the OnLeave/OnHover/OnClick/OnEnter skeleton`);
  console.log(`${summary.dialogs.resolvedBindings}/${summary.dialogs.bindings} dialogue bindings resolve to ${summary.dialogs.compiledFiles} compiled AGE files; ${summary.dialogs.resolvedByBasename} resolve by unique basename`);
  console.log(`${summary.transitions.resolved}/${summary.transitions.total} WD_LoadArea transitions resolve; ${summary.transitions.globalMapCalls} RS_GlobalMap calls; ${summary.transitions.missingTargets.length} missing targets; ${summary.transitions.missingEntrances.length} missing entrances`);
  for (const transition of summary.transitions.missingTargets) console.log(`missing target: ${transition.scenario} → ${transition.destination} (${transition.entrance}; ${transition.script})`);
  for (const transition of summary.transitions.missingEntrances) console.log(`missing entrance: ${transition.scenario} → ${transition.destination}.${transition.entrance} (${transition.script})`);
  for (const binding of summary.scripts.missing) console.log(`missing trigger script: ${binding.scenario}.${binding.trigger} → ${binding.file}`);
  for (const script of summary.lifecycle.invalidExitHandlers) console.log(`invalid exit handlers: ${script.script} (${script.handlers.join(', ')})`);
  for (const dialog of summary.dialogs.missing) console.log(`missing dialogue: ${dialog.scenario}.${dialog.person} → ${dialog.dialog}`);
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const positional = args.filter((arg) => arg !== '--json');
if (positional.length > 1) {
  console.error('Usage: node --experimental-strip-types tools/inspect-scripts.mjs [levels-directory] [--json]');
  process.exitCode = 2;
} else {
  const levelsRoot = resolve(positional[0] ?? 'public/assets/levels');
  const summary = await inspect(levelsRoot);
  if (json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else printSummary(summary);
}
