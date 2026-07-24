// @category Zlato

import java.util.HashSet;
import java.util.Set;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
public class FindAgeLoader extends GhidraScript {
    private static final long[] TARGETS = { 0x14088ddcL };

    public void run() throws Exception {
        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        try {
            for (long target : TARGETS) {
                Address address = toAddr(target);
                Set<Function> callers = new HashSet<>();
                for (Reference reference : getReferencesTo(address)) {
                    Function caller = getFunctionContaining(reference.getFromAddress());
                    if (caller != null) callers.add(caller);
                }
                println("=== callers of " + address + ": " + callers.size() + " ===");
                for (Function caller : callers) {
                    println("=== " + caller.getName() + " @ " + caller.getEntryPoint() + " ===");
                    DecompileResults result = decompiler.decompileFunction(caller, 60, monitor);
                    println(result.decompileCompleted() ? result.getDecompiledFunction().getC() : result.getErrorMessage());
                }
            }
        } finally {
            decompiler.dispose();
        }
    }
}
