// @category Zlato

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

public class DumpFunctions extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] addresses = getScriptArgs();
        if (addresses.length == 0) {
            printerr("Usage: DumpFunctions.java <address> [...]");
            return;
        }

        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        try {
            for (String value : addresses) {
                Address address = toAddr(value);
                Function function = currentProgram.getFunctionManager().getFunctionContaining(address);
                println("=== " + address + " ===");
                if (function == null) {
                    println("No containing function");
                    continue;
                }
                println(function.getName() + " @ " + function.getEntryPoint());
                DecompileResults result = decompiler.decompileFunction(function, 60, monitor);
                if (!result.decompileCompleted()) {
                    println("Decompilation failed: " + result.getErrorMessage());
                } else {
                    println(result.getDecompiledFunction().getC());
                }
            }
        } finally {
            decompiler.dispose();
        }
    }
}
