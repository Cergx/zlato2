// @category Zlato

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

import java.util.HashSet;
import java.util.Set;

public class DumpAddressReferences extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] addresses = getScriptArgs();
        if (addresses.length == 0) {
            printerr("Usage: DumpAddressReferences.java <address> [...]");
            return;
        }

        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        Set<String> dumpedFunctions = new HashSet<>();
        try {
            for (String value : addresses) {
                Address address = toAddr(value);
                println("=== REFERENCES TO " + address + " ===");
                ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(address);
                while (references.hasNext()) {
                    Reference reference = references.next();
                    Function function = currentProgram.getFunctionManager().getFunctionContaining(reference.getFromAddress());
                    println("xref " + reference.getFromAddress() + (function == null ? "" : " in " + function.getName() + " @ " + function.getEntryPoint()));
                    if (function == null || !dumpedFunctions.add(function.getEntryPoint().toString())) continue;

                    DecompileResults result = decompiler.decompileFunction(function, 60, monitor);
                    if (!result.decompileCompleted()) {
                        println("Decompilation failed: " + result.getErrorMessage());
                    } else {
                        println(result.getDecompiledFunction().getC());
                    }
                }
            }
        } finally {
            decompiler.dispose();
        }
    }
}
