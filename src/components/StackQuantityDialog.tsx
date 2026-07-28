import { useEffect, useState } from "react";
import type { ShippedItem } from "../game/ItemCatalogRuntime.ts";
import { ColorKeyImage } from "./ColorKeyImage.tsx";
import { ItemIcon } from "./ItemIcon.tsx";
import { OriginalGuiLayer } from "./OriginalGuiLayer.tsx";
import styles from "./StackQuantityDialog.module.scss";

interface StackQuantityDialogProps {
    readonly item: ShippedItem;
    readonly maximum: number;
    readonly onConfirm: (quantity: number) => void;
    readonly onCancel: () => void;
}

export const StackQuantityDialog = ({ item, maximum, onConfirm, onCancel }: StackQuantityDialogProps): React.JSX.Element => {
    const [quantity, setQuantity] = useState(1);


    useEffect(() => setQuantity(1), [item.technicalName, maximum]);

    const setClampedQuantity = (value: number): void => setQuantity(Math.max(1, Math.min(maximum, value)));

    const remaining = Math.max(0, maximum - quantity);

    return <div className={styles.dialog} role="dialog" aria-label={`Количество: ${item.literaryName}`}>
        <ColorKeyImage src="/assets/engineres/stacks/main.bmp" draggable={false} />
        <span className={`${styles.count} ${styles.remaining}`} data-stack-count="remaining"
            aria-label={`Останется: ${remaining}`}>{remaining}</span>
        <span className={`${styles.count} ${styles.transferred}`} data-stack-count="transferred"
            aria-label={`Переносится: ${quantity}`}>{quantity}</span>
        <OriginalGuiLayer script="stacks_gui" canvasWidth={246} canvasHeight={201} values={{ 4: quantity }}
            objectContents={{ 5: <ItemIcon item={item} /> }}
            sliderLimits={{ 4: { minimum: 1, maximum } }}
            onValueChange={(object, value) => {
                if (object.id === 4 && typeof value === "number") setClampedQuantity(value);
            }}
            onAction={(object) => {
                if (object.id === 1) onConfirm(quantity);
                else if (object.id === 2) onCancel();
                else if (object.id === 3) onConfirm(maximum);
                else if (object.id === 7) setClampedQuantity(quantity - 1);
                else if (object.id === 8) setClampedQuantity(quantity + 1);
            }} />
    </div>;
};
