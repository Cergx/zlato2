import type { MaskHDR } from "./parsers/LVLParser.ts";
import type { TilePosition } from "./parsers/SEFParser.ts";

const NO_WAY_BIT = 1 << 2;
const CARDINAL_COST = 10;
const DIAGONAL_COST = 14;
// Deliberately native rather than octile: 8 * Manhattan can overestimate a
// diagonal (16 versus 14), but Server.dll uses this exact priority term.
const HEURISTIC_AXIS_COST = 8;

// Server.dll 0x1400FF28 expands these eight branches in this exact order.
// The native collision test validates the destination footprint only; it does
// not reject a diagonal merely because either adjacent cardinal cell is blocked.
const neighborX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const neighborY = [0, 0, 1, -1, -1, 1, 1, -1] as const;
const neighborCost = [
    CARDINAL_COST, CARDINAL_COST, CARDINAL_COST, CARDINAL_COST,
    DIAGONAL_COST, DIAGONAL_COST, DIAGONAL_COST, DIAGONAL_COST,
] as const;

export class WorldGrid {
    public readonly width: number;
    public readonly height: number;

    private readonly header: MaskHDR;
    private readonly cameFrom: Int32Array;
    private readonly gScore: Float64Array;
    private readonly fScore: Float64Array;
    private readonly closed: Uint8Array;
    private readonly heap: Int32Array;
    private readonly heapPosition: Int32Array;
    private heapLength = 0;
    constructor(header: MaskHDR) {
        this.header = header;
        this.width = header.width * 2;
        this.height = header.height * 2;
        const cellCount = this.width * this.height;
        this.cameFrom = new Int32Array(cellCount);
        this.gScore = new Float64Array(cellCount);
        this.fScore = new Float64Array(cellCount);
        this.closed = new Uint8Array(cellCount);
        this.heap = new Int32Array(cellCount);
        this.heapPosition = new Int32Array(cellCount);
    }

    public index(position: TilePosition): number {
        return position.y * this.width + position.x;
    }

    public contains(position: TilePosition): boolean {
        return position.x >= 0 && position.y >= 0 && position.x < this.width && position.y < this.height;
    }

    public terrainType(position: TilePosition): number {
        if (!this.contains(position)) return -1;
        const slot = (position.x & 1) | ((position.y & 1) << 1);
        const chunk = this.header.chunks[(position.x >> 1) * this.header.height + (position.y >> 1)];
        const terrain = chunk?.[0]?.terrain ?? 0;
        let type = 0;
        for (let bit = 0; bit < 4; bit++) type |= ((terrain >> (slot + bit * 4)) & 1) << bit;
        return type;
    }

    public isWalkable(position: TilePosition, blocked?: ReadonlySet<number>, allowedIndex = -1): boolean {
        if (!this.contains(position)) return false;
        const index = this.index(position);
        if (index !== allowedIndex && blocked?.has(index)) return false;
        return (this.terrainType(position) & NO_WAY_BIT) === 0;
    }

    public blocksSight(position: TilePosition): boolean {
        return !this.contains(position) || (this.terrainType(position) & NO_WAY_BIT) !== 0;
    }

    public hasLineOfSight(start: TilePosition, target: TilePosition): boolean {
        let x = start.x;
        let y = start.y;
        const dx = Math.abs(target.x - start.x);
        const dy = Math.abs(target.y - start.y);
        const stepX = start.x < target.x ? 1 : -1;
        const stepY = start.y < target.y ? 1 : -1;
        let error = dx - dy;
        while (x !== target.x || y !== target.y) {
            const doubled = error * 2;
            if (doubled > -dy) {
                error -= dy;
                x += stepX;
            }
            if (doubled < dx) {
                error += dx;
                y += stepY;
            }
            if ((x !== target.x || y !== target.y) && this.blocksSight({ x, y })) return false;
        }
        return true;
    }

    public nearestWalkable(position: TilePosition, blocked?: ReadonlySet<number>, maxRadius = 12): TilePosition | undefined {
        const clamped = {
            x: Math.max(0, Math.min(this.width - 1, position.x)),
            y: Math.max(0, Math.min(this.height - 1, position.y)),
        };
        if (this.isWalkable(clamped, blocked)) return clamped;

        for (let radius = 1; radius <= maxRadius; radius++) {
            const left = clamped.x - radius;
            const right = clamped.x + radius;
            const top = clamped.y - radius;
            const bottom = clamped.y + radius;
            for (let x = left; x <= right; x++) {
                const upper = { x, y: top };
                if (this.isWalkable(upper, blocked)) return upper;
                const lower = { x, y: bottom };
                if (this.isWalkable(lower, blocked)) return lower;
            }
            for (let y = top + 1; y < bottom; y++) {
                const lhs = { x: left, y };
                if (this.isWalkable(lhs, blocked)) return lhs;
                const rhs = { x: right, y };
                if (this.isWalkable(rhs, blocked)) return rhs;
            }
        }
        return undefined;
    }

    public findPath(
        start: TilePosition,
        requestedGoal: TilePosition,
        blocked?: ReadonlySet<number>,
        exactGoal = false,
    ): TilePosition[] {
        if (!this.contains(start)) return [];
        const startIndex = this.index(start);
        const goal = exactGoal
            ? this.isWalkable(requestedGoal, blocked) ? requestedGoal : undefined
            : this.nearestWalkable(requestedGoal, blocked);
        if (!goal) return [];
        const goalIndex = this.index(goal);
        if (startIndex === goalIndex) return [{ ...goal }];

        this.resetSearch();
        this.gScore[startIndex] = 0;
        this.fScore[startIndex] = this.heuristic(start.x, start.y, goal.x, goal.y);
        this.pushHeap(startIndex);

        while (this.heapLength > 0) {
            const currentIndex = this.popHeap();
            if (currentIndex === goalIndex) return this.reconstructPath(startIndex, goalIndex);
            if (this.closed[currentIndex]) continue;
            this.closed[currentIndex] = 1;

            const currentX = currentIndex % this.width;
            const currentY = Math.floor(currentIndex / this.width);
            for (let i = 0; i < neighborX.length; i++) {
                const dx = neighborX[i];
                const dy = neighborY[i];
                const next = { x: currentX + dx, y: currentY + dy };
                if (!this.isWalkable(next, blocked, goalIndex)) continue;

                const nextIndex = this.index(next);
                if (this.closed[nextIndex]) continue;
                const tentative = this.gScore[currentIndex] + neighborCost[i];
                if (tentative >= this.gScore[nextIndex]) continue;

                this.cameFrom[nextIndex] = currentIndex;
                this.gScore[nextIndex] = tentative;
                this.fScore[nextIndex] = tentative + this.heuristic(next.x, next.y, goal.x, goal.y);
                this.pushOrUpdateHeap(nextIndex);
            }
        }
        return [];
    }

    private resetSearch() {
        this.cameFrom.fill(-1);
        this.gScore.fill(Number.POSITIVE_INFINITY);
        this.fScore.fill(Number.POSITIVE_INFINITY);
        this.closed.fill(0);
        this.heapPosition.fill(-1);
        this.heapLength = 0;
    }

    private heuristic(x: number, y: number, goalX: number, goalY: number): number {
        return HEURISTIC_AXIS_COST * (Math.abs(goalX - x) + Math.abs(goalY - y));
    }

    private reconstructPath(startIndex: number, goalIndex: number): TilePosition[] {
        const reversed: TilePosition[] = [];
        let current = goalIndex;
        while (current !== startIndex && current >= 0) {
            reversed.push({ x: current % this.width, y: Math.floor(current / this.width) });
            current = this.cameFrom[current];
        }
        if (current !== startIndex) return [];
        reversed.push({ x: startIndex % this.width, y: Math.floor(startIndex / this.width) });
        reversed.reverse();
        return reversed;
    }

    private pushOrUpdateHeap(index: number) {
        const position = this.heapPosition[index];
        if (position < 0) {
            this.pushHeap(index);
            return;
        }
        this.siftUp(position);
    }

    private pushHeap(index: number) {
        const position = this.heapLength++;
        this.heap[position] = index;
        this.heapPosition[index] = position;
        this.siftUp(position);
    }

    private popHeap(): number {
        const root = this.heap[0];
        const last = this.heap[--this.heapLength];
        this.heapPosition[root] = -1;
        if (this.heapLength > 0) {
            this.heap[0] = last;
            this.heapPosition[last] = 0;
            this.siftDown(0);
        }
        return root;
    }

    private siftUp(start: number) {
        let position = start;
        while (position > 0) {
            const parent = (position - 1) >> 1;
            if (this.fScore[this.heap[parent]] <= this.fScore[this.heap[position]]) break;
            this.swapHeap(parent, position);
            position = parent;
        }
    }

    private siftDown(start: number) {
        let position = start;
        while (true) {
            const left = position * 2 + 1;
            if (left >= this.heapLength) return;
            const right = left + 1;
            let smallest = left;
            if (right < this.heapLength && this.fScore[this.heap[right]] < this.fScore[this.heap[left]]) smallest = right;
            if (this.fScore[this.heap[position]] <= this.fScore[this.heap[smallest]]) return;
            this.swapHeap(position, smallest);
            position = smallest;
        }
    }

    private swapHeap(left: number, right: number) {
        const leftIndex = this.heap[left];
        const rightIndex = this.heap[right];
        this.heap[left] = rightIndex;
        this.heap[right] = leftIndex;
        this.heapPosition[leftIndex] = right;
        this.heapPosition[rightIndex] = left;
    }
}
