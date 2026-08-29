import { useEffect, useState } from "react";
import type { DevHoverItem } from "../../game/MapRenderer";
import styles from "./DevHoverDock.module.scss";

const KIND_LABEL: Record<DevHoverItem["kind"], string> = {
    unit: "юнит",
    chest: "сундук",
    trigger: "триггер",
    static: "статик",
    door: "дверь",
    mask: "маска",
};

export const DevHoverDock = () => {
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<readonly DevHoverItem[]>([]);

    useEffect(() => {
        const onHover = (event: Event) => {
            setItems((event as CustomEvent<readonly DevHoverItem[]>).detail ?? []);
        };
        window.addEventListener("zlato2:dev-hover", onHover);
        return () => window.removeEventListener("zlato2:dev-hover", onHover);
    }, []);

    useEffect(() => {
        window.__devHoverEnabled = open;
        if (!open) window.__devHover = [];
        return () => { window.__devHoverEnabled = false; };
    }, [open]);

    return (
        <div className={styles.dock}>
            <button
                type="button"
                className={`${styles.toggle} ${open ? styles.toggleOpen : ""}`}
                onClick={() => setOpen((current) => !current)}
                title="DEV: переключить панель объектов под курсором"
            >
                {open ? "»" : "«"} hover
            </button>
            {open && (
                <div className={styles.panel}>
                    <div className={styles.panelTitle}>Объекты под курсором</div>
                    {items.length === 0 ? (
                        <div className={styles.empty}>Наведите курсор на объект</div>
                    ) : (
                        items.map((item, index) => (
                            <div key={`${item.kind}-${item.name}-${index}`} className={styles.item}>
                                <div className={styles.itemHead}>
                                    <span className={`${styles.badge} ${styles[item.kind]}`}>{KIND_LABEL[item.kind]}</span>
                                    <span className={styles.name}>{item.name}</span>
                                </div>
                                <div className={styles.coords}>
                                    x={item.x} y={item.y} w={item.w} h={item.h} depth={item.depth}
                                    {item.tileX !== undefined && (
                                        <span className={styles.tile}> tile=({item.tileX},{item.tileY})</span>
                                    )}
                                </div>
                                {item.extra.map((line, lineIndex) => (
                                    <div key={lineIndex} className={styles.extra}>{line}</div>
                                ))}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};
