// @category Zlato

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;

public class DumpMemory extends GhidraScript {
    @Override
    public void run() throws Exception {
        Memory memory = currentProgram.getMemory();
        for (String value : getScriptArgs()) {
            Address address = toAddr(value);
            int bits = memory.getInt(address);
            long doubleBits = memory.getLong(address);
            println(address + " int=" + bits + " uint=" + Integer.toUnsignedString(bits) + " float=" + Float.intBitsToFloat(bits) + " double=" + Double.longBitsToDouble(doubleBits));
        }
    }
}
