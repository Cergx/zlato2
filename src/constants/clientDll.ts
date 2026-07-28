export interface InventoryTextDraw {
    readonly stringId: number;
    readonly x: number;
    readonly y: number;
    /** -1 disables horizontal centering; otherwise this is the centering box width. */
    readonly boxWidth: number;
    /** -1 disables vertical centering; otherwise this is the centering box height. */
    readonly boxHeight: number;
}

/**
 * Client.dll inventory renderer selects `heads_interface` from string
 * 0x12128bd8 at 0x1206635c, 0x120664a0, and 0x120665c3. It selects
 * `main_interface` from string 0x12128284 at 0x1206634c, 0x1206639a,
 * 0x12066502, and 0x12066625.
 */
export const INVENTORY_FONT_NAMES = Object.freeze({
    text: "main_interface",
    heads: "heads_interface",
});

/**
 * Native text has no CSS-style line-height constant. Renderer 0x12030a88
 * reads the selected font object's signed height at field +0x08
 * (0x12030aed..0x12030af5) and uses its absolute value for vertical centering.
 * Font construction stores that field at 0x120302a1 from the negated return of
 * state object +0x4434, vtable slot +0x68, called at 0x120301aa..0x120301c4.
 * That host method's scaling contract is not recovered yet; do not hardcode a
 * browser line-height as if it were native.
 */

export interface ClientHeroParameterDefinition {
    readonly parameter: string;
    readonly interfaceStringId: number;
}

export interface HeroGeneratorParameterDraw extends ClientHeroParameterDefinition {
    readonly label: InventoryTextDraw;
    readonly valueRect: NativeRect;
}

/**
 * Client.dll character-generator renderer 0x1209DE78 and button handler
 * 0x1209DBB0. The skill parameter order is the 27-entry dispatch table at
 * 0x1212E0A0; every text and numeric rectangle below is passed to
 * 0x12030A04/0x12030A88 by the renderer.
 */
const HERO_GENERATOR_LIMITS = Object.freeze({
    primaryMinimum: 5,
    primaryMaximum: 30,
    skillMinimum: 0,
    skillMaximum: 15,
});

const HERO_GENERATOR_CHARACTERISTICS: readonly HeroGeneratorParameterDraw[] = Object.freeze([
    { parameter: "strength", interfaceStringId: 6, label: { stringId: 6, x: 30, y: 61, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 197, top: 60, width: 30, height: 18 } },
    { parameter: "constitution", interfaceStringId: 7, label: { stringId: 7, x: 30, y: 87, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 197, top: 87, width: 30, height: 18 } },
    { parameter: "dexterity", interfaceStringId: 8, label: { stringId: 8, x: 30, y: 114, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 197, top: 115, width: 30, height: 18 } },
    { parameter: "perception", interfaceStringId: 9, label: { stringId: 9, x: 30, y: 142, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 197, top: 143, width: 30, height: 18 } },
    { parameter: "wisdom", interfaceStringId: 10, label: { stringId: 10, x: 30, y: 169, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 197, top: 171, width: 30, height: 18 } },
    { parameter: "intelligence", interfaceStringId: 11, label: { stringId: 11, x: 30, y: 197, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 197, top: 198, width: 30, height: 18 } },
    { parameter: "luck", interfaceStringId: 12, label: { stringId: 12, x: 30, y: 224, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 197, top: 225, width: 30, height: 18 } },
]);

const HERO_GENERATOR_SKILLS: readonly HeroGeneratorParameterDraw[] = Object.freeze([
    { parameter: "skill_wpn_sword", interfaceStringId: 49, label: { stringId: 49, x: 295, y: 124, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 460, top: 123, width: 31, height: 18 } },
    { parameter: "skill_wpn_axe", interfaceStringId: 50, label: { stringId: 50, x: 295, y: 156, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 460, top: 156, width: 31, height: 18 } },
    { parameter: "skill_wpn_crush", interfaceStringId: 51, label: { stringId: 51, x: 295, y: 188, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 460, top: 188, width: 31, height: 18 } },
    { parameter: "skill_wpn_staff", interfaceStringId: 52, label: { stringId: 52, x: 544, y: 124, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 706, top: 123, width: 31, height: 18 } },
    { parameter: "skill_wpn_dist", interfaceStringId: 53, label: { stringId: 53, x: 544, y: 156, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 706, top: 156, width: 31, height: 18 } },
    { parameter: "skill_wpn_spear", interfaceStringId: 54, label: { stringId: 54, x: 544, y: 188, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 706, top: 188, width: 31, height: 18 } },
    { parameter: "skill_wpn_throw", interfaceStringId: 55, label: { stringId: 55, x: 790, y: 124, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 952, top: 123, width: 31, height: 18 } },
    { parameter: "skill_wpn_hand", interfaceStringId: 56, label: { stringId: 56, x: 790, y: 156, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 952, top: 156, width: 31, height: 18 } },
    { parameter: "skill_critical_hit", interfaceStringId: 57, label: { stringId: 57, x: 790, y: 188, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 952, top: 188, width: 31, height: 18 } },
    { parameter: "skill_shadmag", interfaceStringId: 58, label: { stringId: 58, x: 295, y: 309, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 460, top: 310, width: 31, height: 18 } },
    { parameter: "skill_natrmag", interfaceStringId: 59, label: { stringId: 59, x: 295, y: 342, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 460, top: 342, width: 31, height: 18 } },
    { parameter: "skill_godsmag", interfaceStringId: 60, label: { stringId: 60, x: 295, y: 375, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 460, top: 374, width: 31, height: 18 } },
    { parameter: "skill_elemmag", interfaceStringId: 61, label: { stringId: 61, x: 544, y: 309, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 706, top: 310, width: 31, height: 18 } },
    { parameter: "skill_lghtmag", interfaceStringId: 62, label: { stringId: 62, x: 544, y: 342, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 706, top: 342, width: 31, height: 18 } },
    { parameter: "skill_darkmag", interfaceStringId: 63, label: { stringId: 63, x: 544, y: 375, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 706, top: 374, width: 31, height: 18 } },
    { parameter: "skill_magicuse", interfaceStringId: 64, label: { stringId: 64, x: 790, y: 309, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 952, top: 310, width: 31, height: 18 } },
    { parameter: "skill_alchemy", interfaceStringId: 65, label: { stringId: 65, x: 790, y: 342, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 952, top: 342, width: 31, height: 18 } },
    { parameter: "skill_identify", interfaceStringId: 66, label: { stringId: 66, x: 790, y: 375, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 952, top: 374, width: 31, height: 18 } },
    { parameter: "skill_tactic", interfaceStringId: 67, label: { stringId: 67, x: 295, y: 494, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 460, top: 494, width: 31, height: 18 } },
    { parameter: "skill_scout", interfaceStringId: 68, label: { stringId: 68, x: 295, y: 526, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 460, top: 527, width: 31, height: 18 } },
    { parameter: "skill_healing", interfaceStringId: 69, label: { stringId: 69, x: 295, y: 558, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 460, top: 559, width: 31, height: 18 } },
    { parameter: "skill_speech", interfaceStringId: 70, label: { stringId: 70, x: 544, y: 494, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 706, top: 494, width: 31, height: 18 } },
    { parameter: "skill_trade", interfaceStringId: 71, label: { stringId: 71, x: 544, y: 526, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 706, top: 527, width: 31, height: 18 } },
    { parameter: "skill_hack", interfaceStringId: 72, label: { stringId: 72, x: 544, y: 558, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 706, top: 559, width: 31, height: 18 } },
    { parameter: "skill_science", interfaceStringId: 73, label: { stringId: 73, x: 790, y: 494, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 952, top: 494, width: 31, height: 18 } },
    { parameter: "skill_smith", interfaceStringId: 74, label: { stringId: 74, x: 790, y: 526, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 952, top: 527, width: 31, height: 18 } },
    { parameter: "skill_athletic", interfaceStringId: 75, label: { stringId: 75, x: 790, y: 558, boxWidth: -1, boxHeight: -1 }, valueRect: { left: 952, top: 559, width: 31, height: 18 } },
]);

export interface HeroGeneratorPresetCaption {
    readonly objectId: number;
    readonly stringId: number;
    readonly rect: NativeRect;
}

/**
 * Preset caption strings are user_interface.sdb IDs 213..216. Their boxes are
 * the exact GUI_CHECK_BUTTON rectangles authored as objects 1..4 in
 * scripts/ui/hero_generator.scr; centering therefore uses the button bounds,
 * not inferred text offsets.
 */
const HERO_GENERATOR_PRESET_CAPTIONS = Object.freeze([
    { objectId: 1, stringId: 213, rect: { left: 33, top: 696, width: 162, height: 53 } },
    { objectId: 2, stringId: 214, rect: { left: 219, top: 696, width: 162, height: 53 } },
    { objectId: 3, stringId: 215, rect: { left: 405, top: 696, width: 162, height: 53 } },
    { objectId: 4, stringId: 216, rect: { left: 592, top: 696, width: 162, height: 53 } },
] satisfies readonly HeroGeneratorPresetCaption[]);

/**
 * Client.dll:0x1209E095 selects `heads_interface`; the draw at
 * 0x1209E0A5..0x1209E0C9 renders user_interface.sdb ID 2 at (474, 6).
 */
const HERO_GENERATOR_TOP_TITLE_DRAW: InventoryTextDraw = Object.freeze({
    stringId: 2, x: 474, y: 6, boxWidth: -1, boxHeight: -1,
});

const HERO_GENERATOR_SECTION_TITLE_DRAWS = Object.freeze([
    { stringId: 83, x: 535, y: 78, boxWidth: 230, boxHeight: -1 },
    { stringId: 84, x: 535, y: 264, boxWidth: 230, boxHeight: -1 },
    { stringId: 85, x: 535, y: 449, boxWidth: 230, boxHeight: -1 },
] satisfies readonly InventoryTextDraw[]);

const HERO_GENERATOR_PRIMARY_POINTS_LABEL_DRAW: InventoryTextDraw = Object.freeze({
    stringId: 13, x: 30, y: 261, boxWidth: -1, boxHeight: -1,
});
const HERO_GENERATOR_SKILL_POINTS_LABEL_DRAW: InventoryTextDraw = Object.freeze({
    stringId: 76, x: 526, y: 626, boxWidth: -1, boxHeight: -1,
});
const HERO_GENERATOR_PRIMARY_POINTS_VALUE_RECT: NativeRect = Object.freeze({
    left: 216, top: 261, width: 38, height: 18,
});
const HERO_GENERATOR_SKILL_POINTS_VALUE_RECT: NativeRect = Object.freeze({
    left: 739, top: 623, width: 45, height: 23,
});

export const HERO_GENERATOR_NATIVE_LAYOUT = Object.freeze({
    limits: HERO_GENERATOR_LIMITS,
    characteristics: HERO_GENERATOR_CHARACTERISTICS,
    skills: HERO_GENERATOR_SKILLS,
    topTitle: HERO_GENERATOR_TOP_TITLE_DRAW,
    sectionTitles: HERO_GENERATOR_SECTION_TITLE_DRAWS,
    presetCaptions: HERO_GENERATOR_PRESET_CAPTIONS,
    primaryPoints: Object.freeze({
        label: HERO_GENERATOR_PRIMARY_POINTS_LABEL_DRAW,
        valueRect: HERO_GENERATOR_PRIMARY_POINTS_VALUE_RECT,
    }),
    skillPoints: Object.freeze({
        label: HERO_GENERATOR_SKILL_POINTS_LABEL_DRAW,
        valueRect: HERO_GENERATOR_SKILL_POINTS_VALUE_RECT,
    }),
});

export type ProfessionSkillId = "theft" | "smith" | "repair" | "alchemy" | "recharge_staff";

export interface ProfessionSkillDefinition {
    readonly id: ProfessionSkillId;
    readonly parameter: "skill_hack" | "skill_smith" | "skill_alchemy";
    readonly minimumExclusive: number;
    readonly interfaceStringId: number;
}

/**
 * Client.dll FUN_1204C4A8 compact HUD profession-skill list. Calls to
 * FUN_1204F09C use indices 0..4; table 0x120F82D8 maps them to
 * user_interface.sdb IDs 82, 77, 78, 79, and 80. Native parameter IDs are
 * 0x12, 0x16, and 0x19.
 */
export const PROFESSION_SKILLS: readonly ProfessionSkillDefinition[] = Object.freeze([
    { id: "theft", parameter: "skill_hack", minimumExclusive: 0, interfaceStringId: 82 },
    { id: "smith", parameter: "skill_smith", minimumExclusive: 0, interfaceStringId: 77 },
    { id: "repair", parameter: "skill_smith", minimumExclusive: 4, interfaceStringId: 78 },
    { id: "alchemy", parameter: "skill_alchemy", minimumExclusive: 0, interfaceStringId: 79 },
    { id: "recharge_staff", parameter: "skill_alchemy", minimumExclusive: 4, interfaceStringId: 80 },
]);

export type ProfessionCraftMode = 0 | 1 | 2 | 3;

/**
 * Client.dll compact-profession handler 0x12054A20 maps HUD actions to the
 * profession window's independent mode field +0x68: smith -> 1, repair -> 3,
 * alchemy -> 0, recharge staff -> 2. Theft (HUD index 0) does not open this
 * window. The mode indexes four independent selected-level fields at
 * +0x58..+0x64.
 */
export const PROFESSION_CRAFT_MODES: Readonly<Partial<Record<ProfessionSkillId, ProfessionCraftMode>>> = Object.freeze({
    smith: 1,
    repair: 3,
    alchemy: 0,
    recharge_staff: 2,
});

export interface ProfessionLevelTabDefinition {
    readonly level: 1 | 2 | 3 | 4 | 5;
    readonly objectId: 5 | 6 | 7 | 8 | 9;
    readonly artwork?: string;
}

/**
 * skills_gui.scr objects 5..9 are levels I..V of the currently opened
 * profession. Client.dll event handler 0x12097446..0x120974EC stores
 * objectId - 5 in +0x58 + mode*4, then 0x1208FC8C filters recipes by the
 * corresponding one-based level. All five authored buttons remain enabled.
 */
export const PROFESSION_LEVEL_TABS = Object.freeze([
    { level: 1, objectId: 5 },
    { level: 2, objectId: 6, artwork: "/assets/engineres/skills/tab2.bmp" },
    { level: 3, objectId: 7, artwork: "/assets/engineres/skills/tab3.bmp" },
    { level: 4, objectId: 8, artwork: "/assets/engineres/skills/tab4.bmp" },
    { level: 5, objectId: 9, artwork: "/assets/engineres/skills/tab5.bmp" },
] satisfies readonly ProfessionLevelTabDefinition[]);

/**
 * Recipe-page loops in Client.dll 0x1208FCFD..0x1208FE3C. Mode 0 (alchemy)
 * scans 48 records and compares record +0x04 with the selected one-based
 * level; mode 1 (smith) scans 288 records with the same comparison. Learned
 * recipes are gated by bitsets at global player-state offsets +0x6B0/+0x6B6.
 */
export const PROFESSION_RECIPE_TABLES = Object.freeze({
    alchemy: { mode: 0, recordCount: 48, recordStride: 0x14, levelOffset: 0x04, learnedBitsetOffset: 0x6b0 },
    smith: { mode: 1, recordCount: 288, recordStride: 0x14, levelOffset: 0x04, learnedBitsetOffset: 0x6b6 },
});

export interface DiaryTabTextDraw {
    readonly objectId: number;
    readonly stringId: number;
    readonly x: number;
    readonly selectedY: number;
    readonly unselectedY: number;
    readonly boxWidth: number;
    readonly boxHeight: number;
}

/**
 * Client.dll diary renderer selects `main_interface` at 0x12080eeb.
 * Tab x coordinates are immediates at 0x12080f06..0x12080f34, SCR object IDs
 * at 0x12080f3f..0x12080f6b, and SDB IDs 104..108 at
 * 0x12080f76..0x12080fa2. The loop 0x12080fd6..0x12081069 draws selected
 * text at y=5 with COLORREF 0x00800000 (CSS #000080), set at 0x1208100d;
 * unselected text is at y=6 with COLORREF 0, set at 0x12081039. Both use a
 * 178x44 centering box. Renderer 0x12030980 passes the value directly to
 * GDI SetTextColor at 0x120309b7.
 */
export const DIARY_TAB_TEXT_DRAWS = Object.freeze([
    { objectId: 1, stringId: 104, x: 32, selectedY: 5, unselectedY: 6, boxWidth: 178, boxHeight: 44 },
    { objectId: 2, stringId: 105, x: 220, selectedY: 5, unselectedY: 6, boxWidth: 178, boxHeight: 44 },
    { objectId: 3, stringId: 106, x: 410, selectedY: 5, unselectedY: 6, boxWidth: 178, boxHeight: 44 },
    { objectId: 4, stringId: 107, x: 610, selectedY: 5, unselectedY: 6, boxWidth: 178, boxHeight: 44 },
    { objectId: 5, stringId: 108, x: 791, selectedY: 5, unselectedY: 6, boxWidth: 178, boxHeight: 44 },
] satisfies readonly DiaryTabTextDraw[]);

/**
 * Client.dll pushes x=15 at 0x1206638c, y=10 at 0x1206638a,
 * boxWidth=250 at 0x12066384, and boxHeight=26 at 0x1206637f before the
 * character-name text call at 0x12066395.
 */
export const INVENTORY_CHARACTER_NAME_DRAW = Object.freeze({
    x: 15,
    y: 10,
    boxWidth: 250,
    boxHeight: 26,
});

/**
 * Raw, not yet fully classified SDB text draws recovered from Client.dll's
 * inventory renderer 0x120661cc. Renderer 0x12030a88 accepts
 * (surface, x, y, stringId, boxWidth, boxHeight): horizontal centering is at
 * 0x12030ac2..0x12030ae4 and vertical centering at 0x12030af5..0x12030b17.
 *
 * Common IDs 1 and 2 are immediates at 0x120664bd..0x120664fd and
 * 0x120665e0..0x12066620. IDs 6..13 and their y coordinates are initialized
 * at 0x120663aa..0x12066451 and consumed by 0x1206645c..0x12066484.
 *
 * Skill x coordinates are DWORDs at 0x120f8520..0x120f858c, y coordinates at
 * 0x120f85a0..0x120f860c, and IDs at 0x120f8620..0x120f868c; the loop is
 * 0x1206651b..0x12066545. IDs 83..85 are immediate call arguments at
 * 0x12066552..0x120665b9.
 *
 * Characteristic six-entry tables are at 0x120f8690..0x120f86d4, twelve-entry
 * tables at 0x120f86d8..0x120f8734, and fifteen-entry tables at
 * 0x120f8738..0x120f87ac. Their loops are 0x120666a7..0x120666d0,
 * 0x12066704..0x1206672d, and 0x12066761..0x1206678b. IDs 3, 4, 86, 29,
 * and 42 are immediate arguments at 0x12066642..0x120666a0,
 * 0x120666dd..0x120666fd, and 0x1206673a..0x1206675a.
 */
export const INVENTORY_NATIVE_TEXT_DRAWS = Object.freeze({
    common: Object.freeze([
        { stringId: 1, x: 292, y: 16, boxWidth: 344, boxHeight: -1 },
        { stringId: 2, x: 661, y: 16, boxWidth: 344, boxHeight: -1 },
        { stringId: 6, x: 30, y: 61, boxWidth: -1, boxHeight: -1 },
        { stringId: 7, x: 30, y: 87, boxWidth: -1, boxHeight: -1 },
        { stringId: 8, x: 30, y: 114, boxWidth: -1, boxHeight: -1 },
        { stringId: 9, x: 30, y: 142, boxWidth: -1, boxHeight: -1 },
        { stringId: 10, x: 30, y: 169, boxWidth: -1, boxHeight: -1 },
        { stringId: 11, x: 30, y: 197, boxWidth: -1, boxHeight: -1 },
        { stringId: 12, x: 30, y: 224, boxWidth: -1, boxHeight: -1 },
        { stringId: 13, x: 30, y: 261, boxWidth: -1, boxHeight: -1 },
    ] satisfies readonly InventoryTextDraw[]),
    skills: Object.freeze([
        { stringId: 49, x: 295, y: 124, boxWidth: -1, boxHeight: -1 },
        { stringId: 50, x: 295, y: 156, boxWidth: -1, boxHeight: -1 },
        { stringId: 51, x: 295, y: 188, boxWidth: -1, boxHeight: -1 },
        { stringId: 52, x: 544, y: 124, boxWidth: -1, boxHeight: -1 },
        { stringId: 53, x: 544, y: 156, boxWidth: -1, boxHeight: -1 },
        { stringId: 54, x: 544, y: 188, boxWidth: -1, boxHeight: -1 },
        { stringId: 55, x: 790, y: 124, boxWidth: -1, boxHeight: -1 },
        { stringId: 56, x: 790, y: 156, boxWidth: -1, boxHeight: -1 },
        { stringId: 57, x: 790, y: 188, boxWidth: -1, boxHeight: -1 },
        { stringId: 58, x: 295, y: 309, boxWidth: -1, boxHeight: -1 },
        { stringId: 59, x: 295, y: 342, boxWidth: -1, boxHeight: -1 },
        { stringId: 60, x: 295, y: 375, boxWidth: -1, boxHeight: -1 },
        { stringId: 61, x: 544, y: 309, boxWidth: -1, boxHeight: -1 },
        { stringId: 62, x: 544, y: 342, boxWidth: -1, boxHeight: -1 },
        { stringId: 63, x: 544, y: 375, boxWidth: -1, boxHeight: -1 },
        { stringId: 64, x: 790, y: 309, boxWidth: -1, boxHeight: -1 },
        { stringId: 65, x: 790, y: 342, boxWidth: -1, boxHeight: -1 },
        { stringId: 66, x: 790, y: 375, boxWidth: -1, boxHeight: -1 },
        { stringId: 67, x: 295, y: 494, boxWidth: -1, boxHeight: -1 },
        { stringId: 68, x: 295, y: 526, boxWidth: -1, boxHeight: -1 },
        { stringId: 69, x: 295, y: 558, boxWidth: -1, boxHeight: -1 },
        { stringId: 70, x: 544, y: 494, boxWidth: -1, boxHeight: -1 },
        { stringId: 71, x: 544, y: 526, boxWidth: -1, boxHeight: -1 },
        { stringId: 72, x: 544, y: 558, boxWidth: -1, boxHeight: -1 },
        { stringId: 73, x: 790, y: 494, boxWidth: -1, boxHeight: -1 },
        { stringId: 74, x: 790, y: 526, boxWidth: -1, boxHeight: -1 },
        { stringId: 75, x: 790, y: 558, boxWidth: -1, boxHeight: -1 },
        { stringId: 76, x: 526, y: 626, boxWidth: -1, boxHeight: -1 },
        { stringId: 83, x: 535, y: 78, boxWidth: 230, boxHeight: -1 },
        { stringId: 84, x: 535, y: 264, boxWidth: 230, boxHeight: -1 },
        { stringId: 85, x: 535, y: 449, boxWidth: 230, boxHeight: -1 },
    ] satisfies readonly InventoryTextDraw[]),
    characteristics: Object.freeze([
        { stringId: 3, x: 352, y: 57, boxWidth: 228, boxHeight: -1 },
        { stringId: 4, x: 709, y: 57, boxWidth: 228, boxHeight: -1 },
        { stringId: 86, x: 352, y: 307, boxWidth: 228, boxHeight: -1 },
        { stringId: 14, x: 308, y: 103, boxWidth: -1, boxHeight: -1 },
        { stringId: 15, x: 308, y: 134, boxWidth: -1, boxHeight: -1 },
        { stringId: 16, x: 308, y: 162, boxWidth: -1, boxHeight: -1 },
        { stringId: 27, x: 308, y: 212, boxWidth: -1, boxHeight: -1 },
        { stringId: 28, x: 308, y: 238, boxWidth: -1, boxHeight: -1 },
        { stringId: 18, x: 308, y: 265, boxWidth: -1, boxHeight: -1 },
        { stringId: 19, x: 308, y: 348, boxWidth: -1, boxHeight: -1 },
        { stringId: 20, x: 308, y: 375, boxWidth: -1, boxHeight: -1 },
        { stringId: 21, x: 308, y: 402, boxWidth: -1, boxHeight: -1 },
        { stringId: 22, x: 308, y: 429, boxWidth: -1, boxHeight: -1 },
        { stringId: 23, x: 308, y: 456, boxWidth: -1, boxHeight: -1 },
        { stringId: 24, x: 308, y: 483, boxWidth: -1, boxHeight: -1 },
        { stringId: 25, x: 308, y: 510, boxWidth: -1, boxHeight: -1 },
        { stringId: 26, x: 308, y: 537, boxWidth: -1, boxHeight: -1 },
        { stringId: 17, x: 308, y: 564, boxWidth: -1, boxHeight: -1 },
        { stringId: 29, x: 300, y: 598, boxWidth: -1, boxHeight: -1 },
        { stringId: 30, x: 673, y: 104, boxWidth: -1, boxHeight: -1 },
        { stringId: 31, x: 673, y: 136, boxWidth: -1, boxHeight: -1 },
        { stringId: 32, x: 673, y: 168, boxWidth: -1, boxHeight: -1 },
        { stringId: 33, x: 673, y: 221, boxWidth: -1, boxHeight: -1 },
        { stringId: 34, x: 673, y: 251, boxWidth: -1, boxHeight: -1 },
        { stringId: 35, x: 673, y: 282, boxWidth: -1, boxHeight: -1 },
        { stringId: 36, x: 673, y: 312, boxWidth: -1, boxHeight: -1 },
        { stringId: 37, x: 673, y: 343, boxWidth: -1, boxHeight: -1 },
        { stringId: 38, x: 673, y: 373, boxWidth: -1, boxHeight: -1 },
        { stringId: 39, x: 673, y: 430, boxWidth: -1, boxHeight: -1 },
        { stringId: 40, x: 673, y: 455, boxWidth: -1, boxHeight: -1 },
        { stringId: 41, x: 673, y: 482, boxWidth: -1, boxHeight: -1 },
        { stringId: 42, x: 713, y: 527, boxWidth: 228, boxHeight: -1 },
        { stringId: 43, x: 673, y: 570, boxWidth: -1, boxHeight: -1 },
        { stringId: 44, x: 673, y: 596, boxWidth: -1, boxHeight: -1 },
        { stringId: 45, x: 673, y: 622, boxWidth: -1, boxHeight: -1 },
        { stringId: 46, x: 850, y: 570, boxWidth: -1, boxHeight: -1 },
        { stringId: 47, x: 850, y: 596, boxWidth: -1, boxHeight: -1 },
        { stringId: 48, x: 850, y: 622, boxWidth: -1, boxHeight: -1 },
    ] satisfies readonly InventoryTextDraw[]),
});

/**
 * IDs in the 1..86 inventory SDB range not passed to 0x12030a88 by the
 * exhaustively disassembled Client.dll inventory renderer 0x120661cc..0x12068399.
 * Their ownership or alternate rendering path remains unresolved.
 */
export const INVENTORY_UNRESOLVED_STRING_IDS = Object.freeze([5, 77, 78, 79, 80, 81, 82]);

export interface UnclassifiedClientDwordTable {
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly values: readonly number[];
    readonly consumers: readonly number[];
    readonly hypothesis: string;
}

/**
 * Exact neighboring DWORD tables in the Client.dll data region surrounding
 * the classified inventory text tables. They are preserved even where their
 * semantic names are not recovered yet.
 *
 * Repeated value shapes and consumers in 0x1204f3ff..0x1207c37a connect these
 * tables to inventory-like grids, item-type ordering, selection rows, and
 * related transfer/trade views. Those roles remain hypotheses; do not treat
 * property order or coordinates as a recovered public ABI until each consumer
 * is decompiled.
 *
 * The classified text corpus occupies 0x120f8520..0x120f87ac and remains in
 * INVENTORY_NATIVE_TEXT_DRAWS above. The next table at 0x120f89a0 is a
 * diary resource-pointer table, so 0x120f899c is the end of this adjacent
 * inventory-related numeric cluster.
 */
export const INVENTORY_ADJACENT_UNCLASSIFIED_DWORD_TABLES = Object.freeze([
    {
        sourceStart: 0x120f82ec,
        sourceEnd: 0x120f8324,
        values: Object.freeze([219, 248, 277, 306, 335, 364, 393, 422, 451, 219, 248, 277, 306, 335, 364]),
        consumers: Object.freeze([0x1204f3ff, 0x1204f417]),
        hypothesis: "Repeated vertical grid coordinates; only the first nine values are directly indexed by the known consumer.",
    },
    {
        sourceStart: 0x120f8340,
        sourceEnd: 0x120f83b0,
        values: Object.freeze([18, 1, 0, 2, 3, 4, 5, 6, 7, 28, 10, 9, 8, 11, 12, 13, 14, 15, 16, 17, 21, 22, 19, 20, 23, 24, 26, 27, 25]),
        consumers: Object.freeze([0x12053f7c, 0x12053f96, 0x12054132]),
        hypothesis: "Item or equipment type traversal order.",
    },
    {
        sourceStart: 0x120f83c0,
        sourceEnd: 0x120f8444,
        values: Object.freeze([1, 7, 2, 6, 3, 9, 4, 8, 5, 13, 6, 11, 7, 12, 8, 10, 34, 4, 35, 4, 36, 5, 37, 5, 14, 14, 17, 0xffff, 19, 0xffff, 16, 0xffff, 18, 0xffff]),
        consumers: Object.freeze([0x12059e20, 0x12059e31, 0x12059e42, 0x12059e53, 0x12059e64, 0x12059e75, 0x12059e86, 0x12059e97, 0x12059ea8, 0x12059eb9, 0x12059ec6, 0x12059ed3, 0x12059ee0, 0x12059eed, 0x12059efa, 0x12059f07, 0x12059f14, 0x12059f3b]),
        hypothesis: "Pairs matched against an object or item code and converted to another small enum; 0xffff is a native sentinel.",
    },
    {
        sourceStart: 0x120f8460,
        sourceEnd: 0x120f8480,
        values: Object.freeze([14, 43, 72, 101, 130, 159, 188, 217, 246]),
        consumers: Object.freeze([0x1205bce0, 0x1205bcf8]),
        hypothesis: "Nine row thresholds used for pointer-to-row selection.",
    },
    {
        sourceStart: 0x120f8484,
        sourceEnd: 0x120f8490,
        values: Object.freeze([19, 690, 100, 765]),
        consumers: Object.freeze([0x12060816, 0x12060824]),
        hypothesis: "Two adjacent coordinate pairs; the known draw uses only the first pair (19,690).",
    },
    {
        sourceStart: 0x120f84a0,
        sourceEnd: 0x120f8510,
        values: Object.freeze([18, 1, 0, 2, 3, 4, 5, 6, 7, 28, 10, 9, 8, 11, 12, 13, 14, 15, 16, 17, 21, 22, 19, 20, 23, 24, 26, 27, 25]),
        consumers: Object.freeze([0x1206368c, 0x120636a6, 0x12063842]),
        hypothesis: "A duplicate of the 0x120f8340 traversal order used by a second inventory-related view.",
    },
    {
        sourceStart: 0x120f87b0,
        sourceEnd: 0x120f87d0,
        values: Object.freeze([14, 43, 72, 101, 130, 159, 188, 217, 246]),
        consumers: Object.freeze([0x120690e7]),
        hypothesis: "Nine object IDs or row coordinates selected from an encoded high-nibble category.",
    },
    {
        sourceStart: 0x120f87d4,
        sourceEnd: 0x120f8800,
        values: Object.freeze([140, 201, 261, 321, 382, 443, 504, 565, 627, 688, 749, 811]),
        consumers: Object.freeze([0x120693e4]),
        hypothesis: "Twelve grid coordinates indexed modulo 12.",
    },
    {
        sourceStart: 0x120f8820,
        sourceEnd: 0x120f8840,
        values: Object.freeze([14, 43, 72, 101, 130, 159, 188, 217, 246]),
        consumers: Object.freeze([0x1206a9cd, 0x1206a9e2]),
        hypothesis: "A second nine-row pointer-selection threshold table.",
    },
    {
        sourceStart: 0x120f8860,
        sourceEnd: 0x120f88d0,
        values: Object.freeze([18, 1, 0, 2, 3, 4, 5, 6, 7, 28, 10, 9, 8, 11, 12, 13, 14, 15, 16, 17, 21, 22, 19, 20, 23, 24, 26, 27, 25]),
        consumers: Object.freeze([0x120730ac, 0x120730c6, 0x12073262]),
        hypothesis: "A third copy of the item or equipment traversal order.",
    },
    {
        sourceStart: 0x120f88d4,
        sourceEnd: 0x120f88f4,
        values: Object.freeze([14, 43, 72, 101, 130, 159, 188, 217, 246]),
        consumers: Object.freeze([0x1207aecb]),
        hypothesis: "Nine object IDs or row coordinates selected from an encoded high-nibble category.",
    },
    {
        sourceStart: 0x120f88f8,
        sourceEnd: 0x120f891c,
        values: Object.freeze([347, 407, 467, 528, 589, 650, 711, 773, 834, 895]),
        consumers: Object.freeze([0x1207c37a]),
        hypothesis: "Ten grid coordinates indexed modulo 10.",
    },
    {
        sourceStart: 0x120f8920,
        sourceEnd: 0x120f8944,
        values: Object.freeze([347, 407, 467, 528, 589, 650, 711, 773, 834, 895]),
        consumers: Object.freeze([0x1207c0f9]),
        hypothesis: "Duplicate ten-coordinate grid for a related list.",
    },
    {
        sourceStart: 0x120f8948,
        sourceEnd: 0x120f896c,
        values: Object.freeze([347, 407, 467, 528, 589, 650, 711, 773, 834, 895]),
        consumers: Object.freeze([0x1207b6f1]),
        hypothesis: "Duplicate ten-coordinate grid for a related list.",
    },
    {
        sourceStart: 0x120f8970,
        sourceEnd: 0x120f899c,
        values: Object.freeze([140, 201, 261, 321, 382, 443, 504, 565, 627, 688, 749, 811]),
        consumers: Object.freeze([0x1207b46c]),
        hypothesis: "Duplicate twelve-coordinate grid for a related list.",
    },
] satisfies readonly UnclassifiedClientDwordTable[]);


/**
 * Client.dll loads weapon_slot1.bmp into inventory field +0x1c4 at
 * 0x1205ff2f..0x1205ff35. Its renderer pushes y=461 at 0x120662f8 and
 * x=9 at 0x120662fd before the blit call at 0x12066300.
 */
export const INVENTORY_WEAPON_OVERLAY_POSITION = Object.freeze({ left: 9, top: 461 });

/**
 * Exact 18-entry Client.dll HUD resource-pointer table
 * 0x120f8240..0x120f8284, consumed by 0x1204e0a1..0x1204e127.
 */
export const HUD_RESOURCE_NAMES = Object.freeze([
    "engineres\\gpanel\\std",
    "engineres\\gpanel\\dialog_panel",
    "engineres\\gpanel\\skill_panel",
    "engineres\\gpanel\\big_sel",
    "engineres\\gpanel\\small_sel",
    "engineres\\gpanel\\podlozhka",
    "engineres\\gpanel\\status_bar_new",
    "engineres\\gpanel\\exchange",
    "engineres\\gpanel\\damage\\cannot",
    "engineres\\gpanel\\damage\\hacking",
    "engineres\\gpanel\\damage\\crushing",
    "engineres\\gpanel\\damage\\pricking",
    "engineres\\gpanel\\damage\\distance",
    "engineres\\gpanel\\damage\\magic",
    "engineres\\gpanel\\damage\\noweapon",
    "engineres\\gpanel\\damage\\noweapon_alpha",
    "engineres\\gpanel\\zaglushka3",
    "engineres\\gpanel\\zaglushka4",
]);

/**
 * Client.dll attack-mode resolver 0x12057638 maps item-header capability bits
 * to the four physical HUD modes. The selected resource is loaded from
 * HUD field `+0x1c8 + mode * 4` at 0x12055042 and drawn into SCR object 17.
 */
export type HudDamageMode = 0 | 1 | 2 | 3;
export const HUD_DAMAGE_MODE_FLAGS: Readonly<Record<HudDamageMode, number>> = Object.freeze({
    0: 0x100,
    1: 0x40,
    2: 0x80,
    3: 0x20,
});
export const HUD_DAMAGE_RESOURCE_BY_MODE: Readonly<Record<HudDamageMode, string>> = Object.freeze({
    0: "hacking",
    1: "crushing",
    2: "pricking",
    3: "distance",
});
export const HUD_DAMAGE_MODE_SEQUENCE = Object.freeze([0, 1, 2, 3] satisfies readonly HudDamageMode[]);

/** Client.dll 0x12055026..0x12055049 and gpanel_new.scr object 17. */
export const HUD_DAMAGE_SLOT_POSITION = Object.freeze({ left: 89, top: 674, width: 55, height: 55 });

/** Client.dll 0x12055052..0x1205506e draws noweapon with noweapon_alpha here. */
export const HUD_NO_WEAPON_POSITION = Object.freeze({ left: 19, top: 674, width: 55, height: 55 });

/**
 * Exact five-entry animation-resource table 0x120f829c..0x120f82ac.
 */
export const HUD_ANIMATION_RESOURCE_NAMES = Object.freeze([
    "engineres\\gpanel\\anim\\health",
    "engineres\\gpanel\\anim\\energy",
    "engineres\\gpanel\\anim\\koleso",
    "engineres\\gpanel\\anim\\but_spr",
    "engineres\\gpanel\\anim\\bar_ap",
]);

/**
 * Parallel DWORDs at 0x120f82c4..0x120f82d4, passed as the fourth numeric
 * argument to animation initializer 0x120215b4. All are 100. Atlas dimensions
 * disprove a frame-count interpretation (health has 43 frames, wheel 72,
 * button 14); timing or normalization remains a hypothesis.
 */
export const HUD_ANIMATION_UNCLASSIFIED_PARAMETERS = Object.freeze([100, 100, 100, 100, 100]);

/**
 * Adjacent five-entry table 0x120f82d8..0x120f82e8, consumed at 0x1204f17f
 * through a lookup keyed by the HUD animation state. Values coincide with SDB
 * IDs 82 and 77..80, but the exact displayed-message role remains unresolved.
 */
export const HUD_ANIMATION_UNCLASSIFIED_STRING_IDS = Object.freeze([82, 77, 78, 79, 80]);

/**
 * Client.dll HUD animation resource pointers are at 0x120f829c..0x120f82ac.
 * Their frame heights are the parallel DWORD table 0x120f82b0..0x120f82c0,
 * consumed by the initialization loop 0x1204e132..0x1204e1b5.
 */
export const HUD_NATIVE_ANIMATION_FRAME_HEIGHTS = Object.freeze({
    health: 141,
    energy: 141,
    wheel: 36,
    button: 36,
    actionPoints: 16,
});

/**
 * Full-frame destinations passed to animation renderer `0x12021880`: health at
 * `0x12056181..0x1205619c`, energy at `0x1205620c..0x12056226`.
 * The shipped atlases are 46x6063 and 47x6063: 43 full-height 141px frames.
 * SCR objects 34 and 36 are separate authored GUI rectangles and do not crop
 * the animation renderer's destination.
 */
export const HUD_GAUGE_ANIMATION_ORIGINS = Object.freeze({
    health: Object.freeze({ left: 158, top: 611 }),
    energy: Object.freeze({ left: 819, top: 611 }),
});

/**
 * Client.dll wheel renderer 0x12054b68..0x12054c33 draws the 42x36 frame at
 * (490, 732). It divides the 1440-minute day into the atlas frame count and
 * rotates the sequence so frame zero represents 14:00.
 */
export const HUD_WHEEL_ANIMATION_ORIGIN = Object.freeze({ left: 490, top: 732 });
export const HUD_WHEEL_DAY_MINUTES = 24 * 60;
export const HUD_WHEEL_START_HOUR = 14;

/**
 * `but_spr` is HUD animation field +0x1f8. Client.dll attaches the separate
 * grayscale `but_alfa` atlas at 0x1204e1bb..0x1204e1d4. Renderer
 * 0x12054c38..0x12054f64 draws both at the wheel origin; the 14 40x36 frames
 * transition between non-combat frame 0 and combat frame 13 at the native
 * animation initializer's 100 ms interval.
 */
export const HUD_COMBAT_BUTTON_ALPHA_RESOURCE_NAME = "engineres\\gpanel\\anim\\but_alfa";
export const HUD_COMBAT_BUTTON_ANIMATION_ORIGIN = Object.freeze({ left: 490, top: 732 });
export const HUD_COMBAT_BUTTON_FRAME_INTERVAL_MS = 100;

/**
 * `bar_ap` is HUD animation field +0x1fc. Renderer 0x1204c398..0x1204c458
 * clamps the action-point frame to 60 and draws at (201,718). The shipped
 * 620x976 CSX contains 61 620x16 frames. Its combat visibility factor moves
 * toward zero or one by 0.04 per native draw.
 */
export const HUD_ACTION_POINTS_ANIMATION_ORIGIN = Object.freeze({ left: 201, top: 718 });
export const HUD_ACTION_POINTS_MAXIMUM_FRAME = 60;
export const HUD_ACTION_POINTS_OPACITY_STEP = 0.04;

export type HudInterfaceIconAction = "inventory" | "journal" | "none";

export interface HudInterfaceIconDefinition {
    readonly index: number;
    readonly resource: string;
    readonly hintStringId?: number;
    readonly action: HudInterfaceIconAction;
    readonly heroStateId?: number;
}

/**
 * Client.dll icon manager `0x1209bef0` initializes eleven CSX sprites from
 * pointer table `0x1212dc10`. Initializer `0x1209bf59..0x1209bf7b` passes a
 * 30-pixel frame height and a 70 ms interval to `0x12021750`; the retained
 * 40x270 atlases therefore contain nine 40x30 frames (quick_save is 40x540,
 * eighteen frames). Renderer `0x1209bddb..0x1209be07` draws the first active
 * icon at `(4,598)` while the HUD is visible and advances upward by 34 pixels.
 */
export const HUD_INTERFACE_ICON_FRAME_WIDTH = 40;
export const HUD_INTERFACE_ICON_FRAME_HEIGHT = 30;
export const HUD_INTERFACE_ICON_FRAME_INTERVAL_MS = 70;
export const HUD_INTERFACE_ICON_SLOT_STEP = 34;
export const HUD_INTERFACE_ICON_LEFT = 4;
export const HUD_INTERFACE_ICON_FIRST_TOP = 598;

/**
 * Hint IDs come from the native `(icon index, payload)` table at
 * `0x120f8d60`: 0x83..0x87 and 0x9a..0x9e resolve directly through hints.sdb.
 * Status synchronization at `0x1209be25..0x1209beb9` maps hero states
 * 4→blind, 6→cold, 10→poison, and 24→overload. Entries 9 and 10 intentionally
 * share the shipped cold sprite; hints.sdb identifies entry 10 as acceleration,
 * matching native hero state 11 from the recovered state table.
 */
export const HUD_INTERFACE_ICONS = Object.freeze([
    { index: 0, resource: "level_up", hintStringId: 0x83, action: "inventory" },
    { index: 1, resource: "low_ammo", hintStringId: 0x84, action: "inventory" },
    { index: 2, resource: "new_quest", hintStringId: 0x85, action: "journal" },
    { index: 3, resource: "item_break", hintStringId: 0x86, action: "inventory" },
    { index: 4, resource: "need_params", hintStringId: 0x87, action: "inventory" },
    { index: 5, resource: "quick_save", action: "none" },
    { index: 6, resource: "poison", hintStringId: 0x9a, action: "inventory", heroStateId: 10 },
    { index: 7, resource: "blind", hintStringId: 0x9b, action: "inventory", heroStateId: 4 },
    { index: 8, resource: "overload", hintStringId: 0x9c, action: "inventory", heroStateId: 24 },
    { index: 9, resource: "cold", hintStringId: 0x9d, action: "inventory", heroStateId: 6 },
    { index: 10, resource: "cold", hintStringId: 0x9e, action: "inventory", heroStateId: 11 },
] satisfies readonly HudInterfaceIconDefinition[]);

export interface NativeRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Client.dll HUD exchange composition. Resource-table entry 7
 * (`0x120f825c`, `engineres\\gpanel\\exchange`) is stored at HUD field
 * `+0x1c0`. Renderer `0x1204dfd4..0x1204e018` blits it at viewport origin
 * plus `(0xf6, 0xe1)`. The retained bitmap is exactly 528x276.
 */
export const LOOT_EXCHANGE_BACKGROUND_RECT: NativeRect = Object.freeze({
    left: 246,
    top: 225,
    width: 528,
    height: 276,
});

/**
 * Exact diary resource-pointer table 0x120f8a20..0x120f8a38, loaded by
 * 0x1208142f..0x120814a2.
 */
export const DIARY_RESOURCE_NAMES = Object.freeze([
    "engineres\\diary\\main",
    "engineres\\diary\\page1",
    "engineres\\diary\\page2",
    "engineres\\diary\\page3",
    "engineres\\diary\\page4",
    "engineres\\diary\\page4_add",
    "engineres\\diary\\page5",
]);

/**
 * Adjacent alternating DWORDs at 0x120f8a3c..0x120f8a60, consumed by
 * 0x12081ed8..0x12081f48 when diary controls 6..10 are activated.
 * The first column is the SCR object ID. The second column is assigned to
 * field +0x9d8; its exact native selection/page role is not recovered.
 */
export const DIARY_UNCLASSIFIED_CONTROL_VALUES = Object.freeze([
    Object.freeze({ objectId: 6, value: 2 }),
    Object.freeze({ objectId: 7, value: 3 }),
    Object.freeze({ objectId: 8, value: 2 }),
    Object.freeze({ objectId: 9, value: 3 }),
    Object.freeze({ objectId: 10, value: 0 }),
]);

/**
 * DWORD 0x120f8a64 (=2000) is read by text-layout routines
 * 0x12082d17, 0x12082ec6, and 0x12082ef4. It is retained without assigning
 * units; a maximum text-buffer or layout-step limit is only a hypothesis.
 */
export const DIARY_UNCLASSIFIED_TEXT_LIMIT = 2000;

/**
 * Fourteen adjacent RECTs at 0x120f8a80..0x120f8b5c. Renderer loop
 * 0x120843bf..0x120843e7 draws fourteen strings from object fields +0xe0
 * through these rectangles. The owning interface is not yet classified,
 * despite the table's proximity to the diary constants.
 */
export const DIARY_ADJACENT_UNCLASSIFIED_TEXT_RECTS = Object.freeze([
    Object.freeze({ left: 27, top: 227, right: 222, bottom: 250 }),
    Object.freeze({ left: 27, top: 325, right: 230, bottom: 348 }),
    Object.freeze({ left: 27, top: 389, right: 230, bottom: 414 }),
    Object.freeze({ left: 369, top: 227, right: 565, bottom: 250 }),
    Object.freeze({ left: 369, top: 324, right: 565, bottom: 348 }),
    Object.freeze({ left: 369, top: 420, right: 565, bottom: 444 }),
    Object.freeze({ left: 369, top: 517, right: 574, bottom: 541 }),
    Object.freeze({ left: 710, top: 227, right: 906, bottom: 250 }),
    Object.freeze({ left: 710, top: 324, right: 906, bottom: 348 }),
    Object.freeze({ left: 710, top: 421, right: 906, bottom: 444 }),
    Object.freeze({ left: 710, top: 517, right: 915, bottom: 541 }),
    Object.freeze({ left: 710, top: 587, right: 915, bottom: 609 }),
    Object.freeze({ left: 27, top: 456, right: 230, bottom: 481 }),
    Object.freeze({ left: 710, top: 655, right: 915, bottom: 676 }),
]);

/**
 * Client.dll diary list initialization:
 * - left list fields at 0x1207f3fd..0x1207f42d;
 * - normal right list fields at 0x1207eda2..0x1207edd2;
 * - bestiary title/description RECTs at 0x121296ec..0x12129708,
 *   consumed by 0x1207e61e..0x1207e66a and 0x1207e582..0x1207e5d8.
 */
export const DIARY_CONTENT_RECTS = Object.freeze({
    leftList: Object.freeze({ left: 75, top: 110, width: 280, height: 557 }),
    rightList: Object.freeze({ left: 460, top: 110, width: 465, height: 557 }),
    creatureTitle: Object.freeze({ left: 550, top: 109, width: 309, height: 23 }),
    creatureDescription: Object.freeze({ left: 703, top: 157, width: 229, height: 191 }),
} satisfies Readonly<Record<string, NativeRect>>);

export interface InventoryHintBinding {
    readonly objectId: number;
    /** Zero selects one of Client.dll's dynamic tooltip paths. */
    readonly stringId: number;
}

/**
 * Exact 122-pair table copied from 0x121283a0 by
 * 0x1205ea81..0x1205ea8b. Ordering is retained because the native hover
 * resolver linearly scans these pairs. Zero is an authored dynamic binding,
 * not a missing record.
 */
export const INVENTORY_NATIVE_HINT_BINDINGS: readonly InventoryHintBinding[] = Object.freeze([
    { objectId: 9, stringId: 48 },
    { objectId: 10, stringId: 49 },
    { objectId: 11, stringId: 50 },
    { objectId: 12, stringId: 51 },
    { objectId: 13, stringId: 52 },
    { objectId: 14, stringId: 53 },
    { objectId: 15, stringId: 54 },
    { objectId: 90, stringId: 57 },
    { objectId: 91, stringId: 59 },
    { objectId: 92, stringId: 58 },
    { objectId: 93, stringId: 60 },
    { objectId: 94, stringId: 61 },
    { objectId: 95, stringId: 62 },
    { objectId: 96, stringId: 63 },
    { objectId: 97, stringId: 64 },
    ...Array.from({ length: 28 }, (_, index) => ({ objectId: 100 + index, stringId: 99 + index })),
    ...Array.from({ length: 34 }, (_, index) => ({ objectId: 160 + index, stringId: 65 + index })),
    { objectId: 204, stringId: 56 },
    ...Array.from({ length: 10 }, (_, index) => ({ objectId: 194 + index, stringId: 0 })),
    ...Array.from({ length: 7 }, (_, index) => ({ objectId: 23 + index, stringId: 0 })),
    ...Array.from({ length: 27 }, (_, index) => ({ objectId: 31 + index * 2, stringId: 0 })),
]);

export const INVENTORY_STATIC_HINT_BINDINGS: readonly InventoryHintBinding[] = Object.freeze(
    INVENTORY_NATIVE_HINT_BINDINGS.filter(({ stringId }) => stringId !== 0),
);

export interface InventorySkillUpgradeBinding {
    readonly objectId: number;
    readonly valueKey: number;
    readonly nativeSkillIndex: number;
}

/**
 * Odd skill-increase objects pass keys 100..126 to 0x120a90ec. The helper
 * maps those keys through the 27 pairs at 0x1212ed40 to native skill indices;
 * these are not hints.sdb string IDs. The caller then formats only record 145
 * with the next skill value.
 */
export const INVENTORY_SKILL_UPGRADE_BINDINGS: readonly InventorySkillUpgradeBinding[] = Object.freeze([
    12, 13, 7, 8, 9, 10, 11, 14, 24, 4, 5, 0, 1, 2, 3, 17, 25, 23, 26, 15, 20, 21, 16, 18, 19, 22, 6,
].map((nativeSkillIndex, index) => ({
    objectId: 31 + index * 2,
    valueKey: 100 + index,
    nativeSkillIndex,
})));

export const INVENTORY_CHARACTERISTIC_UPGRADE_OBJECT_IDS = Object.freeze(
    Array.from({ length: 7 }, (_, index) => 23 + index),
);

export const INVENTORY_ROLE_STATE_OBJECT_IDS = Object.freeze(
    Array.from({ length: 10 }, (_, index) => 194 + index),
);

export interface NativeHeroStateBinding {
    readonly stateId: number;
    readonly stringId: number;
    readonly resource: string;
}

/**
 * Client.dll constructor 0x1206a410 binds native role-state IDs 0..27 to
 * shipped 20x20 hero-state resources. Tooltip resolver 0x1206a7a8 enumerates
 * active IDs in ascending order and resolves the same ID through hero.sdb.
 */
export const NATIVE_HERO_STATE_BINDINGS: readonly NativeHeroStateBinding[] = Object.freeze([
    "026", "027", "020", "019", "012", "029", "003", "018",
    "024", "025", "017", "010", "007", "011", "013", "014",
    "001", "002", "023", "022", "016", "015", "004", "005",
    "009", "021", "030", "006",
].map((resource, stateId) => ({ stateId, stringId: stateId, resource })));

export interface NativeHeroStateEffectGroup {
    readonly positiveStateId: number;
    readonly negativeStateId?: number;
    readonly specialIds: readonly string[];
}

/**
 * Aggregate comparisons in Client.dll 0x1201be84..0x1201c375: speed,
 * elemental protection, armor, physical protection, six magic immunities,
 * six magic resistances, and accuracy. Direct injury/status flags 0..10,
 * 13, and 24..27 remain separate host states.
 */
export const NATIVE_HERO_STATE_EFFECT_GROUPS: readonly NativeHeroStateEffectGroup[] = Object.freeze([
    { positiveStateId: 11, specialIds: ["IDSPEC_ACTION_POINTS"] },
    { positiveStateId: 12, specialIds: ["IDSPEC_FIRE_RES", "IDSPEC_COLD_RES", "IDSPEC_POISON_RES"] },
    { positiveStateId: 14, negativeStateId: 15, specialIds: ["IDSPEC_ARMOR_CLASS"] },
    { positiveStateId: 16, negativeStateId: 17, specialIds: ["IDSPEC_CRUSHING_RES", "IDSPEC_HACKING_RES", "IDSPEC_PRICKING_RES"] },
    { positiveStateId: 18, negativeStateId: 19, specialIds: [
        "IDSPEC_GODS_MAGIC_IMMUN", "IDSPEC_ELEMENTS_MAGIC_IMMUN", "IDSPEC_LIGHTNESS_MAGIC_IMMUN",
        "IDSPEC_DARKNESS_MAGIC_IMMUN", "IDSPEC_SHADOWS_MAGIC_IMMUN", "IDSPEC_NATURE_MAGIC_IMMUN",
    ] },
    { positiveStateId: 20, negativeStateId: 21, specialIds: [
        "IDSPEC_GODS_MAGIC_RES", "IDSPEC_ELEMENTS_MAGIC_RES", "IDSPEC_LIGHTNESS_MAGIC_RES",
        "IDSPEC_DARKNESS_MAGIC_RES", "IDSPEC_SHADOWS_MAGIC_RES", "IDSPEC_NATURE_MAGIC_RES",
    ] },
    { positiveStateId: 22, negativeStateId: 23, specialIds: ["IDSPEC_CHT_HIT", "IDSPEC_CHT_HIT_THROWING"] },
]);

export const INVENTORY_DYNAMIC_HINT_STRING_IDS = Object.freeze({
    characteristicRequirement: 144,
    skillRequirement: 145,
});

/**
 * The shared authored-control tooltip path starts a 0x12c ms timer at
 * 0x12060c1a..0x12060c1f before constructing the tooltip.
 */
export const GUI_TOOLTIP_DELAY_MS = 0x12c;

/**
 * The inventory-item path starts a 0x190 ms timer at
 * 0x1206089a..0x1206089f before constructing the shared tooltip widget.
 */
export const INVENTORY_ITEM_HINT_DELAY_MS = 0x190;

/**
 * Client.dll HUD renderer 0x1204d38e..0x1204d418 draws resource-table
 * entry `engineres\gpanel\dialog_panel` at viewport origin + (0xc5,0x1ff).
 * The shipped BMP is exactly 627x207.
 */
export const DIALOGUE_PANEL_RECT: NativeRect = Object.freeze({
    left: 197, top: 511, width: 627, height: 207,
});

/**
 * The initialized Client dialogue singleton reports this exact view through
 * fields `+0x149D0/+0x149D4/+0x149D8/+0x149CC`: `(213, 522, 530, 184)`.
 * `Client.dll` `0x120A1B50` uses the same fields for clipping, hit-testing,
 * wrapping, and text placement with the `main_interface` font.
 */
export const DIALOGUE_TEXT_RECT: NativeRect = Object.freeze({
    left: 213, top: 522, width: 530, height: 184,
});

/** Shipped gpanel_new.scr dialogue scrollbar controls. */
export const DIALOGUE_SCROLL_OBJECT_IDS = Object.freeze([44, 45, 46]);
export const DIALOGUE_TRADE_OBJECT_ID = 15;

/** Client.dll dialogue layout constants recovered from 0x120A01F4..0x120A1E1F. */
export const DIALOGUE_LINE_HEIGHT = 0x14;
export const DIALOGUE_CONTINUATION_INDENT = 0x1e;
export const DIALOGUE_ARROW_SCROLL_STEP = 0x0a;
export const DIALOGUE_WHEEL_SCROLL_STEP = 0x19;

/**
 * Client.dll game-menu constructor 0x1208a1d0..0x1208a25a loads
 * `engineres\interface\game_menu\background` with color key 0xff00ff.
 * Renderer 0x1208a264..0x1208a366 draws it at the viewport offsets plus
 * (0x180, 0x5a); the shipped 8-bit BMP is exactly 249x460.
 */
export const PAUSE_MENU_BACKGROUND_RECT: NativeRect = Object.freeze({
    left: 384, top: 90, width: 249, height: 460,
});

/**
 * Client.dll rest-menu framebuffer RECT is initialized at
 * 0x12099222..0x12099259 and offset by the viewport at
 * 0x12099265..0x12099289. Constructor 0x120995bc..0x1209967d loads
 * `engineres\relax\Normal` with color key 0xff00ff.
 */
export const REST_MENU_BACKGROUND_RECT: NativeRect = Object.freeze({
    left: 367, top: 286, width: 290, height: 196,
});

/** Native text RECTs built by 0x12099cac and 0x12099e10. */
export const REST_MENU_CALENDAR_RECT: NativeRect = Object.freeze({
    left: 524, top: 319, width: 113, height: 51,
});
export const REST_MENU_PERIOD_RECT: NativeRect = Object.freeze({
    left: 407, top: 335, width: 76, height: 22,
});

/**
 * Rest-period DWORDs written by constructor 0x1209903c..0x1209913f.
 * Field +0x18 selects one of these five minute counts; it starts at zero
 * and the arrow handlers 0x1209a00c/0x1209a01c clamp at both ends.
 */
export const REST_MENU_PERIOD_MINUTES = Object.freeze([60, 180, 360, 720, 1440]);

/**
 * Client.dll save/load constructor 0x12089380..0x12089576 and renderer
 * 0x120895a4..0x1208995a. The shipped SCR owns close/confirm/page controls;
 * these constants cover the Client-composed resources and text.
 */
export const SAVE_LOAD_PAGE_COUNT = 4;
export const SAVE_LOAD_SLOTS_PER_PAGE = 7;
export const SAVE_LOAD_SLOTS_FRAME_RECT: NativeRect = Object.freeze({
    left: 65, top: 113, width: 301, height: 587,
});
export const SAVE_LOAD_PREVIEW_RECT: NativeRect = Object.freeze({
    left: 451, top: 115, width: 500, height: 375,
});
export const SAVE_LOAD_TITLE_RECT: NativeRect = Object.freeze({
    left: 372, top: 38, width: 261, height: 39,
});
export const SAVE_LOAD_DETAILS_RECT: NativeRect = Object.freeze({
    left: 499, top: 542, width: 402, height: 51,
});
export const SAVE_LOAD_TITLE_STRING_IDS = Object.freeze({
    load: 140,
    save: 141,
});
export const SAVE_LOAD_SLOT_RECTS: readonly NativeRect[] = Object.freeze(
    Array.from({ length: SAVE_LOAD_SLOTS_PER_PAGE }, (_, index) => ({
        left: 65,
        top: 113 + index * 88,
        width: 301,
        height: 59,
    })),
);
