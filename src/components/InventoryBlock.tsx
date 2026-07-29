import type { DragEvent, ReactNode } from "react";
import type { GuiObjectDefinition } from "../game/GuiDefinitionRuntime.ts";
import { OriginalGuiLayer, type GuiControlValue } from "./OriginalGuiLayer.tsx";
import styles from "./HeroBlocks.module.scss";

interface InventoryBlockProps {
    readonly script: string;
    readonly containerObjectId: number;
    readonly content: ReactNode;
    readonly previousObjectId?: number;
    readonly nextObjectId?: number;
    readonly dropObjectId?: number;
    readonly filterObjectIds?: readonly number[];
    readonly activeFilterId?: number | null;
    readonly canGoPrevious?: boolean;
    readonly canGoNext?: boolean;
    readonly canDrop?: boolean;
    readonly onPrevious?: () => void;
    readonly onNext?: () => void;
    readonly onFilterChange?: (objectId: number | null) => void;
    readonly onDragOver?: (object: GuiObjectDefinition, event: DragEvent<HTMLElement>) => void;
    readonly onDrop?: (object: GuiObjectDefinition, event: DragEvent<HTMLElement>) => void;
    readonly tooltips?: Readonly<Record<number, string>>;
    readonly tooltipDelayMs?: number;
    readonly className?: string;
}

export const InventoryBlock = ({
    script,
    containerObjectId,
    content,
    previousObjectId,
    nextObjectId,
    dropObjectId,
    filterObjectIds = [],
    activeFilterId = null,
    canGoPrevious = true,
    canGoNext = true,
    canDrop = true,
    onPrevious,
    onNext,
    onFilterChange,
    onDragOver,
    onDrop,
    tooltips,
    tooltipDelayMs,
    className,
}: InventoryBlockProps) => {
    const objectIds = [
        containerObjectId,
        ...(previousObjectId === undefined ? [] : [previousObjectId]),
        ...(nextObjectId === undefined ? [] : [nextObjectId]),
        ...(dropObjectId === undefined ? [] : [dropObjectId]),
        ...filterObjectIds,
    ];
    const values: Record<number, GuiControlValue> = {};
    for (const id of filterObjectIds) values[id] = id === activeFilterId;
    const inactiveObjectIds = [
        ...(!canGoPrevious && previousObjectId !== undefined ? [previousObjectId] : []),
        ...(!canGoNext && nextObjectId !== undefined ? [nextObjectId] : []),
        ...(!canDrop && dropObjectId !== undefined ? [dropObjectId] : []),
    ];

    return <section className={`${styles.block} ${className ?? ""}`} data-inventory-block>
        <OriginalGuiLayer className={styles.controls} script={script} objectIds={objectIds}
            values={values} inactiveObjectIds={inactiveObjectIds}
            objectContents={{ [containerObjectId]: content }}
            tooltips={tooltips} tooltipDelayMs={tooltipDelayMs}
            onAction={(object) => {
                if (object.id === previousObjectId) onPrevious?.();
                else if (object.id === nextObjectId) onNext?.();
            }}
            onValueChange={(object, value) => {
                if (!filterObjectIds.includes(object.id) || typeof value !== "boolean") return;
                onFilterChange?.(value ? object.id : null);
            }}
            onDragOver={onDragOver} onDrop={onDrop} />
    </section>;
};
