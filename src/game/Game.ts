import { Level, type MapReferenceHint } from "./Level";
import { GameMode } from "../constants/levels.ts";
import { Paths } from "../constants/paths.ts";
import { AGEParser } from "./parsers/AGEParser.ts";
import { SDBParser, type SDBData } from "./parsers/SDBParser.ts";
import {
    DialogueRuntime,
    type DialogueFunctionCall,
    type DialogueState,
    type DialogueValue,
} from "./dialogue/DialogueRuntime.ts";
import {
    decodeDialogueReplyPacket,
    decodeDialogueSnapshotPacket,
    encodeDialogueReplyPacket,
    encodeDialogueSnapshotPacket,
} from "./dialogue/DialoguePacketRuntime.ts";
import {
    LocalStorageAdapter,
    PersistenceRuntime,
    createSaveData,
    type GameSaveData,
} from "./PersistenceRuntime.ts";
import {
    GOLDEN_LAND_WORLD_MAP_LOCATIONS,
    WorldMapRuntime,
    type WorldMapLocationState,
    type WorldMapLocation,

    type WorldMapTravelLink,
} from "./WorldMapRuntime.ts";
import type { TradeOffer } from "./systems/Trade.ts";
import {
    ShippedItemCatalog,
    itemClassCanBeUsed,
    loadShippedItemCatalog,
    type HeroInventoryItemView,
    type HeroInventoryView,
} from "./ItemCatalogRuntime.ts";
import type { EquipmentSlot } from "./systems/Items.ts";
import type { GameRuntimeSnapshot, RestRuntimeState } from "./GameStateRuntime.ts";
import type { CursorType } from "../enums/CursorTypes.ts";
import { readGameSettings, type GameSettings } from "./GameSettingsRuntime.ts";
import { createBrowserAudio, resolveLevelAudioUrl, type BrowserAudio } from "./AudioWeatherRuntime.ts";
import { DEFAULT_HERO_NAME, parseHeroProfiles, selectHeroProfile, type HeroProfile } from "./HeroProfileRuntime.ts";

const HERO_CHARACTERISTICS = new Set([
    "strength", "constitution", "dexterity", "perception", "intelligence", "wisdom", "luck",
]);
const EMPTY_DIALOGUE_PACKET_BYTES = new Uint8Array(0);




const dialogueAssetUrls = import.meta.glob("/public/assets/scripts/dialogs/**/*.age.cs", {
    eager: true,
    import: "default",
    query: "?url",
}) as Record<string, string>;

const normalizedDialogueAssets = new Map<string, string>();
const dialogueBasenames = new Map<string, string | null>();
for (const [path, url] of Object.entries(dialogueAssetUrls)) {
    const relative = path.replace(/^.*\/scripts\/dialogs\//i, "").toLowerCase();
    normalizedDialogueAssets.set(relative, url);
    const basename = relative.slice(relative.lastIndexOf("/") + 1);
    dialogueBasenames.set(basename, dialogueBasenames.has(basename) ? null : url);
}


// The shipped scripts expose locations but no serialized road table. The web host
// therefore permits direct zero-cost travel and derives elapsed time from map distance.
const createWorldMapLinks = (locations: readonly WorldMapLocation[]): readonly WorldMapTravelLink[] => locations.flatMap((from) =>
    locations
        .filter((to) => to.id !== from.id)
        .map((to) => ({
            from: from.id,
            to: to.id,
            cost: 0,
            duration: Math.max(1, Math.round(Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y) / 100)),
        })),
);


export type LoadingStage = "Инициализация..." | "Создание игры..." | "Загрузка игры..." | `Подключается ${string}...`;

export interface GameEvents {
    onDialogueStateChange?: (state: DialogueState) => void;
    onWorldMapStateChange?: (locations: readonly WorldMapLocationState[] | null) => void;
    onLevelChanged?: (gameMode: GameMode, levelName: string) => void;
    onError?: (error: unknown) => void;
    onGameFinished?: (ending: number) => void;
    onHeroDeath?: () => void;
    onCursorChange?: (cursor: CursorType) => void;
    onLoadingStateChange?: (loading: boolean, levelName: string, stage: LoadingStage, progress: number) => void;
    onCombatModeChange?: (active: boolean) => void;
    onContainerOpen?: (owner: string, title: string) => void;
    onTradeRequest?: (owner: string, title: string) => void;
    onStatusTextChange?: (text?: string) => void;
    onStatusMessage?: (message: string) => void;
    onReferenceHintChange?: (hint?: MapReferenceHint) => void;
    onInterfaceIcon?: (index: number) => void;
}

export interface GameOptions {
    strictScriptAbi?: boolean;
    heroProfile?: HeroProfile;
    requireHeroProfile?: boolean;
}

export class Game {
    private readonly ctx: CanvasRenderingContext2D | null;
    private readonly dialogue: DialogueRuntime;
    private readonly persistence = new PersistenceRuntime(new LocalStorageAdapter(window.localStorage));
    private level: Level | null = null;
    private worldMap: WorldMapRuntime | null = null;
    private gameLoopActive = false;
    private stopped = false;
    private levelChangeGeneration = 0;
    private dialoguePhrasesPromise: Promise<SDBData> | null = null;
    private dialoguePhrases: SDBData | null = null;
    private dialogueVoice: BrowserAudio | null = null;
    private itemCatalogPromise: Promise<ShippedItemCatalog> | null = null;
    private heroProfilePromise: Promise<HeroProfile> | null = null;
    private currentWorldMapLocation: string | null = null;
    private combatMode = false;
    private dialogueSpeakerTechnical: string | null = null;
    private settings: GameSettings = readGameSettings();
    private readonly clockListeners = new Set<(elapsedMinutes: number) => void>();
    private loadingLevelName = "";
    private loadingStage: LoadingStage = "Инициализация...";
    private readonly restListeners = new Set<(state: RestRuntimeState) => void>();



    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly events: GameEvents = {},
        private readonly options: GameOptions = {},
    ) {
        this.ctx = canvas.getContext("2d");
        if (!this.ctx) throw new Error("Не удалось получить контекст `2d`");

        this.dialogue = new DialogueRuntime({
            resolvePhrase: (phraseId) => this.dialoguePhrases?.[phraseId] ?? `#${phraseId}`,
            readVariable: (name) => {
                if (name.toLowerCase() === "heroname") return this.options.heroProfile?.name ?? DEFAULT_HERO_NAME;
                const value = this.level?.getRuntime().getVariable(name);
                return typeof value === "boolean" ? (value ? 1 : 0) : value;
            },
            writeVariable: (name, value) => this.level?.getRuntime().setVariable(name, value),
            invokeFunction: (call) => this.invokeDialogueFunction(call),
            onStateChange: (state) => this.publishDialogueState(state),

        });
    }

    public async start(gameMode: GameMode, levelName: string, entranceName?: string) {
        this.loadingLevelName = levelName;
        this.loadingStage = "Инициализация...";
        this.events.onLoadingStateChange?.(true, levelName, this.loadingStage, 0);

        this.stopped = false;
        console.log(`Запуск игры: режим ${gameMode}, уровень ${levelName}`);
        const itemCatalog = await this.getItemCatalog();
        this.level = new Level(this.canvas, {
            onLoadArea: (request) => void this.changeLevel(request.gameMode, request.level, request.entrance).catch((error) => this.reportError(error)),
            onGlobalMap: () => this.openWorldMap(),
            onDialog: (arguments_) => void this.openDialogue(arguments_).catch((error) => this.reportError(error)),
            onFinished: (ending) => this.events.onGameFinished?.(ending),
            onHeroDeath: () => this.events.onHeroDeath?.(),
            onCursorChange: (cursor) => this.events.onCursorChange?.(cursor),
            onContainerOpen: (owner, triggerName) => this.events.onContainerOpen?.(owner, triggerName),
            onTrade: () => void this.openCurrentTrade().catch((error) => this.reportError(error)),
            onStatusText: (text) => this.events.onStatusTextChange?.(text),
            onMessage: (message) => this.events.onStatusMessage?.(String(message)),
            resolveItemLiteraryName: (technicalName) => itemCatalog.getLiteraryName(technicalName),
            onReferenceHint: (hint) => this.events.onReferenceHintChange?.(hint),
            onLoadingProgress: (progress) => this.events.onLoadingStateChange?.(
                true,
                this.loadingLevelName,
                this.loadingStage,
                progress,
            ),
            onClockChange: (elapsedMinutes) => {
                for (const listener of this.clockListeners) listener(elapsedMinutes);
            },
            onRestChange: (state) => {
                for (const listener of this.restListeners) listener(state);
            },
            strictScriptAbi: this.options.strictScriptAbi,
        });
        this.level.applySettings(this.settings);
        const heroProfile = await this.loadHeroProfile();
        this.level.initializeHeroProfile(heroProfile.parameters, heroProfile.experience);
        this.loadingStage = "Создание игры...";
        this.events.onLoadingStateChange?.(true, levelName, this.loadingStage, 0);

        await this.level.loadLevel(gameMode, levelName, entranceName);

        this.level.setCombatMode(this.combatMode);
        await this.initializeHeroInventory();
        if (this.stopped) return;
        this.events.onLevelChanged?.(gameMode, levelName);
        this.rememberWorldMapLocation(levelName);
        this.events.onLoadingStateChange?.(false, levelName, this.loadingStage, 1);

        this.gameLoopActive = true;
        this.gameLoop();
    }

    public stop() {
        console.log("Остановка игрового цикла");
        this.stopped = true;
        this.gameLoopActive = false;
        this.levelChangeGeneration++;
        this.dialogue.end();
        this.stopDialogueVoice();

        this.worldMap = null;
        this.currentWorldMapLocation = null;

        this.level?.destroy();
        this.level = null;
    }

    public async changeLevel(
        gameMode: GameMode,
        levelName: string,
        entranceName?: string,
        loadingStage: LoadingStage = "Инициализация...",
        keepLoading = false,
    ) {
        if (!this.level || this.stopped) return;
        this.loadingLevelName = levelName;
        this.loadingStage = loadingStage;
        this.events.onLoadingStateChange?.(true, levelName, loadingStage, 0);
        const generation = ++this.levelChangeGeneration;
        console.log(`Смена уровня: режим ${gameMode}, новый уровень ${levelName}`);
        await this.level.changeLevel(gameMode, levelName, entranceName);
        if (generation !== this.levelChangeGeneration) return;
        this.level.setCombatMode(this.combatMode);
        this.rememberWorldMapLocation(levelName);

        this.events.onLevelChanged?.(gameMode, levelName);
        if (!keepLoading) this.events.onLoadingStateChange?.(false, levelName, loadingStage, 1);
    }

    public chooseDialogue(optionId: number): DialogueState {
        const replyId = decodeDialogueReplyPacket(encodeDialogueReplyPacket(optionId));
        return this.dialogue.choose(replyId);
    }

    public getDialogueState(): DialogueState {
        return this.dialogue.getState();
    }

    public canTradeWithDialogueSpeaker(): boolean {
        const speaker = this.dialogueSpeakerTechnical;
        return Boolean(speaker && this.level?.getData()?.levelPersons.some(
            (person) => person.name.toLowerCase() === speaker.toLowerCase() && person.scriptInventory,
        ));
    }

    public tradeWithDialogueSpeaker(): Promise<void> {
        return this.openCurrentTrade();
    }

    public getLevel(): Level | null {
        return this.level;
    }

    public getRuntimeSnapshot(): GameRuntimeSnapshot | null {
        return this.level?.getRuntimeSnapshot() ?? null;
    }

    public subscribeClock(listener: (elapsedMinutes: number) => void): () => void {
        this.clockListeners.add(listener);
        return () => this.clockListeners.delete(listener);
    }

    public subscribeRest(listener: (state: RestRuntimeState) => void): () => void {
        this.restListeners.add(listener);
        return () => this.restListeners.delete(listener);
    }

    public getRestState(): RestRuntimeState {
        return this.level?.getRuntime().getRestState() ?? Object.freeze({
            active: false,
            requestedMinutes: 0,
            remainingMinutes: 0,
        });
    }

    public centerCameraAt(position: Readonly<{ x: number; y: number }>): void {
        this.level?.centerCameraAt(position);
    }

    public applySettings(settings: Readonly<GameSettings>): void {
        this.settings = { ...settings };
        this.level?.applySettings(settings);
        if (this.dialogueVoice) this.dialogueVoice.volume = Math.max(0, Math.min(1, Number(settings[7]) / 100));
    }

    public isCombatMode(): boolean {
        return this.combatMode;
    }

    public toggleCombatMode(): boolean {
        this.combatMode = !this.combatMode;
        this.level?.setCombatMode(this.combatMode);
        this.events.onCombatModeChange?.(this.combatMode);
        return this.combatMode;
    }

    public endCombatTurn(): boolean {
        if (!this.combatMode) {
            this.combatMode = true;
            this.level?.setCombatMode(true);
            this.events.onCombatModeChange?.(true);
            return true;
        }
        return this.level?.endCombatTurn() ?? false;
    }

    public rest(minutes = 480): boolean {
        return this.level?.getRuntime().beginRest(minutes) ?? false;
    }

    public cancelRest(): boolean {
        return this.level?.getRuntime().cancelRest() ?? false;
    }

    public adjustHeroProgression(
        parameter: string,
        kind: "characteristic" | "skill",
        direction: 1 | -1,
        minimum: number,
    ): boolean {
        const normalized = parameter.toLowerCase();
        if (kind === "characteristic" ? !HERO_CHARACTERISTICS.has(normalized) : !normalized.startsWith("skill_")) return false;
        const runtime = this.level?.getRuntime();
        if (!runtime) return false;
        return runtime.adjustHeroProgression(
            normalized,
            kind === "characteristic" ? "person_points" : "skill_points",
            direction,
            minimum,
            kind === "characteristic" ? 30 : 15,
        );
    }

    public async getHeroName(): Promise<string> {
        return (await this.loadHeroProfile()).name;
    }

    public async getHeroInventory(): Promise<HeroInventoryView> {
        const level = this.level;
        if (!level) throw new Error("Инвентарь недоступен до загрузки уровня");
        const catalog = await this.getItemCatalog();
        const heroStacks = level.getRuntime().getInventoryStacks("Hero");
        const items = await Promise.all(heroStacks.map(async (stack) => {
            const item = await catalog.get(stack.technicalName);
            level.getRuntime().registerItem(item);
            return {
                ...item,
                stackKey: stack.stackKey,
                instanceId: stack.id,
                durability: stack.durability,
                ...(stack.charges === undefined ? {} : { charges: stack.charges }),
                quantity: stack.quantity,
            };
        }));
        const snapshot = level.getRuntimeSnapshot();
        const equippedEntries = await Promise.all(Object.entries(snapshot.equipped).map(async ([slot, technicalName]) => [
            slot,
            await catalog.get(technicalName),
        ] as const));
        return {
            items: items.sort((left, right) => left.literaryName.localeCompare(right.literaryName, "ru")),
            equipped: Object.fromEntries(equippedEntries),
        };
    }

    public async getInventoryItems(owner: string): Promise<readonly HeroInventoryItemView[]> {
        const level = this.level;
        if (!level) return [];
        const catalog = await this.getItemCatalog();
        const stacks = level.getRuntime().getInventoryStacks(owner);
        return Promise.all(stacks.map(async (stack) => {
            const item = await catalog.get(stack.technicalName);
            level.getRuntime().registerItem(item);
            return {
                ...item,
                stackKey: stack.stackKey,
                instanceId: stack.id,
                durability: stack.durability,
                ...(stack.charges === undefined ? {} : { charges: stack.charges }),
                quantity: stack.quantity,
            };
        }));
    }

    public transferInventoryItem(source: string, destination: string, stackKey: string, quantity = 1): boolean {
        return this.level?.getRuntime().transferInventoryItem(source, destination, stackKey, quantity) ?? false;
    }

    public transferInventoryAll(source: string, destination: string): void {
        this.level?.getRuntime().transferInventoryAll(source, destination);
    }

    public getTradePriceMultiplier(): number {
        return this.level?.getRuntime().getTradePriceMultiplier() ?? 1;
    }

    public exchangeTradeOffers(
        trader: string,
        heroOffer: TradeOffer,
        traderOffer: TradeOffer,
        buyCost: number,
        sellCredit: number,
    ): boolean {
        return this.level?.getRuntime().exchangeTradeOffers(trader, heroOffer, traderOffer, buyCost, sellCredit) ?? false;
    }

    public async equipHeroItem(technicalName: string, requestedSlot?: EquipmentSlot, stackKey?: string): Promise<boolean> {
        const level = this.level;
        if (!level) return false;
        const item = await (await this.getItemCatalog()).get(technicalName);
        level.getRuntime().registerItem(item);
        const equipped = level.getRuntime().getEquippedItems();
        const slots = item.definition.equipSlots ?? [];
        const slot = requestedSlot ?? slots.find((candidate) => !equipped[candidate]) ?? slots[0];
        if (!slot || !slots.includes(slot)) {
            this.events.onInterfaceIcon?.(4);
            return false;
        }

        const changed = level.getRuntime().equipHeroItem(technicalName, slot, stackKey);
        if (changed) await this.refreshHeroEquipment();
        else this.events.onInterfaceIcon?.(4);
        return changed;
    }

    public async unequipHeroItem(slot: EquipmentSlot): Promise<boolean> {
        const level = this.level;
        if (!level || !level.getRuntime().unequipHeroItem(slot)) return false;
        await this.refreshHeroEquipment();
        return true;
    }

    public async useHeroItem(technicalName: string, stackKey?: string): Promise<boolean> {
        const level = this.level;
        if (!level) return false;
        const item = await (await this.getItemCatalog()).get(technicalName);
        if (!itemClassCanBeUsed(item.definition.itemClass)) return false;
        if (item.definition.itemClass === "book") {
            return item.magicId !== undefined && level.getRuntime().learnHeroMagic(technicalName, item.magicId, stackKey);
        }
        return level.getRuntime().useHeroItem(technicalName, item.specialEffects, item.nutrition, stackKey);
    }
    public setHeroMagicHotbar(slot: number, magicId: number | null): boolean {
        return this.level?.getRuntime().setHeroMagicHotbar(slot, magicId) ?? false;
    }
    public activateHeroMagicSlot(slot: number): boolean {
        return this.level?.activateHeroMagicSlot(slot) ?? false;
    }

    public cancelHeroMagicTargeting(): void {
        this.level?.cancelHeroMagicTargeting();
    }


    public async dropHeroItem(technicalName: string, stackKey?: string): Promise<boolean> {
        const level = this.level;
        if (!level) return false;
        const item = await (await this.getItemCatalog()).get(technicalName);
        if (!item.canDrop) return false;
        return level.getRuntime().dropHeroItem(technicalName, 1, stackKey);
    }


    public canShowWorldMap(): boolean {
        return Boolean(this.level?.getData());
    }

    public travelWorldMap(destinationId: string): void {
        if (!this.worldMap) throw new Error("Глобальная карта не открыта");
        this.worldMap.travel(destinationId);
        this.currentWorldMapLocation = destinationId;
        this.worldMap = null;

        this.events.onWorldMapStateChange?.(null);
    }

    public closeWorldMap(): void {
        this.worldMap = null;
        this.events.onWorldMapStateChange?.(null);
    }

    public showWorldMap(): boolean {
        return this.openWorldMap();
    }


    public save(slot: string): GameSaveData {
        const save = this.captureSave();
        this.persistence.save(slot, save);
        return save;
    }

    public quickSave(): GameSaveData {
        const save = this.captureSave();
        this.persistence.quickSave(save);
        return save;
    }

    public async load(slot: string): Promise<GameSaveData | null> {
        return this.restoreSave(this.persistence.load(slot));
    }

    public async quickLoad(): Promise<GameSaveData | null> {
        return this.restoreSave(this.persistence.quickLoad());
    }

    private captureSave(): GameSaveData {
        const level = this.level;
        const data = level?.getData();
        const player = level?.getPlayerState();
        if (!level || !data || !player) throw new Error("Нельзя сохранить игру до загрузки уровня");
        const runtime = level.getRuntimeSnapshot();
        const save = createSaveData({ gameMode: data.gameMode, level: data.levelName, entrance: null });
        save.player.position = player.position;
        save.player.direction = player.direction;
        save.scriptVariables = { ...runtime.variables };
        save.inventories = Object.fromEntries(Object.entries(runtime.inventoryStacks).map(([owner, stacks]) => [
            owner,
            stacks.map(({ stackKey: _stackKey, technicalName, ...stack }) => ({
                id: stack.id,
                definitionId: technicalName,
                durability: stack.durability,
                ...(stack.charges === undefined ? {} : { charges: stack.charges }),
                quantity: stack.quantity,
            })),
        ]));
        save.equipped = Object.fromEntries(Object.entries(runtime.equippedStacks).map(([slot, stack]) => [
            slot,
            stack && {
                id: stack.item.id,
                definitionId: stack.item.definitionId,
                durability: stack.item.durability ?? 100,
                ...(stack.item.charges === undefined ? {} : { charges: stack.item.charges }),
                quantity: stack.quantity,
            },
        ]));
        save.questFlags = { ...runtime.questFlags };
        save.persons = { ...runtime.persons };
        save.personStatesByLevel = Object.fromEntries(
            Object.entries(runtime.personStatesByLevel).map(([level, persons]) => [level, { ...persons }]),
        );
        save.stageFlags = { ...runtime.stageFlags };
        save.locationAccess = { ...runtime.locationAccess };
        save.bestiaryKills = { ...runtime.bestiaryKills };
        save.personParameters = Object.fromEntries(Object.entries(runtime.personParameters).map(([person, values]) => [person, { ...values }]));
        save.magicEffects = runtime.magic.activeEffects.map((effect) => ({ ...effect }));
        save.regenerationElapsed = Object.fromEntries(
            Object.entries(runtime.regenerationElapsed).map(([name, elapsed]) => [name, { ...elapsed }]),
        );
        save.experience = runtime.experience;
        save.clock = {
            day: Math.floor(runtime.elapsedMinutes / (24 * 60)),
            minuteOfDay: runtime.elapsedMinutes % (24 * 60),
        };
        const scenario = level.getRuntime().getScenario();
        if (scenario) {
            save.doors = Object.fromEntries(scenario.getDoorStates().map((door) => [door.name, door.opened]));
            save.triggers = Object.fromEntries(scenario.getTriggerStates().map((trigger) => [trigger.name, {
                active: trigger.active,
                visible: trigger.visible,
            }]));
        }
        return save;
    }

    private async restoreSave(save: GameSaveData | null): Promise<GameSaveData | null> {
        if (!save) return null;
        const { gameMode, level, entrance } = save.location;
        this.loadingLevelName = level;
        this.loadingStage = "Загрузка игры...";
        this.events.onLoadingStateChange?.(true, level, this.loadingStage, 0);
        this.level?.getRuntime().restoreScriptVariables(save.scriptVariables);
        await this.changeLevel(gameMode, level, entrance ?? undefined, this.loadingStage, true);
        if (!this.level) return null;
        const catalog = await this.getItemCatalog();
        for (const itemState of Object.values(save.equipped)) {
            if (itemState) this.level.getRuntime().registerItem(await catalog.get(itemState.definitionId));
        }
        this.level.getRuntime().restore(save);
        this.level.setPlayerState(save.player.position, save.player.direction);
        await this.refreshHeroEquipment();
        this.events.onLoadingStateChange?.(false, level, this.loadingStage, 1);
        return save;
    }

    private async initializeHeroInventory(): Promise<void> {
        const level = this.level;
        if (!level) return;
        const response = await fetch(`${Paths.SCRIPTS}/inventory/hero_items.inv`);
        if (!response.ok) throw new Error(`Не удалось загрузить начальный инвентарь: HTTP ${response.status}`);
        const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
        level.getRuntime().initializeInventoryFromScript("Hero", source, { periodicSecondPass: false });
    }

    private getItemCatalog(): Promise<ShippedItemCatalog> {
        this.itemCatalogPromise ??= loadShippedItemCatalog();
        return this.itemCatalogPromise;
    }
    private loadHeroProfile(): Promise<HeroProfile> {
        if (this.options.heroProfile) return Promise.resolve(this.options.heroProfile);
        if (this.options.requireHeroProfile) {
            throw new Error("Новая одиночная игра запущена без профиля из генератора героя");
        }
        this.heroProfilePromise ??= fetch(`${Paths.SCRIPTS}/hero.scr`)
            .then(async (response) => {
                if (!response.ok) throw new Error(`Не удалось загрузить профиль героя: HTTP ${response.status}`);
                const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
                const profile = selectHeroProfile(parseHeroProfiles(source), "Default");
                return { ...profile, name: DEFAULT_HERO_NAME };
            });
        return this.heroProfilePromise;
    }


    private async refreshHeroEquipment(): Promise<void> {
        const level = this.level;
        if (!level) return;
        const equippedTechnicalNames = Object.values(level.getRuntime().getEquippedItems());
        const catalog = await this.getItemCatalog();
        const items = await Promise.all(equippedTechnicalNames.map((name) => catalog.get(name)));
        for (const item of items) level.getRuntime().registerItem(item);
        await level.setHeroEquipment(equippedTechnicalNames);
    }

    private async openDialogue(arguments_: readonly (number | string | boolean)[]) {
        const speaker = arguments_[0];
        const asset = arguments_[1];
        const suppliedSpeakerName = arguments_[2];
        if (typeof speaker !== "string" || !speaker) throw new Error("RS_StartDialog requires a speaker id");
        if (typeof asset !== "string" || !asset) throw new Error("RS_StartDialog requires an AGE asset name");
        await this.loadDialoguePhrases();
        const url = await this.resolveDialogueAsset(asset);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Не удалось загрузить диалог ${asset}: HTTP ${response.status}`);
        const speakerName = typeof suppliedSpeakerName === "string" && suppliedSpeakerName.trim()
            ? suppliedSpeakerName
            : this.resolveSpeakerName(speaker);
        this.dialogueSpeakerTechnical = speaker;
        try {
            this.dialogue.start(new AGEParser(await response.arrayBuffer()).getData(), speakerName);
        } catch (error) {
            this.dialogueSpeakerTechnical = null;
            throw error;
        }
    }

    private async openCurrentTrade(): Promise<void> {
        const speaker = this.dialogueSpeakerTechnical;
        const level = this.level;
        const person = level?.getData()?.levelPersons.find((candidate) => candidate.name.toLowerCase() === speaker?.toLowerCase());
        if (!speaker || !level || !person?.scriptInventory) {
            throw new Error("Собеседник не поддерживает обмен");
        }
        const owner = `person:${speaker}`;
        if (!level.getRuntime().hasInventory(owner)) {
            const fileName = person.scriptInventory.toLowerCase().endsWith(".inv") ? person.scriptInventory : `${person.scriptInventory}.inv`;
            const response = await fetch(`${Paths.SCRIPTS}/inventory/${fileName.toLowerCase()}`);
            if (!response.ok) throw new Error(`Не удалось загрузить инвентарь торговца ${fileName}: HTTP ${response.status}`);
            const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
            level.getRuntime().initializeInventoryFromScript(owner, source);
        }
        this.events.onTradeRequest?.(owner, this.resolveSpeakerName(speaker));
    }

    private resolveSpeakerName(technicalName: string): string {
        const data = this.level?.getData();
        const person = data?.levelPersons.find((candidate) => candidate.name.toLowerCase() === technicalName.toLowerCase());
        if (!person) return technicalName;
        return person.literaryName === undefined ? person.literaryLabel ?? technicalName : data?.sdbData[person.literaryName] ?? technicalName;
    }


    private async resolveDialogueAsset(asset: string): Promise<string> {
        const normalized = `${asset.replace(/\\/g, "/").toLowerCase()}.cs`.replace(/\.cs\.cs$/, ".cs");
        const exact = normalizedDialogueAssets.get(normalized);
        if (exact) return exact;
        const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
        const fallback = dialogueBasenames.get(basename);
        if (fallback) return fallback;
        if (fallback === null) throw new Error(`Диалог ${asset} неоднозначен без относительного каталога`);
        throw new Error(`Диалог ${asset} отсутствует в поставленных ресурсах`);
    }

    private async loadDialoguePhrases(): Promise<SDBData> {
        if (this.dialoguePhrases) return this.dialoguePhrases;
        this.dialoguePhrasesPromise ??= fetch("/assets/sdb/dialogs/dialogsphrases.sdb")
            .then((response) => {
                if (!response.ok) throw new Error(`Не удалось загрузить базу фраз: HTTP ${response.status}`);
                return response.arrayBuffer();
            })
            .then((buffer) => new SDBParser(buffer).getData());
        this.dialoguePhrases = await this.dialoguePhrasesPromise;
        return this.dialoguePhrases;
    }

    private openWorldMap(): boolean {
        const level = this.level;
        const data = level?.getData();
        if (!level || !data) return false;
        const currentLocation = this.resolveWorldMapLocation(data.levelName);
        if (!currentLocation) return false;

        const locationAccess = level.getRuntimeSnapshot().locationAccess;
        const accessFor = (locationId: string): number => locationId === currentLocation
            ? 2
            : locationAccess[locationId.toLowerCase()] ?? 0;
        const configuredLocations = GOLDEN_LAND_WORLD_MAP_LOCATIONS.map((location) => ({
            ...location,
            availableWhen: [{ variable: `worldmap:${location.id}`, operator: "atLeast" as const, value: 2 }],
        }));
        const locations = configuredLocations.some((location) => location.id === currentLocation)
            ? configuredLocations
            : [...configuredLocations, {
                id: currentLocation,
                level: data.levelName.toLowerCase(),
                entrance: "GM",
                position: { x: 800, y: 600 },
                availableWhen: [{ variable: `worldmap:${currentLocation}`, operator: "atLeast" as const, value: 2 }],
            }];

        this.worldMap = new WorldMapRuntime({
            locations,
            links: createWorldMapLinks(locations),
            currentLocation,
            discoveredLocations: locations.filter((location) => accessFor(location.id) > 0).map((location) => location.id),
            host: {
                getVariable: (name) => name.startsWith("worldmap:")
                    ? accessFor(name.slice("worldmap:".length))
                    : level.getRuntime().getVariable(name),
                chargeTravelCost: () => true,
                advanceClock: (duration) => level.getRuntime().advanceClock(duration),
                requestTransition: (request) => void this.changeLevel("single", request.level, request.entrance).catch((error) => this.reportError(error)),
            },
        });
        this.events.onWorldMapStateChange?.(this.worldMap.getLocations());
        return true;
    }

    private resolveWorldMapLocation(levelName: string): string | null {
        const normalized = levelName.toLowerCase();
        return GOLDEN_LAND_WORLD_MAP_LOCATIONS.find((location) => location.level === normalized)?.id
            ?? this.currentWorldMapLocation
            ?? normalized.toUpperCase();
    }


    private rememberWorldMapLocation(levelName: string): void {
        const location = GOLDEN_LAND_WORLD_MAP_LOCATIONS.find((candidate) => candidate.level === levelName.toLowerCase());
        if (location) this.currentWorldMapLocation = location.id;
    }


    private publishDialogueState(state: DialogueState): void {
        if (state.status !== "active" || state.phraseId === null) {
            this.dialogueSpeakerTechnical = null;
            this.stopDialogueVoice();
            this.events.onDialogueStateChange?.(state);
            return;
        }
        const snapshot = decodeDialogueSnapshotPacket(encodeDialogueSnapshotPacket({
            updateCounter: state.revision,
            phraseId: state.phraseId,
            replyIds: state.options.map(({ id }) => id),
            context: -1,
            owner: 0,
            substitutionBlob: EMPTY_DIALOGUE_PACKET_BYTES,
            voiceBasename: EMPTY_DIALOGUE_PACKET_BYTES,
        }));
        const options = Object.freeze(snapshot.replyIds.map((id, index) => {
            const source = state.options[index];
            if (!source || source.id !== id) throw new Error(`Dialogue packet reply ${index} does not match AGE state`);
            return Object.freeze({ ...source, id });
        }));
        this.events.onDialogueStateChange?.(Object.freeze({
            ...state,
            revision: snapshot.updateCounter,
            phraseId: snapshot.phraseId,
            options,
        }));
    }

    private invokeDialogueFunction(call: DialogueFunctionCall): DialogueValue | void {
        const name = call.name;
        if (!name) return 0;
        // Server.dll 0x1403FCEC validates one string argument and returns 0.0 after dispatching the voice basename.
        if (name === "D_PlaySound") {
            const source = call.arguments[0];
            if (call.arguments.length !== 1 || typeof source !== "string" || source.trim().length === 0) {
                throw new Error(`AGE D_PlaySound record ${call.record.index} requires exactly one dialogue voice path`);
            }
            this.playDialogueVoice(source);
            return 0;
        }
        const value = this.level?.getRuntime().invokeHost(name, call.arguments);
        return typeof value === "boolean" ? (value ? 1 : 0) : value;
    }

    private playDialogueVoice(source: string): void {
        const url = resolveLevelAudioUrl(`sounds/dialogs/${source}`);
        const voice = this.dialogueVoice ??= createBrowserAudio(url);
        voice.pause();
        voice.src = url;
        voice.loop = false;
        voice.volume = Math.max(0, Math.min(1, Number(this.settings[7]) / 100));

        voice.currentTime = 0;
        try {
            const playback = voice.play();
            if (playback) void playback.catch((error) => this.reportError(error));
        } catch (error) {
            this.reportError(error);
        }
    }

    private stopDialogueVoice(): void {
        this.dialogueVoice?.pause();
    }

    private reportError(error: unknown) {
        console.error(error);
        this.events.onError?.(error);
    }

    private gameLoop = () => {
        if (!this.gameLoopActive) return;
        requestAnimationFrame(this.gameLoop);
        this.ctx!.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.level?.draw();
    };
}
