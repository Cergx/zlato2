export const DIALOGUE_SNAPSHOT_OPCODE = 12;
export const DIALOGUE_REPLY_OPCODE = 6;
export const MAX_DIALOGUE_REPLIES = 40;

export interface DialoguePacketSnapshot {
    readonly updateCounter: number;
    readonly phraseId: number;
    readonly replyIds: readonly number[];
    readonly context: number;
    readonly owner: number;
    readonly substitutionBlob: Uint8Array;
    readonly voiceBasename: Uint8Array;
}

const EMPTY_BYTES = new Uint8Array(0);

const requireUint8 = (value: number, label: string): number => {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new Error(`${label} must be a uint8`);
    return value;
};

const requireUint16 = (value: number, label: string): number => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error(`${label} must be a uint16`);
    return value;
};

const requireUint32 = (value: number, label: string): number => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`${label} must be a uint32`);
    return value;
};

const requireInt32 = (value: number, label: string): number => {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new Error(`${label} must be an int32`);
    return value;
};

const requireTail = (value: Uint8Array | undefined, label: string): Uint8Array => {
    const bytes = value ?? EMPTY_BYTES;
    if (bytes.byteLength > 0xff) throw new Error(`${label} exceeds the native uint8 byte length`);
    return bytes;
};

export const encodeDialogueSnapshotPacket = (snapshot: DialoguePacketSnapshot): Uint8Array => {
    const updateCounter = requireUint32(snapshot.updateCounter, "Dialogue update counter");
    const phraseId = requireUint16(snapshot.phraseId, "Dialogue phrase ID");
    const context = requireInt32(snapshot.context, "Dialogue context");
    const owner = requireUint8(snapshot.owner, "Dialogue owner");
    if (snapshot.replyIds.length > MAX_DIALOGUE_REPLIES) {
        throw new Error(`Dialogue reply count exceeds native limit ${MAX_DIALOGUE_REPLIES}`);
    }
    const replyIds = snapshot.replyIds.map((replyId, index) => requireUint16(replyId, `Dialogue reply ID ${index}`));
    const substitutionBlob = requireTail(snapshot.substitutionBlob, "Dialogue substitution blob");
    const voiceBasename = requireTail(snapshot.voiceBasename, "Dialogue voice basename");
    const byteLength = 15 + replyIds.length * 2 + substitutionBlob.byteLength + voiceBasename.byteLength;
    const packet = new Uint8Array(byteLength);
    const view = new DataView(packet.buffer);
    let offset = 0;

    packet[offset++] = DIALOGUE_SNAPSHOT_OPCODE;
    view.setUint32(offset, updateCounter, true);
    offset += 4;
    view.setUint16(offset, phraseId, true);
    offset += 2;
    packet[offset++] = replyIds.length;
    for (const replyId of replyIds) {
        view.setUint16(offset, replyId, true);
        offset += 2;
    }
    view.setInt32(offset, context, true);
    offset += 4;
    packet[offset++] = owner;
    packet[offset++] = substitutionBlob.byteLength;
    packet.set(substitutionBlob, offset);
    offset += substitutionBlob.byteLength;
    packet[offset++] = voiceBasename.byteLength;
    packet.set(voiceBasename, offset);
    return packet;
};

export const decodeDialogueSnapshotPacket = (packet: Uint8Array): DialoguePacketSnapshot => {
    if (packet.byteLength < 15) throw new Error("Dialogue snapshot packet is truncated");
    if (packet[0] !== DIALOGUE_SNAPSHOT_OPCODE) throw new Error(`Expected dialogue snapshot opcode ${DIALOGUE_SNAPSHOT_OPCODE}`);
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    let offset = 1;
    const updateCounter = view.getUint32(offset, true);
    offset += 4;
    const phraseId = view.getUint16(offset, true);
    offset += 2;
    const replyCount = packet[offset++];
    if (replyCount > MAX_DIALOGUE_REPLIES) throw new Error(`Dialogue reply count exceeds native limit ${MAX_DIALOGUE_REPLIES}`);
    const fixedTailLength = replyCount * 2 + 7;
    if (offset + fixedTailLength > packet.byteLength) throw new Error("Dialogue snapshot reply list is truncated");
    const replyIds = new Array<number>(replyCount);
    for (let index = 0; index < replyCount; index += 1) {
        replyIds[index] = view.getUint16(offset, true);
        offset += 2;
    }
    const context = view.getInt32(offset, true);
    offset += 4;
    const owner = packet[offset++];
    const substitutionLength = packet[offset++];
    if (offset + substitutionLength + 1 > packet.byteLength) throw new Error("Dialogue substitution blob is truncated");
    const substitutionBlob = packet.slice(offset, offset + substitutionLength);
    offset += substitutionLength;
    const voiceLength = packet[offset++];
    if (offset + voiceLength !== packet.byteLength) throw new Error("Dialogue voice basename length does not match packet size");
    const voiceBasename = packet.slice(offset, offset + voiceLength);

    return Object.freeze({
        updateCounter,
        phraseId,
        replyIds: Object.freeze(replyIds),
        context,
        owner,
        substitutionBlob,
        voiceBasename,
    });
};

export const encodeDialogueReplyPacket = (replyId: number): Uint8Array => {
    const packet = new Uint8Array(5);
    packet[0] = DIALOGUE_REPLY_OPCODE;
    new DataView(packet.buffer).setUint32(1, requireUint32(replyId, "Dialogue reply ID"), true);
    return packet;
};

export const decodeDialogueReplyPacket = (packet: Uint8Array): number => {
    if (packet.byteLength !== 5) throw new Error("Dialogue reply packet must contain exactly five bytes");
    if (packet[0] !== DIALOGUE_REPLY_OPCODE) throw new Error(`Expected dialogue reply opcode ${DIALOGUE_REPLY_OPCODE}`);
    return new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(1, true);
};
