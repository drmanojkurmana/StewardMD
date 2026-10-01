import in.stewardmd.llama.LlamaEngine;
import java.nio.file.*;
import java.util.*;

/** Drives the REAL LlamaEngine / LlamaNative (capacitor-llama) on the host: each router prompt with
 *  and without the GBNF grammar, greedy, 8 tokens. Prints one JSON line per call. */
public class GrammarHarness {
    public static void main(String[] a) throws Exception {
        String model = a[0], rows = a[1]; boolean grammarOn = !"off".equals(a.length > 2 ? a[2] : "on");
        LlamaEngine eng = new LlamaEngine();
        eng.load(model, 1024, 4);
        Base64.Decoder d = Base64.getDecoder();
        for (String line : Files.readAllLines(Paths.get(rows))) {
            if (line.isEmpty()) continue;
            String[] f = line.split("\t");
            String sys = new String(d.decode(f[1]), "UTF-8"), prompt = new String(d.decode(f[2]), "UTF-8"), gram = new String(d.decode(f[3]), "UTF-8");
            long t0 = System.currentTimeMillis(); String out; String status = "ok";
            try { out = eng.generate(sys, prompt, 8, 0f, 0, false, grammarOn ? gram : null, null); }
            catch (Exception e) { out = ""; status = "error:" + e.getMessage(); }
            long ms = System.currentTimeMillis() - t0;
            System.out.println("{\"id\":\"" + f[0] + "\",\"text\":\"" + out.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\",\"ms\":" + ms + ",\"status\":\"" + status + "\"}");
        }
        eng.release();
    }
}
