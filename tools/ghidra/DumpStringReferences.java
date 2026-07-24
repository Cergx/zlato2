// @category Zlato

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

import java.util.HashSet;
import java.util.Set;

public class DumpStringReferences extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] needles = getScriptArgs();
        if (needles.length == 0) {
            printerr("Usage: DumpStringReferences.java <substring> [...]");
            return;
        }

        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        Set<String> dumpedFunctions = new HashSet<>();

        try {
            DataIterator allData = currentProgram.getListing().getDefinedData(true);
            while (allData.hasNext()) {
                Data data = allData.next();
                Object value = data.getValue();
                if (!(value instanceof String)) continue;
                String text = (String) value;

                boolean matches = false;
                for (String needle : needles) {
                    if (text.toLowerCase().contains(needle.toLowerCase())) {
                        matches = true;
                        break;
                    }
                }
                if (!matches) continue;

                println("=== STRING " + data.getAddress() + ": " + text + " ===");
                ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(data.getAddress());
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
