// @category Zlato

import java.nio.charset.StandardCharsets;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

public class FindServerDialogueStrings extends GhidraScript {
    private static final String[] NEEDLES = {
        "Dialogs cache...",
        "All dialogs was cached ok. Found: %d",
        "scripts\\dialogs\\%s.cs",
        "RS_StartDialog",
        "CBDialogServer::OpenDialog() :",
    };

    @Override
    public void run() throws Exception {
        println("Image base: " + currentProgram.getImageBase());
        for (String needle : NEEDLES) {
            byte[] pattern = needle.getBytes(StandardCharsets.US_ASCII);
            println("=== " + needle + " ===");
            for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
                if (!block.isInitialized() || block.getSize() > Integer.MAX_VALUE) continue;
                byte[] bytes = new byte[(int) block.getSize()];
                currentProgram.getMemory().getBytes(block.getStart(), bytes);
                for (int offset = 0; offset <= bytes.length - pattern.length; offset += 1) {
                    boolean matches = true;
                    for (int index = 0; index < pattern.length; index += 1) {
                        if (bytes[offset + index] != pattern[index]) {
                            matches = false;
                            break;
                        }
                    }
                    if (!matches) continue;
                    Address address = block.getStart().add(offset);
                    println("string @ " + address);
                    ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(address);
                    while (references.hasNext()) {
                        Reference reference = references.next();
                        Function caller = currentProgram.getFunctionManager().getFunctionContaining(reference.getFromAddress());
                        println("  " + reference.getFromAddress() + " -> " + (caller == null ? "<no function>" : caller.getName() + " @ " + caller.getEntryPoint()));
                    }
                }
            }
        }
    }
}
