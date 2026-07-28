import styles from "./LoadingScreen.module.scss";

interface LoadingScreenProps {
    readonly level: string;
    readonly stage: string;
    readonly progress: number;
}

export const LoadingScreen = ({ level, stage, progress }: LoadingScreenProps) => {
    let hash = 0;
    for (const character of level) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    const background = hash % 9;
    const clampedProgress = Math.max(0, Math.min(1, progress));
    return (
        <section className={styles.loading} aria-label={`${stage} ${level}`}>
            <img className={styles.background} src={`/assets/engineres/interface/loading_jpg/background_${background}.jpg`} alt="" draggable={false} />
            <div className={styles.progress} style={{ width: `${934 * clampedProgress}px` }}>
                <img src="/assets/engineres/interface/loading/progress.bmp" alt="" draggable={false} />
            </div>
            {clampedProgress > 0 && (
                <img
                    className={styles.glow}
                    src="/assets/engineres/interface/loading/glow.bmp"
                    alt=""
                    draggable={false}
                    style={{ left: `${47 + 934 * clampedProgress - 30}px` }}
                />
            )}
            <strong>{stage}</strong>
        </section>
    );
};
