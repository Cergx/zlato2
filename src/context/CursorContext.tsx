import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {ANIParser, ParsedAni} from "../game/parsers/ANIParser.ts";
import { CursorType } from "../enums/CursorTypes";

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

export const CursorProvider = ({ children }: { children: ReactNode }) => {
    const [parsedAni, setParsedAni] = useState<ParsedAni>();

    const setCursor = async (cursor: CursorType) => {
        const path = `/assets/cursors/${cursor}`;
        try {
            const response = await fetch(path);
            const buffer = await response.arrayBuffer();
            const aniParser = new ANIParser(buffer);
            setParsedAni(aniParser.parse());
        } catch (error) {
            console.error("Failed to load ANI cursor:", error);
        }
    };

    useEffect(() => {
        if (!parsedAni || parsedAni.frames.length === 0) {
            return;
        }

        const styleElement = document.createElement('style');

        if (parsedAni.frames.length === 1) {
            styleElement.innerHTML = `.${cursorClassName} { cursor: url(${parsedAni.frames[0]}), auto; }`;
        } else {
            const keyframes = parsedAni.frames
                .map((frame, index) => `${(parsedAni.rate[index] * index / parsedAni.rateSum) * 100}% { cursor: url(${frame}), auto; }`)
                .join("\n");

            const animationDuration = parsedAni.rateSum / 60;
            styleElement.innerHTML = `@keyframes ${cursorClassName}Animation{${keyframes}} .${cursorClassName}{animation: ${cursorClassName}Animation ${animationDuration}s steps(1) infinite;}`;
        }

        document.head.appendChild(styleElement);

        return () => {
            document.head.removeChild(styleElement);
        };
    }, [parsedAni]);

    return (
        <CursorContext.Provider value={{ setCursor, cursorClassName }}>
            {children}
        </CursorContext.Provider>
    );
};
