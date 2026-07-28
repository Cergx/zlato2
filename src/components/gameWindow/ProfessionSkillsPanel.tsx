import { useEffect, useState } from "react";
import {
    PROFESSION_LEVEL_TABS,
    type ProfessionSkillId,
} from "../../constants/clientDll.ts";
import { ColorKeyImage } from "../ColorKeyImage.tsx";
import { OriginalGuiLayer, type GuiControlValue } from "../OriginalGuiLayer.tsx";
import styles from "./ProfessionSkillsPanel.module.scss";

interface ProfessionSkillsPanelProps {
    readonly initialSkillId: ProfessionSkillId;
    readonly onClose: () => void;
}

const TAB_FIRST_OBJECT_ID = PROFESSION_LEVEL_TABS[0].objectId;
const TAB_LAST_OBJECT_ID = PROFESSION_LEVEL_TABS[PROFESSION_LEVEL_TABS.length - 1].objectId;
const FILTER_FIRST_OBJECT_ID = 14;
const FILTER_LAST_OBJECT_ID = 20;
const CLOSE_OBJECT_ID = 21;
const CREATE_OBJECT_ID = 22;
const INACTIVE_OBJECT_IDS = [1, 2, 3, 4, 10, 11, 12, 13, CREATE_OBJECT_ID, 23, 24, 25, 26] as const;

export const ProfessionSkillsPanel = ({ initialSkillId, onClose }: ProfessionSkillsPanelProps) => {
    const [selectedLevelIndex, setSelectedLevelIndex] = useState(0);
    const [selectedFilterId, setSelectedFilterId] = useState<number | null>(null);

    useEffect(() => setSelectedLevelIndex(0), [initialSkillId]);
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const selectedLevel = PROFESSION_LEVEL_TABS[selectedLevelIndex] ?? PROFESSION_LEVEL_TABS[0];
    const values: Record<number, GuiControlValue> = Object.fromEntries([
        ...PROFESSION_LEVEL_TABS.map(({ objectId }, index) => [objectId, index === selectedLevelIndex]),
        ...Array.from({ length: FILTER_LAST_OBJECT_ID - FILTER_FIRST_OBJECT_ID + 1 }, (_, index) => [FILTER_FIRST_OBJECT_ID + index, FILTER_FIRST_OBJECT_ID + index === selectedFilterId]),
    ]);

    return <section className={styles.panel} data-profession-panel={initialSkillId}
        data-profession-level={selectedLevel.level} aria-label="Окно ремесленного навыка">
        <ColorKeyImage className={styles.background} src="/assets/engineres/skills/main.bmp" />
        {selectedLevel.artwork && <ColorKeyImage className={styles.tabArtwork} src={selectedLevel.artwork} />}
        <OriginalGuiLayer
            className={styles.authoredControls}
            script="skills_gui"
            canvasWidth={923}
            canvasHeight={453}
            values={values}
            inactiveObjectIds={INACTIVE_OBJECT_IDS}
            labels={{
                5: "Уровень I",
                6: "Уровень II",
                7: "Уровень III",
                8: "Уровень IV",
                9: "Уровень V",
                21: "Закрыть",
                22: "Создать",
            }}
            onAction={(object) => {
                if (object.id >= TAB_FIRST_OBJECT_ID && object.id <= TAB_LAST_OBJECT_ID) {
                    setSelectedLevelIndex(object.id - TAB_FIRST_OBJECT_ID);
                } else if (object.id === CLOSE_OBJECT_ID) {
                    onClose();
                }
            }}
            onValueChange={(object, value) => {
                if (object.id >= FILTER_FIRST_OBJECT_ID && object.id <= FILTER_LAST_OBJECT_ID && value === true) {
                    setSelectedFilterId(object.id);
                }
            }}
        />
    </section>;
};
