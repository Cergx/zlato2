import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ANIParser, buildAniCursorSteps, type ParsedAni } from "../game/parsers/ANIParser.ts";
import { CursorType } from "../enums/CursorTypes";
import { Paths } from "../constants/paths.ts";

interface CursorContextType {
    setCursor: (cursor: CursorType) => void;
    cursorClassName: string;
}

const CursorContext = createContext<CursorContextType | undefined>(undefined);

export const useCursor = () => {
    const context = useContext(CursorContext);
    if (!context) {
        throw new Error("useCursor must be used within a CursorProvider");
    }
    return context;
};

const cursorClassName = 'aniCursor';
const cursorCache = new Map<CursorType, Promise<ParsedAni>>();

export const CursorProvider = ({ children }: { children: ReactNode }) => {
    const [parsedAni, setParsedAni] = useState<ParsedAni>();
    const activeCursor = useRef<CursorType | undefined>(undefined);
    const requestGeneration = useRef(0);

    const setCursor = useCallback((cursor: CursorType) => {
        if (activeCursor.current === cursor) return;
        activeCursor.current = cursor;
        const generation = ++requestGeneration.current;
        let pending = cursorCache.get(cursor);
        if (!pending) {
            pending = fetch(`${Paths.CURSORS}/${cursor}`).then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return new ANIParser(await response.arrayBuffer()).parse();
            });
            cursorCache.set(cursor, pending);
        }
        void pending.then((parsed) => {
            if (generation === requestGeneration.current) setParsedAni(parsed);
        }).catch((error) => {
            cursorCache.delete(cursor);
            console.error("Failed to load ANI cursor:", error);
        });
    }, []);

    useEffect(() => {
        if (!parsedAni || parsedAni.frames.length === 0) {
            return;
        }

        const styleElement = document.createElement('style');

        if (parsedAni.frames.length === 1) {
            styleElement.innerHTML = `.${cursorClassName} { cursor: url(${parsedAni.frames[0]}), auto; }`;
        } else {
            const { steps, rateSum } = buildAniCursorSteps(parsedAni);
            const keyframes = steps
                .map(({ frameIndex, percent }) => `${percent}% { cursor: url(${parsedAni.frames[frameIndex]}), auto; }`)
                .join("\n");

            const animationDuration = rateSum / 60;
            styleElement.innerHTML = `@keyframes ${cursorClassName}Animation{${keyframes}} .${cursorClassName}{animation: ${cursorClassName}Animation ${animationDuration}s steps(1) infinite;}`;
        }

        document.head.appendChild(styleElement);

        return () => {
            document.head.removeChild(styleElement);
        };
    }, [parsedAni]);

    const contextValue = useMemo(() => ({ setCursor, cursorClassName }), [setCursor]);

    return (
        <CursorContext.Provider value={contextValue}>
            {children}
        </CursorContext.Provider>
    );
};
