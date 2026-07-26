# GoldenLand / «Златогорье 2» reverse-engineering notes

Updated: 2026-07-25. All paths below are relative to this repository unless stated otherwise.

> **Current direction:** executable-first script execution. Before adding more browser gameplay behavior, recover the original `GoldenLand.exe` / `Server.dll` / `Client.dll` runtime boundary and validate direct execution of shipped `.scr` and `.age.cs` assets. See [`executable-first-handoff.md`](./executable-first-handoff.md) for the binding architecture decision, binary hashes, known addresses, current-runtime gaps, and ordered next steps.

## Resource roots

- Original game installation: `E:/Games/zlato22`.
- Extracted assets used by the web client: `public/assets`.
- Browser implementation: `src/game`.
- Original host: `E:/Games/zlato22/GoldenLand.exe`; engine modules: `E:/Games/zlato22/Server.dll` and `E:/Games/zlato22/Client.dll`.
- `BurutPak.exe` is the resource pack manager.

## Burut PAK archives

Every `.pak` begins with `PAK `, `uint32 reserved` (zero in all inspected files), and `uint32 entryCount`. Its variable-length directory immediately follows. Each entry is `uint32 CP1251PathByteLength`, CP1251 path, `uint32 decodedByteLength`, and `uint32 absolutePayloadOffset`; the first payload starts exactly at the directory end.

Each payload starts with a little-endian codec word. Codec `0` stores the following `decodedByteLength` bytes verbatim. Codec `1` stores a `uint32 compressedByteLength` followed by a zlib stream which inflates exactly to the directory's decoded length. Payloads are contiguous and have no alignment padding.

`tools/inspect-pak.mjs` validates the directory, every payload boundary and codec stream, and can byte-compare decoded entries with an extracted root:

```bash
node tools/inspect-pak.mjs E:/Games/zlato22/Data --compare-root public/assets
```

Validated: all 16 archives. The ten base archives reproduce the extracted tree exactly. The six `*.update.3.pak` archives are separate revision variants rather than a uniform overlay of that tree: matching entries range from 0/7 (`sdb.update.3.pak`) to 19/20 (`engineres.update.3.pak`). Preserve both variants when reproducing a patch-level resource set. `BurutPak.exe` identifies itself as the freeware Burut PAK-archive manager 0.90 using zlib 1.1.4; its `t`, `e`, and `x` commands respectively test, extract flat, and extract with stored paths.

## Existing project parsers

| File | Role |
| --- | --- |
| `src/game/parsers/LVLParser.ts` | Parses binary geometry and object-description data from `.lvl`. |
| `src/game/parsers/SEFParser.ts` | Parses textual CP1251 scenario metadata. |
| `src/game/parsers/SDBParser.ts` | Parses string databases. |
| `src/game/parsers/CSXParser.ts` | Decodes palette/RLE-like bitmap resources. |
| `src/game/parsers/PADParser.ts` | Parses person animation atlas metadata from `.pad`. |
| `src/game/parsers/HADParser.ts` | Parses the dedicated composited hero animation metadata from `.had`. |
| `src/game/parsers/LAOParser.ts` | Parses animation metadata. |
| `src/game/parsers/engineObjectParser.ts` | Generic parser for SEF-style named blocks. Repeated `name` blocks are retained as arrays. |
| `src/game/parsers/OriginalGuiScript.ts` | Parses shipped `scripts/ui/*.scr` object declarations into browser controls. |
| `src/game/parsers/PRSParser.ts` | Parses person resource metadata and referenced sound shaders from `.prs`. |
| `src/game/parsers/MDFParser.ts` | Parses magic/effect duration headers and length-prefixed sprite references from `.mdf`. |
| `src/game/parsers/GlobalEncounterParser.ts` | Parses global-map combat-zone `.dsc` groups. |


## LVL container

All 175 inspected files under `public/assets/levels/lvl` conform to the block layout:

```text
8-byte ASCII block id + uint32 little-endian payload size + payload
```

Observed required block sequence:

```text
BLK_LVER  version: uint16 minor, uint16 major
BLK_MPSZ  map width, height: uint32
BLK_MHDR  chunk-grid width, height: uint32; width × height × 4 records of (uint16 terrain, uint16 flags, int16 maskDescriptionIndex)
BLK_MDSC  uint32 count; per record: uint32 type, int32 resourceIndex, int32 x, int32 y
BLK_SDSC / BLK_ADSC / BLK_TDSC  uint32 count; per record: uint16 type, uint16 flags, uint32 resourceIndex, int32 x, int32 y, length-prefixed CP1251 name
BLK_CGRP  named cell groups: length-prefixed CP1251 name, uint32 count, count × (uint16 x, uint16 y)
BLK_SENV  sound header, uint32 extra-sound count, three length-prefixed CP1251 paths, then named sound records
BLK_WTHR  weather type, intensity: uint16
BLK_DOOR  door records, each with six length-prefixed CP1251 strings
BLK_LFLS  uint32 floor count
```

`BLK_MHDR` determines the actual terrain grid. `BLK_MPSZ` may be smaller for maps whose outer chunks are cropped.

### Level compositing and occlusion

`bitmaps/layer.jpg` is the precomposed visible scene. The CSX files referenced by `BLK_MDSC` are not visible colored overlays: their only drawn palette color is magenta, forming irregular coverage masks. A descriptor's `x, y` is the mask canvas's top-left map position.

The original loader expands each six-byte `BLK_MHDR` record to a packed 32-bit `terrain | (flags << 16)` word plus a signed mask-description index. Low terrain bit `1` controls whether the index is active; some shipped records retain an unused non-negative index while that bit is clear. Every active index in all validated LVLs resolves to `BLK_MDSC`. Low terrain bit `2` marks the end boundary used by the occlusion scan. `Client.dll` groups the map into 24-by-18-pixel chunks, while SEF positions use half-sized 12-by-9-pixel cells. A person's `big cell` is therefore `(cellX >> 1, cellY >> 1)`.

The base packed terrain word is also a four-cell bitplane. For SEF cell `(x, y)`, `slot = (x & 1) + 2 * (y & 1)` and terrain property `b` is stored at bit `slot + 4 * b`. This is not four contiguous nibbles. The original accessors use the same half-coordinate lookup and shifted masks. Property `2` is the no-way plane used by the web collision grid; property `3` is the corresponding no-view plane. Corpus check across all 247 single-player SEFs and their 152 LVL packs found the no-way plane clear at 1,310 of 1,312 person starts and 1,303 of 1,312 authored route points; the few exceptions are scripted endpoints or initially overlapping state.

Occlusion is entity-local, not a global bottom-baseline queue of foreground cutouts. Before drawing an entity, `Client.dll` enumerates the 24-by-18 cells intersecting its sprite bounds. For each of the four MHDR slots at the entity's big-cell row, `ApplyCellMask` follows equal active mask indexes rightward and downward and accepts the mask only when both runs reach a terrain-bit-`2` boundary. The renderer preserves the affected layer tiles, draws the entity, then restores the accepted mask-covered scene pixels over it. The web renderer mirrors this by selecting MHDR masks per entity and clipping extracted `layer.jpg` foregrounds to that entity's frame.

Static objects, animations, and persons still use map-space depth ordering. SEF person and route positions are screen-aligned 12-by-9-pixel cells (`pixelX = cellX * 12`, `pixelY = cellY * 9`), not an additional isometric transform.

The runtime canonicalizes all entity and route positions to map pixels at load time and advances world state on a fixed 60 Hz simulation clock. Rendering, depth, occlusion, camera offsets, and movement therefore share one coordinate space; render-frame cadence no longer changes NPC positions or animation frame advancement.

Player movement now uses this 12-by-9 cell grid. A left click is converted from camera-relative canvas coordinates to a world cell, occupied NPC cells are blocked for that request, and an eight-neighbour A* search rejects no-way cells and diagonal corner cutting. Clicking a blocked cell resolves to a nearby walkable destination. The selected hero then advances over the resulting path on the same fixed simulation clock and participates in the existing depth and occlusion render queue.

Representative `l1_1.lvl`:

```text
311,939 bytes
2760 × 2016 pixels
115 × 112 chunks = 12,880 chunks / 51,520 terrain-tile records
62 masks, 2 static objects, 2 animations, 20 triggers
3 cell groups / 15 cells, 2 doors, 2 floors
```

Reusable validator:

```bash
node tools/inspect-lvl.mjs public/assets/levels/lvl --assets-root public/assets/levels
```

Validated: all 175 LVL files parse; their referenced CSX, layer, and LAO resources resolve.

## CSX bitmap containers

Non-empty `.csx` files are paletted, scanline-compressed bitmaps:

```text
int32 palette count (0..256)
BGRA fill color (stored alpha is inverted)
palette count × BGRA palette entries
int32 width, height
(height + 1) × int32 byte offsets relative to the compressed-data start
compressed scanline command stream
```

Palette indexes `0`–`104` are literal pixels; `105` is one transparent pixel; `106, color, count` is a palette-color run; `107, color` escapes the following byte so command-valued palette indexes (`105`–`108`) can be emitted as one literal pixel; and `108, count` is a transparent run. Neither `106` nor `107` modifies the preceding pixel. Run counts are clipped to the remaining output width. Palette magenta (`R >= 254, G < 2, B >= 253`) is a color key and decodes as transparent for visible sprites, but MDSC mask resources preserve it as opaque coverage for foreground extraction. `tools/inspect-csx.mjs` strictly validates the header, every scanline boundary, palette reference, and decoded width.

```bash
node tools/inspect-csx.mjs public/assets --quiet
```

Validated: all 19,698 CSX files; `levels/pack/tl41/bitmaps/minimap.csx` is an intentional zero-byte placeholder in both the original and extracted trees.

The browser decoder previously inherited an obsolete C# interpretation that also rewrote the preceding pixel for commands `106` and `107`. The corrected implementation matches the newer independent `GoldenLandEditor` decoder. A browser differential check decoded all 17 retained `engineres/interface/**/*.csx` files through `CSXParser` and an independent reference implementation and reported zero RGBA mismatches. Visual checks of `save_load_menu/background.csx` and `about_menu/background.csx` found no obvious one-pixel streaks, palette corruption, or broken panel edges.

## PAD person animation metadata

Person resource directories contain one `.pad` file and animation atlases under `animation/`. The observed `.pad` layout begins with:

```text
"PAD "
uint32 recordEndOffset       // file size minus the fixed 76-byte tail
uint32 unknownHeaderWord
repeat until recordEndOffset:
    uint32 actionFlag
    uint32 recordSize        // measured from this field
    uint32 resourceId
    uint32 frameCount
    uint32 frameWidth
    uint32 frameHeight
    uint32 anchorX
    uint32 anchorY
    float32 movementX
    float32 movementY
    uint32 durationMs
    byte[recordSize - 40] action-specific frame data
byte[76] unknownTail
```

The atlas width is exactly `frameCount * frameWidth`. Walking atlases use the server direction enum as rows `UP, UP_LEFT, LEFT, DOWN_LEFT, DOWN, DOWN_RIGHT, RIGHT, UP_RIGHT`, followed by a repeated `UP` row. Idle atlases store the first five rows through `DOWN`; the three right-facing directions mirror rows `3, 2, 1`. Verified action/file pairs are `0x1 = rt_stay`, `0x4 = tb_stay`, `0x10 = tb_go`, and `0x20 = rt_go`.

SEF technical person names are not sprite resources. The original client loads `scripts/persons/<technical-name>.scr`, reads its `res_name`, and then opens `persons/<res_name>/<res_name>.pad`. The web runtime now follows that exact chain and selects the complete real-time idle/walk pair when present, otherwise the turn-based pair; no archetype-name sprite substitution remains.

The playable hero is not an NPC resource. Its base body and clothing live under `wear/noweapon_thrw/`, with animation metadata in `noweapon_thrw.had`. `HAD` uses the same record framing and 76-byte tail as `PAD`, but each record adds composite bounds before the actual base-atlas geometry:

```text
"HAD "
uint32 recordEndOffset
uint32 unknownHeaderWord
repeat until recordEndOffset:
    uint32 actionFlag
    uint32 recordSize                 // measured from this field
    uint32 resourceId
    uint32 frameCount
    uint32 compositeWidth
    uint32 compositeHeight
    uint32 frameWidth                 // base CSX frame geometry
    uint32 frameHeight
    uint32 anchorX
    uint32 anchorY
    float32 movementX
    float32 movementY
    uint32 durationMs
    byte[recordSize - 48] frame composition data
byte[76] unknownTail
```

The base atlas dimensions still equal `frameCount * frameWidth` by the direction-row count. Verified hero pairs are `0x1 = rt_stay`, `0x20 = rt_go`, and `0x200 = run`. The web client now uses this dedicated hero rather than borrowing an arbitrary level NPC; double-click movement uses the shipped `run.csx` atlas.


## LAO and ANI animation metadata

- Each `.lao` file is an unframed array of 8-byte records. Across 33 files / 84 records, the observed layout is `uint16 height, uint16 0, uint16 duration, uint16 0`; heights are 22–1,488 pixels and durations are 50, 60, 70, 80, 85, 90, or 100.
- Cursor `.ani` files are RIFF/`ACON` cursor animations. The producer stores the total file size in the RIFF length field, rather than the usual payload size. Each inspected file has an `anih` header, optional `rate` and `seq ` chunks, and a `LIST`/`fram` collection of embedded `icon` images. `anih.nFrames` counts source icons; `anih.nSteps` counts playback steps. `take.ani` proves the distinction: its 6 icons are sequenced through 8 steps as `0,1,2,3,4,3,2,5`.

## SEF scenario metadata

SEF files are CP1251 textual object syntax. Important blocks:

- `pack`: geometry pack / LVL resource identifier.
- `persons`: NPC placement, direction, route, tribe, inventory and dialog script.
- `points_entrance`: named spawn points.
- `cell_groups`: logical cell sets; these are unrelated to LVL `BLK_CGRP` names.
- `triggers`: interactive areas; may point to a `.scr` file.
- `doors`: optional scenario-level door state.

The generic object parser must preserve duplicate `name` blocks. This is required: `single/l1_1/l1_1.sef` contains two independent `L0.P744_oficer1` placements.

Verified against raw named blocks in all 261 SEF files:

```text
1,478 persons
450 entrance points
1,180 triggers
0 parser failures
```

### LVL/SEF relationship

- 261 scenario folders map to 152 distinct geometry packs.
- 50 packs are shared by more than one scenario.
- `SEF.pack` is the geometry pack, not the scenario-folder identifier.
- `WD_LoadArea` selects a scenario folder, then that folder's SEF selects the geometry pack.
- Across all scenarios, LVL has 2,544 trigger descriptors and SEF has 1,166 trigger definitions; 1,165 names overlap.
- LVL and SEF cell-group namespaces have zero matching names.
- Door names only partially overlap; LVL also contains visual/physical door definitions with no SEF record.
- `l1_1`: 11 of 20 LVL trigger-descriptor names occur in the corresponding SEF; the nine LVL-only names are physical door/open/close, blocked-entry, or filling regions. Both `BLK_DOOR` records join a SEF door by `sefName`, their `staticName` joins `BLK_SDSC`, and their open/close actions join `BLK_TDSC`.

## Items, inventories, and hero wear

The shipped item databases join the numeric `.itm` file name to technical name, Russian literary name, and description. `src/game/ItemCatalogRuntime.ts` loads those SDB tables once and resolves `.itm` files lazily. The initial hero inventory comes from `scripts/inventory/hero_items.inv`; an active `item "TECHNICAL_NAME" ... minimum maximum` line contributes a quantity in its final inclusive range, while `//item` lines remain disabled. The shipped hero file currently materializes 1,000 `T_MONEY`.

Hero equipment is data-driven rather than baked into the base character atlas:

- `scripts/herowear.scr` maps technical item names to a visual group and, for weapons, a hero animation profile.
- Each profile supplies base `.had` metadata and base CSX animation atlases.
- Each equipped visual group supplies an `.iad`, per-action CSX layers, and category `.seq` files. IAD starts with `IAD ` and contains variable records keyed by action id; the runtime uses frame count and dimensions plus composite offsets from each record.
- A sequence begins with the action frame count, followed by one layer-order byte per direction-row/frame pair. `src/game/HeroWear.ts` composites those layers around the base hero frame and preserves the base HAD anchors. Missing action layers are intentional; for example spear/staff weapon groups have no `run.csx`, so the base run action remains visible without that layer.

The implemented inventory screen uses the original `engineres/newinv/inventory_skills.bmp` and `inventory_secondary.bmp`, shipped item icons, and descriptions. It supports use, drop, equip/unequip, live hero sprite recomposition, and quick-save/quick-load restoration. Browser verification covered the shipped 1,000-money initial inventory, helmet equip/unequip, restored equipment after F5/F9, a changed composed helmet atlas, and combined helmet composition in all seven shipped weapon profiles (`two_spears_staffs`, `xbows_guns`, `two_axes_maces`, `bows`, `noweapon_thrw`, `onehand_wpn`, and `two_swords`).

## Magic book and spell items

The six original schools are not contiguous in UI order. Button order and spell-id ranges are: gods `26..38`, elements `13..25`, light `39..51`, dark `0..12`, shadows `65..77`, and nature `52..64`. The literary names, technical names, and descriptions come from `sdb/magic/magiclitnames.sdb`, `magictechnames.sdb`, and `magicdescription.sdb`. Spell art is keyed by the technical name under `engineres/interface/magic_book/magic_icons/{noactive,glow_na,glow,cast_na,cast}`.

The shipped item corpus contains a book (ITM type `21`) and scroll (type `22`) for every one of the 78 spell ids. Their class-specific magic id is the integer at parsed native-property index `18`. The browser runtime treats books as permanent learning items, consumes one only when the spell is not already known, and stores learned ids plus the nine spell-book quick slots in the existing hero parameter map so ordinary quick-save/quick-load persistence preserves them without a save-format fork.

The magic book now loads `magic_book.scr` through `GuiDefinitionRuntime`. `OriginalGuiLayer` owns close/cast objects `1..2` and school check buttons `3..8`; spell hitboxes use parsed objects `9..21`; the nine assignment slots use parsed objects `22..30`. The former duplicated `SPELL_POSITIONS`, percentage school bar, hand-authored close/cast hitboxes, and manually swapped school-button sprites are removed. Learned spells remain selectable and draggable; right-click clears an assignment slot. Browser verification matched close `928,692,66,62`, cast `731,689,74,67`, all six school rectangles, and all nine quick-slot rectangles from the shipped script, and switching object `4` selected the light school without a duplicate browser control.

Combat spell execution is data-driven from `scripts/magic.scr`. `MagicCatalogRuntime` joins all 78 definitions to the shipped SDB names and decodes school, ally/enemy targeting, healing, realtime/aimed flags, radius, AP/energy formulas, and nested `special` records. Every shipped player spell is executable: the runtime applies physical, elemental and school damage; current/max health, energy and action points; attributes, accuracy, critical, armor, initiative, resistance and immunity modifiers; silence, regeneration and map-walker conditions; dispelling; and all four summon variants. Area spells select combatants inside the authored world-space radius. Timed effects use the authored `base + coefficient * power` duration, replace an existing effect with the same target/special instead of stacking it, rebuild the affected combat profile immediately, and expire on game-time or combat-turn advancement; expiring summons leave the active roster. The nine original HUD cells mirror the spell-book assignments, accept mouse activation and keys `1` through `9`, arm enemy targeting or immediately apply ally spells, deduct authored AP/energy costs, respect school immunity and channel resistance, update death/combat state, and persist learned/assigned spell ids through the existing hero parameters. Deterministic browser verification cast all 78 ids with no rejected or inert definitions.

Save format `5` persists every active timed effect as `(spellId, specialId, targetName, value, remainingMinutes)`, the independent per-person health/energy regeneration elapsed counters, and native-style persistent bestiary kill counts. Restore rebuilds modified combat profiles, current health/energy and summoned allies before time resumes; versions `1` through `3` migrate with empty effect and bestiary state, while version `4` retains its effect state and gains an empty bestiary record. End-to-end browser verification round-tripped an active regeneration spell with a partial interval and restored its next tick at the exact remaining delay, separately restored a summoned ally, and restored a bestiary count after clearing the live runtime map.

## SCR scripts

Inventory:

```text
1,397 .scr source files
556 .age.cs binary dialogue files
```

`*.scr` is a C-like event language with `if`, `else`, local `int`, global state variables and braces. Interactive trigger scripts contain `OnEnter`, `OnLeave`, `OnHover`, and `OnClick`; all four occur 448 times. Transitions commonly happen in `OnHover` via:

```c
WD_LoadArea("L1_1_1", "L1_1_1_e_L1_1");
```

Observed API families:

- `WD_LoadArea`, `WD_SetVisible`: world transition / visibility.
- `RS_GlobalMap`: global-map transition.
- `RS_EnableTrigger`: trigger state.
- `RS_IsPersonExistsI`, `RS_AddPerson_1`, `RS_AddPerson_2`, `RS_DelPerson`: NPC lifecycle.
- `RS_GetTribesRelation`, `RS_SetTribesRelation`: faction relations.
- `RS_StageComplete`, `RS_StageEnable`, `RS_QuestComplete`: quest state.
- `RS_StartDialog`: dialogue invocation.

`RS_AddPerson_1(routeType, route, radius, delayMin, delayMax)` stages movement data for the immediately following `RS_AddPerson_2(technicalName, cellX, cellY, direction, literaryLabel, tribe, dialog, inventory)`. The shipped source corpus contains 77 calls of each half and every `_2` is immediately preceded by `_1`. Repeated technical names are intentional clones: `single/l6_1/init.scr`, for example, creates three guards from `L1_2.P130_Svetlograd_Heavy_Guard1` at distinct cells. The browser runtime now preserves every tuple, loads the original person sprite and combat assets, appends every clone to rendering/pathfinding/interaction, retains the supplied dialogue and inventory bindings, and makes `RS_DelPerson` hide all clones of that technical name. Browser verification loaded the shipped `single/l12_1` conditions: `L82.P537_Son` spawned at `(75, 28)` with `RANDOM`, `L10.P541_Mangaurs_Oficial` spawned at `(153, 146)` with `STAY`, both entered the combat roster, and the son's supplied AGE dialogue opened through the renderer interaction callback. Person and parameter identifiers used by `RS_GetPersonParameterI`, `RS_GetPersonSkillI`, and `RS_SetPersonParameterI` are case-insensitive, matching shipped uppercase `REPUTATION` calls against the lowercase hero profile field.

`init.scr` and `core.scr` have different lifetimes:

- The normal level-load path at `Server.dll:0x14033214` executes `scripts\dialogs_special\every.scr` and then `<level-root>\scripts\init.scr` once through `0x14038BE4`. Two alternate load branches bypass both one-shot calls and rejoin afterward.
- `0x140311D8` then loads persistent `<level-root>\scripts\core.scr` and `scripts\dialogs_special\core.scr` contexts through `0x14038958`. Scheduler `0x1402542C` advances a counter while level scripts are enabled and, every 20 calls, evaluates the level core followed by the global core through `0x14038904` when `hero` exists and its `+0x14FC` field is positive. Level teardown at `0x14033E0E` destroys both contexts.
- The shipped `scripts.pak` and extracted tree contain neither global `dialogs_special/every.scr` nor `dialogs_special/core.scr`; those two optional loads are therefore no-ops. Across 261 scenarios, 63 have `init.scr` and 57 have `core.scr`.
- The trigger parser maps `OnLeave`, `OnHover`, `OnClick`, and `OnEnter` to four source-body slots at object offsets `+0x158`, `+0x15C`, `+0x160`, and `+0x164`. The hover-state method runs `OnHover` when the cursor enters and `OnLeave` when it leaves; `0x14028217` runs `OnEnter` while computing `bOpenTrigger`. All 442 `tg_exit*.scr` files have the same four-handler skeleton. Their `OnHover` bodies contain exactly 339 `WD_LoadArea` calls and 103 `RS_GlobalMap` calls.
- `WD_LoadArea(destination, entrance)` at `0x1403FF1C` stores the second argument as the pending entrance name, formats the first as command `map %s`, and submits it to the host. The entrance names address SEF `points_entrance` records. In mode-local corpus validation, 316 of 339 transitions resolve completely; 11 multiplayer scripts name absent target scenarios and 12 more name missing entrance points. These are shipped dangling links, not parser uncertainty.

Reusable static linker:

```bash
node --experimental-strip-types tools/inspect-scripts.mjs public/assets/levels
node --experimental-strip-types tools/inspect-scripts.mjs public/assets/levels --json
```

Latest verified output:

```text
261 scenarios; 152 geometry packs; 50 shared packs
461 / 461 SEF trigger-script bindings resolve to 419 files
1,267 / 1,268 NPC dialogue bindings resolve
316 / 339 WD_LoadArea transitions resolve
103 RS_GlobalMap calls
11 missing multiplayer targets; 12 destination-entrance mismatches
```

The one missing dialogue is `l0_traider_armor.age`, referenced by `multiplayer/l14_2` for `L13_1.P517_Boat_Trader`. It is absent from both extracted and original `Data/scripts/dialogs` trees.

## AGE dialogue containers

Files named `*.age.cs` are binary dialogue containers, not C# source.

Verified facts:

- Every one of 556 files begins with a little-endian `uint32` equal to the file's exact byte length.
- 550 containers are plaintext and have six constant little-endian words after the length: `49, 1, 1, 7, 2, 3`. The other six use the same structure after decryption: for each byte at file offset `o ≥ 4`, plaintext is `ciphertext[o] XOR ((0x59 + o - 4) & 0xFF)`. These words are the beginning of records 0 and 1, not a separate file header.
- Every container starts with the same entry graph: record `0` is tag `49` with successors `(1, 1)`; record `1` is tag `7` with references `(2, 3, openingRecord, 4)`; record `2` is symbol `LastPhrase`; record `3` is numeric literal `0`. The formerly unexplained word immediately after the six-word prefix is therefore `openingRecord`, the nonzero successor selected when `LastPhrase == 0`; record `4` begins dispatch for nonzero incoming phrase IDs.
- After the length word is a contiguous typed-record stream. The parser consumes it exactly to the declared file size in every container; the record's ordinal position is its reference index.
- Tags `0`–`20` and `50` each contain four signed 32-bit record indexes. Tags `21` and `24` contain two 32-bit words. Tag `22` is a NUL-terminated CP1251 literal (possibly empty); tag `23` is a NUL-terminated ASCII symbol; tag `48` contains two branch references, a `float64` callee identifier, and up to nine argument references (normally terminated by `-1`); tag `49` contains two record indexes.
- `Server.dll` function `0x1403E020` allocates one 80-byte runtime node per serialized record, copies each payload, resolves every record ordinal to a node pointer, and initializes the runtime's root/current pointers from record `0`. It proves that the integer fields above are node references rather than offsets or values.
- The runtime evaluator in `Server.dll` function `0x1403A010` treats tags `0`–`20` as expression nodes; most use their first and second references as operands. Tag `50` assigns its second reference's value to the ASCII variable named by its first reference. Tags `21`/`24` are numeric `float64` literals; tag `22` is a CP1251 string literal; tag `23` reads a named variable; tag `48` invokes a registered function with up to nine argument-node references.
- The evaluator dispatch table at `0x14090580` names tags `0`–`20` exactly: `logicalOr`, `logicalXor`, `logicalAnd`, `bitwiseOr`, `bitwiseXor`, `bitwiseAnd`, `notEqual`, `equal`, `greaterOrEqual`, `lessOrEqual`, `greater`, `less`, `shiftLeft`, `shiftRightArithmetic`, `add`, `subtract`, `multiply`, `divide`, `modulo`, `bitwiseNot`, `logicalNot`. Arithmetic and bitwise operations convert operands to signed 32-bit integers; divide and modulo return `0` for a zero divisor. The inspector emits the matching `tagName` on every decoded record.
- `Server.dll` `0x14042464` registers the tag-48 callee IDs and their source names. The formerly unnamed generic gaps are exact: `0x01000000` is `Exit` and `0x01000003` is `Cmd`; `0x01000004` is `D_Say`, `0x01000005` is `D_CloseDialog`, and `0x01000006` is `D_Answer`. The same registry maps world, NPC, quest, time, trade, and UI API IDs to their source names. The inspector exposes each tag-48 `functionId`, `functionName`, branch references, and argument references in JSON.
- The dialogue loop at `0x1403D944` evaluates its current node, follows node pointer `+0x0C` for a nonzero result and `+0x08` for zero, then repeats. Tag `7` is therefore exact numeric equality: it compares its first two references and selects its nonzero/zero successors.
- Tag `49` evaluates to `0.0`; its two successor references are equal in the entry root, so record `0` unconditionally advances to record `1`. A newly loaded dialogue therefore enters its opening branch exactly when `LastPhrase` has the sentinel value `0`; later calls use the chain beginning at record `4` to dispatch actual phrase IDs.
- All 70,172 tag-23 symbols are now decoded. They include `LastPhrase`, `LastAnswer`, `result`, NPC ids, quest variables, and item ids.
- `public/assets/sdb/dialogs/dialogsphrases.sdb` has the normal `SDB ` header and maps 12,022 IDs in the range 1–17,103 to CP1251 dialogue phrases. A tag-7 `LastPhrase` comparison with a tag-24 `float64` literal identifies the incoming phrase ID. For example, `demon.d1.age.cs` recognizes IDs `2684`, `2702`, `2719`, and `5038`, which resolve to the demon's Russian dialogue. ID `0` is an unmapped sentinel.
- The zero callee ID is a compiler miss marker. The source-call parser at `0x140398FC` extracts the function identifier; `0x140399F0` looks it up in the name-to-ID map through `0x14006040`, explicitly supplying default value `0`. No failure branch follows the lookup. At `0x14039E0D` the returned integer is converted to `float64` and stored in the tag-48 runtime node, so an unknown source identifier loses its spelling and becomes serialized ID zero. During evaluation, `0x14039888` converts the ID back to an integer and queries the handler map through `0x14004F14`. ID zero is not registered; the miss path returns the `0.0` constant at `0x14090530`. These calls are therefore inert compiler output, not aliases for `Exit` or `Cmd`.
- All 51 zero-ID calls are reachable and split into six stable shapes: 28 attempted `Hero` base-attribute deltas of `+4` or `-4`; five item-ID lookups assigned to variables named `price`/`pric`; five `(person, 1)` calls matching the `RS_SetInjured` signature; two malformed boolean-helper calls; four `(location, person)` calls near quest activation; and seven `("L13_2", 2)` calls exactly matching the `RS_SetLocationAccess` signature. [INFERENCE] The last two named-signature groups are calls compiled before or without those API names in the compiler registry; the other four groups are misspelled, removed, or editor-only helpers whose original names cannot be recovered from `.age.cs` because compilation discarded them.
- The seven affected entries in `scripts.pak` and their path-matching copies in `scripts.update.3.pak` are byte-identical, proving the zero IDs are shipped content rather than extraction damage or a patch-overlay error. A separate root-level update entry, `scripts/dialogs/l1_2.p397_healer_experimentator.d397.age.cs`, is a different healer-dialogue revision with no zero-ID calls and four valid `RS_SetInjured` calls; it does not replace the affected `scripts/dialogs/l1_1/...` entry.
- The AGE files are not valid UTF-8 text.
- `Server.dll` `CBDialogServer::OpenDialog` candidate at `0x140441D8` constructs `scripts/dialogs/%s.cs`, reads that exact file, then calls the AGE loader at `0x14038958`. The loader chooses the plaintext parser when the first length word matches the supplied byte length; otherwise it selects the incremental-XOR decoder.
- The tag-48 handlers for `D_Say`, `D_CloseDialog`, and `D_Answer` at `0x1403FC10`, `0x1403FC60`, and `0x1403FC9C` all first call `0x14038C6C` with literal arguments `(1, -1)`. When that common selector permits execution, `D_CloseDialog` sets the `+0x5528` flag on the singleton at `0x14088DE8`. `D_Say` and `D_Answer` require its `+0x2CC` member, pass `DAT_14089740`, and respectively invoke `0x14043D44` and `0x14043CF8`; each returns a distinct static `float64` (`0x14091320`, `0x14091328`, `0x14091330`).
- `Exit` handler `0x1403FD38` accepts no AGE arguments. If a current AGE context exists at `0x14089740`, it sets global exit flag `0x14088DD8` to `1`, then returns `0.0`. `Cmd` handler `0x1403FDF4` uses the three-argument selector, then forwards the current AGE argument/context object and flag `1` to virtual slot `+0x10` of singleton `0x14088E2C`; it also returns `0.0`.
- `D_Say` starts a dialogue turn: `0x14043D44` clears the linked phrase list at dialog-object `+0x2C4`, clears the `+0x1BC` display buffer, then appends its phrase ID. `D_Answer` (`0x14043CF8`) only appends its phrase ID to that same list. Thus one `D_Say` followed by `D_Answer` calls represents one NPC phrase and its selectable player replies.
- The selected reply reaches AGE through handler `0x14043A74`: it stores its integer parameter in the `LastAnswer` variable, clears the close flag, and rebuilds dialogue state. Opening a dialog invokes that handler with `0`; the response path at `0x1402C767` validates the active dialog owner before passing the selected reply ID to it. No `LastAnswer` string is embedded in `Client.dll`, so the client communicates the numeric answer ID rather than evaluating AGE.
- The original time handlers are now mapped end to end. `RS_GetCurrentTimeOfDayI` returns the integer hour `0..23`; `RS_GetDaysFromBeginningI` returns complete elapsed days; `RS_GetDayOrNight` returns day for hours `6..19` and night otherwise. `RS_AddTime(hours, minutes)` takes two AGE arguments and advances the same game clock by `hours * 60 + minutes`; shipped calls include `(5, 40)`, `(4, 20)`, `(60, 0)`, and `(600, 0)`. The browser runtime no longer derives these values from the host computer's wall clock.
- `RS_SetWeather(mode)` maps `1` to rain, `2` to snow, and every other value to clear weather. The browser runtime updates the renderer snapshot immediately and starts/stops the recovered weather ambience (`sounds/weather/storm.wav` for rain) through the existing crossfade path.
- With `gv_addon=0` (the shipped base-game default), `RS_SetSpecialPerk(mask)` ORs the supplied power-of-two mask into the hero's persistent special-perk bitfield. With `gv_addon!=0`, the argument is instead a bit index and the engine stores `1 << index`. The 27 shipped calls use base-game masks from `2` through `8192`; repeated grants are idempotent. The browser runtime exposes the same split through its `addonMode` option and defaults to base-game semantics.
- `RS_AllyCmd(person, command)` resolves the six exact command strings to enum values: `CMD_ALLY_DO_NOT_FIGHT=0`, `CMD_ALLY_ALL_TARGET=1`, `CMD_ALLY_WEAK_TARGET=2`, `CMD_ALLY_HERO_DANGER=3`, `CMD_ALLY_HERO_TARGET=4`, and `CMD_ALLY_NOT_HERO_TARGET=5`. The recovered runtime stores the resulting command on the named ally rather than discarding it.
- `RS_GetDialogEnabled(selector)` uses speech skill index `21` as its hard gate: skill `0` always fails and skill `15+` always succeeds. Otherwise the original chance is `clamp(effectiveReputation + 4 * speech + 10 + itemSpecial54 + alchemyBonus + addonPerkBonuses, 0, 100)` percent. `effectiveReputation` is reputation plus item-special modifier `10`, gains `2` at speech `>=10`, and is rounded/clamped to `1..30`; alchemy skill index `16` contributes `20` at level `10+`. Only when `gv_addon!=0`, perk masks `0x10`, `0x100000`, and `0x200000` contribute `30`, `10`, and `15`. The chance is passed to the engine RNG as a `0..1` probability. The AGE selector argument is still validated and all 100 shipped calls pass one argument.
- `Client.dll` has no embedded `.age` pathname or direct AGE-loader label. Useful 32-bit image-base `0x12000000` analysis anchors are the debug registration of `d_create_dialogs_cache` at `0x12002FF8`, a candidate phrase-lookup function at `0x120A0B84`, and its phrase-error paths at `0x120A0F5A` and `0x120A17FF`.

Reusable structural and phrase validator:

```bash
node tools/inspect-age.mjs public/assets/scripts/dialogs
node tools/inspect-age.mjs public/assets/scripts/dialogs/demon.d1.age.cs --phrases public/assets/sdb/dialogs/dialogsphrases.sdb
node tools/inspect-age.mjs public/assets/scripts/dialogs/demon.d1.age.cs --phrases public/assets/sdb/dialogs/dialogsphrases.sdb --flow
node tools/inspect-age.mjs public/assets/scripts/dialogs --quiet --functions
node tools/inspect-age.mjs public/assets/scripts/dialogs --quiet --function RS_AddTime
node tools/inspect-age.mjs public/assets/scripts/dialogs --json
node tools/inspect-age.mjs public/assets/scripts/dialogs --quiet
```

Latest validation: all 556 containers parse structurally, have matching declared lengths, normalize to the standard leading records after applying incremental XOR where required, and satisfy the exact record-0-through-3 entry graph. JSON output exposes `entryGraph.openingRecord` rather than treating that variable word as header data. With `--phrases`, the tool renders every tag-7 `LastPhrase` comparison and its exact nonzero/zero branch record indexes. With `--flow`, it renders every flow node, conditional branch, assignment, and registered function call; phrase text is attached to `LastPhrase`, `D_Say`, and `D_Answer` IDs. `--functions` reports the 42 named functions actually present in the shipped AGE corpus plus the zero-ID compiler misses; `--function <name>` prints every decoded call with exact arguments where statically evaluable.

AGE is an expression and control-flow graph: each node's numeric result selects one of two successor pointers. The loader starts at record `0`; the dialog engine supplies `LastPhrase` and `LastAnswer`; AGE scripts inspect them, call engine functions, and assign scenario variables.

## Dialogue ABI and packet bridge

`GoldenLand.exe` resolves `GetClientAPI` and `GetServerAPI` and calls both exports as `__cdecl void Get*API(HostAPI *host, ModuleAPI *out)`. The shared host table is at `0x46C200`; the returned Server and Client API tables are stored at `0x46D820` and `0x46D840`. The host then calls each returned table's `+0x04` initializer. Dialogue traffic does not use a callback registered in `HostAPI`: the Client export places its facade object at Client API `+0x18`, while the Server export places its facade object at Server API `+0x10`.

The Server and Client still share the same fixed C-style dialogue snapshot. The Client view begins four bytes after the Server dialog object's vtable; `Server.dll` `0x14043220` rebuilds the object and `Server.dll` `0x1404476C` copies `0xAF` dwords from object `+0x04` into the exported snapshot.

| Client payload offset | Server object offset | Meaning |
| --- | --- | --- |
| `0x00` | `0x04` | Monotonic dialogue update counter. |
| `0x04` | `0x08` | Current NPC phrase ID; `0` means no phrase. |
| `0x08` | `0x0C` | Number of selectable replies. |
| `0x0C` | `0x10` | Dialogue context value; its higher-level semantics remain unknown. |
| `0x10` | `0x14` | Dialog-owner/entity value used by the Client's phrase UI. |
| `0x14..0xB0` | `0x18..0xB4` | Up to 40 `int32` reply phrase IDs. |
| `0xB4` | `0xB8` | `uint8 substitutionBlobByteLength`, followed at `+0xB5` by concatenated `token\0replacement\0` pairs. The pair count is not exported. |

The relevant facade slots and exact call shapes are:

| Direction | Returned API entry | Virtual slot | Target | Observed ABI |
| --- | --- | --- | --- | --- |
| Server -> host | Server API `+0x10` object | `+0xB8` | `Server.dll` `0x1402C5AC` | `void __thiscall snapshot(int32 playerSlot, DialoguePayload *out)`; invalid or unrelated slots receive a zeroed `0x2BC`-byte payload. |
| Host -> Client | Client API `+0x18` object | `+0xB4` | `Client.dll` `0x120C706C` | `void __thiscall apply(const DialoguePayload *payload)`. |
| Client -> host | Client API `+0x18` object | `+0xB8` | `Client.dll` `0x120C7060` | `uint32 __thiscall pollSelectedReply()`; the reply is returned once. |
| Host -> Server | Server API `+0x10` object | `+0xBC` | `Server.dll` `0x1402C6A4` | `void __thiscall submitReply(int32 playerSlot, int32 replyId)`. |

The Client facade vtable begins at `0x121332A0`; `+0xB4`, `+0xB8`, and `+0xBC` resolve to `0x120C706C`, `0x120C7060`, and the adjacent one-shot UI-event poller `0x120C7048`. The Server facade vtable begins at `0x14092EA0`; its dialogue slots resolve to `0x1402C5AC` and `0x1402C6A4`. The previously identified `0x12133354` is therefore Client-facade vtable slot `+0xB4`, not the start of a separately registered callback table.

`GoldenLand.exe` bridges those calls through its packet dispatchers, even for the local in-process composition:

- At `0x415365`, it calls Server virtual slot `+0xB8` for a player slot. A nonzero update counter causes packet opcode `12` to be emitted. The compact wire form is `uint32 updateCounter`, `uint16 phraseId`, `uint8 replyCount`, `replyCount * uint16 replyId`, `uint32 context`, `uint8 owner`, then two length-prefixed tail byte regions reconstructed at payload offsets `+0xB4` and `+0x1B8`.
- Client packet dispatcher jump-table index `12` reaches `0x411410`; `0x411524` invokes Client virtual slot `+0xB4` with the reconstructed `0x2BC`-byte snapshot. `Client.dll` `0x120A0F9C` ignores an unchanged update counter, resolves phrase IDs locally, and updates the dialogue UI.
- `Client.dll` `0x120A2334` returns the selected phrase ID once and clears its pending field. `GoldenLand.exe` `0x40EDC6` polls Client virtual slot `+0xB8`; a nonzero result is encoded as packet opcode `6` followed by one little-endian `uint32` reply ID.
- Server packet dispatcher jump-table index `6` reaches `0x416686`; `0x416723` calls Server virtual slot `+0xBC` with `(playerSlot, replyId)`. The wrapper validates the player slot and active dialog owner, then calls `Server.dll` `0x14043A74`, which updates `LastAnswer` and rebuilds the dialogue snapshot through `0x14043220`.

Thus the complete turn is AGE -> Server snapshot -> opcode `12` -> Client UI -> opcode `6` -> Server `LastAnswer`. The DLL boundary is an in-process C ABI, but the host bridge itself is a compact bidirectional packet protocol rather than a direct payload handoff. `demon.d1.age.cs` supplies a representative turn: `D_Say(2684)` followed by `D_Answer(2686)` and `D_Answer(2696)` becomes one current-phrase ID and two reply IDs in the snapshot.

### Dialogue substitution and voice tail

`Server.dll` `0x14043638` resolves phrase substitutions before publishing a snapshot. It fetches the phrase text by ID, scans for `%%`, and takes the following non-whitespace bytes as the variable token. Resolved pairs are first retained in Server-only `0x104`-byte slots; `0x14043B02..0x14043BFE` then concatenates every `token\0replacement\0` pair at Server object `+0xB9` and writes the concatenated byte length, excluding the leading length byte, to object `+0xB8`. Consequently Client payload `+0xB4` is definitively a byte length, not a pair count. Observed resolver types are signed integer (`%i`), unsigned integer (`%u`), numeric (`%g`), string (`%s`), and the special token `HeroName`.

`GoldenLand.exe` opcode `12` writes that length and exactly that many bytes; `0x411410` reconstructs them unchanged at Client payload `+0xB4/+0xB5`. `Client.dll` `0x120A0F9C` nevertheless reuses the byte length as its pair-loop bound. After the real pairs are consumed, the zero-filled fixed snapshot produces empty token/value pairs. The renderer at `0x1209FF10` uses the same inflated bound but encounters real keys first, so the empty padding entries are benign. This is a shipped count-versus-length bug/quirk, not an unknown wire convention.

The second tail region at payload `+0x1B8` is a dialogue voice basename. Server setter `0x1404345C` strips a three-character filename extension when present. Opcode `12` sends `uint8 basenameByteLength` plus the basename bytes, and the Client formats `sounds\\dialogs\\%s.wav` before starting playback.

`dialogsphrases.sdb` contains 12,022 records; 104 phrases contain 105 `%%` markers, with at most two markers in one phrase. The shipped markers are predominantly `HeroName`, with additional `money`, `price`, and `race_race` variables plus three malformed punctuation/spacing variants. Twenty-nine decoded `D_Say` callsites use nine of those substituted phrase IDs. Phrase `85`, used by `l1_1.p387_poison_plotnik.d387.age.cs`, is a reproducible example. Emulating `HeroName -> Hero` produces a 14-byte blob `HeroName\0Hero\0`; the Client performs 14 iterations, yielding one real pair followed by 13 empty pairs.

The browser runtime now consumes these fields directly from AGE execution: phrase rendering replaces each shipped `%%` token through scenario variables (with `HeroName` supplied by the player identity), while `D_PlaySound` resolves its Windows-style relative path below `sounds/dialogs`, stops the preceding voice, and plays the extracted WAV/OGG asset through the shared Web Audio implementation.

## Interface, person sound, magic, and encounter resources

The browser now renders the shipped `main_menu.scr`, `options_menu.scr`, `about_menu.scr`, and `game_menu.scr` declarations through one `OriginalGuiLayer`. `GUI_SIMPLE_BUTTON`, `GUI_CHECK_BUTTON`, and `GUI_SLIDER` use their authored 1024-by-768 bounds and referenced lighted/pressed images. The options panel is shared between the title and in-game menus, persists the original control values, and applies brightness immediately. Escape opens the in-game menu; its save, load, settings, main-menu, and exit actions are wired to the existing runtime.

The in-game pause menu is now positioned only from shipped/native evidence. `game_menu.scr` supplies the six `195x61` controls at x `412`: save/load/settings/menu/exit at y `120`, `185`, `250`, `315`, `380`, and back at y `483`. Client constructor `0x1208a1d0..0x1208a25a` loads `engineres\interface\game_menu\background` with color key `0xff00ff`; renderer `0x1208a264..0x1208a366` adds `(0x180,0x5a)` to the viewport origin, establishing the background rectangle `(384,90,249,460)`. Handler `0x12089c90..0x12089e60` confirms object roles `1=back`, `2=save`, `3=load`, `4=settings`, `5=main menu`, and `6=exit`. The former percentage rectangle `(387,85)`, `translateY(-1.3%)`, and invented full-screen black veil have been removed. The button captions use the shipped `button_heads_interface` font (`pala.ttf`, 18, weight 600).

The rest panel is likewise native-coordinate driven. `relax.scr` owns left/right selectors `(380,331,23,29)` and `(489,331,23,29)`, sleep `(458,381,100,38)`, cancel `(482,428,46,42)`, plus logical calendar/period hitboxes `5` and `6`. Client framebuffer setup `0x12099222..0x12099259` establishes `(367,286)-(657,482)`, exactly matching the shipped `290x196` `engineres\relax\Normal.bmp`; constructor `0x120995bc..0x1209967d` requests color key `0xff00ff` even though the retained bitmap contains no magenta pixels. Native text helpers use smaller draw rectangles than the SCR hitboxes: calendar `(524,319)-(637,370)` at `0x12099d6e..0x12099db2`, and period `(407,335)-(483,357)` at `0x12099e5f..0x12099eae`. Both select `main_interface` (`pala.ttf`, 12, weight 500).

The former browser range `1..24` with wraparound and default `8` was not native. Constructor `0x120990d6..0x120990f2` writes minute choices `60`, `180`, `360`, `720`, and `1440`; field `+0x18` starts at index zero, and handlers `0x1209a00c`/`0x1209a01c` clamp rather than wrap. The period renderer divides the selected value by 60 and formats only `%d`, so the browser now displays `1`, `3`, `6`, `12`, or `24` without the invented `ч.` suffix. Native calendar formatting is `%d %s %d %d:%02d` with month names from SDB IDs `87..98`; the clean-room persistence model currently retains only elapsed day and minute-of-day, so its calendar text keeps that reduced information while using the recovered Client rectangle and font.

The NPC dialogue window now follows the native HUD composition instead of the former responsive card. `dialog_panel` is resource-table entry `0x120f8244`, loaded by the 18-entry loop at `0x1204e0f3..0x1204e124`. HUD renderer `0x1204d38e..0x1204d418` draws it at viewport origin plus `(0xc5,0x1ff)`, giving the exact shipped rectangle `(197,511,627,207)`. `gpanel_new.scr` supplies the dialogue scrollbar rather than a browser scrollbar: up object `44` `(744,525,20,15)`, down object `45` `(745,692,20,15)`, and vertical slider object `46` `(745,546,20,140)`. The browser now executes those three controls through `OriginalGuiLayer`.

An original 1024-coordinate dialogue capture corroborates the content bounds `(212,522)-(740,696)`: text begins 15 pixels inside the native panel and ends before the authored scrollbar. It also confirms that the speaker name is inline with the phrase, responses use ordinary `1.`, `2.` list numbering, and there is no separate uppercase header, shortcut badge, CSS border, drop shadow, or responsive repositioning. Dialogue copy now uses `main_interface` (`pala.ttf`, 12, weight 500), the native black text treatment, and the shipped scrollbar controls; hovered/focused responses use the recovered Client list-selection blue rather than a fabricated parchment button.

The dialogue-side trade shortcut is shipped `gpanel_new.scr` object `15`, not part of the painted BMP: `(773,581,33,73)`, initially disabled, with pressed resource `engineres\gpanel\pressed_but`. Native event path `0x12056c18..0x12056c9d` handles object `15` only while a dialogue speaker is active, compares that speaker against the four current merchant slots at server-state offsets `+0x6a0..+0x6ac`, and dispatches host action `6` or `7`. The clean-room equivalent enables object `15` only when the active level person has a shipped `scriptInventory`, then routes it through the existing `openCurrentTrade` → `onTradeRequest` → `ItemTransferPanel` path. Browser verification with `L1_3.P1_Kotar` measured `(773,581,33,73)`, exposed the authored pressed image and opened the populated trade interface.

The persisted options are also runtime inputs rather than a menu-only façade. Sound, music, and dialogue sliders set their independent playback gains; animation speed scales actor movement and sprite playback; edge-scroll speed drives the original seven slider steps; always-run changes path requests; hints suppress hover status publication; and object transparency changes foreground occluder compositing. The world clock now advances continuously at one game minute per real second while simulation is running. The HUD rest command advances eight hours through the same clock path, so regeneration and timed magic effects observe both realtime and explicit waiting.

`tools/audit-interface-assets.mjs` performs a repeatable conservative reference audit across `engineres/interface` and `engineres/gpanel`, including authored GUI scripts, runtime path suffixes, numbered loading/about families, and dynamically named spell icons. Of 628 shipped interface assets, 556 are currently referenced and 72 remain candidates rather than proven garbage. The candidates are retained: they include notification/status icons, ally and combat-detail panels, legacy BMP loading-screen duplicates, old HUD revisions, multiplayer/player-selection backgrounds, and five apparently mistyped spell-icon variants. They are inputs for unfinished original subsystems or archival leftovers, not safe deletion targets during fidelity work.

Person sound bundles (`scripts/shaders/persons/*.pssh`) are parsed as nested sound-shader blocks, including `random` wave selection, 3D distance, volume, EAX, loop flags, and animation step frames. Person combat resources now load the corresponding `persons_res/*.prs`, including height, death/container flags, attack application frames, body parts, materials, and all referenced `.ssh` files. Successful and missed attacks choose `attack_0.hit` and `attack_0.miss` respectively and play the extracted wave through the level audio host. Corpus validation: all 277 PRS files parse; their 3,188 shader references resolve.

Inventory-adjacent interaction panels now reuse the shipped authored layouts instead of generic overlays. The player inventory renders `inventory.scr` over `inventory.bmp`; barter renders `trade.scr` over `trade.bmp`, moves selected stacks in both directions through the runtime inventory ledger, and preserves the original item-strip/equipment-slot geometry; corpse and container looting uses the HUD-authored `gpanel_new.scr` controls over `gpanel/exchange.bmp`: object `22` is the source strip, `23` is the hero strip, `9`-`12` page them, `20` transfers all items, and `21` closes the exchange. Person death is a persistent renderer state: dead actors stop moving and accepting attacks but remain targetable with the take cursor. A corpse is lootable only when its parsed PRS declares `container_after_die` and its SEF person record supplies `scr_inv`; that inventory is initialized once and then retained after transfers. The original does not replace the scene with a dedicated game-over artwork: Server `0x140351c6` queues UI packet type `6` and `0x140351d1` assigns SDB string `212`, `Игра окончена.`. Type `6` is the same notification channel used for ordinary gameplay errors. The browser therefore keeps the HUD and the actor's final death frame visible, publishes `Игра окончена.` in the authored status bar, closes active interactions, and rejects further world clicks while the hero is dead; loading a save rebuilds the level and clears that renderer state.

The browser combat runtime now uses the recovered Server formulas directly. Maximum health is `50 + 14 * constitution`; maximum energy is `10 + 2 * wisdom + 2 * intelligence`; action points are `20 + 1.5 * dexterity + 1.9375 * skill_athletic`; armor class is `0.6 * dexterity + 1.775 * skill_athletic`; initiative is `5 + 0.9 * dexterity + 0.15 * perception + 1.14 * skill_tactic`. With nonzero `skill_athletic`, the native health-regeneration interval is `clamp((6 - 0.1 * (constitution + skill_athletic)) * (skill_athletic > 9 ? 0.5 : 1), 1, 20)` minutes. With nonzero `skill_smith`, the energy interval is `clamp((6 - 0.1 * (effectiveWisdom + skill_smith)) * (skill_smith > 9 ? 0.5 : 1), 1, 20)`, where `effectiveWisdom = wisdom + (skill_speech > 4 ? 1 : 0)`. The Server advances each resource by `floor(elapsedMinutes / interval)` up to its maximum; the browser runtime preserves the fractional remainder and timed magic can alter either interval while active. Hit chance, critical chance/damage, critical miss, the separate crushing/hacking/pricking channels, item modifiers, weapon AP cost, monster `.inf` overrides, selected person weapons, and resistances are applied before health is synchronized back into scenario parameters. The HUD exposes rounds and remaining AP; the combat button or an attack click starts combat, Shift-click forces an attack, and Space ends the hero turn. Enemy turns use recovered initiative/AP profiles. Attacks drive the shipped PAD `attack`/`suffer`/`die` animations and the attack, miss, suffer, and death shaders referenced by PSSH/PRS resources.

Magic `.mdf` files begin with `MDF ` followed by twelve observed little-endian 32-bit header words; the first word is the effect duration in milliseconds. Their variable records contain length-prefixed CP1251 sprite paths below `magic/bitmap`; shipped header variants place the first record at different offsets. Sprite records expose an active interval at path-end offsets `+40` and `+80` and a frame-count/index hint at `+56`. The runtime scans the validated length-prefixed records, resolves each vertical sprite strip from the local hint or the matching shifted header frame-count pair, caches decoded layers, and composites the active frame at the caster-selected world target. Corpus validation: all 97 MDF files parse, yielding 155 sprite references, and every referenced bitmap resolves. Browser verification loaded all 78 player-spell MDF animations without failure and rendered a representative frame to 8,930 visible pixels.

Global-map `czdescriptions/*.dsc` files define an overall encounter chance and `evil`/`good` sides. Each side declares a priority, group count, and repeated `person` records containing technical name, group, chance, and weight. Corpus validation: all 22 files parse, containing 177 person records.

## Native oracle verified composition

The 32-bit oracle now loads the hashed `Server.dll` and `Client.dll` exports without launching `GoldenLand.exe`. `GetServerAPI` writes entries at `+0x04`, `+0x08`, and `+0x0c`; `GetClientAPI` writes entries at `+0x04`, `+0x08`, `+0x0c`, `+0x10`, `+0x14`, and `+0x30..+0x54`. The recovered HostAPI layout has object pointers at offsets including `+0x04`, `+0x10`, `+0x14`, `+0x1c`, `+0x8c`, `+0x94`, and `+0xa4`; `+0x10` is the first object consumed by `Server.dll`, not a direct callback function pointer.

The full-object vtable calls observed during API composition use three forwarded stack arguments with `thiscall` cleanup. The deterministic trace reaches vtable byte offsets `4`, `12`, `16`, and `20` (slots 1, 3, 4, and 5), then returns from both exports and emits `oracle_complete initialized=false`. The raw capture is `tools/native-api-composition.ndjson`; its stable comparison form is `tools/native-api-composition.normalized.ndjson`. The clean-room AGE trace is preserved in `tools/demon-age.clean-room.ndjson`. A server-only native probe now invokes the recovered `D_Say` (`Server.dll+0x3fc10`) and `D_Answer` (`Server.dll+0x3fc60`) entrypoints after `GetServerAPI`; both return the native zero/default result without an active dialogue context.
The native oracle now completes both `GetServerAPI` and `GetClientAPI` composition with split HostAPI object facades. Provisionally, the allocator thunk is modeled as x86 `thiscall` with three stack arguments and uses CRT-owned zeroed `calloc` memory, with a `0x10000` minimum/fallback and a bounded requested-size path; the request-size interpretation still requires native confirmation. Slot `+0x08` is an explicit one-argument `thiscall` fail-closed no-op returning `0`; its native ownership/free semantics remain unconfirmed. The `+0x14` thunk remains three-argument for the full object, while the object supplied at HostAPI `+0x04` uses a two-argument query thunk. The apparent two-push sequence immediately before `Client.dll+0x2586` is preceded by `push $0xa` at `Client.dll+0x2576`; the complete call therefore supplies three stack arguments: type, default/source pointer, and key pointer. With `.tmp/native-oracle.exe --game-root E:/Games/zlato22 --host-facades --initialize`, the Server initializer at `Server.dll+0x5cd60` returns cleanly and the Client initializer at `Client.dll+0xc9cc0` is entered, then faults at `Client.dll+0x26220` during an invalid-pointer char-copy loop (`edi=4`). Raw stdout is `.tmp/native-oracle-init.stdout.ndjson`, raw stderr is `.tmp/native-oracle-init.stderr.log`, and the combined `.tmp/native-oracle-init.log` includes wrapper markers. Static Client evidence identifies a confirmed candidate for the missing contract: `Client.dll+0x2586` calls the full-object `+0x14` host method and stores its return in `0x12106bb8`; the verified excerpt `.tmp/Client.initializer.dis` shows the initializer consuming that global at `Client.dll+0xc9d0e` (`mov ebx,[0x12106bb8]`) and incrementing it at `+0xc9d44` (`add ebx,4`) before the invalid copy. The adjacent Client data at RVA `0x122704` begins with the ASCII keys `gv_Title`, `gv_double_click_speed`, and `gv_mouse_speed`; the `gv_Title` call supplies type `0xa`. A temporary non-null two-word return probe advanced the initializer past the original null-pointer fault but then faulted at an external stack address, so that probe is not accepted as recovered semantics. A separate trace marker on the short-object query thunk shows four two-argument query calls and sixteen full-object slot-5 calls during the same initializer; the short query remains a fail-closed boolean-style `0` until its key/out-pointer contract is recovered. A second isolated probe replaced the short object's slot `+0x04` handler with a two-argument fail-closed thunk while returning a non-null full getter object; it reached 168 such calls and advanced to `Client.dll+0x229c7`, where a zero divisor/context field faulted. A third probe additionally returned `g_hostResultObject` from full slot `+0x0c` and set its field `+0x88` to float `1.0`; this passed `Client.dll+0x229c7` and reached `Client.dll+0x2529d`, where a subsequent object pointer at `this+0x443c` was null/invalid. This confirms the `+0x88` field was an immediate missing prerequisite, but the object and slot contracts remain unproven, so none of these probe changes are landed. The exact return value/effect required from the full-object `+0x14` method remains unvalidated; it is the next target, not allocator sizing or caller ABI. `currentStackPointer()` has real ESP implementations for both GCC i386 and MSVC x86; no MSVC compiler is installed here, so only the GCC build is toolchain-verified.
The latest read-only initializer capture is `.tmp/native-oracle-init.baseline.stdout.ndjson` (SHA-256 `f41405e275bee6c3152076b64eb7a94204bcecb98f3645e3029ca3a2acf409c9`) plus `.tmp/native-oracle-init.baseline.stderr.log` (SHA-256 `ace1281b719c5b6c62596ffdcfa50c732e602d0b01e55c0bcc27a56a3d8ab9ef`). It contains 945 JSON events and 910 host calls; the deterministic fault remains `Client.dll+0x26220`, `edi=4`. Static Server callsites `Server.dll+0x3ac7` and `+0x3adf` each show three pushes before `call *0xc`: `0`, default float `0x3f800000`, and key pointer. The slot `+0x0c` call is therefore currently treated as a three-stack-argument `thiscall` in the oracle; the apparent two-argument reading omits the preceding zero push.
Static Client evidence now identifies the `this+0x443c` chain as DirectDraw COM state, not a HostAPI slot return. The constructor at `Client.dll+0x26658` writes vtable `0x121243a0`, clears the `0x4400`-byte object through `Client.dll+0xf175c`, and zeroes `0x4430`/`0x443c`; the reinitialization thunk begins at `Client.dll+0x267b4` and repeats the vtable assignment. The initializer later calls the object at `this+0x4430` with descriptor `0x120f5330` and output pointer `&this->0x443c`; the descriptor bytes decode to IID `IDirectDrawGammaControl` (`{69C11C3E-B46B-11D1-AD7A-00C04FC29B4E}`). `Client.dll+0x25290` subsequently calls vtable offset `+0x10` on that gamma-control interface, consistent with `SetGammaRamp`; the prior `0x2529d` probe fault was a null/invalid gamma interface, not evidence for another HostAPI slot contract.
An isolated fake-COM probe confirmed the boundary: replacing the HostAPI result object's vtable did not produce any `QueryInterface` marker during initializer execution, and the run still faulted at `Client.dll+0x2529d`. Therefore the `0x4430`/`0x443c` object is not directly the provisional HostAPI result facade; its construction must be traced through the Client internal object at `0x4424`/`0x4428` before any COM shim is accepted.
The `Client.dll+0x26194` string-copy helper has one direct x86 `call` reference, at `Client.dll+0xc9d60`. Its first stack argument is read from `0x30(%esp)` after the helper prologue and copied into the local source pointer at `0x4(%esp)`; the caller supplies that argument from `EBX`. Immediately before the call, `EBX` is loaded from `0x12106bb8`, advanced by `add $0x4`, and then pushed. Therefore the baseline `edi=4` fault is the first helper argument produced by the unresolved full-object `+0x14` getter, not an unrelated sixth argument or the DirectDraw `0x443c` chain.
An isolated vtable-identity marker confirmed the failing path uses `g_hostObjectVtable[5]`, not the short facade: the initializer produced 16 full-object slot-5 calls and 4 short-object slot-5 calls, while the crash remained at `Client.dll+0x26220`. The `Client.dll+0x2589` value therefore must be fixed in the full-object `+0x14` contract; aligning the short vtable cannot resolve this fault.
The same marker also separated caller modules: of 16 full-object slot-5 calls, 8 came from `Server.dll` and 8 from `Client.dll`; all 4 short-object slot-5 calls came from `Server.dll`. The failing Client call is exactly `Client.dll+0x2589`, with decoded arguments `(key=0x12122704, default/source=0x12122710, type=0xa)`, and it writes `0x12106bb8`. This is the direct native proof that the full-object `+0x14` getter, not the short facade, produces the bad pointer.
A narrow full-slot probe used the confirmed `(key, defaultValue, type)` ABI, returned a heap object of size `0x90`, and set field `+0x04` to `defaultValue` for `type=0xa`; the short facade was untouched. This removed the original `edi=4` fault at `Client.dll+0x26220`, but the initializer then faulted at an external stack address. The result confirms that a non-null `+0x04` source is necessary but not sufficient; object ownership/layout or a subsequent full-slot contract remains unresolved, so the probe was removed.
A second isolated probe used a static full-object result with the same header and `+0x04` field instead of heap allocation. It produced the identical transition: the `Client.dll+0x26220` string fault disappeared, execution advanced through the remaining initializer, and the run ended at an external stack-address fault. This rules out allocator lifetime as the immediate cause and moves the next native boundary to the subsequent Client graphics/DirectDraw setup.
Setting the returned config object's `+0x04` field from `defaultValue` for every observed full-slot type (`0`, `2`, `6`, `0xa`) also left the trace unchanged: the string-copy fault stayed eliminated, but the run stopped at the same external stack-address boundary. The remaining failure is therefore not caused by a missing type-specific source pointer in this startup path.
The short facade is a separate ABI: its four observed `Server.dll+0x60c5` slot-5 calls supplied two forwarded arguments, and the isolated short marker used `thiscall(void*, uintptr_t, uintptr_t)` without changing the clean baseline. It must not be widened to the full-object three-argument config signature; doing so would introduce stack cleanup mismatch rather than fix the Client fault.
The oracle now keeps the validated differential path behind `--probe-config-object` without changing the default baseline: full slot `+0x14` returns a static object whose `+0x04` points to the confirmed default string; the short facade slot `+0x04` uses a two-argument boolean check; full slot `+0x0c` returns the result object with `+0x88 = 1.0`. The staged trace advances through `Client.dll+0x26220`, the second short-query copy at `Client.dll+0xbf017`, and the divisor at `Client.dll+0x229c7`, then reaches the unresolved `Client.dll+0x2529d` call where `this+0x443c` is still null. The default invocation remains the clean 945-event baseline.
The slot `+0x0c` ABI is not yet cut over: Server callsites such as `Server.dll+0x3ac7` push three forwarded values, while the Client initializer at `Client.dll+0x250d..+0x2517` pushes only `(defaultFloat, key)` before `call *0xc`. The optional probe currently uses the three-argument resource-shaped thunk because it preserves the Server path; a production dual-ABI vtable or per-interface object split is still required before this boundary can be declared recovered.
An optional direct graphics probe replaced the `mov eax,[this+0x443c]` load at `Client.dll+0x25294` with a fake object carrying a two-argument `thiscall` slot `+0x10`. The fake method was reached from return site `Client.dll+0x252a2`, proving the null dereference boundary is bypassable, but execution then faulted at an external stack address. The next unresolved contract is therefore the caller-visible result/state after the `+0x10` graphics method, not the existence of `0x443c` alone.
The fake COM method must use `WINAPI`/stdcall, not `thiscall`: the native call explicitly pushes `this` before invoking the COM vtable. With that correction, the staged probe reaches `Client.dll+0xc9e66`, where the object vtable slot `+0x68` is called with one pushed argument (`thiscall`). A one-argument slot-26 probe and the graphics-state handoff then allow the Client initializer to continue through 1,120 events and 1,085 host calls without an access violation; the process exits with code `116` before emitting `oracle_complete`. The clean default remains 945 events and the original `Client.dll+0x26220` fault.
The Client resource ABI is now split by operation and interface. Resource open at `+0x14` is a callee-cleaned `thiscall(void*, path, default)`, resource length at `+0x08` is `thiscall(void*, resource) -> byteLength`, resource read at `+0x20` is `thiscall(void*, buffer, size, resource)`, and resource release at `+0x18` is `thiscall(void*, resource)`. The previous zero-return `+0x08` stub caused the initializer to allocate one byte and loop forever on `scripts\\shaders\\save_slot_focus.ssh`; returning the shipped resource length removed that stall.
Client `GetClientAPI` copies host offsets `+0x24`, `+0x70`, and `+0x74` into the file-interface globals `0x12110eec`, `0x12110ce8`, and `0x12110ce4`. Their `+0x28` method receives `(index, buffer, 0x104)` and their `+0x2c` method receives `(buffer, outIndex)`; dedicated Client file-object vtable entries now provide the correct callee cleanup and fail-closed zero result. The shared host-object `+0x4c` method is a one-argument output/time query; returning `GetTickCount()` prevents the Client update loop from stalling.
With these contracts, the oracle crosses the prior `focus.csx`/`0xc8` boundary and loads at least `0xb4` resources, including `engineres\\fonts\\ttf\\pala.ttf`, `engineres\\status_bar\\main2.csx`, `main3.csx`, and `scripts\\shaders\\save_slot_focus.ssh`. The next boundary is graphics/font ownership: `Client.dll+0x30181` dereferences state field `+0x4434`; the optional graphics probe supplies a fake object with slots `+0x44` and `+0x68`, after which a separate font-object failure remains.
Clean-room SCR execution no longer fabricates success for unrecovered host calls. `wd_setcellsgroupflag`, `le_casteffect`, `le_castmagic`, and `le_deleffect` now fail explicitly with an ABI-unavailable error; recovered handlers remain executable. This makes missing native semantics observable instead of silently mutating scenario state.
Returning success from the full-object `+0x08` release probe advances the Client initializer beyond the previous code-116 stop to 1,410 events / 1,375 host calls, confirming that `Client.dll+0x3f3d` expects a truthy release result. `GetClientAPI` then provides the next object source: at `Client.dll+0xc9a8f`, global `0x121109a4` is assigned from host-table offset `+0x14`, not from `+0x8c`. GoldenLand constructs this object from a 0x20-byte allocation with vtable `0x47f808`; its vtable `+0x30` method resolves SDB records and returns the record's `char*`. The loaded `sdb\user_interface.sdb` records prove selector `0x8f` is record 143 (`Вы хотите выйти?` in CP1251 bytes) and selector `0x8e` is record 142 (`Выход из игры`). The clean-room probe now returns those stable strings and reaches the same later resource loop, so the slot ABI and selector semantics are recovered while the subsequent resource-owner contract remains open.
The optional `--probe-config-object` trace supplies the recovered script-registry facade at Client HostAPI `+0x9c`: the registry object uses the native three-argument vtable family, with lookup-pair at slot `0`, lookup-value at slots `2`/`4`, and resolve-value at slot `6`. The final reproducible trace reaches the shipped `scripts\magic_schools.scr` resource and then hits a null indirect call at `Client.dll+0x12088ec1` through global object `0x12110f48`, vtable slot `+0x6c`; this is the unresolved Client-owned graphics/font object, not a HostAPI `+0x90` slot. Experiments with a generic full-object facade and embedded result storage were discarded; the default oracle remains unchanged.
Static Client disassembly now gives a partial vtable inventory for global `0x12110f48`: slot `+0x04` receives one output-pointer argument (`Client.dll+0x12034cef`, `+0x12036bd9`); `+0x08` receives two arguments (`+0x12036d2d`); `+0x0c` receives one selector/value (`+0x1202de7d`); `+0x30` receives one argument (`+0x12088f1a`); `+0x44` is called without stack arguments (`+0x12036d38`); `+0x5c` is called without stack arguments (`+0x12036d77`); `+0x68` receives one argument (`+0x120c9e66`); and `+0x6c` is called without stack arguments (`+0x12088ec1`). The same `+0x6c` byte offset is used by other graphics objects with an explicit object push, so these interfaces require separate object identities and per-slot calling conventions.
An isolated `--probe-config-object` facade wired through HostAPI `+0x90` with those per-slot shapes advances the native initializer from `scripts\magic_schools.scr` to 861 resource opens, ending at `engineres\interface\save_load_menu\page4_down.csx`. It passes the former null `+0x6c` call, then fails on a subsequent heap-derived invalid target whose low word is consistently `0x027f`; the facade is retained only behind the differential probe flag and is not treated as recovered production behavior.

## Native Client initializer completion (2026-07-25)

The former `0x027f` target was stack damage caused by assigning the generic three-argument `thiscall` thunk to Client HostAPI `+0x14`, vtable slot `+0x30`. Client callsites, including `Client.dll+0x88f1d`, push exactly one argument. A dedicated one-argument `thiscall` slot removes the over-cleanup and advances initialization beyond `scripts\magic_schools.scr`.

Client state field `+0x4424` is `IDirect3DDevice7`, not a proprietary event interface. The object is produced by `IDirect3D7::CreateDevice` at `Client.dll+0x245ec` / `+0x25027`: the class GUID is `f5049e78-4861-11d2-a407-00a0c90629a8` (`IID_IDirect3DTnLHalDevice`), the render-target surface is passed as the second argument, and `&state[+0x4424]` receives the device pointer. The recovered vtable mapping follows the published D3D7 ABI: `+0x0c = GetCaps(D3DDEVICEDESC7*)`, `+0x10 = EnumTextureFormats(callback, context)`, `+0x24 = GetRenderTarget(IDirectDrawSurface7**)`, and `+0x34 = SetViewport(D3DVIEWPORT7*)`. The surface returned by `GetRenderTarget` is then queried through its own `IDirectDrawSurface7::GetSurfaceDesc` slot at `+0x58`; it remains a separate interface identity from the Client-owned graphics object at state `+0x4434`.

The resource read slot at HostAPI `+0x04`, vtable `+0x20`, has `fread` semantics: it returns the actual number of bytes copied and permits a short final read. This is required by the shipped `engineres\interface\test.f2d`: the file is `0xe1c` bytes, Client first reads its `0x2c`-byte header, then requests `0xe00` bytes and accepts the remaining `0xdf0` because the result is nonzero. Full-buffer callers such as the GUI script loader separately require `returned == requested`.

With those contracts, the Win32/x86 oracle command `native-oracle --game-root E:/Games/zlato22 --asset-root G:/ws/zlato2/public/assets --host-facades --probe-config-object --initialize --quiet-stubs` exits successfully. The final trace records 925 resource requests, resolves 914 of them, directly loads `scripts\ui\main_menu.scr` and `scripts\weather.scr`, records no unhandled exception, returns from the Client initializer at `Client.dll+0xc9cc0`, and emits `{"event":"oracle_complete","initialized":true}`. The 11 fail-closed misses are three unavailable loading-background requests and eight empty `.csx`/`.bmp` requests. The clean-room `parseGuiDefinition` path executes the same CP1251 `main_menu.scr` and yields six buttons with IDs `1..6` and labels `Играть`, `Загрузить`, `Сетевая игра`, `Настройки`, `Об авторах`, and `Выход`.

The HostAPI `+0x14` object now implements its recovered vtable `+0x30` SDB lookup instead of returning null. It parses the shipped `sdb\user_interface.sdb` header and `(int32 id, int32 byteLength, CP1251 bytes)` records once, keeps stable null-terminated byte strings, and returns the record pointer for the selector. The completed Client initializer performs 23 lookups; every selector resolves, including `0x8f -> Вы хотите выйти?`, `0x8e -> Выход из игры`, and settings labels `0x90..0xa1`. A byte-for-byte comparison with the clean-room SDB parser reports 23/23 matches and zero mismatches.


## Verified asset-only execution boundary (2026-07-25)

The browser runtime was smoke-tested without `GoldenLand.exe`: the Vite app loaded the shipped `single/l1_3` map, rendered its extracted geometry and actors, opened `l1_3.p1_kotar.d1.age.cs` from the shipped dialogue corpus, and advanced two dialogue branches (`Я слушаю.` → both authored follow-up choices). The level's `l1_3.sef` bindings and the AGE graph therefore execute end to end through the current asset-backed clean-room path.

The native oracle now resolves resources against `public/assets`, completes both original module initializers without launching `GoldenLand.exe`, and directly parses shipped GUI and weather scripts through `Client.dll`. The browser smoke path remains separately verified for the shipped `single/l1_3` level and AGE dialogue.

The browser UI loader no longer duplicates the numeric definitions from `script_types.age.h`. It executes shipped `#INCLUDE`/`#DEFINE` directives, retains source locations and every authored object attribute, and uses the included symbols to resolve GUI type IDs. A live Vite validation loaded all 22 object-definition scripts under `public/assets/scripts/ui`: 534/534 objects and zero failures. `main_menu.scr` produced the six authored controls with ID `1..6`; the Play-button bounds remain the exact logical pixels `652,113,227,64` on the original 1024-by-768 canvas. `options_menu.scr` produced all 17 controls, and its check-button state changed through the generic renderer.

`InventoryPanel` now routes every applicable `inv_gui.scr` object through `OriginalGuiLayer`: 123 objects on skills and 85 on characteristics, including filters `9..15`, weapon selectors `84`/`85`, role-state zones `194..203`, and all four `GUI_DD_CONTAINER` objects `1`, `2`, `8`, and `99`. `OBJECT_VISIBLE FALSE` suppresses a container's images and text, not its logical DOM/drop-zone presence. Thus hidden container `1` retains the exact inventory-strip rectangle `138,696,730,66`, `2` retains the puppet rectangle `8,296,270,320`, and `99` retains the quick-access rectangle `10,618,266,40`; visible drop container `8` renders its authored image at `19,690,81,75`. The specialized bag, puppet, and quick-access contents remain positioned from the same object definitions above these logical zones. Captions come from `sdb/user_interface.sdb`; runtime values occupy the background's separate value boxes. No generated metadata is stored under `public/assets`. Constants are separated by provenance: exact binary-derived values and their addresses live in `src/constants/clientDll.ts`; visually measured equipment geometry and the inferred hot-slot count live under `src/constants/temporary`. Everything in that directory is explicitly pending replacement or native verification. Plus/minus controls always remain clickable and show their pressed image; unaffordable changes leave the runtime value unchanged. Browser verification found exactly the four authored containers with IDs `1,2,8,99`, matched all four rectangles, confirmed zero images for the three hidden containers and one authored image for visible container `8`, matched all ten equipment areas, exercised both tabs and progression press state, and found no missing captions, clipped values, or displaced controls.

The inventory section-heading rectangles are no longer visual approximations in `InventoryPanel`. `Client.dll` function `0x120661cc` passes exact `(x, y, SDB string ID, maximum width)` arguments to text renderer `0x12030a88`. The recovered skills entries are `(535,78,83,230)`, `(535,264,84,230)`, and `(535,449,85,230)`; the characteristics entries are `(352,57,3,228)`, `(709,57,4,228)`, `(352,307,86,228)`, and `(713,527,42,228)`. They live in `src/constants/clientDll.ts`. Browser geometry matched every tuple exactly and visual inspection found all seven labels centered without clipping or overlap.

The same native inventory routine contains a broader SDB layout corpus, but not one contiguous `3..86` record block. It mixes immediate call arguments with DWORD tables. `src/constants/clientDll.ts` now preserves all 79 unique records passed to renderer `0x12030a88` as `INVENTORY_NATIVE_TEXT_DRAWS`, including native `(x, y, stringId, boxWidth, boxHeight)` sentinels and exact table/call-site addresses. The observed IDs are `1..4`, `6..76`, and `83..86`; IDs `5` and `77..82` are not passed through this renderer anywhere in the exhaustively disassembled inventory function `0x120661cc..0x12068399` and are tracked separately in `INVENTORY_UNRESOLVED_STRING_IDS`.

The adjacent Client data cluster is now retained even where semantics are incomplete. `INVENTORY_ADJACENT_UNCLASSIFIED_DWORD_TABLES` preserves every nonzero table outside the already-structured text corpus from `0x120f82ec` through `0x120f899c`, with exact source bounds, known consumers, and explicitly marked hypotheses. This includes three repeated 29-DWORD traversal orders, repeated nine-row thresholds, object/category mappings with native `0xffff` sentinels, and 10-/12-coordinate grids used by inventory-related transfer or list views. The inventory renderer itself has 17 `0x12030a88` call sites in `0x120661cc..0x12068399`; their expanded loops still produce exactly 79 unique records with maximum SDB ID `86`, so there is no omitted `>86` text draw in that function. IDs beyond `86` belong to other renderers rather than a hidden tail of `INVENTORY_NATIVE_TEXT_DRAWS`.

`InventoryPanel` no longer injects SDB captions into SCR button objects. `inv_gui.scr` remains authoritative for object type, enabled/visible state, controls, hitboxes, images, sounds, and mouse timing; plain text is resolved from `sdb/user_interface.sdb` and rendered independently from `INVENTORY_NATIVE_TEXT_DRAWS`. Native `-1` box dimensions are treated as `auto` and therefore omitted from inline style entirely. Every native text node and every manually rendered progression/field-value overlay has `pointer-events: none`, so the authored object beneath remains the hit target. The invented `PASSIVE_GUI_IDS`, `passiveObjectIds` ABI, passive component branches, `data-gui-passive`, and CSS hit-test suppression have been removed. Authored `GUI_SIMPLE_BUTTON` objects `90..98`, `100..127`, and `160..203` now remain ordinary enabled buttons even when the browser host has no state-changing callback for them. The manual quick-access overlay also uses `pointer-events: none` rather than disabling authored objects. Browser checks rendered 41 text records on skills and 48 on characteristics, confirmed ID `14` as `Уровень` at `308,103` with no explicit width or height, and verified former passive objects `90`, `100`, and `160` as actual `BUTTON` elements with `pointer-events:auto`, no passive marker, direct `elementFromPoint` ownership, and one received mouseup each.

`OriginalGuiLayer` is now only the loader and exhaustive dispatcher. Every supported SCR `OBJECT_TYPE` has its own React file and its own CSS module under `src/components/gui`: simple button, check button, horizontal slider, vertical slider, edit, listbox, drag object, and drag/drop container. Shared ABI types, geometry, text style, sound loading, and state-image loading live in `GuiControlSupport.tsx`. Native button timing is type-specific. `GUI_CHECK_BUTTON` plays `PLAY_ON_CLICK` and dispatches its value/action callbacks on primary-button `mousedown`; `GUI_SIMPLE_BUTTON` does both on primary-button `mouseup`. A check button's pressed art is controlled exclusively by its checked value (`aria-pressed`), never by the pointer's `:active` state: browser instrumentation of active `inv_gui.scr` object `9` measured pressed opacity `1`, then `aria-pressed=false` and opacity `0` immediately on mousedown, before mouseup. Pressing unchecked object `10` produced the inverse transition to opacity `1` during mousedown and requested `sounds/ui/inventory/select.wav` exactly once. Keyboard activation remains available through the synthesized zero-detail click without duplicating mouse callbacks. Runtime-inactive simple controls retain their mouseup timing and pressed art but suppress state-changing callbacks; inactive magic cast object `2` played `okcancelclick.wav` on mouseup without assigning a spell. Isolated browser mounts rendered all eight component types; `GUI_DD_OBJECT` used a synthetic definition because no shipped UI SCR declares that supported type.

`OBJECT_VISIBLE` is now treated exclusively as presentation state for every object type, never as a construction/filter flag. `OriginalGuiLayer` creates every requested object regardless of that field. Simple/check buttons, both slider types, edit, listbox, and drag objects retain their exact geometry and event surface with CSS opacity `0` while invisible; drag/drop containers retain the logical zone but omit their state images and text. `OBJECT_ENABLED` remains the independent interaction gate. Browser verification mounted hidden enabled `skills_gui.scr` simple object `5`: it existed with `data-gui-visible=false`, opacity `0`, and `pointer-events:auto`; mousedown produced no action and mouseup dispatched exactly one action. Hidden enabled inventory containers `1` and `2` likewise remained in the DOM with `pointer-events:auto` and accepted cancelable dragover events. Thus visibility affects only visual content while object lifetime, state, geometry, and host event semantics remain intact.

The former inventory CSS `font: 700 12px/1 ...` was not native-derived and has been removed. `Client.dll` selects string `main_interface` at `0x12128284` through calls `0x1206634c`, `0x1206639a`, `0x12066502`, and `0x12066625`, and selects `heads_interface` at `0x12128bd8` through `0x1206635c`, `0x120664a0`, and `0x120665c3`. Their exact shipped definitions in `scripts/fonts.scr` are `pala.ttf / palatino linotype / 12 / weight 500` and `pala.ttf / palatino linotype / 14 / weight 600`. They are represented in `src/constants/fontsScr.ts`. No explicit CSS line-height is imposed. The character-name box is also native-derived: `15,10,250,26` from `0x1206637f..0x12066395`. Browser computation confirmed the two font profiles and character-name geometry exactly.

The authored inventory tooltip path is now recovered from `Client.dll`, rather than inferred from Russian captions. Hover resolver `0x1205e96c` copies and linearly scans the exact 122 `(objectId, value)` pairs at `0x121283a0`; `INVENTORY_NATIVE_HINT_BINDINGS` preserves their original ordering, including all 44 zero-valued dynamic entries. The 78 nonzero pairs resolve static `hints.sdb` records for filters `9..15`, characteristic labels `90..97`, skill/secondary labels `100..127` and `160..193`, and discard object `204`. Characteristic increase objects `23..29` call `0x1207d170`, compute the next value, and format `hints.sdb` record `144`. Odd skill-increase objects `31..83` do not repeat the skill description: keys `100..126` are passed to mapper `0x120a90ec`, whose 27-pair table at `0x1212ed40` converts them to internal skill indices; the caller reads the current value and formats only `hints.sdb` record `145` with `current + 1` at `0x12060d37..0x12060d59`.

Objects `194..203` are not magic slots: `inv_gui.scr` names them “Role states 10 fake buttons”. Client constructor `0x1206a410` binds all 28 native role-state IDs to exact `engineres/hero_states/NNN` resources, while `0x1206a7a8` enumerates active IDs in ascending order, keeps the first ten, and resolves tooltip text from `hero.sdb` by the same state ID. `NATIVE_HERO_STATE_BINDINGS` preserves the full 28-entry resource order recovered from `0x12128c68..0x12128f5c`; the aggregate state comparisons at `0x1201be84..0x1201c375` cover speed, elemental protection, armor, physical protection, magic immunity, magic resistance, and accuracy. The browser renders the corresponding shipped 20-by-20 icon over each authored hitbox with `pointer-events: none`, so hover reaches the underlying SCR control. Direct host-only injury/status states remain represented in the native table and will appear when their host state becomes available; they are not guessed from unrelated effects.

The tooltip widget starts its authored-control delay with `0x12c` milliseconds at `0x12060c1a..0x12060c1f`. Text loader `0x120a8814` measures the resolved string, adds 20 pixels, and caps the frame width at `0x190` (400). Placement code `0x12060f14..0x12061059` centers the frame horizontally on the authored control, clamps it to the logical viewport, and chooses above or below according to available space. `OriginalGuiLayer` implements those generic semantics without modifying shipped SCR definitions. `GuiTooltip` owns one backing canvas rather than nine frame DOM elements: it color-key loads `main`, `top`, `bottom`, `left`, `right`, `lt`, `rt`, `lb`, and `rb`, tiles the center and four edges into that canvas, and draws the four corners at native 20-pixel size. The sources come from `engineres/msg_box/hints` and are byte-identical to the `engineres/item_desc` resources named by Client. Browser verification found exactly one canvas and one text span, no child frame divs, a nontransparent high-DPI backing buffer, all 122 unique binding objects, all 78 static records, all 28 `hero.sdb` records/resources, characteristic object `23` (`Необходимо очков опыта: 15`), and injected native armor state `14` on object `194` (`Повышенный класс брони`) through its actual icon hit area.

Canvas composition overlaps every junction by exactly one logical pixel. `main` is drawn first from inset `19` through the opposing inset, the horizontal and vertical sides are drawn second with a one-pixel extension toward their neighboring corners, and the four native corners are drawn last. This preserves the native 20-pixel regions while hiding subpixel seams without stretching an intermediate texture across the full canvas.

The former CSS-only `inventory-item-popup` path has been removed. Bag items and equipped items now feed their literary name, class, description, quantity, and special-effect lines into the same `GuiTooltip` canvas renderer. Their separate native item delay remains `0x190` (400 ms), recovered from `0x1206089a..0x1206089f`; frame composition, viewport clamping, and above/below placement are shared with authored-control hints.

The save/load screen no longer uses percentage approximations. Shipped `save_load_menu.scr` owns close object `1` at `(743,659,75,69)`, confirm object `2` at `(581,659,75,69)`, and page objects `3..6` at the authored `52x38` rectangles near y `716`. Client constructor `0x12089380..0x12089576` loads `focus_slot`, `slots`, `background`, and `back`; renderer `0x120895a4..0x1208995a` places the `301x587` slot frame at `(65,113)`, the `500x375` preview at `(451,115)`, the title RECT `(372,38)-(633,77)`, and the selected-save details RECT `(499,542)-(901,593)`. The native model is four pages of seven slots, not the former browser model of four pages of ten. Per-page slot RECTs are `(65,113+88n)-(366,172+88n)` for `n=0..6`; this exactly fills the slot-frame height because the six inter-slot advances plus the final 59-pixel slot total 587 pixels.

`SaveLoadMenuPanel` now renders those literal Client rectangles, uses the shipped `focus_slot.csx` only for the selected slot, adds a separate two-pixel pale-green CSS outline on hover, routes all six SCR controls through `OriginalGuiLayer`, and resolves title SDB IDs `140`/`141` (`Загрузить`/`Сохранить`). Native font selections are also retained: `button_heads_interface` (`pala.ttf`, 18, weight 600) for the title, `heads_interface` for both slot lines, and `main_interface` for selected-save details. Browser verification matched every resource/control rectangle after subtracting the fixed-canvas origin, paged `1..7` to `8..14`, saved slot 1, displayed its two metadata lines in the recovered rectangles, and loaded it back through the authored confirm button.

The exact native line advance remains a separate unresolved ABI value, not a field in `fonts.scr`. Renderer `0x12030a88` reads signed font-object field `+0x08` at `0x12030aed` and uses its absolute value for vertical centering. Font construction writes `+0x08` at `0x120302a1` from the negated result of state object `+0x4434`, vtable slot `+0x68`, called at `0x120301aa..0x120301c4`. Until that host scaling method is recovered or traced, the browser intentionally leaves `line-height` unspecified (`normal`) rather than inventing another numeric value.

The HUD toolbar is now driven by shipped `gpanel_new.scr` instead of percentage CSS hitboxes. `OriginalGuiLayer` owns object IDs `1..8` and `14`; magic slots use exact SCR objects `24..32`; status text, life/energy values, and right-hand placeholders use objects `38`, `35`, `37`, `18`, and `19`. Browser geometry matched every literal SCR rectangle, including toolbar `12,639,63,21`, journal `869,637,66,23`, combat `494,736,32,28`, and magic slots `544..776,738,27,27`. Client HUD resources are loaded by `0x1204e01c`; the 18-entry pointer table is `0x120f8240..0x120f8284`, and animation resource/frame-height tables are `0x120f829c..0x120f82c0`, consumed by `0x1204e132..0x1204e1b5`. Health and energy frame heights `141` are binary constants. Their native animation origins are `(158,611)` at `0x12056181..0x1205619c` and `(819,611)` at `0x1205620c..0x12056226`; clipping those frames to SCR objects `34` and `36` proves the source insets `(6,24)` and `(4,24)` without visual guesses. Target frame calculation uses integer division over `value * (frameCount - 1) / maximum`, and fields `+0x240/+0x244` advance one frame toward the target per draw; the browser now reproduces both floor division and per-frame smoothing.

The diary toolbar is likewise driven by shipped `diary.scr` objects `1..10`, replacing manually positioned tab, arrow, and close buttons. Client resource pointers for `main`, `page1..page5`, and `page4_add` are at `0x120f8a20..0x120f8a38` and loaded by `0x1208142f..0x120814a2`. Native tab text uses `main_interface`: x coordinates are initialized at `0x12080f06..0x12080f34`, object IDs at `0x12080f3f..0x12080f6b`, SDB IDs `104..108` at `0x12080f76..0x12080fa2`, and draw loop `0x12080fd6..0x12081069`. Selected text uses GDI COLORREF `0x00800000` (CSS `#000080`) at y `5`; unselected text uses COLORREF `0` at y `6`; both are centered in `178x44`. Browser checks matched all ten control rectangles and five text records. `page4_add.bmp` now uses color-key rendering rather than exposing its magenta transparency key.

Diary content rectangles are no longer visual percentages. The left list initializer at `0x1207f3fd..0x1207f42d` writes `(75,110,280,557)`; the normal right list at `0x1207eda2..0x1207edd2` writes `(460,110,465,557)`. Bestiary title RECT `(550,109)-(859,132)` is stored at `0x121296ec..0x121296f8` and drawn at `0x1207e61e..0x1207e66a`; description RECT `(703,157)-(932,348)` is stored at `0x121296fc..0x12129708` and drawn at `0x1207e582..0x1207e5d8`. Both select `main_interface`. The list object constructor `0x12082c30` stores `main_interface` and `main_interface_so`; the latter is the shipped strikeout variant and now marks completed entries instead of an invented gray-state style. Native bestiary population `0x120802a8..0x12080413` reads an ordered array of creature SDB IDs at object `+0x1f0` and a 16-bit kill-count array at `+0x2f0`. Callback `0x120805d0`, reached through Client callback wrapper `0x120c6f38`, accepts either a full 128-word snapshot or sparse ID/count pairs. The clean-room runtime now stores persistent counts by the matching person resource ID, increments them only for hero-caused deaths (including area magic), caps them at native word maximum `0xffff`, persists them in save format 5, and migrates version-4 saves with an empty bestiary record.

The journal no longer paginates with browser-invented constants (`12` list entries or `1350` characters). Both native list rectangles render their complete content and the shipped arrow controls advance by the measured rectangle height, clamped to the actual DOM scroll range. Runtime-inactive authored controls remain ordinary pressable buttons: their shipped pressed image and click sound still play, while the state-changing callback becomes a no-op. Browser verification on the history tab measured right content `863px` inside the native `557px` viewport: object `9` moved from offset `0` to the exact maximum `306`; another press at the boundary left the offset unchanged. A one-entry bestiary remained non-scrollable while both forward controls still responded visually to pointer presses.

The same preservation rule now covers nearby HUD and diary data instead of discarding values whose consumers are not fully named. `HUD_RESOURCE_NAMES` retains all 18 pointers at `0x120f8240..0x120f8284`; `HUD_ANIMATION_RESOURCE_NAMES` retains all five pointers at `0x120f829c..0x120f82ac`; parallel unknown DWORDs `100,100,100,100,100` at `0x120f82c4..0x120f82d4` and IDs `82,77,78,79,80` at `0x120f82d8..0x120f82e8` are stored with hypotheses explicitly marked as unresolved. `DIARY_RESOURCE_NAMES` retains all seven pointers at `0x120f8a20..0x120f8a38`; the adjacent control/value pairs at `0x120f8a3c..0x120f8a60`, DWORD `2000` at `0x120f8a64`, and fourteen text RECTs at `0x120f8a80..0x120f8b5c` are likewise preserved with consumer addresses and no invented semantic labels.

The browser presentation now uses an unscaled fixed 1024-by-768 logical viewport. Responsive `vw`/`vh`, `clamp(...vw...)`, percentage conversion of SCR object bounds, `viewport-scale`, resize listeners, and `transform: scale(...)` are absent. Browser checks at `1600x900 / devicePixelRatio 1.0` and `1280x720 / devicePixelRatio 1.25` produced the same viewport `1024x768`, Play-button `652,113,227,64`, and 16px authored-button font. A smaller browser viewport scrolls over the fixed canvas instead of resizing it.

### Native dialogue function probe and trace comparison

The server-only oracle capture `.tmp/native-dialog-server-only.ndjson` proves direct native invocation of both registered dialogue functions without launching `GoldenLand.exe`: one `D_Say` call and one `D_Answer` call, both returning `0`, followed by `oracle_complete initialized=true`. The clean-room capture contains two `D_Say` and four `D_Answer` AGE operations plus two authored dialogue-state snapshots. The function-name intersection is exact (`D_Say`, `D_Answer`), but the traces are not behaviorally equivalent yet: the native probe has no active dialogue context and therefore emits zero dialogue-state snapshots, while the clean-room trace executes authored branches. This is a completed structural comparison, not the final native-vs-clean-room branch comparison.
The current hard boundary is no longer Client startup, UI SDB lookup, or identification of the state `+0x4424` graphics device. Remaining work is behavioral: extend the recovered D3D7 facade from startup queries to frame/render calls, construct an active Server dialogue context, and compare native script state transitions—not merely asset acceptance—with the clean-room runtimes.

## Next reverse-engineering target

1. Recover exact event registration, graphics descriptor, and object-ownership semantics while preserving the completed Client initializer and verified SDB values.
2. Wire a shipped AGE dialogue through an active recovered Server/Client dialogue context and compare native node/function/branch/snapshot traces with `AGEParser` + `DialogueRuntime`.
3. Recover SCR context construction, handler dispatch, core scheduling, variable lifetime, and host-call ABI beyond the now-verified native GUI script parse.
4. Treat zero-ID AGE source names as unavailable unless dialogue-editor sources, symbols, or compiler logs appear; the serialized containers retain only numeric zero.
