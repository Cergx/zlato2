# Executable-first reverse-engineering handoff

Updated: 2026-07-23.

This file is the binding direction for the next session. The verified technical corpus remains in [`reverse-engineering.md`](./reverse-engineering.md); do not duplicate or discard it.

## User decision

The project must stop approximating original script behavior with feature-by-feature TypeScript implementations. The next priority is to reverse the original executable composition and make the shipped asset scripts authoritative at runtime.

Required interpretation of “execute scripts directly”:

1. Recover the original script virtual machines, lifecycle, function registry, argument/return rules, state ownership, and DLL/host boundary from `GoldenLand.exe`, `Server.dll`, and `Client.dll`.
2. Execute the shipped CP1251 `.scr` sources and binary `.age.cs` graphs through generic interpreters whose semantics are justified by native code and black-box traces.
3. Keep engine services behind the recovered script ABI. Rendering, audio, persistence, pathfinding, and UI may be browser implementations, but script-specific quest/dialogue outcomes must not be re-authored in TypeScript.
4. A native 32-bit harness that loads the original DLLs is the preferred oracle and may also become the runtime backend if its ABI can be hosted safely. If the browser remains the final target, use the native harness for differential traces and implement a clean-room compatible VM in the web client.

Do not continue adding combat, quest, dialogue, trigger, inventory, or UI behavior by guessing what an individual asset intended. First recover the mechanism that interprets the asset.

## Original binaries and identity

Original installation: `E:/Games/zlato22`.

| Binary | Size | PE | Preferred image base | Entry RVA | SHA-256 |
| --- | ---: | --- | ---: | ---: | --- |
| `GoldenLand.exe` | 372,736 | i386 PE32 | `0x00400000` | `0x37B9E` | `7854019e6c0a6c2bfde6425c5799afca654d174a31cdaa7a624c3e17842109ff` |
| `Server.dll` | 589,824 | i386 PE32 DLL | `0x14000000` | `0x6C943` | `418e256063748f2e90db35ae7c6abe6eac401fb86908cb5f27ebf565a21cc837` |
| `Client.dll` | 1,331,200 | i386 PE32 DLL | `0x12000000` | `0xE841C` | `fbf213b4b820e767a529556d0f7e4d29ee2202e7e39c3e49043f49d55dab5c16` |

Other original modules present: `protect.dll` and `dare.dll`. Resource archive manager: `BurutPak.exe`.

Extracted asset root used by the browser client: `public/assets`. Original packed assets: `E:/Games/zlato22/Data`.

## Recovered executable composition

`GoldenLand.exe` is the host. It resolves `GetClientAPI` and `GetServerAPI` and calls both exports as:

```c
__cdecl void GetClientAPI(HostAPI *host, ModuleAPI *out);
__cdecl void GetServerAPI(HostAPI *host, ModuleAPI *out);
```

Known host/module locations in `GoldenLand.exe`:

- shared `HostAPI` table: `0x46C200`;
- returned Server API table: `0x46D820`;
- returned Client API table: `0x46D840`;
- both returned tables are initialized through virtual/API slot `+0x04`;
- Client facade is exposed at Client API `+0x18`;
- Server facade is exposed at Server API `+0x10`.

The local game still routes dialogue through packet-style dispatch rather than directly sharing a UI object:

```text
AGE VM
  -> Server dialogue snapshot
  -> GoldenLand opcode 12
  -> Client dialogue UI
  -> GoldenLand opcode 6
  -> Server LastAnswer
  -> AGE VM resumes
```

Exact dialogue bridge anchors and payload layout are recorded in `reverse-engineering.md`, section **Dialogue ABI and packet bridge**. Preserve those addresses and use that path as the first complete executable-to-asset vertical slice.

## Existing script runtimes: useful work, not yet authoritative

### Text SCR

Current implementation: `src/game/scripts/SCRRuntime.ts`.

It already lexes, parses, and evaluates asset source instead of translating individual files. Supported syntax currently includes scalar declarations, assignment, calls, blocks, `if`/`else`, unary `! + -`, and common binary operators. It has execution limits and persistent variables.

Known architectural gaps:

- `extractSCREventHandler` extracts trigger bodies separately instead of reproducing the native parsed script object and its four handler slots;
- `void`, loops, `return`, `switch`, `break`, and `continue` are explicitly rejected rather than proven absent/unsupported by the native compiler;
- variable type, numeric conversion, local/global scope, string ownership, error, and lifetime semantics have not all been validated against `Server.dll`;
- lifecycle is manually scheduled by browser code;
- host calls are normalized by name and routed to a large hand-written switch in `GameStateRuntime.callHost`.

Current native lifecycle evidence:

- normal level load at `Server.dll:0x14033214` executes optional `scripts\dialogs_special\every.scr`, then scenario `scripts\init.scr`, through `0x14038BE4`;
- persistent scenario/global core contexts load at `0x140311D8` through `0x14038958`;
- scheduler `0x1402542C` evaluates them every 20 enabled calls through `0x14038904`, only while `hero` exists and its field `+0x14FC` is positive;
- teardown at `0x14033E0E` destroys both contexts;
- trigger handler body slots are object offsets `+0x158 OnLeave`, `+0x15C OnHover`, `+0x160 OnClick`, `+0x164 OnEnter`;
- `0x14028217` executes `OnEnter` while computing open-trigger state;
- `WD_LoadArea` at `0x1403FF1C` stores the entrance argument, formats command `map %s`, and submits it to the host.

The next implementation must turn these findings into one native-compatible SCR context/lifecycle abstraction. Do not add more one-off cases to `GameStateRuntime.callHost` without first documenting the corresponding native registration/handler and testing its trace.

### Binary AGE dialogue VM

Current parser: `src/game/parsers/AGEParser.ts`.
Current evaluator: `src/game/dialogue/DialogueRuntime.ts`.
Current browser bridge: `Game.invokeDialogueFunction` in `src/game/Game.ts`.

This is already close to the desired architecture: it parses and evaluates the shipped graph. Preserve it, but verify each semantic against native execution rather than treating the current TypeScript policy as truth.

Verified native facts:

- loader `Server.dll:0x1403E020` allocates an 80-byte runtime node per serialized record and resolves record ordinals into node pointers;
- evaluator `0x1403A010` executes expression/assignment/function nodes;
- branch loop `0x1403D944` follows node `+0x0C` for nonzero and `+0x08` for zero;
- tag names come from dispatch table `0x14090580`;
- function registration occurs at `0x14042464`;
- source parser/lookup path `0x140398FC -> 0x140399F0 -> 0x14006040` maps unknown function names to numeric ID `0`, losing the spelling;
- the ID is serialized as `float64` at `0x14039E0D`;
- `D_Say`, `D_CloseDialog`, `D_Answer`: `0x1403FC10`, `0x1403FC60`, `0x1403FC9C`;
- `Exit`: `0x1403FD38`; `Cmd`: `0x1403FDF4`;
- dialogue rebuild/select path: `0x14043D44`, `0x14043CF8`, `0x14043A74`, `0x14043220`;
- snapshot copy: `0x1404476C` copies `0xAF` dwords from Server object `+0x04`;
- phrase substitution: `0x14043638` and `0x14043B02..0x14043BFE`;
- voice basename setter: `0x1404345C`.

Current evaluator assumptions requiring differential verification:

- starting every new program at `entryRecord` and restarting graph traversal on each answer;
- maximum-step policy;
- truthiness and string comparison/coercion rules;
- assignment result value;
- exact `D_Say`/`D_Answer` return constants and when the common selector blocks execution;
- termination distinction between `Exit`, `D_CloseDialog`, graph exhaustion, and native context destruction;
- missing function ID `0` behavior;
- variable persistence and ownership across dialogue, scenario, load, and save boundaries.

## Hand-written emulation that must not become the source of truth

`src/game/GameStateRuntime.ts` currently owns a large `callHost` switch for `WD_*`, `RS_*`, `LE_*`, `D_*`, and `C_*` calls. Some cases are grounded in decompilation, while others are placeholders or browser policy. Examples of known weak cases include:

- `WD_SetCellsGroupFlag` returns success without applying state;
- `LE_DelEffect` returns success without applying state;
- effect/magic condition handling does not reproduce the original object model;
- quest/event/party state is represented through convenient maps rather than a recovered native schema;
- `RS_StartDialog`, loading, trade, weather, messages, and completion call browser callbacks directly;
- many argument validations and return values are locally chosen.

This switch should evolve into a generated/declared ABI registry with one entry per recovered native function:

```text
numeric ID
source name
native registration address
native handler address
argument count and types
return type/value convention
state read/write effects
host callbacks or packets emitted
proof source
native trace fixture
```

Function implementations still have to exist, but they must implement the recovered engine service, not a particular quest or script outcome.

## Required next work, in order

### 1. Build a repeatable native oracle

Create a 32-bit Windows harness under `tools/` that can load the exact `Server.dll` and `Client.dll` by hash, resolve `GetServerAPI`/`GetClientAPI`, and supply an instrumented `HostAPI` table. Start with read-only logging and fail closed on unknown callbacks.

Acceptance for the first harness slice:

- module exports load in a 32-bit process;
- API table writes and initializer calls are captured;
- every invoked host-table slot is logged with slot offset and raw arguments;
- one clean startup/shutdown cycle completes without patching the original binaries;
- output is deterministic enough to diff.

If initialization needs DirectX/window/audio services, stub only the exact recovered callback contracts. Record every stub and never return arbitrary success without evidence.

### 2. Recover full API tables and main loop

From `GoldenLand.exe`, label all `HostAPI`, Server API, and Client API slots. Recover:

- construction and destruction order;
- frame/tick order;
- command and packet dispatch loops;
- resource open/read/close callbacks;
- save/load callbacks;
- input and time sources;
- Server-to-Client state synchronization.

The goal is a diagram and machine-readable table sufficient to drive the harness, not more browser gameplay code.

### 3. Make AGE the first differential vertical slice

Use a small shipped dialogue such as `demon.d1.age.cs` and phrase DB `public/assets/sdb/dialogs/dialogsphrases.sdb`.

Capture from the original DLL path:

- loaded node graph and initial variables;
- each evaluated node/tag;
- function ID and evaluated arguments;
- returned numeric value;
- selected successor;
- resulting Server snapshot/opcode-12 bytes;
- submitted reply/opcode-6 bytes;
- updated `LastAnswer` and next turn.

Run the same asset in `DialogueRuntime` and compare traces step by step. Change the TypeScript VM only where the native trace proves a difference.

### 4. Recover and replace SCR lifecycle

Instrument normal load, trigger enter/hover/click/leave, core ticks, map transition, and teardown. Parse the same CP1251 sources in the clean-room VM and compare:

- handler selection;
- statement/call order;
- variable reads/writes;
- host calls and exact arguments;
- return values and side effects;
- context lifetime.

Only after this passes should browser scenario behavior be driven exclusively through SCR execution.

### 5. Cut over cleanly

Once native-compatible VMs and ABI services cover a path:

- remove the superseded ad-hoc path;
- do not keep aliases, fallbacks, per-dialogue patches, or duplicated quest logic;
- save the script VM/global state in a format derived from the original save path, not the current convenience model;
- keep renderer/audio/UI as clients of recovered engine state.

## Reusable tools already in the repository

- `tools/inspect-age.mjs`: strict AGE structural/flow/function/phrase inspector.
- `tools/inspect-scripts.mjs`: scenario/SCR/dialogue binding and transition corpus audit.
- `tools/inspect-lvl.mjs`: LVL corpus validator.
- `tools/inspect-csx.mjs`: CSX decoder validator.
- `tools/inspect-pak.mjs`: Burut PAK decoder/comparator.
- `tools/ghidra/*.java`: headless Ghidra scripts for functions, references, strings, memory, AGE loader, and dialogue handlers.

Useful baseline commands:

```bash
node tools/inspect-age.mjs public/assets/scripts/dialogs --phrases public/assets/sdb/dialogs/dialogsphrases.sdb
node --experimental-strip-types tools/inspect-scripts.mjs public/assets/levels
node tools/inspect-lvl.mjs public/assets/levels
node tools/inspect-csx.mjs public/assets --quiet
node tools/inspect-pak.mjs E:/Games/zlato22/Data --compare-root public/assets
```

The exact flags supported by each inspector are defined in the script itself; do not assume old command examples if a script has changed.

## Known corpus facts useful for oracle tests

- 1,397 textual `.scr` source files.
- 556 binary `.age.cs` dialogue files; all parse structurally with the current inspector.
- 70,172 decoded AGE variable records.
- 51 reachable function calls with numeric ID `0`; their original source names are irrecoverable from the serialized file alone.
- 12,022 dialogue phrases in `dialogsphrases.sdb`, IDs spanning 1–17,103.
- 104 phrases contain 105 `%%` substitutions.
- 261 scenarios; 63 scenario `init.scr`; 57 scenario `core.scr`.
- 442 `tg_exit*.scr` files share the four-handler skeleton.
- 339 `WD_LoadArea` and 103 `RS_GlobalMap` calls occur in those exit scripts.
- 175 LVL files, 19,698 CSX files, and 16 PAK archives have strict validators; these formats are documented in `reverse-engineering.md` and should be treated as supporting infrastructure, not the next feature target.

## Evidence discipline

For every newly claimed script semantic, record:

1. exact binary hash;
2. module and address;
3. decompiled control flow or observed instruction behavior;
4. representative asset input;
5. original-runtime trace/output;
6. clean-room trace/output;
7. corpus validation count.

Address-only guesses are not enough. A behavior observed only in the current browser runtime is not evidence about the original game.

## Files to read first after restart

1. `docs/executable-first-handoff.md` — direction and next actions.
2. `docs/reverse-engineering.md` — verified formats, native addresses, and corpus results.
3. `src/game/scripts/SCRRuntime.ts` — current generic SCR parser/evaluator.
4. `src/game/dialogue/DialogueRuntime.ts` and `src/game/parsers/AGEParser.ts` — current AGE VM.
5. `src/game/GameStateRuntime.ts`, especially `executeTriggerRequest` and `callHost` — ad-hoc host emulation to replace or validate.
6. `src/game/Game.ts`, especially dialogue creation and `invokeDialogueFunction` — current AGE/browser bridge.
7. `tools/ghidra/*.java`, `tools/inspect-age.mjs`, and `tools/inspect-scripts.mjs`.

## Explicit stop condition for the next session

Do not declare progress merely because another gameplay feature works in the browser. The next meaningful milestone is a repeatable, traced execution of at least one shipped AGE or SCR asset through the original module path and a matching clean-room/runtime trace.