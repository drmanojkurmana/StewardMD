package in.stewardmd.needle;

import java.nio.file.*;
import java.util.*;

/** Host check of the REAL needle_jni.cpp + NeedleNative: load (mmap), configure, complete, reset. */
public class NeedleHarness {
    public static void main(String[] a) throws Exception {
        String weights = a[0], rows = a[1], tools = new String(Files.readAllBytes(Paths.get(a[2])), "UTF-8"), system = new String(Files.readAllBytes(Paths.get(a[3])), "UTF-8");
        int limit = a.length > 4 ? Integer.parseInt(a[4]) : 60;
        System.err.println("load rc=" + NeedleNative.load(weights) + " err=" + NeedleNative.lastError());
        System.err.println("configure rc=" + NeedleNative.configure(system, tools) + " err=" + NeedleNative.lastError());
        System.err.println("missing weights rc=" + NeedleNative.load("/nonexistent.cact") + " err=" + NeedleNative.lastError());
        Base64.Decoder d = Base64.getDecoder(); int n = 0;
        for (String line : Files.readAllLines(Paths.get(rows))) {
            if (line.isEmpty() || n++ >= limit) continue;
            String[] f = line.split("\t");
            String prompt = new String(d.decode(f[2]), "UTF-8");
            NeedleNative.reset();
            long t0 = System.currentTimeMillis();
            String json = NeedleNative.complete(prompt, 48);
            long ms = System.currentTimeMillis() - t0;
            System.out.println("{\"id\":\"" + f[0] + "\",\"ms\":" + ms + ",\"raw\":" + (json == null ? "null" : json) + "}");
        }
    }
}
