// @category Zlato

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;

public class FindDecompiledText extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] needles = getScriptArgs();
        if (needles.length == 0) {
            printerr("Usage: FindDecompiledText.java <substring> [...]");
            return;
        }

        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        int matches = 0;
        try {
            FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);
            while (functions.hasNext() && !monitor.isCancelled()) {
                Function function = functions.next();
                DecompileResults result = decompiler.decompileFunction(function, 30, monitor);
                if (!result.decompileCompleted()) continue;
                String source = result.getDecompiledFunction().getC();
                boolean matched = false;
                for (String needle : needles) {
                    if (source.contains(needle)) {
                        matched = true;
                        break;
                    }
                }
                if (!matched) continue;
                matches++;
                println("=== " + function.getName() + " @ " + function.getEntryPoint() + " ===");
                println(source);
            }
        } finally {
            decompiler.dispose();
        }
        println("Matches: " + matches);
    }
}
