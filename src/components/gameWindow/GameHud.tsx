import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Game } from "../../game/Game.ts";
import { loadCSX, loadImage } from "../../game/Assets.ts";
import { getProfessionSkills } from "../../constants/professionSkills.ts";
import {
    HUD_INTERFACE_ICONS,
    HUD_INTERFACE_ICON_FRAME_WIDTH,
    HUD_INTERFACE_ICON_FRAME_HEIGHT,
    HUD_INTERFACE_ICON_FIRST_TOP,
    HUD_INTERFACE_ICON_FRAME_INTERVAL_MS,
    HUD_INTERFACE_ICON_LEFT,
    HUD_INTERFACE_ICON_SLOT_STEP,
    HUD_GAUGE_ANIMATION_ORIGINS,
    HUD_ACTION_POINTS_ANIMATION_ORIGIN,
    HUD_ACTION_POINTS_MAXIMUM_FRAME,
    HUD_ACTION_POINTS_OPACITY_STEP,
    HUD_COMBAT_BUTTON_ANIMATION_ORIGIN,
    HUD_COMBAT_BUTTON_FRAME_INTERVAL_MS,
    HUD_DAMAGE_MODE_FLAGS,
    HUD_DAMAGE_MODE_SEQUENCE,
    HUD_DAMAGE_RESOURCE_BY_MODE,
    HUD_NATIVE_ANIMATION_FRAME_HEIGHTS,
    HUD_NO_WEAPON_POSITION,
    HUD_WHEEL_ANIMATION_ORIGIN,
    HUD_WHEEL_DAY_MINUTES,
    HUD_WHEEL_START_HOUR,
    type HudDamageMode,
    type ProfessionSkillDefinition,
    type HudInterfaceIconDefinition,
} from "../../constants/clientDll.ts";
import { CONSOLE_FONT, MAIN_INTERFACE_FONT } from "../../constants/fontsScr.ts";
import { Paths } from "../../constants/paths.ts";
import { loadGuiDefinition, type GuiDefinition } from "../../game/GuiDefinitionRuntime.ts";
import { loadMagicCatalog, type MagicDefinition } from "../../game/MagicCatalogRuntime.ts";
import { loadShippedItemCatalog } from "../../game/ItemCatalogRuntime.ts";
import { SDBParser } from "../../game/parsers/SDBParser.ts";
import { originalLevelForExperience } from "../../game/systems/Combat.ts";
import { ColorKeyImage } from "../ColorKeyImage.tsx";
import { guiObjectStyle, OriginalGuiLayer, type GuiControlValue } from "../OriginalGuiLayer.tsx";
import { GuiTooltip } from "../gui/GuiTooltip.tsx";
import styles from "./GameHudNative.module.scss";

const MINIMAP_CAMERA_START_FOLLOW_FACTOR = 0.1;
const MINIMAP_CAMERA_END_FOLLOW_FACTOR = 0.07;
/** Client.dll 0x12039ecc: round(minimapScale * 3 * 12 + 2) + 7. */
const nativeMinimapTransitionGlowSize = (minimapScale: number): number =>
    Math.max(1, Math.round(minimapScale * 36 + 2) + 7);
const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.max(minimum, Math.min(maximum, value));

interface GameHudProps {
    getGame: () => Game | null;
    statusText: string;
    statusMessages: readonly Readonly<{ id: number; text: string }>[];
    quickSaveSignal: number;
    needParamsSignal: number;
    onSkills: () => void;
    onProfessionSkill: (skill: ProfessionSkillDefinition, availableSkills: readonly ProfessionSkillDefinition[]) => void;
    onInventory: () => void;
    onJournal: () => void;
    onMagic: () => void;
    onRest: () => void;
    onPause: () => void;
    skillsActive: boolean;
    onCombatModeChange?: (active: boolean) => void;
}

interface HudInfo {
    lifeValue: number;
    lifeMaximum: number;
    lifeRatio: number;
    energyValue: number;
    energyMaximum: number;
    energyRatio: number;
    elapsedMinutes: number;
    actionPoints: number;
    worldMapAvailable: boolean;
    combatMode: boolean;
    heroDead: boolean;
    combatMessage: string;
    hotbarSpellIds: readonly (number | null)[];
    castableSpellIds: readonly number[];
    selectedSpellId?: number;
    professionSkills: readonly ProfessionSkillDefinition[];
    weaponItemId: string;
    weaponItemClass?: string;
    weaponNativeFlags: number;
    conditionIconIds: readonly number[];
}

const initialInfo: HudInfo = {
    lifeValue: 0,
    lifeMaximum: 0,
    lifeRatio: 1,
    energyValue: 0,
    energyMaximum: 0,
    energyRatio: 1,
    elapsedMinutes: 0,
    actionPoints: 0,
    worldMapAvailable: false,
    combatMode: false,
    heroDead: false,
    combatMessage: "",
    hotbarSpellIds: Array.from({ length: 9 }, () => null),
    castableSpellIds: [],
    professionSkills: [],
    weaponItemId: "unarmed",
    weaponItemClass: "mace",
    weaponNativeFlags: HUD_DAMAGE_MODE_FLAGS[1],
    conditionIconIds: [],
};

const readValue = (parameters: Readonly<Record<string, number>>, names: readonly string[]): number | undefined => {
    for (const name of names) {
        const value = parameters[name];
        if (value !== undefined) return value;
    }
    return undefined;
};

const nativeStateParameterActive = (parameters: Readonly<Record<string, number>>, stateId: number): boolean =>
    (readValue(parameters, [`state_${stateId}`, `state${stateId}`, `hero_state_${stateId}`, `status_${stateId}`]) ?? 0) > 0;

const nativeStatusIconIds = (
    parameters: Readonly<Record<string, number>>,
    specialIds: ReadonlySet<string>,
): readonly number[] => {
    const result: number[] = [];
    if (nativeStateParameterActive(parameters, 10) || specialIds.has("IDSPEC_POISON_DMG")) result.push(6);
    if (nativeStateParameterActive(parameters, 4) || [...specialIds].some((id) => id.includes("BLIND"))) result.push(7);
    if (nativeStateParameterActive(parameters, 24)
        || (readValue(parameters, ["overload", "overloaded", "encumbered"]) ?? 0) > 0) result.push(8);
    if (nativeStateParameterActive(parameters, 6) || specialIds.has("IDSPEC_COLD_DMG")) result.push(9);
    if (nativeStateParameterActive(parameters, 11) || specialIds.has("IDSPEC_ACTION_POINTS")) result.push(10);
    return result;
};

const NativeHudInterfaceIcon = ({ definition, tooltip, slot, onClick, onAnimationComplete }: {
    readonly definition: HudInterfaceIconDefinition;
    readonly tooltip?: string;
    readonly slot: number;
    readonly onClick: () => void;
    readonly onAnimationComplete?: () => void;
}): React.JSX.Element => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [tooltipVisible, setTooltipVisible] = useState(false);
    const animationCompleteRef = useRef(onAnimationComplete);
    animationCompleteRef.current = onAnimationComplete;
    const top = HUD_INTERFACE_ICON_FIRST_TOP - slot * HUD_INTERFACE_ICON_SLOT_STEP;
    useEffect(() => {
        let cancelled = false;
        let animationFrame = 0;
        void loadCSX(`${Paths.ENGINERES}/interface/icons/${definition.resource}.csx`).then((sprite) => {
            if (cancelled || !sprite) return;
            const canvas = canvasRef.current;
            const context = canvas?.getContext("2d");
            if (!canvas || !context) return;
            const frameCount = Math.max(1, Math.floor(sprite.height / HUD_INTERFACE_ICON_FRAME_HEIGHT));
            const startedAt = performance.now();
            let completed = false;
            const draw = (now: number): void => {
                if (cancelled) return;
                const frame = Math.min(frameCount - 1,
                    Math.floor((now - startedAt) / HUD_INTERFACE_ICON_FRAME_INTERVAL_MS));
                const sourceFrame = document.createElement("canvas");
                sourceFrame.width = HUD_INTERFACE_ICON_FRAME_WIDTH;
                sourceFrame.height = HUD_INTERFACE_ICON_FRAME_HEIGHT;
                const sourceContext = sourceFrame.getContext("2d");
                if (!sourceContext) return;
                drawColorKeyed(sourceContext, sprite,
                    0, frame * HUD_INTERFACE_ICON_FRAME_HEIGHT,
                    HUD_INTERFACE_ICON_FRAME_WIDTH, HUD_INTERFACE_ICON_FRAME_HEIGHT, 0, 0);
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(sourceFrame, 0, 0);
                if (frame < frameCount - 1) animationFrame = window.requestAnimationFrame(draw);
                else if (!completed) {
                    completed = true;
                    animationCompleteRef.current?.();
                }
            };
            animationFrame = window.requestAnimationFrame(draw);
        }).catch((error) => console.error(`Не удалось загрузить HUD-иконку ${definition.resource}`, error));
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(animationFrame);
        };
    }, [definition.resource]);

    return <>
        <button className={styles.interfaceIcon} type="button" aria-label={tooltip ?? "Быстрое сохранение"}
            style={{
                left: HUD_INTERFACE_ICON_LEFT,
                top,
                width: HUD_INTERFACE_ICON_FRAME_WIDTH,
                height: HUD_INTERFACE_ICON_FRAME_HEIGHT,
            }} onClick={onClick} aria-disabled={definition.action === "none"}
            onPointerEnter={() => setTooltipVisible(true)} onPointerLeave={() => setTooltipVisible(false)}
            onFocus={() => setTooltipVisible(true)} onBlur={() => setTooltipVisible(false)}>
            <canvas ref={canvasRef} width={HUD_INTERFACE_ICON_FRAME_WIDTH} height={HUD_INTERFACE_ICON_FRAME_HEIGHT} />
        </button>
        {tooltipVisible && tooltip && <GuiTooltip text={tooltip}
            anchor={{ left: HUD_INTERFACE_ICON_LEFT, top,
                width: HUD_INTERFACE_ICON_FRAME_WIDTH, height: HUD_INTERFACE_ICON_FRAME_HEIGHT }}
            canvasWidth={1024} canvasHeight={768} />}
    </>;
};

const availableHudDamageModes = (nativeFlags: number): readonly HudDamageMode[] =>
    HUD_DAMAGE_MODE_SEQUENCE.filter((mode) => (nativeFlags & HUD_DAMAGE_MODE_FLAGS[mode]) !== 0);

const nextHudDamageMode = (
    current: HudDamageMode | undefined,
    available: readonly HudDamageMode[],
): HudDamageMode | undefined => {
    if (available.length === 0) return undefined;
    const currentIndex = current === undefined ? -1 : available.indexOf(current);
    return available[(currentIndex + 1) % available.length];
};

const drawColorKeyed = (
    target: CanvasRenderingContext2D,
    image: CanvasImageSource,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    destinationX: number,
    destinationY: number,
): void => {
    const buffer = document.createElement("canvas");
    buffer.width = sourceWidth;
    buffer.height = sourceHeight;
    const context = buffer.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
    const pixels = context.getImageData(0, 0, sourceWidth, sourceHeight);
    for (let index = 0; index < pixels.data.length; index += 4) {
        if (pixels.data[index] >= 250 && pixels.data[index + 1] <= 5 && pixels.data[index + 2] >= 250) {
            pixels.data[index + 3] = 0;
        }
    }

    context.putImageData(pixels, 0, 0);
    target.drawImage(buffer, destinationX, destinationY);
};

const buildAlphaMaskedFrames = (
    sprite: CanvasImageSource & { readonly width: number; readonly height: number },
    alphaMask: CanvasImageSource & { readonly width: number; readonly height: number },
    frameHeight: number,
): readonly HTMLCanvasElement[] => {
    const frameCount = Math.min(Math.floor(sprite.height / frameHeight), Math.floor(alphaMask.height / frameHeight));
    return Array.from({ length: frameCount }, (_, frame) => {
        const canvas = document.createElement("canvas");
        canvas.width = sprite.width;
        canvas.height = frameHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return canvas;
        context.drawImage(sprite, 0, frame * frameHeight, sprite.width, frameHeight, 0, 0, sprite.width, frameHeight);
        const pixels = context.getImageData(0, 0, sprite.width, frameHeight);
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = alphaMask.width;
        maskCanvas.height = frameHeight;
        const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
        if (!maskContext) return canvas;
        maskContext.drawImage(alphaMask, 0, frame * frameHeight, alphaMask.width, frameHeight, 0, 0, alphaMask.width, frameHeight);
        const mask = maskContext.getImageData(0, 0, alphaMask.width, frameHeight).data;
        for (let index = 0; index < pixels.data.length; index += 4) {
            const colorKeyed = pixels.data[index] >= 250 && pixels.data[index + 1] <= 5 && pixels.data[index + 2] >= 250;
            pixels.data[index + 3] = colorKeyed ? 0 : mask[index];
        }
        context.putImageData(pixels, 0, 0);
        return canvas;
    });
};


const HUD_STATUS_FONT_STYLE: CSSProperties = Object.freeze({
    fontFamily: `ZlatoPalatino, "${MAIN_INTERFACE_FONT.typeFace}", serif`,
    fontSize: `${MAIN_INTERFACE_FONT.size}px`,
    fontWeight: MAIN_INTERFACE_FONT.weight,
});

/** Client.dll 0x1205a5f4: native history-panel rectangles and text insets. */
const HUD_STATUS_HISTORY_LAYOUTS = Object.freeze({
    expanded: Object.freeze({ left: 200, top: 508, width: 627, height: 191, textLeft: 15, textTop: 4, textWidth: 570, textHeight: 184 }),
    compact: Object.freeze({ left: 200, top: 629, width: 627, height: 70, textLeft: 15, textTop: 4, textWidth: 570, textHeight: 63 }),
});
const HUD_STATUS_HISTORY_DEPTH = 15;
const HUD_STATUS_SHOW_TIME_MS = 3000;
const HUD_STATUS_SCROLL_STEP = 5;
const HUD_STATUS_WHEEL_STEP = HUD_STATUS_SCROLL_STEP * 2;

type HudStatusHistoryMode = keyof typeof HUD_STATUS_HISTORY_LAYOUTS;

interface HudStatusHistoryEntry {
    readonly id: number;
    readonly text: string;
}

const HUD_VALUE_FONT_STYLE: CSSProperties = Object.freeze({
    fontFamily: `ZlatoConsole, "${CONSOLE_FONT.typeFace}", monospace`,
    fontSize: `${CONSOLE_FONT.size}px`,
});

interface MinimapDragState {
    pointerId: number;
    target: Readonly<{ x: number; y: number }>;
    initialDistance: number | undefined;
}

export const GameHud = ({ getGame, statusText, statusMessages, quickSaveSignal, needParamsSignal, onSkills, onProfessionSkill, onInventory, onJournal, onMagic, onPause, onRest, skillsActive, onCombatModeChange }: GameHudProps) => {

    const frameRef = useRef<HTMLCanvasElement>(null);
    const healthFrameRef = useRef<number | null>(null);
    const energyFrameRef = useRef<number | null>(null);
    const combatButtonFrameRef = useRef<number | null>(null);
    const combatButtonAdvanceAtRef = useRef(0);
    const actionPointsOpacityRef = useRef(0);
    const minimapRef = useRef<HTMLCanvasElement>(null);
    const noWeaponRef = useRef<HTMLCanvasElement>(null);
    const minimapDragRef = useRef<MinimapDragState | null>(null);
    const [hudVisible, setHudVisible] = useState(true);
    const [minimapVisible, setMinimapVisible] = useState(true);
    const [info, setInfo] = useState(initialInfo);
    const [damageMode, setDamageMode] = useState<HudDamageMode | undefined>(1);
    const [weaponIconUrl, setWeaponIconUrl] = useState<string | undefined>();
    const previousLevelRef = useRef<number | null>(null);
    const previousQuestFlagsRef = useRef<Readonly<Record<string, boolean>> | null>(null);
    const [persistentIconIds, setPersistentIconIds] = useState<ReadonlySet<number>>(() => new Set());
    const [statusHistoryVisible, setStatusHistoryVisible] = useState(false);
    const [statusHistoryMode, setStatusHistoryMode] = useState<HudStatusHistoryMode>("compact");
    const [statusHistory, setStatusHistory] = useState<readonly HudStatusHistoryEntry[]>([]);
    const [statusScrollOffset, setStatusScrollOffset] = useState(0);
    const [maximumStatusScroll, setMaximumStatusScroll] = useState(0);
    const [transientStatusText, setTransientStatusText] = useState("");
    const statusHistoryViewportRef = useRef<HTMLDivElement>(null);
    const statusMessageIdRef = useRef(0);
    const statusMessageTimerRef = useRef<number | null>(null);
    const processedStatusMessageIdRef = useRef(0);
    const previousCombatMessageRef = useRef("");
    const minimapTargetAt = useCallback((clientX: number, clientY: number): Readonly<{ x: number; y: number }> | null => {
        const canvas = minimapRef.current;
        const mapSize = getGame()?.getLevel()?.getData()?.lvlData.mapSize;
        if (!canvas || !mapSize) return null;
        const bounds = canvas.getBoundingClientRect();
        return {
            x: clamp((clientX - bounds.left) / Math.max(1, bounds.width), 0, 1) * mapSize.width,
            y: clamp((clientY - bounds.top) / Math.max(1, bounds.height), 0, 1) * mapSize.height,
        };
    }, [getGame]);
    const [magicDefinitions, setMagicDefinitions] = useState<readonly MagicDefinition[]>([]);
    const [guiDefinition, setGuiDefinition] = useState<GuiDefinition | null>(null);
    const [interfaceStrings, setInterfaceStrings] = useState<Record<number, string>>({});
    const [hintStrings, setHintStrings] = useState<Record<number, string>>({});
    const guiObjects = useMemo(
        () => new Map(guiDefinition?.objects.map((object) => [object.id, object]) ?? []),
        [guiDefinition],
    );
    const addStatusMessage = useCallback((text: string, showTransient = true): void => {
        const normalized = text.trim();
        if (!normalized) return;
        setStatusHistory((current) => {
            const next = [...current, { id: ++statusMessageIdRef.current, text: normalized }];
            return next.slice(-HUD_STATUS_HISTORY_DEPTH);
        });
        if (!showTransient) return;
        setTransientStatusText(normalized);
        if (statusMessageTimerRef.current !== null) window.clearTimeout(statusMessageTimerRef.current);
        statusMessageTimerRef.current = window.setTimeout(() => {
            setTransientStatusText("");
            statusMessageTimerRef.current = null;
        }, HUD_STATUS_SHOW_TIME_MS);
    }, []);

    useEffect(() => () => {
        if (statusMessageTimerRef.current !== null) window.clearTimeout(statusMessageTimerRef.current);
    }, []);

    useEffect(() => {
        const unprocessed = statusMessages.filter((message) => message.id > processedStatusMessageIdRef.current);
        for (const [index, message] of unprocessed.entries()) {
            processedStatusMessageIdRef.current = message.id;
            addStatusMessage(message.text, index === unprocessed.length - 1);
        }
    }, [addStatusMessage, statusMessages]);

    useEffect(() => {
        const message = info.heroDead ? "Игра окончена." : info.combatMessage;
        if (!message || message === previousCombatMessageRef.current) {
            previousCombatMessageRef.current = message;
            return;
        }
        previousCombatMessageRef.current = message;
        addStatusMessage(message);
    }, [addStatusMessage, info.combatMessage, info.heroDead]);

    useEffect(() => {
        const viewport = statusHistoryViewportRef.current;
        if (!statusHistoryVisible || !viewport) return;
        const animationFrame = window.requestAnimationFrame(() => {
            const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
            setMaximumStatusScroll(maximum);
            setStatusScrollOffset((current) => {
                const bounded = clamp(current, 0, maximum);
                viewport.scrollTop = maximum - bounded;
                return bounded;
            });
        });
        return () => window.cancelAnimationFrame(animationFrame);
    }, [statusHistory, statusHistoryMode, statusHistoryVisible, statusScrollOffset]);

    const scrollStatusHistory = (delta: number): void => {
        setStatusScrollOffset((current) => clamp(current + delta, 0, maximumStatusScroll));
    };
    const setStatusSliderFromPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const thumbTravel = Math.max(1, bounds.height - 16);
        const thumbTop = clamp(event.clientY - bounds.top - 8, 0, thumbTravel);
        const value = maximumStatusScroll * (1 - thumbTop / thumbTravel);
        setStatusScrollOffset(maximumStatusScroll - value);
    };

    useEffect(() => {
        let cancelled = false;
        void Promise.all([
            loadMagicCatalog(),
            loadGuiDefinition("gpanel_new"),
            ...["user_interface", "hints"].map((name) => fetch(`/assets/sdb/${name}.sdb`).then(async (response) => {
                if (!response.ok) throw new Error(`${name} strings failed: HTTP ${response.status}`);
                return new SDBParser(await response.arrayBuffer()).getData();
            })),
        ]).then(([definitions, gui, strings, hints]) => {
            if (cancelled) return;
            setMagicDefinitions(definitions as readonly MagicDefinition[]);
            setGuiDefinition(gui as GuiDefinition);
            setInterfaceStrings(strings as Record<number, string>);
            setHintStrings(hints as Record<number, string>);
        }).catch((error) => console.error("Не удалось загрузить HUD", error));
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (quickSaveSignal <= 0) return;
        setPersistentIconIds((current) => new Set(current).add(5));
    }, [quickSaveSignal]);

    useEffect(() => {
        if (needParamsSignal <= 0) return;
        setPersistentIconIds((current) => new Set(current).add(4));
    }, [needParamsSignal]);

    useEffect(() => {
        const update = () => {
            const game = getGame();
            const level = game?.getLevel();
            if (!game || !level) return;

            const runtime = level.getRuntimeSnapshot();
            const rawHeroParameters = Object.entries(runtime.personParameters).find(([owner]) => owner.toLowerCase() === "hero")?.[1] ?? {};
            const heroParameters = Object.fromEntries(Object.entries(rawHeroParameters).map(([name, value]) => [name.toLowerCase(), value]));
            const heroCombat = Object.entries(runtime.combat.combatants).find(([owner]) => owner.toLowerCase() === "hero")?.[1];
            const lifeValue = heroCombat?.health ?? readValue(heroParameters, ["life", "health", "current_life"]) ?? 0;
            const lifeMaximum = heroCombat?.maximumHealth ?? readValue(heroParameters, ["max_life", "max_health", "maxlife", "maximum_life"]) ?? 0;
            const energyValue = heroCombat?.energy ?? readValue(heroParameters, ["mana", "energy", "current_mana"]) ?? 0;
            const energyMaximum = heroCombat?.maximumEnergy ?? readValue(heroParameters, ["max_mana", "max_energy", "maxmana", "maximum_mana"]) ?? 0;
            const currentLevel = originalLevelForExperience(runtime.experience);
            if (previousLevelRef.current !== null && currentLevel > previousLevelRef.current) {
                setPersistentIconIds((current) => new Set(current).add(0));
            }
            previousLevelRef.current = currentLevel;
            const previousQuestFlags = previousQuestFlagsRef.current;
            if (previousQuestFlags && Object.keys(runtime.questFlags).some((name) => !(name in previousQuestFlags))) {
                setPersistentIconIds((current) => new Set(current).add(2));
            }
            previousQuestFlagsRef.current = runtime.questFlags;
            const ammoQuantity = runtime.equippedStacks.ammo?.quantity ?? 0;
            const lowAmmo = ["bow", "crossbow", "firearm"].includes(heroCombat?.profile.weapon.itemClass ?? "")
                && ammoQuantity <= 3;
            const lowDurability = Object.values(runtime.equippedStacks)
                .some((stack) => (stack?.item.durability ?? 100) <= 10);
            const heroEffectIds = new Set(runtime.magic.activeEffects
                .filter(({ targetName }) => targetName.toLowerCase() === "hero")
                .map(({ specialId }) => specialId));
            const conditionIconIds = [
                ...(lowAmmo ? [1] : []),
                ...(lowDurability ? [3] : []),
                ...nativeStatusIconIds(heroParameters, heroEffectIds),
            ];

            setInfo({
                lifeValue,
                lifeMaximum,
                lifeRatio: lifeMaximum > 0 ? Math.max(0, Math.min(1, lifeValue / lifeMaximum)) : 1,
                energyValue,
                energyMaximum,
                energyRatio: energyMaximum > 0 ? Math.max(0, Math.min(1, energyValue / energyMaximum)) : 1,
                elapsedMinutes: runtime.elapsedMinutes,
                actionPoints: heroCombat?.actionPoints ?? 0,
                worldMapAvailable: game.canShowWorldMap(),
                combatMode: game.isCombatMode(),
                heroDead: heroCombat?.health === 0,
                combatMessage: runtime.combat.message,
                hotbarSpellIds: runtime.magic.hotbarSpellIds,
                castableSpellIds: runtime.magic.castableSpellIds,
                selectedSpellId: runtime.magic.selectedSpellId,
                professionSkills: getProfessionSkills(heroParameters),
                weaponItemId: heroCombat?.profile.weapon.itemId ?? "unarmed",
                weaponItemClass: heroCombat?.profile.weapon.itemClass,
                weaponNativeFlags: heroCombat?.profile.weapon.nativeFlags ?? HUD_DAMAGE_MODE_FLAGS[1],
                conditionIconIds,
            });
        };
        update();
        const interval = window.setInterval(update, 250);
        return () => window.clearInterval(interval);
    }, [getGame]);

    const damageModes = useMemo(
        () => availableHudDamageModes(info.weaponNativeFlags),
        [info.weaponNativeFlags],
    );
    useEffect(() => {
        setDamageMode((current) => current !== undefined && damageModes.includes(current)
            ? current
            : damageModes[0]);
    }, [damageModes, info.weaponItemId]);

    useEffect(() => {
        let cancelled = false;
        if (info.weaponItemId === "unarmed") {
            setWeaponIconUrl(undefined);
            return () => { cancelled = true; };
        }
        void loadShippedItemCatalog()
            .then((catalog) => catalog.get(info.weaponItemId))
            .then((item) => { if (!cancelled) setWeaponIconUrl(item.iconUrl); })
            .catch((error) => {
                if (!cancelled) {
                    setWeaponIconUrl(undefined);
                    console.error(`Не удалось загрузить иконку оружия ${info.weaponItemId}`, error);
                }
            });
        return () => { cancelled = true; };
    }, [info.weaponItemId]);

    useEffect(() => {
        if (info.weaponItemId !== "unarmed") return;
        let cancelled = false;
        void Promise.all([
            loadImage(`${Paths.ENGINERES}/gpanel/damage/noweapon.bmp`),
            loadImage(`${Paths.ENGINERES}/gpanel/damage/noweapon_alpha.bmp`),
        ]).then(([sprite, alphaMask]) => {
            if (cancelled) return;
            const canvas = noWeaponRef.current;
            const context = canvas?.getContext("2d");
            if (!canvas || !context) return;
            const [image] = buildAlphaMaskedFrames(sprite, alphaMask, HUD_NO_WEAPON_POSITION.height);
            context.clearRect(0, 0, canvas.width, canvas.height);
            if (image) context.drawImage(image, 0, 0);
        }).catch((error) => console.error("Не удалось загрузить нативный индикатор пустой руки", error));
        return () => { cancelled = true; };
    }, [info.weaponItemId]);

    useEffect(() => {
        let cancelled = false;
        let animationFrame = 0;
        void Promise.all([
            loadImage(`${Paths.ENGINERES}/gpanel/std.bmp`),
            loadImage(`${Paths.ENGINERES}/gpanel/anim/health.bmp`),
            loadImage(`${Paths.ENGINERES}/gpanel/anim/energy.bmp`),
            loadImage(`${Paths.ENGINERES}/gpanel/anim/koleso.bmp`),
            loadImage(`${Paths.ENGINERES}/gpanel/anim/but_spr.bmp`),
            loadImage(`${Paths.ENGINERES}/gpanel/anim/but_alfa.bmp`),
            loadCSX(`${Paths.ENGINERES}/gpanel/anim/bar_ap.csx`),
        ]).then(([frame, health, energy, wheel, combatButton, combatButtonAlpha, actionPoints]) => {
            if (cancelled) return;
            const canvas = frameRef.current;
            const context = canvas?.getContext("2d");
            if (!canvas || !context) return;
            const healthFrameCount = Math.max(1, Math.floor(health.height / HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.health));
            const energyFrameCount = Math.max(1, Math.floor(energy.height / HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.energy));
            const wheelFrameCount = Math.max(1, Math.floor(wheel.height / HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.wheel));
            const combatButtonFrames = buildAlphaMaskedFrames(combatButton, combatButtonAlpha, HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.button);
            const combatButtonTarget = info.combatMode ? combatButtonFrames.length - 1 : 0;
            if (combatButtonFrameRef.current === null) combatButtonFrameRef.current = combatButtonTarget;
            const actionPointsFrameCount = actionPoints
                ? Math.max(1, Math.floor(actionPoints.height / HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.actionPoints))
                : 0;
            const actionPointsFrame = Math.min(
                Math.max(0, actionPointsFrameCount - 1),
                HUD_ACTION_POINTS_MAXIMUM_FRAME,
                Math.max(0, Math.floor(info.actionPoints)),
            );
            const minuteOfDay = ((Math.floor(info.elapsedMinutes) % HUD_WHEEL_DAY_MINUTES) + HUD_WHEEL_DAY_MINUTES) % HUD_WHEEL_DAY_MINUTES;
            const hour = Math.floor(minuteOfDay / 60);
            const minute = minuteOfDay % 60;
            const rotatedMinutes = hour >= HUD_WHEEL_START_HOUR
                ? minute + 60 * (hour - HUD_WHEEL_START_HOUR)
                : minute + 60 * hour + 60 * (24 - HUD_WHEEL_START_HOUR);
            const wheelFrame = Math.floor(rotatedMinutes / (HUD_WHEEL_DAY_MINUTES / wheelFrameCount));
            const healthTarget = Math.floor(info.lifeRatio * (healthFrameCount - 1));
            const energyTarget = Math.floor(info.energyRatio * (energyFrameCount - 1));
            const advance = (current: number | null, target: number): number =>
                current === null ? target : current < target ? current + 1 : current > target ? current - 1 : current;
            const draw = (now = performance.now()): void => {
                if (cancelled) return;
                const healthFrame = advance(healthFrameRef.current, healthTarget);
                const energyFrame = advance(energyFrameRef.current, energyTarget);
                healthFrameRef.current = healthFrame;
                energyFrameRef.current = energyFrame;
                let combatButtonFrame = combatButtonFrameRef.current ?? combatButtonTarget;
                if (combatButtonFrame !== combatButtonTarget && now >= combatButtonAdvanceAtRef.current) {
                    combatButtonFrame += combatButtonFrame < combatButtonTarget ? 1 : -1;
                    combatButtonFrameRef.current = combatButtonFrame;
                    combatButtonAdvanceAtRef.current = now + HUD_COMBAT_BUTTON_FRAME_INTERVAL_MS;
                }
                const actionPointsOpacityTarget = info.combatMode ? 1 : 0;
                const actionPointsOpacity = actionPointsOpacityRef.current < actionPointsOpacityTarget
                    ? Math.min(actionPointsOpacityTarget, actionPointsOpacityRef.current + HUD_ACTION_POINTS_OPACITY_STEP)
                    : Math.max(actionPointsOpacityTarget, actionPointsOpacityRef.current - HUD_ACTION_POINTS_OPACITY_STEP);
                actionPointsOpacityRef.current = actionPointsOpacity;
                context.clearRect(0, 0, canvas.width, canvas.height);
                drawColorKeyed(context, frame,
                    0, 0, frame.width, frame.height,
                    0, canvas.height - frame.height);
                drawColorKeyed(context, health,
                    0,
                    healthFrame * HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.health,
                    health.width,
                    HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.health,
                    HUD_GAUGE_ANIMATION_ORIGINS.health.left,
                    HUD_GAUGE_ANIMATION_ORIGINS.health.top);
                drawColorKeyed(context, energy,
                    0,
                    energyFrame * HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.energy,
                    energy.width,
                    HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.energy,
                    HUD_GAUGE_ANIMATION_ORIGINS.energy.left,
                    HUD_GAUGE_ANIMATION_ORIGINS.energy.top);
                drawColorKeyed(context, wheel,
                    0,
                    wheelFrame * HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.wheel,
                    wheel.width,
                    HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.wheel,
                    HUD_WHEEL_ANIMATION_ORIGIN.left,
                    HUD_WHEEL_ANIMATION_ORIGIN.top);
                const combatButtonImage = combatButtonFrames[combatButtonFrame];
                if (combatButtonImage) context.drawImage(combatButtonImage,
                    HUD_COMBAT_BUTTON_ANIMATION_ORIGIN.left,
                    HUD_COMBAT_BUTTON_ANIMATION_ORIGIN.top);
                if (actionPoints && actionPointsOpacity > 0) {
                    context.save();
                    context.globalAlpha = actionPointsOpacity;
                    context.drawImage(actionPoints,
                        0,
                        actionPointsFrame * HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.actionPoints,
                        actionPoints.width,
                        HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.actionPoints,
                        HUD_ACTION_POINTS_ANIMATION_ORIGIN.left,
                        HUD_ACTION_POINTS_ANIMATION_ORIGIN.top,
                        actionPoints.width,
                        HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.actionPoints);
                    context.restore();
                }
                if (healthFrame !== healthTarget || energyFrame !== energyTarget
                    || combatButtonFrame !== combatButtonTarget || actionPointsOpacity !== actionPointsOpacityTarget) {
                    animationFrame = window.requestAnimationFrame(draw);
                }
            };
            draw();
        });
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(animationFrame);
        };
    }, [info.lifeRatio, info.energyRatio, info.elapsedMinutes, info.combatMode, info.actionPoints]);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent): void => {
            const drag = minimapDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const target = minimapTargetAt(event.clientX, event.clientY);
            if (target) {
                drag.target = target;
                drag.initialDistance = undefined;
            }
            event.preventDefault();
        };
        const endDrag = (event: PointerEvent): void => {
            const drag = minimapDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            minimapDragRef.current = null;
            const canvas = minimapRef.current;
            if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        };
        window.addEventListener("pointermove", handlePointerMove, { passive: false });
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", endDrag);
            window.removeEventListener("pointercancel", endDrag);
        };
    }, [minimapTargetAt]);

    useEffect(() => {
        const canvas = minimapRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        let stopped = false;
        let animationFrame = 0;
        let loadedPack = "";
        let loadingPack = "";
        let minimap: HTMLCanvasElement | undefined;
        let transitionGlow: HTMLImageElement | undefined;
        void loadImage(Paths.MINIMAP_TRANSITION_GLOW)
            .then((image) => {
                if (!stopped) transitionGlow = image;
            })
            .catch((error) => console.error("Не удалось загрузить маркер перехода миникарты", error));

        const draw = () => {
            if (stopped) return;
            const game = getGame();
            const level = game?.getLevel();
            const data = level?.getData();
            if (data && data.sefData.pack !== loadedPack && data.sefData.pack !== loadingPack) {
                loadingPack = data.sefData.pack;
                void loadCSX(Paths.LEVEL_MININAP(loadingPack)).then((image) => {
                    if (stopped || loadingPack !== data.sefData.pack) return;
                    minimap = image;
                    loadedPack = data.sefData.pack;
                });
            }

            context.clearRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = "#120f0b";
            context.fillRect(0, 0, canvas.width, canvas.height);
            const state = level?.getMinimapState();
            if (minimap && data && state) {
                const mapWidth = Math.max(1, data.lvlData.mapSize.width);
                const mapHeight = Math.max(1, data.lvlData.mapSize.height);
                const drag = minimapDragRef.current;
                if (drag && game) {
                    const currentX = state.camera.left + state.camera.width / 2;
                    const currentY = state.camera.top + state.camera.height / 2;
                    const targetX = clamp(
                        drag.target.x,
                        Math.min(state.camera.width / 2, mapWidth / 2),
                        Math.max(mapWidth - state.camera.width / 2, mapWidth / 2),
                    );
                    const targetY = clamp(
                        drag.target.y,
                        Math.min(state.camera.height / 2, mapHeight / 2),
                        Math.max(mapHeight - state.camera.height / 2, mapHeight / 2),
                    );
                    const distance = Math.hypot(targetX - currentX, targetY - currentY);
                    drag.initialDistance ??= Math.max(distance, Number.EPSILON);
                    const progress = clamp(1 - distance / drag.initialDistance, 0, 1);
                    const easedProgress = progress * progress * (3 - 2 * progress);
                    const followFactor = MINIMAP_CAMERA_START_FOLLOW_FACTOR
                        + (MINIMAP_CAMERA_END_FOLLOW_FACTOR - MINIMAP_CAMERA_START_FOLLOW_FACTOR) * easedProgress;
                    game.centerCameraAt({
                        x: currentX + (targetX - currentX) * followFactor,
                        y: currentY + (targetY - currentY) * followFactor,
                    });
                }

                context.drawImage(minimap, 0, 0, canvas.width, canvas.height);

                const projectX = (x: number): number => x / mapWidth * canvas.width;
                const projectY = (y: number): number => y / mapHeight * canvas.height;

                if (transitionGlow) {
                    const minimapScale = Math.min(canvas.width / mapWidth, canvas.height / mapHeight);
                    const glowSize = nativeMinimapTransitionGlowSize(minimapScale);
                    const glowRadius = Math.floor(glowSize / 2);
                    context.save();
                    // Native loads the grayscale 16x16 BMP as a glow texture. Screen blending
                    // preserves the minimap under its black background and adds the light spokes.
                    context.globalCompositeOperation = "screen";
                    for (const transition of state.transitions) {
                        const x = Math.round(projectX(transition.x));
                        const y = Math.round(projectY(transition.y));
                        context.drawImage(
                            transitionGlow,
                            x - glowRadius,
                            y - glowRadius,
                            glowSize,
                            glowSize,
                        );
                    }
                    context.restore();
                }

                context.fillStyle = "#e00000";
                for (const person of state.persons) {
                    context.fillRect(Math.round(projectX(person.x)) - 2, Math.round(projectY(person.y)) - 2, 4, 4);
                }
                context.fillStyle = "#8ee1bd";
                context.fillRect(Math.round(projectX(state.player.x)) - 2, Math.round(projectY(state.player.y)) - 2, 4, 4);

                const frameWidth = clamp(Math.round(projectX(state.camera.width)), 1, canvas.width);
                const frameHeight = clamp(Math.round(projectY(state.camera.height)), 1, canvas.height);
                const cameraCenterX = projectX(state.camera.left + state.camera.width / 2);
                const cameraCenterY = projectY(state.camera.top + state.camera.height / 2);
                const frameLeft = Math.round(clamp(cameraCenterX - frameWidth / 2, 0, canvas.width - frameWidth));
                const frameTop = Math.round(clamp(cameraCenterY - frameHeight / 2, 0, canvas.height - frameHeight));
                context.strokeStyle = "#dfe2d5";
                context.lineWidth = 1;
                context.strokeRect(frameLeft + 0.5, frameTop + 0.5, frameWidth - 1, frameHeight - 1);
            }
            animationFrame = requestAnimationFrame(draw);
        };
        draw();
        return () => {
            stopped = true;
            cancelAnimationFrame(animationFrame);
        };
    }, [getGame]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code === "Space") {
                event.preventDefault();
                getGame()?.endCombatTurn();
                return;
            }
            const slotMatch = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
            if (slotMatch && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                getGame()?.activateHeroMagicSlot(Number(slotMatch[1]) - 1);
                return;
            }
            if (event.code === "KeyT") {
                event.preventDefault();
                setHudVisible((visible) => !visible);
            } else if (event.key === "Tab") {
                event.preventDefault();
                setMinimapVisible((visible) => !visible);
            } else if (event.code === "KeyM") {
                event.preventDefault();
                getGame()?.showWorldMap();
            } else if (event.code === "KeyI") {
                event.preventDefault();
                onInventory();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [getGame, onInventory]);


    const hudValues: Record<number, GuiControlValue> = { 2: skillsActive, 6: minimapVisible };
    const hudLabels = {
        1: "Инвентарь",
        2: "Навыки",
        3: "Меню",
        4: "Отдых",
        5: "Дневник",
        6: "Миникарта",
        7: "Книга магии",
        8: "Глобальная карта",
        14: "Боевой режим",
    };
    const damageResource = damageMode === undefined
        ? "cannot"
        : damageMode === 3 && info.weaponItemClass === "staff"
            ? "magic"
            : HUD_DAMAGE_RESOURCE_BY_MODE[damageMode];
    const handleHudAction = (id: number): void => {
        if (id === 1) onInventory();
        else if (id === 3) onPause();
        else if (id === 4) onRest();
        else if (id === 5) onJournal();
        else if (id === 7) onMagic();
        else if (id === 8) getGame()?.showWorldMap();
        else if (id === 14) {
            const active = getGame()?.toggleCombatMode() ?? false;
            setInfo((current) => ({ ...current, combatMode: active }));
            onCombatModeChange?.(active);
        }
    };
    const activeInterfaceIcons = HUD_INTERFACE_ICONS.filter(({ index }) =>
        persistentIconIds.has(index) || info.conditionIconIds.includes(index));
    const dismissPersistentIcon = (index: number): void => setPersistentIconIds((current) => {
        const next = new Set(current);
        next.delete(index);
        return next;
    });
    const handleInterfaceIcon = (definition: HudInterfaceIconDefinition): void => {
        if (definition.action === "journal") onJournal();
        else if (definition.action === "inventory") onInventory();
        if (definition.index === 0 || definition.index === 2 || definition.index === 4) dismissPersistentIcon(definition.index);
    };

    return (
        <div className={styles.hud} data-hidden={!hudVisible}>
            <div className={styles.minimapFrame} data-hidden={!minimapVisible} aria-label="Миникарта">
                <canvas ref={minimapRef} width={220} height={165}
                    onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        const target = minimapTargetAt(event.clientX, event.clientY);
                        if (!target) return;
                        event.preventDefault();
                        minimapDragRef.current = { pointerId: event.pointerId, target, initialDistance: undefined };
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }} />
            </div>
            {skillsActive && <section className={styles.skillPanel} aria-label="Навыки героя">
                <ColorKeyImage className={styles.skillPanelBackground}
                    src="/assets/engineres/gpanel/skill_panel.bmp" />
                <div className={styles.skillList}>
                    {info.professionSkills.map((skill) => <button className={styles.skillEntry}
                        data-profession-skill={skill.id} key={skill.id} type="button"
                        onClick={() => onProfessionSkill(skill, info.professionSkills)}>
                        {interfaceStrings[skill.interfaceStringId] ?? skill.id}
                    </button>)}
                </div>
            </section>}
            <div className={styles.panel}>
                <canvas ref={frameRef} width={1024} height={768} />
            </div>
            {activeInterfaceIcons.map((definition, slot) => <NativeHudInterfaceIcon
                key={definition.index === 5 ? `${definition.index}:${quickSaveSignal}` : definition.index}
                definition={definition}
                slot={slot}
                tooltip={definition.hintStringId === undefined
                    ? undefined
                    : hintStrings[definition.hintStringId] ?? definition.resource}
                onClick={() => handleInterfaceIcon(definition)}
                onAnimationComplete={definition.index === 5 ? () => dismissPersistentIcon(5) : undefined}
            />)}
            {info.weaponItemId === "unarmed" && <canvas ref={noWeaponRef} className={styles.weaponSlot}
                style={HUD_NO_WEAPON_POSITION} width={HUD_NO_WEAPON_POSITION.width} height={HUD_NO_WEAPON_POSITION.height} />}
            {info.weaponItemId !== "unarmed" && weaponIconUrl && guiObjects.get(16) && <ColorKeyImage
                className={styles.weaponSlot} style={guiObjectStyle(guiObjects.get(16)!)} src={weaponIconUrl} />}
            {guiObjects.get(17) && <button className={styles.damageSlot} style={guiObjectStyle(guiObjects.get(17)!)}
                type="button" disabled={damageModes.length <= 1}
                aria-label="Текущий тип урона"
                onClick={() => setDamageMode((current) => nextHudDamageMode(current, damageModes))}>
                <img src={`${Paths.ENGINERES}/gpanel/damage/${damageResource}.bmp`} alt="" draggable={false} />
            </button>}
            {guiObjects.get(18) && <img className={styles.slotPlaceholder} style={guiObjectStyle(guiObjects.get(18)!)}
                src="/assets/engineres/gpanel/zaglushka3.bmp" alt="" draggable={false} />}
            {guiObjects.get(19) && <img className={styles.slotPlaceholder} style={guiObjectStyle(guiObjects.get(19)!)}
                src="/assets/engineres/gpanel/zaglushka4.bmp" alt="" draggable={false} />}
            {statusHistoryVisible && (() => {
                const layout = HUD_STATUS_HISTORY_LAYOUTS[statusHistoryMode];
                const expanded = statusHistoryMode === "expanded";
                const sliderThumbTop = maximumStatusScroll === 0
                    ? 0
                    : statusScrollOffset / maximumStatusScroll * (128 - 16);
                return <section className={styles.statusHistory}
                    data-mode={statusHistoryMode}
                    style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height }}
                    aria-label="История сообщений"
                    onWheel={(event) => {
                        event.preventDefault();
                        scrollStatusHistory(event.deltaY < 0 ? HUD_STATUS_WHEEL_STEP : -HUD_STATUS_WHEEL_STEP);
                    }}>
                    <img className={styles.statusHistoryBackground}
                        src={`/assets/engineres/status_bar/${expanded ? "main2" : "main3"}.bmp`} alt="" draggable={false} />
                    <div ref={statusHistoryViewportRef} className={styles.statusHistoryViewport}
                        style={{ left: layout.textLeft, top: layout.textTop, width: layout.textWidth, height: layout.textHeight, ...HUD_STATUS_FONT_STYLE }}
                        onClick={() => { setStatusHistoryMode(expanded ? "compact" : "expanded"); setStatusScrollOffset(0); }}>
                        <div className={styles.statusHistoryMessages}>
                            {statusHistory.map((entry) => <div key={entry.id}>{entry.text}</div>)}
                        </div>
                    </div>
                    <button className={styles.statusHistoryControl}
                        style={{ left: 593, top: expanded ? 13 : 5 }} type="button" aria-label="Ранее"
                        disabled={statusScrollOffset >= maximumStatusScroll}
                        onClick={(event) => { event.stopPropagation(); scrollStatusHistory(HUD_STATUS_SCROLL_STEP); }}>
                        <img src={`/assets/engineres/status_bar/${expanded ? "1d" : "3d"}.bmp`} alt="" draggable={false} />
                    </button>
                    <button className={styles.statusHistoryControl}
                        style={{ left: 593, top: expanded ? 166 : 45 }} type="button" aria-label="Позднее"
                        disabled={statusScrollOffset <= 0}
                        onClick={(event) => { event.stopPropagation(); scrollStatusHistory(-HUD_STATUS_SCROLL_STEP); }}>
                        <img src="/assets/engineres/status_bar/2d.bmp" alt="" draggable={false} />
                    </button>
                    {expanded && <div className={styles.statusHistorySlider} style={{ left: 594, top: 33 }}
                        onPointerDown={(event) => {
                            event.currentTarget.setPointerCapture(event.pointerId);
                            setStatusSliderFromPointer(event);
                        }}
                        onPointerMove={(event) => {
                            if (event.currentTarget.hasPointerCapture(event.pointerId)) setStatusSliderFromPointer(event);
                        }}>
                        <ColorKeyImage className={styles.statusHistorySliderThumb}
                            style={{ top: sliderThumbTop }} src="/assets/engineres/status_bar/slider_button.bmp" />
                    </div>}
                </section>;
            })()}
            {guiObjects.get(38) && <button className={styles.status}
                style={{ ...guiObjectStyle(guiObjects.get(38)!), ...HUD_STATUS_FONT_STYLE }} type="button"
                aria-expanded={statusHistoryVisible}
                onClick={() => { setStatusHistoryVisible((visible) => !visible); setStatusScrollOffset(0); }}>
                {info.heroDead ? "Игра окончена." : statusText || transientStatusText}
            </button>}
            {guiObjects.get(35) && <span className={styles.lifeValue}
                style={{ ...guiObjectStyle(guiObjects.get(35)!), ...HUD_VALUE_FONT_STYLE }}>
                {Math.round(info.lifeValue)}/{Math.round(info.lifeMaximum)}
            </span>}
            {guiObjects.get(37) && <span className={styles.energyValue}
                style={{ ...guiObjectStyle(guiObjects.get(37)!), ...HUD_VALUE_FONT_STYLE }}>
                {Math.round(info.energyValue)}/{Math.round(info.energyMaximum)}
            </span>}
            <OriginalGuiLayer className={styles.authoredControls} script="gpanel_new"
                objectIds={[1, 2, 3, 4, 5, 6, 7, 8, 14]}
                values={hudValues}
                labels={hudLabels}
                inactiveObjectIds={info.worldMapAvailable ? [] : [8]}
                onAction={(object) => handleHudAction(object.id)}
                onValueChange={(object, value) => {
                    if (object.id === 2) onSkills();
                    else if (object.id === 6) setMinimapVisible(value === true);
                }}
            />
            {info.hotbarSpellIds.map((magicId, slot) => {
                const object = guiObjects.get(24 + slot);
                if (!object) return null;
                const magic = magicId === null ? undefined : magicDefinitions[magicId];
                const castable = magic !== undefined && info.castableSpellIds.includes(magic.id);
                return <button className={styles.magicSlot} style={guiObjectStyle(object)}
                    key={slot} type="button"
                    aria-label={magic ? `${slot + 1}: ${magic.literaryName}` : `Пустой слот ${slot + 1}`}
                    aria-pressed={magicId !== null && info.selectedSpellId === magicId}
                    disabled={!castable}
                    title={magic ? `${slot + 1}. ${magic.literaryName}` : `${slot + 1}. Пусто`}
                    onClick={() => getGame()?.activateHeroMagicSlot(slot)}
                    onContextMenu={(event) => { event.preventDefault(); getGame()?.cancelHeroMagicTargeting(); }}>
                    {magic && <ColorKeyImage src={`/assets/engineres/interface/magic_book/magic_icons/${info.selectedSpellId === magic.id ? "cast" : "glow"}/${magic.technicalName}.bmp`} />}
                </button>;
            })}
        </div>
    );
};
