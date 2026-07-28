import type { ReactNode } from "react";
import styles from "./ItemContainer.module.scss";

interface ItemContainerProps {
    readonly columns: number;
    readonly rows: number;
    readonly children: ReactNode;
    readonly className?: string;
    readonly ariaLabel?: string;
}

export const ItemContainer = ({ columns, rows, children, className, ariaLabel }: ItemContainerProps): React.JSX.Element => (
    <div className={`${styles.container} ${className ?? ""}`}
        style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
        aria-label={ariaLabel}>
        {children}
    </div>
);
