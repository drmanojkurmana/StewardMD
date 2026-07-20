package in.stewardmd.app;

import android.opengl.GLES20;
import android.opengl.Matrix;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * FundX Spatial-AR guide renderer (Android / ARCore) — the OpenGL mirror of the iOS SceneKit corridor.
 *
 * Android has no SceneKit, so the 3D optical corridor is hand-rolled in GLES2: a funnel of concentric
 * ring line-loops laid out on the anchor's local optical axis (local +Z runs eye -> camera, because the
 * anchor adopts the camera orientation at placement, matching the iOS plugin). Each frame the plugin
 * passes ARCore's projection + view matrices and the anchor's model matrix; we compute MVP =
 * projection * view * model and draw every ring, tinted by the fused alignment state (green on-axis at
 * the working distance / amber close / dim off). Presentation only — it never gates capture.
 *
 * Ring layout mirrors the iOS build exactly: z {0.06,0.13,0.20,0.27} m from the eye toward the camera,
 * radii {0.013,0.019,0.025,0.031} m widening outward; the outermost ring is the brighter "gate".
 */
class FundxGuideRenderer {

    private static final String VERTEX_SHADER =
        "uniform mat4 u_mvp;\n" +
        "attribute vec4 a_pos;\n" +
        "void main() { gl_Position = u_mvp * a_pos; }\n";

    private static final String FRAGMENT_SHADER =
        "precision mediump float;\n" +
        "uniform vec4 u_color;\n" +
        "void main() { gl_FragColor = u_color; }\n";

    // Corridor geometry (metres) — identical to the iOS FundxDepthPlugin.buildCorridorGuide().
    private static final float[] RING_Z = { 0.06f, 0.13f, 0.20f, 0.27f };
    private static final float[] RING_R = { 0.013f, 0.019f, 0.025f, 0.031f };
    private static final int SEGMENTS = 48;   // points per ring line-loop

    private int program;
    private int posAttrib;
    private int mvpUniform;
    private int colorUniform;

    private FloatBuffer[] rings;               // one line-loop VBO-backed buffer per ring (local XY plane)
    private FloatBuffer pip;                    // small marker ring at the eye (z=0)

    private final float[] mv = new float[16];   // scratch: view * model
    private final float[] mvp = new float[16];  // scratch: projection * view * model

    void createOnGlThread() {
        int vs = compile(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER);
        int fs = compile(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER);
        program = GLES20.glCreateProgram();
        GLES20.glAttachShader(program, vs);
        GLES20.glAttachShader(program, fs);
        GLES20.glLinkProgram(program);
        posAttrib = GLES20.glGetAttribLocation(program, "a_pos");
        mvpUniform = GLES20.glGetUniformLocation(program, "u_mvp");
        colorUniform = GLES20.glGetUniformLocation(program, "u_color");

        rings = new FloatBuffer[RING_Z.length];
        for (int i = 0; i < RING_Z.length; i++) rings[i] = ringBuffer(RING_R[i], RING_Z[i]);
        pip = ringBuffer(0.005f, 0.0f);   // tiny ring at the pupil (the iOS build uses a solid sphere)
    }

    // A ring of SEGMENTS points in the local XY plane at depth z (faces local +Z = the optical axis).
    private FloatBuffer ringBuffer(float radius, float z) {
        float[] v = new float[SEGMENTS * 3];
        for (int i = 0; i < SEGMENTS; i++) {
            double a = (2.0 * Math.PI * i) / SEGMENTS;
            v[i * 3]     = (float) (radius * Math.cos(a));
            v[i * 3 + 1] = (float) (radius * Math.sin(a));
            v[i * 3 + 2] = z;
        }
        FloatBuffer b = ByteBuffer.allocateDirect(v.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        b.put(v).position(0);
        return b;
    }

    /**
     * Draw the corridor. projection/view are ARCore's column-major float[16]; model is the anchor's
     * pose matrix (anchor.getPose().toMatrix). alignState: 2=aligned(green) 1=close(amber) 0=off(dim).
     */
    void draw(float[] projection, float[] view, float[] model, int alignState) {
        if (program == 0 || rings == null) return;
        Matrix.multiplyMM(mv, 0, view, 0, model, 0);
        Matrix.multiplyMM(mvp, 0, projection, 0, mv, 0);

        GLES20.glUseProgram(program);
        GLES20.glUniformMatrix4fv(mvpUniform, 1, false, mvp, 0);
        GLES20.glEnableVertexAttribArray(posAttrib);
        GLES20.glEnable(GLES20.GL_BLEND);
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA);
        // The camera background owns the depth buffer awkwardly; draw the guide on top regardless.
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);

        float[] c = colorFor(alignState);
        GLES20.glUniform4f(colorUniform, c[0], c[1], c[2], c[3]);

        // Pupil marker.
        GLES20.glLineWidth(3f);
        drawLoop(pip);
        // Funnel rings (the outermost is the brighter gate — a touch thicker).
        for (int i = 0; i < rings.length; i++) {
            GLES20.glLineWidth(i == rings.length - 1 ? 6f : 3f);
            drawLoop(rings[i]);
        }

        GLES20.glDisableVertexAttribArray(posAttrib);
    }

    private void drawLoop(FloatBuffer buf) {
        buf.position(0);
        GLES20.glVertexAttribPointer(posAttrib, 3, GLES20.GL_FLOAT, false, 0, buf);
        GLES20.glDrawArrays(GLES20.GL_LINE_LOOP, 0, SEGMENTS);
    }

    // Green (aligned) / amber (close) / dim white (off). RGBA, premultiplied-safe alpha.
    private float[] colorFor(int state) {
        if (state == 2) return new float[] { 0.20f, 0.85f, 0.35f, 0.95f };  // green
        if (state == 1) return new float[] { 1.00f, 0.65f, 0.10f, 0.95f };  // amber
        return new float[] { 0.88f, 0.88f, 0.88f, 0.85f };                  // dim
    }

    private int compile(int type, String src) {
        int s = GLES20.glCreateShader(type);
        GLES20.glShaderSource(s, src);
        GLES20.glCompileShader(s);
        return s;
    }
}
