import in.stewardmd.llama.LlamaEngine;
import java.nio.file.*;
import java.util.*;

/** Drives the REAL LlamaEngine / LlamaNative (capacitor-llama) on the host: each router prompt with
 *  and without the GBNF grammar, greedy, 8 tokens, or ("pick") the forced prefix {"option": + one
 *  prefill + digit pick, with the prompt tail tokens from lastStats. Prints one JSON line per call. */
public class GrammarHarness {
    public static void main(String[] a) throws Exception {
        String model = a[0], rows = a[1], mode = a.length > 2 ? a[2] : "on"; boolean grammarOn = !"off".equals(mode);
        LlamaEngine eng = new LlamaEngine();
        eng.load(model, 1024, 4);
        Base64.Decoder d = Base64.getDecoder();
        for (String line : Files.readAllLines(Paths.get(rows))) {
            if (line.isEmpty()) continue;
            String[] f = line.split("\t");
            String sys = new String(d.decode(f[1]), "UTF-8"), prompt = new String(d.decode(f[2]), "UTF-8"), gram = new String(d.decode(f[3]), "UTF-8");
            long t0 = System.currentTimeMillis(); String out; String status = "ok";
            if ("pick".equals(mode)) {
                int n = Integer.parseInt(f[4]); String[] ch = new String[n + 1];
                for (int i = 0; i <= n; i++) ch[i] = String.valueOf(i);
                float[] p = eng.pick(sys, prompt, "{\"option\":", ch);
                long ms = System.currentTimeMillis() - t0; int best = 0;
                for (int i = 1; p != null && i < p.length; i++) if (p[i] > p[best]) best = i;
                String st = eng.lastStats(), tail = st.substring(st.indexOf("\"pickTokens\":") + 13, st.indexOf(']', st.indexOf("\"pickTokens\":")) + 1);
                System.out.println("{\"id\":\"" + f[0] + "\",\"option\":" + (p == null ? "null" : best) + ",\"p\":" + (p == null ? "null" : p[best]) + ",\"tail\":" + tail + ",\"ms\":" + ms + "}");
                continue;
            }
            try { out = eng.generate(sys, prompt, 8, 0f, 0, false, grammarOn ? gram : null, null); }
            catch (Exception e) { out = ""; status = "error:" + e.getMessage(); }
            long ms = System.currentTimeMillis() - t0;
            System.out.println("{\"id\":\"" + f[0] + "\",\"text\":\"" + out.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\",\"ms\":" + ms + ",\"status\":\"" + status + "\"}");
        }
        eng.release();
    }
}
