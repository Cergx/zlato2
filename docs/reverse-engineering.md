# GoldenLand / «Златогорье 2» reverse-engineering notes

Updated: 2026-07-23. All paths below are relative to this repository unless stated otherwise.

## Resource roots

- Original game installation: `E:/Games/zlato22`.
- Extracted assets used by the web client: `public/assets`.
- Browser implementation: `src/game`.
- Original executable: `E:/Games/zlato22/GoldenLand.exe`; primary engine DLL: `E:/Games/zlato22/Client.dll`.
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

Palette indexes `0`–`104` are literal pixels; `105` is one transparent pixel; `106, color, count` is a palette-color run; `107, color` rewrites the current and, except at the line start, preceding pixel; and `108, count` is a transparent run. Run counts are clipped to the remaining output width. Palette magenta (`R >= 254, G < 2, B >= 253`) is a color key and decodes as transparent for visible sprites, but MDSC mask resources preserve it as opaque coverage for foreground extraction. `tools/inspect-csx.mjs` strictly validates the header, every scanline boundary, palette reference, and decoded width.

```bash
node tools/inspect-csx.mjs public/assets --quiet
```

Validated: all 19,698 CSX files; `levels/pack/tl41/bitmaps/minimap.csx` is an intentional zero-byte placeholder in both the original and extracted trees.

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

The implemented inventory screen uses the original `engineres/interface/inventory/inventory_skills.bmp`, shipped item icons and descriptions. It supports use, drop, equip/unequip, live hero sprite recomposition, and quick-save/quick-load restoration. Browser verification covered the shipped 1,000-money initial inventory, helmet equip/unequip, restored equipment after F5/F9, a changed composed helmet atlas, and combined helmet composition in all seven shipped weapon profiles (`two_spears_staffs`, `xbows_guns`, `two_axes_maces`, `bows`, `noweapon_thrw`, `onehand_wpn`, and `two_swords`).

## Magic book and spell items

The six original schools are not contiguous in UI order. Button order and spell-id ranges are: gods `26..38`, elements `13..25`, light `39..51`, dark `0..12`, shadows `65..77`, and nature `52..64`. The literary names, technical names, and descriptions come from `sdb/magic/magiclitnames.sdb`, `magictechnames.sdb`, and `magicdescription.sdb`. Spell art is keyed by the technical name under `engineres/interface/magic_book/magic_icons/{noactive,glow_na,glow,cast_na,cast}`.

The shipped item corpus contains a book (ITM type `21`) and scroll (type `22`) for every one of the 78 spell ids. Their class-specific magic id is the integer at parsed native-property index `18`. The browser runtime treats books as permanent learning items, consumes one only when the spell is not already known, and stores learned ids plus the nine spell-book quick slots in the existing hero parameter map so ordinary quick-save/quick-load persistence preserves them without a save-format fork.

The reconstructed `441x440` magic panel uses the original background, six overlapping school-button sprites, five-tier spell tree, spell state art, cast/assignment and close controls. Learned spells can be selected, dragged or assigned to one of nine local quick slots; right-click clears a slot. Browser verification learned `BOK_1_0_10` as spell id `0` (`dark_boiling_blood`, «Кипящая кровь»), consumed the book, assigned it to slot 0, and restored both learned and assigned state through quick-save/quick-load.

Combat spell execution is data-driven from `scripts/magic.scr`. `MagicCatalogRuntime` joins all 78 definitions to the shipped SDB names and decodes school, ally/enemy targeting, healing, realtime/aimed flags, radius, AP/energy formulas, and nested `special` records. Every shipped player spell is executable: the runtime applies physical, elemental and school damage; current/max health, energy and action points; attributes, accuracy, critical, armor, initiative, resistance and immunity modifiers; silence, regeneration and map-walker conditions; dispelling; and all four summon variants. Area spells select combatants inside the authored world-space radius. Timed effects use the authored `base + coefficient * power` duration, replace an existing effect with the same target/special instead of stacking it, rebuild the affected combat profile immediately, and expire on game-time or combat-turn advancement; expiring summons leave the active roster. The nine original HUD cells mirror the spell-book assignments, accept mouse activation and keys `1` through `9`, arm enemy targeting or immediately apply ally spells, deduct authored AP/energy costs, respect school immunity and channel resistance, update death/combat state, and persist learned/assigned spell ids through the existing hero parameters. Deterministic browser verification cast all 78 ids with no rejected or inert definitions.

Save format `4` persists every active timed effect as `(spellId, specialId, targetName, value, remainingMinutes)` plus the independent per-person health/energy regeneration elapsed counters. Restore rebuilds modified combat profiles, current health/energy and summoned allies before time resumes; versions `1` through `3` migrate with empty effect state. End-to-end browser verification round-tripped an active regeneration spell with a partial interval and restored its next tick at the exact remaining delay, and separately restored a summoned ally. Corpus verification executed all 136 `special` records across all 78 player spells without an exception or inert result and loaded all 78 corresponding player-spell MDF animations.

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

The persisted options are also runtime inputs rather than a menu-only façade. Sound, music, and dialogue sliders set their independent playback gains; animation speed scales actor movement and sprite playback; edge-scroll speed drives the original seven slider steps; always-run changes path requests; hints suppress hover status publication; and object transparency changes foreground occluder compositing. The world clock now advances continuously at one game minute per real second while simulation is running. The HUD rest command advances eight hours through the same clock path, so regeneration and timed magic effects observe both realtime and explicit waiting.

`tools/audit-interface-assets.mjs` performs a repeatable conservative reference audit across `engineres/interface` and `engineres/gpanel`, including authored GUI scripts, runtime path suffixes, numbered loading/about families, and dynamically named spell icons. Of 628 shipped interface assets, 556 are currently referenced and 72 remain candidates rather than proven garbage. The candidates are retained: they include notification/status icons, ally and combat-detail panels, legacy BMP loading-screen duplicates, old HUD revisions, multiplayer/player-selection backgrounds, and five apparently mistyped spell-icon variants. They are inputs for unfinished original subsystems or archival leftovers, not safe deletion targets during fidelity work.

Person sound bundles (`scripts/shaders/persons/*.pssh`) are parsed as nested sound-shader blocks, including `random` wave selection, 3D distance, volume, EAX, loop flags, and animation step frames. Person combat resources now load the corresponding `persons_res/*.prs`, including height, death/container flags, attack application frames, body parts, materials, and all referenced `.ssh` files. Successful and missed attacks choose `attack_0.hit` and `attack_0.miss` respectively and play the extracted wave through the level audio host. Corpus validation: all 277 PRS files parse; their 3,188 shader references resolve.

Inventory-adjacent interaction panels now reuse the shipped authored layouts instead of generic overlays. The player inventory renders `inventory.scr` over `inventory.bmp`; barter renders `trade.scr` over `trade.bmp`, moves selected stacks in both directions through the runtime inventory ledger, and preserves the original item-strip/equipment-slot geometry; corpse and container looting uses the HUD-authored `gpanel_new.scr` controls over `gpanel/exchange.bmp`: object `22` is the source strip, `23` is the hero strip, `9`-`12` page them, `20` transfers all items, and `21` closes the exchange. Person death is a persistent renderer state: dead actors stop moving and accepting attacks but remain targetable with the take cursor. A corpse is lootable only when its parsed PRS declares `container_after_die` and its SEF person record supplies `scr_inv`; that inventory is initialized once and then retained after transfers. The original does not replace the scene with a dedicated game-over artwork: Server `0x140351c6` queues UI packet type `6` and `0x140351d1` assigns SDB string `212`, `Игра окончена.`. Type `6` is the same notification channel used for ordinary gameplay errors. The browser therefore keeps the HUD and the actor's final death frame visible, publishes `Игра окончена.` in the authored status bar, closes active interactions, and rejects further world clicks while the hero is dead; loading a save rebuilds the level and clears that renderer state.

The browser combat runtime now uses the recovered Server formulas directly. Maximum health is `50 + 14 * constitution`; maximum energy is `10 + 2 * wisdom + 2 * intelligence`; action points are `20 + 1.5 * dexterity + 1.9375 * skill_athletic`; armor class is `0.6 * dexterity + 1.775 * skill_athletic`; initiative is `5 + 0.9 * dexterity + 0.15 * perception + 1.14 * skill_tactic`. With nonzero `skill_athletic`, the native health-regeneration interval is `clamp((6 - 0.1 * (constitution + skill_athletic)) * (skill_athletic > 9 ? 0.5 : 1), 1, 20)` minutes. With nonzero `skill_smith`, the energy interval is `clamp((6 - 0.1 * (effectiveWisdom + skill_smith)) * (skill_smith > 9 ? 0.5 : 1), 1, 20)`, where `effectiveWisdom = wisdom + (skill_speech > 4 ? 1 : 0)`. The Server advances each resource by `floor(elapsedMinutes / interval)` up to its maximum; the browser runtime preserves the fractional remainder and timed magic can alter either interval while active. Hit chance, critical chance/damage, critical miss, the separate crushing/hacking/pricking channels, item modifiers, weapon AP cost, monster `.inf` overrides, selected person weapons, and resistances are applied before health is synchronized back into scenario parameters. The HUD exposes rounds and remaining AP; the combat button or an attack click starts combat, Shift-click forces an attack, and Space ends the hero turn. Enemy turns use recovered initiative/AP profiles. Attacks drive the shipped PAD `attack`/`suffer`/`die` animations and the attack, miss, suffer, and death shaders referenced by PSSH/PRS resources.

Magic `.mdf` files begin with `MDF ` followed by twelve observed little-endian 32-bit header words; the first word is the effect duration in milliseconds. Their variable records contain length-prefixed CP1251 sprite paths below `magic/bitmap`; shipped header variants place the first record at different offsets. Sprite records expose an active interval at path-end offsets `+40` and `+80` and a frame-count/index hint at `+56`. The runtime scans the validated length-prefixed records, resolves each vertical sprite strip from the local hint or the matching shifted header frame-count pair, caches decoded layers, and composites the active frame at the caster-selected world target. Corpus validation: all 97 MDF files parse, yielding 155 sprite references, and every referenced bitmap resolves. Browser verification loaded all 78 player-spell MDF animations without failure and rendered a representative frame to 8,930 visible pixels.

Global-map `czdescriptions/*.dsc` files define an overall encounter chance and `evil`/`good` sides. Each side declares a priority, group count, and repeated `person` records containing technical name, group, chance, and weight. Corpus validation: all 22 files parse, containing 177 person records.

## Next reverse-engineering target

1. Recover source-level names for zero-ID compiler misses only if dialogue-editor sources, symbol files, or compiler logs become available; the serialized AGE files contain only the discarded numeric zero.
2. Continue validating renderer and combat edge cases against direct original-client captures rather than adding speculative data-model fields.
