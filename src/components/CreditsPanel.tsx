import { useEffect, useState, type CSSProperties } from "react";
import styles from "./CreditsPanel.module.scss";

interface CreditLine {
    readonly kind: "text" | "spacer";
    readonly text?: string;
    readonly size?: number;
    readonly bold?: boolean;
    readonly color?: string;
    readonly align?: "left" | "center" | "right";
    readonly height?: number;
}

const creditsCache = new Map<string, Promise<readonly CreditLine[]>>();

const parseColor = (value: string): string => {
    const numeric = Number(value);
    const color = Number.isFinite(numeric) ? numeric & 0xffffff : 0;
    return `#${color.toString(16).padStart(6, "0")}`;
};

const parseCredits = (source: string): readonly CreditLine[] => {
    const lines: CreditLine[] = [];
    let size = 14;
    let bold = false;
    let color = "#000000";
    let align: "left" | "center" | "right" = "center";
    for (const rawLine of source.replace(/\r/g, "").split("\n")) {
        const line = rawLine.replace(/\/\/.*$/, "").trim();
        const separator = line.indexOf(":");
        if (separator < 0) continue;
        const key = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim().replace(/^"|"$/g, "");
        if (key === "font") {
            const match = value.match(/_(\d+)(b)?$/i);
            if (match) {
                size = Number(match[1]);
                bold = Boolean(match[2]);
            }
        } else if (key === "color") {
            color = parseColor(value);
        } else if (key === "format") {
            align = value === "FMT_LEFT" ? "left" : value === "FMT_RIGHT" ? "right" : "center";
        } else if (key === "text") {
            lines.push({ kind: "text", text: value, size, bold, color, align });
        } else if (key === "delta_y") {
            const height = Number(value);
            if (Number.isFinite(height) && height > 0) lines.push({ kind: "spacer", height });
        }
    }
    return lines;
};

const loadCredits = (): Promise<readonly CreditLine[]> => {
    let cached = creditsCache.get("credits");
    if (!cached) {
        cached = fetch("/assets/scripts/credits.scr").then(async (response) => {
            if (!response.ok) throw new Error(`Credits script failed: HTTP ${response.status}`);
            return parseCredits(new TextDecoder("windows-1251").decode(await response.arrayBuffer()));
        });
        creditsCache.set("credits", cached);
    }
    return cached;
};

export const CreditsPanel = () => {
    const [lines, setLines] = useState<readonly CreditLine[]>([]);
    useEffect(() => {
        let cancelled = false;
        void loadCredits().then((loaded) => { if (!cancelled) setLines(loaded); });
        return () => { cancelled = true; };
    }, []);
    return (
        <div className={styles.viewport}>
            <div className={styles.scroll}>
                {lines.map((line, index) => line.kind === "spacer"
                    ? <div key={index} style={{ height: `${line.height}px` }} />
                    : (
                        <div
                            key={index}
                            className={styles.line}
                            style={{
                                color: line.color,
                                fontSize: `${line.size}px`,
                                fontWeight: line.bold ? 700 : 400,
                                textAlign: line.align,
                            } as CSSProperties}
                        >
                            {line.text}
                        </div>
                    ))}
            </div>
        </div>
    );
};
