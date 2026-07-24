import styles from "./LoadingScreen.module.scss";

export const LoadingScreen = ({ level }: { readonly level: string }) => {
    let hash = 0;
    for (const character of level) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    const background = hash % 9;
    return (
        <section className={styles.loading} aria-label={`Загрузка уровня ${level}`}>
            <img src={`/assets/engineres/interface/loading_jpg/background_${background}.jpg`} alt="" draggable={false} />
            <div className={styles.progress}>
                <span />
            </div>
            <strong>Загрузка...</strong>
        </section>
    );
};
