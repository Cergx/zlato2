import { useEffect, useRef } from "react";
import type { WorldMapLocationState } from "../../game/WorldMapRuntime.ts";
import styles from "./WorldMapPanel.module.scss";

export interface WorldMapPanelProps {
    locations: readonly WorldMapLocationState[];
    onTravel: (locationId: string) => void;
    onClose: () => void;
}

const MAP_WIDTH = 1600;
const MAP_HEIGHT = 1200;

export const WorldMapPanel = ({ locations, onTravel, onClose }: WorldMapPanelProps) => {
    const viewportRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<Readonly<{ pointerId: number; x: number; y: number; left: number; top: number }> | null>(null);

    const current = locations.find((location) => location.current);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport || !current) return;
        const scaleX = viewport.scrollWidth / MAP_WIDTH;
        const scaleY = viewport.scrollHeight / MAP_HEIGHT;
        viewport.scrollTo({
            left: current.position.x * scaleX - viewport.clientWidth / 2,
            top: current.position.y * scaleY - viewport.clientHeight / 2,
        });
    }, [current]);

    return <section className={styles.panel} aria-label="Глобальная карта">
        <div
            className={styles.viewport}
            ref={viewportRef}
            tabIndex={0}
            onPointerDown={(event) => {
                const viewport = viewportRef.current;
                if (!viewport || event.button !== 0) return;
                viewport.setPointerCapture(event.pointerId);
                dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
            }}
            onPointerMove={(event) => {
                const viewport = viewportRef.current;
                const drag = dragRef.current;
                if (!viewport || !drag || drag.pointerId !== event.pointerId) return;
                viewport.scrollLeft = drag.left - (event.clientX - drag.x);
                viewport.scrollTop = drag.top - (event.clientY - drag.y);
            }}
            onPointerUp={(event) => {
                if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            }}
        >
            <div className={styles.surface}>
                <img className={styles.map} src="/assets/engineres/globalmap/map_visible.bmp" alt="" draggable={false} />
                {locations.filter((location) => location.discovered).map((location) => (
                    <button
                        key={location.id}
                        type="button"
                        className={styles.location}
                        data-current={location.current}
                        disabled={location.current || !location.available}
                        style={{ left: location.position.x, top: location.position.y }}
                        onClick={() => onTravel(location.id)}
                        aria-label={location.current ? `${location.id}, текущее местоположение` : `Перейти в ${location.id}`}
                        title={location.id}
                    />
                ))}
            </div>
        </div>
        <img className={styles.frameTop} src="/assets/engineres/globalmap/interface/top.png" alt="" draggable={false} />
        <img className={styles.frameBottom} src="/assets/engineres/globalmap/interface/bottom.png" alt="" draggable={false} />
        <img className={styles.frameLeft} src="/assets/engineres/globalmap/interface/left.png" alt="" draggable={false} />
        <img className={styles.frameRight} src="/assets/engineres/globalmap/interface/right.png" alt="" draggable={false} />
        <img className={styles.frameLeftBottom} src="/assets/engineres/globalmap/interface/left_bottom.png" alt="" draggable={false} />
        <img className={styles.frameRightBottom} src="/assets/engineres/globalmap/interface/right_bottom.png" alt="" draggable={false} />

        <button className={styles.close} type="button" onClick={onClose} aria-label="Закрыть глобальную карту" />
    </section>;
};

