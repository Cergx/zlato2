export type DayPhase = "day" | "night";

export const NATIVE_DAY_START_HOUR = 6;
export const NATIVE_NIGHT_START_HOUR = 20;
export const MINUTES_PER_DAY = 24 * 60;

const normalizeMinuteOfDay = (elapsedMinutes: number): number => {
    if (!Number.isFinite(elapsedMinutes)) throw new Error("Game clock must contain a finite minute count");
    return ((elapsedMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
};

// Server.dll RS_GetDayOrNight at 0x14040D98 returns day for integer hours 6..19.
export const nativeDayPhase = (elapsedMinutes: number): DayPhase => {
    const hour = Math.floor(normalizeMinuteOfDay(elapsedMinutes) / 60);
    return hour >= NATIVE_DAY_START_HOUR && hour < NATIVE_NIGHT_START_HOUR ? "day" : "night";
};

// Client.dll light controller vtable slot +0x0C (0x120AFCAC) returns 0 before
// 07:00, rises linearly during 07:00..07:59, stays at 1 through 20:59, and
// falls linearly during 21:00..21:59.
export const nativeWorldLightCoefficient = (elapsedMinutes: number): number => {
    const minuteOfDay = normalizeMinuteOfDay(elapsedMinutes);
    const hour = Math.floor(minuteOfDay / 60);
    const minuteFraction = minuteOfDay - hour * 60;
    if (hour < 7 || hour >= 22) return 0;
    if (hour === 7) return minuteFraction / 60;
    if (hour === 21) return 1 - minuteFraction / 60;
    return 1;
};

export interface NativeWorldLightModulation {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
}

// On the Direct3D HAL path used by the original game, Client.dll 0x12029869..
// 0x12029896 queues color 0x00E0A0 with strength 1.5 * (coefficient - 1).
// Renderer 0x12029DD1..0x12029E9C uses ZERO/INVSRCCOLOR blending, so this is
// per-channel multiplication, not a neutral black overlay. The input color is
// converted to D3D RGB #A0E000 before its channels are scaled by the strength.
export const nativeWorldLightModulation = (elapsedMinutes: number): NativeWorldLightModulation => {
    const coefficient = nativeWorldLightCoefficient(elapsedMinutes);
    const magnitude = Math.min(255, Math.trunc(Math.abs(1.5 * (coefficient - 1)) * 100));
    const scaledRed = Math.trunc(0xa0 * magnitude / 255);
    const scaledGreen = Math.trunc(0xe0 * magnitude / 255);
    return {
        red: 255 - scaledRed,
        green: 255 - scaledGreen,
        blue: 255,
    };
};

// The render gate at Client.dll 0x1203C904..0x1203C93D checks gv_day_night
// and GoldenLand.exe interface slot +0x60. The latter reads location flags at
// +0x310; bit 0 is populated from SEF internal_location. Indoor levels skip
// the effect. HUD composition happens later and remains unmodified.
export const drawNativeNightShading = (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    elapsedMinutes: number,
    internalLocation: boolean,
): void => {
    if (internalLocation) return;
    const modulation = nativeWorldLightModulation(elapsedMinutes);
    if (modulation.red === 255 && modulation.green === 255 && modulation.blue === 255) return;
    context.save();
    context.globalCompositeOperation = "multiply";
    context.fillStyle = `rgb(${modulation.red} ${modulation.green} ${modulation.blue})`;
    context.fillRect(0, 0, width, height);
    context.restore();
};
