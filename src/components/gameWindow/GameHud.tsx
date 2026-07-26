import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Game } from "../../game/Game.ts";
import { loadCSX, loadImage } from "../../game/Assets.ts";
import { HUD_GAUGE_ANIMATION_ORIGINS, HUD_NATIVE_ANIMATION_FRAME_HEIGHTS } from "../../constants/clientDll.ts";
import { CONSOLE_FONT, MAIN_INTERFACE_FONT } from "../../constants/fontsScr.ts";
import { Paths } from "../../constants/paths.ts";
import { loadGuiDefinition, type GuiDefinition } from "../../game/GuiDefinitionRuntime.ts";
import { loadMagicCatalog, type MagicDefinition } from "../../game/MagicCatalogRuntime.ts";
import { ColorKeyImage } from "../ColorKeyImage.tsx";
import { guiObjectStyle, OriginalGuiLayer, type GuiControlValue } from "../OriginalGuiLayer.tsx";
import styles from "./GameHud.module.scss";

interface GameHudProps {
    getGame: () => Game | null;
    statusText: string;
    onSkills: () => void;
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
    worldMapAvailable: boolean;
    combatMode: boolean;
    heroDead: boolean;
    combatMessage: string;
    hotbarSpellIds: readonly (number | null)[];
    castableSpellIds: readonly number[];
    selectedSpellId?: number;
}

const initialInfo: HudInfo = {
    lifeValue: 0,
    lifeMaximum: 0,
    lifeRatio: 1,
    energyValue: 0,
    energyMaximum: 0,
    energyRatio: 1,
    worldMapAvailable: false,
    combatMode: false,
    heroDead: false,
    combatMessage: "",
    hotbarSpellIds: Array.from({ length: 9 }, () => null),
    castableSpellIds: [],
};

const readValue = (parameters: Readonly<Record<string, number>>, names: readonly string[]): number | undefined => {
    for (const name of names) {
        const value = parameters[name];
        if (value !== undefined) return value;
    }
    return undefined;
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


const HUD_STATUS_FONT_STYLE: CSSProperties = Object.freeze({
    fontFamily: `ZlatoPalatino, "${MAIN_INTERFACE_FONT.typeFace}", serif`,
    fontSize: `${MAIN_INTERFACE_FONT.size}px`,
    fontWeight: MAIN_INTERFACE_FONT.weight,
});

const HUD_VALUE_FONT_STYLE: CSSProperties = Object.freeze({
    fontFamily: `ZlatoConsole, "${CONSOLE_FONT.typeFace}", monospace`,
    fontSize: `${CONSOLE_FONT.size}px`,
});

export const GameHud = ({ getGame, statusText, onSkills, onInventory, onJournal, onMagic, onPause, onRest, skillsActive, onCombatModeChange }: GameHudProps) => {
    const frameRef = useRef<HTMLCanvasElement>(null);
    const healthFrameRef = useRef<number | null>(null);
    const energyFrameRef = useRef<number | null>(null);
    const minimapRef = useRef<HTMLCanvasElement>(null);
    const [hudVisible, setHudVisible] = useState(true);
    const [minimapVisible, setMinimapVisible] = useState(true);
    const [info, setInfo] = useState(initialInfo);
    const [magicDefinitions, setMagicDefinitions] = useState<readonly MagicDefinition[]>([]);
    const [guiDefinition, setGuiDefinition] = useState<GuiDefinition | null>(null);
    const guiObjects = useMemo(
        () => new Map(guiDefinition?.objects.map((object) => [object.id, object]) ?? []),
        [guiDefinition],
    );

    useEffect(() => {
        let cancelled = false;
        void Promise.all([loadMagicCatalog(), loadGuiDefinition("gpanel_new")]).then(([definitions, gui]) => {
            if (cancelled) return;
            setMagicDefinitions(definitions);
            setGuiDefinition(gui);
        }).catch((error) => console.error("Не удалось загрузить HUD", error));
        return () => { cancelled = true; };
    }, []);

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

            setInfo({
                lifeValue,
                lifeMaximum,
                lifeRatio: lifeMaximum > 0 ? Math.max(0, Math.min(1, lifeValue / lifeMaximum)) : 1,
                energyValue,
                energyMaximum,
                energyRatio: energyMaximum > 0 ? Math.max(0, Math.min(1, energyValue / energyMaximum)) : 1,
                worldMapAvailable: game.canShowWorldMap(),
                combatMode: game.isCombatMode(),
                heroDead: heroCombat?.health === 0,
                combatMessage: runtime.combat.message,
                hotbarSpellIds: runtime.magic.hotbarSpellIds,
                castableSpellIds: runtime.magic.castableSpellIds,
                selectedSpellId: runtime.magic.selectedSpellId,
            });
        };
        update();
        const interval = window.setInterval(update, 250);
        return () => window.clearInterval(interval);
    }, [getGame]);

    useEffect(() => {
        let cancelled = false;
        let animationFrame = 0;
        void Promise.all([
            loadImage(`${Paths.ENGINERES}/gpanel/std.bmp`),
            loadImage(`${Paths.ENGINERES}/gpanel/anim/health.bmp`),
            loadImage(`${Paths.ENGINERES}/gpanel/anim/energy.bmp`),
        ]).then(([frame, health, energy]) => {
            if (cancelled) return;
            const canvas = frameRef.current;
            const context = canvas?.getContext("2d");
            if (!canvas || !context) return;
            const healthObject = guiObjects.get(34);
            const energyObject = guiObjects.get(36);
            if (!healthObject || !energyObject) return;
            const panelTop = 768 - canvas.height;
            const healthFrameCount = Math.max(1, Math.floor(health.height / HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.health));
            const energyFrameCount = Math.max(1, Math.floor(energy.height / HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.energy));
            const healthTarget = Math.floor(info.lifeRatio * (healthFrameCount - 1));
            const energyTarget = Math.floor(info.energyRatio * (energyFrameCount - 1));
            const advance = (current: number | null, target: number): number =>
                current === null ? target : current < target ? current + 1 : current > target ? current - 1 : current;
            const draw = (): void => {
                if (cancelled) return;
                const healthFrame = advance(healthFrameRef.current, healthTarget);
                const energyFrame = advance(energyFrameRef.current, energyTarget);
                healthFrameRef.current = healthFrame;
                energyFrameRef.current = energyFrame;
                context.clearRect(0, 0, canvas.width, canvas.height);
                drawColorKeyed(context, frame, 0, 0, 1024, canvas.height, 0, 0);
                drawColorKeyed(context, health,
                    healthObject.left - HUD_GAUGE_ANIMATION_ORIGINS.health.left,
                    healthFrame * HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.health
                        + healthObject.top - HUD_GAUGE_ANIMATION_ORIGINS.health.top,
                    healthObject.width,
                    healthObject.height,
                    healthObject.left,
                    healthObject.top - panelTop);
                drawColorKeyed(context, energy,
                    energyObject.left - HUD_GAUGE_ANIMATION_ORIGINS.energy.left,
                    energyFrame * HUD_NATIVE_ANIMATION_FRAME_HEIGHTS.energy
                        + energyObject.top - HUD_GAUGE_ANIMATION_ORIGINS.energy.top,
                    energyObject.width,
                    energyObject.height,
                    energyObject.left,
                    energyObject.top - panelTop);
                if (healthFrame !== healthTarget || energyFrame !== energyTarget) {
                    animationFrame = window.requestAnimationFrame(draw);
                }
            };
            draw();
        });
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(animationFrame);
        };
    }, [guiObjects, info.lifeRatio, info.energyRatio]);

    useEffect(() => {
        const canvas = minimapRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        let stopped = false;
        let animationFrame = 0;
        let loadedPack = "";
        let loadingPack = "";
        let minimap: HTMLCanvasElement | undefined;

        const draw = () => {
            if (stopped) return;
            const level = getGame()?.getLevel();
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
                context.drawImage(minimap, 0, 0, canvas.width, canvas.height);
                const mapWidth = Math.max(1, data.lvlData.mapSize.width);
                const mapHeight = Math.max(1, data.lvlData.mapSize.height);
                const projectX = (x: number): number => x / mapWidth * canvas.width;
                const projectY = (y: number): number => y / mapHeight * canvas.height;

                context.fillStyle = "#e00000";
                for (const person of state.persons) {
                    context.fillRect(Math.round(projectX(person.x)) - 2, Math.round(projectY(person.y)) - 2, 4, 4);
                }
                context.fillStyle = "#8ee1bd";
                context.fillRect(Math.round(projectX(state.player.x)) - 2, Math.round(projectY(state.player.y)) - 2, 4, 4);

                context.strokeStyle = "#e4e6d9";
                context.lineWidth = 1;
                context.strokeRect(
                    Math.round(projectX(state.camera.left)) + 0.5,
                    Math.round(projectY(state.camera.top)) + 0.5,
                    Math.round(state.camera.width / mapWidth * canvas.width),
                    Math.round(state.camera.height / mapHeight * canvas.height),
                );
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

    return (
        <div className={styles.hud} data-hidden={!hudVisible}>
            <div className={styles.minimapFrame} data-hidden={!minimapVisible} aria-label="Миникарта">
                <canvas ref={minimapRef} width={220} height={165} onPointerDown={(event) => {
                    const game = getGame();
                    const mapSize = game?.getLevel()?.getData()?.lvlData.mapSize;
                    if (!game || !mapSize) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    game.centerCameraAt({
                        x: (event.clientX - bounds.left) / Math.max(1, bounds.width) * mapSize.width,
                        y: (event.clientY - bounds.top) / Math.max(1, bounds.height) * mapSize.height,
                    });
                }} />
            </div>
            <div className={styles.panel}>
                <canvas ref={frameRef} width={1024} height={156} />
            </div>
            {guiObjects.get(18) && <img className={styles.slotPlaceholder} style={guiObjectStyle(guiObjects.get(18)!)}
                src="/assets/engineres/gpanel/zaglushka3.bmp" alt="" draggable={false} />}
            {guiObjects.get(19) && <img className={styles.slotPlaceholder} style={guiObjectStyle(guiObjects.get(19)!)}
                src="/assets/engineres/gpanel/zaglushka4.bmp" alt="" draggable={false} />}
            {guiObjects.get(38) && <span className={styles.status}
                style={{ ...guiObjectStyle(guiObjects.get(38)!), ...HUD_STATUS_FONT_STYLE }}>
                {info.heroDead ? "Игра окончена." : statusText || info.combatMessage}
            </span>}
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
