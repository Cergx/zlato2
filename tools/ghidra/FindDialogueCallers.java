// @category Zlato

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

public class FindDialogueCallers extends GhidraScript {
    private static final long[] TARGETS = {
        0x12133354L,
    };

    @Override
    public void run() throws Exception {
        for (long value : TARGETS) {
            Address address = toAddr(value);
            println("=== callers of " + address + " ===");
            ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(address);
            while (references.hasNext()) {
                Reference reference = references.next();
                Function caller = currentProgram.getFunctionManager().getFunctionContaining(reference.getFromAddress());
                println(reference.getFromAddress() + " -> " + (caller == null ? "<no function>" : caller.getName() + " @ " + caller.getEntryPoint()));
            }
        }
    }
}
