# Executable-first reverse-engineering handoff

Updated: 2026-07-25.

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
- `tools/native-oracle/oracle.cpp`: Win32/x86-only hashed DLL loader with 256 traced HostAPI stubs, bounded API-table capture, and optional initializer calls; it does not launch `GoldenLand.exe`.
- `tools/replay-assets.mjs`: deterministic clean-room replay of `demon.d1.age.cs`, its phrase database, and representative `l1_1` `init/core` scripts; SCR host results are explicitly simulated unless `--strict-host` is supplied.
- `tools/validate-scr-runtime.mjs`: gameplay `.scr` parser/lifecycle corpus validator.
- `tools/trace-level-person.mjs` and `tools/compare-level-traces.mjs`: asset-loaded clean-room trace and native/clean comparator for the `L1_1` level-loader/person-registry slice.

Useful baseline commands:

```bash
node tools/inspect-age.mjs public/assets/scripts/dialogs --phrases public/assets/sdb/dialogs/dialogsphrases.sdb
node --experimental-strip-types tools/inspect-scripts.mjs public/assets/levels
node tools/inspect-lvl.mjs public/assets/levels
node tools/inspect-csx.mjs public/assets --quiet
node tools/inspect-pak.mjs E:/Games/zlato22/Data --compare-root public/assets
npx --yes tsx tools/trace-level-person.mjs
node tools/compare-level-traces.mjs tools/l1_1-level-person.native.ndjson tools/l1_1-level-person.clean-room.ndjson
```

The exact flags supported by each inspector are defined in the script itself; do not assume old command examples if a script has changed.

### Current implementation milestone

The browser runtime parses complete gameplay `.scr` assets into structured programs with top-level `init/core` statements and four handler slots. Trigger execution selects the native lifecycle slot (`OnEnter` + `OnHover`, `OnClick`, or `OnLeave`) from one parsed object cached per level/script. `SCRRuntime` rejects calls outside the recovered 65-entry native function registry and exposes post-order evaluator traces using the native node-kind IDs. `DialogueRuntime` retains the corresponding trace hook for every AGE function call, including `D_Say`, `D_Answer`, `D_CloseDialog`, and `Exit`.

The 32-bit native oracle now completes both verified `Server.dll` and `Client.dll` initializers without launching `GoldenLand.exe`. The successful differential command is `.tmp/native-oracle.exe --game-root E:/Games/zlato22 --asset-root G:/ws/zlato2/public/assets --host-facades --probe-config-object --initialize --quiet-stubs`.

The completed trace records 925 resource requests, resolves 914 of them, directly loads `scripts\ui\main_menu.scr` and `scripts\weather.scr` through Client.dll, records no unhandled exception, returns from the Client initializer at `Client.dll+0xc9cc0`, and emits `oracle_complete initialized=true`. The 11 fail-closed misses are three unavailable loading-background requests and eight empty `.csx`/`.bmp` requests. The matching clean-room GUI parser accepts the same CP1251 `main_menu.scr` and yields its six authored buttons with IDs `1..6`.

The browser GUI path now resolves shipped `#INCLUDE` and `#DEFINE` directives before parsing UI objects. `scripts/include/script_types.age.h` is the runtime source of GUI type IDs; the previous hand-maintained numeric mapping is gone. All 22 `OBJECT_START` UI scripts parse successfully through the shared loader: 534/534 objects, with source locations, raw authored attributes, include dependencies, and no failures. `OriginalGuiLayer` renders all seven object families present in the shipped declarations (`GUI_SIMPLE_BUTTON`, `GUI_CHECK_BUTTON`, `GUI_SLIDER`, `GUI_VSLIDER`, `GUI_EDIT`, `GUI_LISTBOX`, and `GUI_DD_CONTAINER`; `GUI_DD_OBJECT` is also implemented for the declared ABI). Browser smoke verification confirms that `main_menu.scr` produces its six controls at the authored bounds and `options_menu.scr` produces all 17 controls, including interactive slider and check-button state.

The browser does not responsively rescale that authored interface. Main menu, game canvas, weather canvas, and overlays share a fixed 1024-by-768 logical surface; SCR bounds are applied as literal pixel coordinates. There is no `viewport-scale`, viewport-unit layout, resize-driven scale state, or CSS `transform: scale(...)`. If the browser's CSS viewport is smaller, the fixed canvas scrolls rather than changing game geometry.

Three corrected contracts removed the previous boundary: Client HostAPI `+0x14`, vtable `+0x30`, is a one-argument `thiscall`; Client state `+0x4424` is a separate interface whose slots `+0x0c` and `+0x10` use explicit stdcall argument shapes; and resource slot `+0x20` returns the actual byte count with valid short-read behavior. The last point is proven by `test.f2d`, whose `0xe1c` bytes are consumed as a `0x2c` header plus a short `0xdf0` result for a requested `0xe00` body.

The HostAPI `+0x14`, vtable `+0x30`, SDB lookup is no longer fail-closed. The oracle parses `public/assets/sdb/user_interface.sdb`, returns stable CP1251 record pointers, and captures 23 Client selectors. All 23 native-returned byte strings match the clean-room SDB mapping exactly; representative values are `0x8f -> Вы хотите выйти?`, `0x8e -> Выход из игры`, and `0x90 -> Восстановить настройки?`.

The active Server dialogue context is now traced recursively rather than only at top-level flow nodes. The oracle patches 44 direct `0x1403A010` evaluator callsites and 46 `0x1403A914` argument-evaluator callsites, records all 147 evaluations across the first two shipped turns, and matches `DialogueRuntime` exactly on `(turn, sequence, depth, record, result)`. It also emits the compact host packets: opening opcode `12` is `0c010000007c0a027e0a880affffffff000000`, selected reply opcode `6` is `067e0a0000`, and the next opcode `12` snapshot is `0c020000009f0a02f905a10affffffff000000`. The initialized Client facade accepts the update counter through `+0xB4`, and `+0xB8` returns reply `2686` once then `0`; the harness deliberately uses an empty-view apply probe because its minimal host still lacks the live Client phrase-SDB ownership graph required to render the real phrase/reply payload safely.

The verified clean-room baseline remains 556/556 AGE containers, 571/571 gameplay SCR files, 261 scenarios, 461 trigger bindings, 63 `init.scr`, and 57 `core.scr`; simulated replay output is marked `simulated: true`. `GameOptions.strictScriptAbi` is propagated through `Game` and `Level` into `GameStateRuntime`. Non-strict mode keeps shipped levels runnable by warning once per unrecovered side-effect host function and returning success; strict mode fails at the first such call for differential validation.
Executable asset checks are also part of the baseline: `node tools/validate-scr-runtime.mjs public/assets/levels` reports `files: 571`, `handlers: 1792`, `statements: 1380`, `failures: []`; `node tools/replay-assets.mjs > tools/replay-assets.clean-room.ndjson` executes the shipped `demon.d1.age.cs`, `l1_1/init.scr`, and `l1_1/core.scr` paths. The captured stdout is [`tools/replay-assets.clean-room.ndjson`](../tools/replay-assets.clean-room.ndjson) and contains `age_program`/`age_node`/`age_function`/`dialogue_state` plus `scr_host_call`/`scr_result` events; the AGE-only normalized excerpt remains in `tools/demon-age.clean-room.ndjson`.
The corresponding native AGE fixture is [`tools/demon-age.native.ndjson`](../tools/demon-age.native.ndjson). It records hashed `Server.dll`/`Client.dll`, the 3,710-byte shipped `demon.d1.age.cs`, 241 raw `0x50` allocations split into one pre-record allocation plus 240 serialized record nodes, 147 recursive evaluations, 84 top-level flow transitions, all three opcode `12`/`6` packet payloads, two Client one-shot poll checks, turn `2684 -> [2686,2696]`, submitted reply `2686`, turn `2719 -> [1529,2721]`, and clean context destruction. `node tools/compare-dialogue-traces.mjs tools/demon-age.native.ndjson tools/demon-age.clean-room.ndjson` compares every recursive evaluation, flow record/result/branch/successor, packet byte, update counter, phrase ID, reply order, submitted-answer progression, and shutdown.

Native plaintext SCR execution is now repeatable without `GoldenLand.exe`. `--invoke-native-scr` compiles and runs shipped `levels/single/l1_1/scripts/init.scr` through `Server.dll+0x38958/+0x38904/+0x38920`: 207 source bytes, 21 nodes, 11 recursive evaluations, 7 top-level flow nodes, and clean destruction. `--invoke-native-scr-core` runs the 1,242-byte shipped `core.scr`: 137 nodes, 73 recursive evaluations, 41 top-level flow nodes, and 16 exact `RS_GetTribesRelation`/`RS_SetTribesRelation` argument/result calls captured through the native registered callbacks. `node tools/compare-scr-traces.mjs tools/l1_1-init.native.ndjson tools/l1_1-init.clean-room.ndjson` matches all 6 non-structural evaluator results; the equivalent `core` command matches 56 evaluator results and all 16 host calls.
`--invoke-native-scr-core-real` executes the same core through the unmodified registered faction callbacks. The initializer-created faction object has zero entries, so all eight native getter calls return relation code `2`, all setter branches remain unvisited, and the 57-evaluation / 33-flow trace matches 40 clean evaluator results. This corrected two browser assumptions: an absent faction pair is native-friendly (`2`), not neutral (`1`), and `RS_SetTribesRelation` returns `0.0`, not success `1`.
`--invoke-native-scr-trigger` now drives the real shipped `l1_1/tg_exit_l1_2.scr` `OnHover` body through native one-shot helper `Server.dll+0x232B0`. The real `WD_LoadArea` handler returns `0`, writes `L1_2_e_L1_1` into the pending-entrance fixed string, and submits one `map L1_2` command with flag `1`. The matching fixture pair `tools/l1_1-tg-exit-l1_2.{native,clean-room}.ndjson` agrees on both evaluator results, the exact command, entrance state, and teardown. Trigger bodies are now cached as raw slot strings and recompiled per invocation rather than retained as parsed programs.
The gameplay corpus calls 28 registered host functions; the validator now reports exact counts and no shipped call reaches the two remaining fail-closed browser handlers. Static native CFG recovery corrected the used mutators to return `0.0`, including global-map/dialog launch, add/delete person, experience, quest/stage, trigger visibility/enabling, conditions, person/location setters, and visual effects. `RS_SetLocationAccess` also writes `${name}_state` in the shared SCR registry. `RS_IsPersonExistsI(level, person)` keeps native level ownership: it reads the current live level directly, returns native `1` for an as-yet-unsaved remote level, and consults saved level records otherwise. The direct server-facade `+0x28` same-level load is not an unload/save cycle: it rebuilds the shipped person list, so a live deletion reads `0` immediately but the person reads `1` after that reload. `GameStateRuntime` now matches this distinction; save format 7 still persists explicit per-level records and migrates version 6.
`--invoke-native-scr-effect` runs shipped `l10_2_1/init.scr` and captures four native `LE_CastEffect(anchor, effect, x, y)` calls. `tools/l10_2_1-effects.{native,clean-room}.ndjson` matches 16 evaluator results and all four argument/result tuples; the browser now uses the second string as the effect resource and returns native `0`.
`--invoke-native-level` now calls server-facade vtable slot `+0x28`, which resolves to `Server.dll+0x33214`, and loads shipped `L1_1` without launching the executable. The native path requests host-provided dimensions `230x224`, opens the scenario/person/inventory/SCR resources, then compiles a 15-node transition that calls the unmodified `RS_IsPersonExistsI`, `RS_DelPerson`, and `RS_IsPersonExistsI` callbacks. The observed results are exactly `1 -> delete(0) -> 0`; the evaluator performs seven recursive evaluations and the deletion path's no-argument HostAPI `+0xCC` service getter returns a structure whose optional callbacks at `+0x44/+0x48` may be null. Calling the same `+0x28` loader again reopens the level resources and a six-node query returns `1`, proving that this direct load resets the live static-person set rather than committing the deletion to a saved-level record. `tools/trace-level-person.mjs` loads the same SEF/LVL assets through `LVLParser`, `SEFParser`, and `GameStateRuntime.loadLevel`; its derived `2760x2016 / 12x9 = 230x224` geometry, live mutation, and same-level reset match the native fixture. `node tools/compare-level-traces.mjs tools/l1_1-level-person.native.ndjson tools/l1_1-level-person.clean-room.ndjson` verifies the DLL hash, loader RVA, both node/evaluator sequences, geometry, mutation results, and reload result.

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

The generic SCR context, complete 65-name registration table, evaluator dispatch, one-shot/persistent lifecycle, real empty-faction behavior, `WD_LoadArea`, and the populated `L1_1` current-person read/delete/read path are recovered. The direct server-facade `+0x28` same-level reload boundary is also closed: it reconstructs the shipped person set and returns `1` after the verified live deletion, and `GameStateRuntime` matches it. The next Server boundary is actual saved-level persistence through a real unload/level transition or a remote query after that transition; do not treat a repeated `+0x28` load as an unload/save cycle. The independent Client boundary remains a complete phrase-SDB ownership graph for driving a real nonempty opcode `12` payload through `0x120A0F9C`; the current empty-view facade probe proves update and one-shot reply transport but not native phrase rendering.