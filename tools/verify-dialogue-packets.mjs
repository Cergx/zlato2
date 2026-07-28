#!/usr/bin/env node
import assert from "node:assert/strict";
import {
    decodeDialogueReplyPacket,
    decodeDialogueSnapshotPacket,
    encodeDialogueReplyPacket,
    encodeDialogueSnapshotPacket,
} from "../src/game/dialogue/DialoguePacketRuntime.ts";

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const bytes = (value) => Uint8Array.from(Buffer.from(value, "hex"));
const empty = new Uint8Array(0);

const turns = [
    {
        snapshot: {
            updateCounter: 1,
            phraseId: 2684,
            replyIds: [2686, 2696],
            context: -1,
            owner: 0,
            substitutionBlob: empty,
            voiceBasename: empty,
        },
        nativeHex: "0c010000007c0a027e0a880affffffff000000",
    },
    {
        snapshot: {
            updateCounter: 2,
            phraseId: 2719,
            replyIds: [1529, 2721],
            context: -1,
            owner: 0,
            substitutionBlob: empty,
            voiceBasename: empty,
        },
        nativeHex: "0c020000009f0a02f905a10affffffff000000",
    },
];

for (const { snapshot, nativeHex } of turns) {
    assert.equal(hex(encodeDialogueSnapshotPacket(snapshot)), nativeHex);
    const decoded = decodeDialogueSnapshotPacket(bytes(nativeHex));
    assert.deepEqual({
        updateCounter: decoded.updateCounter,
        phraseId: decoded.phraseId,
        replyIds: decoded.replyIds,
        context: decoded.context,
        owner: decoded.owner,
        substitutionBlob: [...decoded.substitutionBlob],
        voiceBasename: [...decoded.voiceBasename],
    }, {
        ...snapshot,
        substitutionBlob: [],
        voiceBasename: [],
    });
}

assert.equal(hex(encodeDialogueReplyPacket(2686)), "067e0a0000");
assert.equal(decodeDialogueReplyPacket(bytes("067e0a0000")), 2686);

const tails = {
    updateCounter: 3,
    phraseId: 85,
    replyIds: [86],
    context: 7,
    owner: 9,
    substitutionBlob: new TextEncoder().encode("HeroName\0Hero\0"),
    voiceBasename: new TextEncoder().encode("demon_001"),
};
const decodedTails = decodeDialogueSnapshotPacket(encodeDialogueSnapshotPacket(tails));
assert.deepEqual([...decodedTails.substitutionBlob], [...tails.substitutionBlob]);
assert.deepEqual([...decodedTails.voiceBasename], [...tails.voiceBasename]);
assert.throws(() => decodeDialogueSnapshotPacket(bytes(`${turns[0].nativeHex}00`)), /length does not match packet size/);

console.log(`Verified ${turns.length} native opcode 12 packets, opcode 6 reply bytes, and both dialogue tail regions`);
