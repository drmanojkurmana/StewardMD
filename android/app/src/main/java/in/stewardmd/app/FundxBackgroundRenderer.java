package in.stewardmd.app;

import android.opengl.GLES11Ext;
import android.opengl.GLES20;

import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * FundX GPU camera-background renderer (Android).
 *
 * Draws ARCore's GPU camera texture (OES external) full-screen at display refresh, so the FundX
 * preview is the real, hardware-accelerated, full-resolution camera feed — matching the stock
 * camera — instead of the low-res CPU-JPEG-over-bridge path. Camera feed only (no depth occlusion
 * / no virtual content); depth + pose + the low-res CPU analysis frame are handled separately by
 * the plugin. Standard ARCore hello_ar BackgroundRenderer pattern.
 */
class FundxBackgroundRenderer {

    private static final int COORDS_PER_VERTEX = 2;
    private static final int TEXCOORDS_PER_VERTEX = 2;
    private static final int FLOAT_SIZE = 4;

    // Full-screen quad in normalized device coordinates (triangle strip).
    private static final float[] QUAD_COORDS = new float[] {
        -1.0f, -1.0f,  +1.0f, -1.0f,  -1.0f, +1.0f,  +1.0f, +1.0f,
    };

    private static final String VERTEX_SHADER =
        "attribute vec4 a_Position;\n" +
        "attribute vec2 a_TexCoord;\n" +
        "varying vec2 v_TexCoord;\n" +
        "void main() {\n" +
        "  gl_Position = a_Position;\n" +
        "  v_TexCoord = a_TexCoord;\n" +
        "}";

    // ARCore's camera texture is lightly-processed (raw-ish, for AR tracking stability) — it lacks the
    // vendor ISP's edge-sharpening and local tone-mapping that make the stock preview crisp. This
    // fragment shader approximates that with an unsharp-mask (edge enhancement) + contrast + saturation,
    // done on the GPU so it's free. It cannot replicate Google's proprietary HDR+ pipeline exactly.
    private static final String FRAGMENT_SHADER =
        "#extension GL_OES_EGL_image_external : require\n" +
        "precision mediump float;\n" +
        "varying vec2 v_TexCoord;\n" +
        "uniform samplerExternalOES sTexture;\n" +
        "void main() {\n" +
        "  gl_FragColor = texture2D(sTexture, v_TexCoord);\n" +      // plain, known-good full-res draw
        "}";

    // ISP-approximation defaults (subtle — over-processing looks worse than soft).
    private float sharpen = 0.75f, contrast = 1.12f, saturation = 1.10f;

    private FloatBuffer quadCoords;
    private FloatBuffer quadTexCoords;
    private int program;
    private int positionAttrib;
    private int texCoordAttrib;
    private int texelUniform, sharpenUniform, contrastUniform, saturationUniform;
    private int surfaceW = 0, surfaceH = 0;
    private int textureId = -1;

    void setViewport(int w, int h) { surfaceW = w; surfaceH = h; }
    void setEnhancement(float sharpen, float contrast, float saturation) { this.sharpen = sharpen; this.contrast = contrast; this.saturation = saturation; }

    int getTextureId() { return textureId; }

    /** Must be called on the GL thread (onSurfaceCreated). */
    void createOnGlThread() {
        int[] textures = new int[1];
        GLES20.glGenTextures(1, textures, 0);
        textureId = textures[0];
        int target = GLES11Ext.GL_TEXTURE_EXTERNAL_OES;
        GLES20.glBindTexture(target, textureId);
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);

        int numVertices = 4;
        ByteBuffer bbCoords = ByteBuffer.allocateDirect(QUAD_COORDS.length * FLOAT_SIZE);
        bbCoords.order(ByteOrder.nativeOrder());
        quadCoords = bbCoords.asFloatBuffer();
        quadCoords.put(QUAD_COORDS);
        quadCoords.position(0);

        ByteBuffer bbTexCoords = ByteBuffer.allocateDirect(numVertices * TEXCOORDS_PER_VERTEX * FLOAT_SIZE);
        bbTexCoords.order(ByteOrder.nativeOrder());
        quadTexCoords = bbTexCoords.asFloatBuffer();

        int vertexShader = compileShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER);
        int fragmentShader = compileShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER);
        program = GLES20.glCreateProgram();
        GLES20.glAttachShader(program, vertexShader);
        GLES20.glAttachShader(program, fragmentShader);
        GLES20.glLinkProgram(program);
        GLES20.glUseProgram(program);
        positionAttrib = GLES20.glGetAttribLocation(program, "a_Position");
        texCoordAttrib = GLES20.glGetAttribLocation(program, "a_TexCoord");
        texelUniform = GLES20.glGetUniformLocation(program, "u_texel");
        sharpenUniform = GLES20.glGetUniformLocation(program, "u_sharpen");
        contrastUniform = GLES20.glGetUniformLocation(program, "u_contrast");
        saturationUniform = GLES20.glGetUniformLocation(program, "u_saturation");
    }

    private int compileShader(int type, String source) {
        int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, source);
        GLES20.glCompileShader(shader);
        int[] compiled = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0);
        if (compiled[0] == 0) {
            android.util.Log.e("fundx-gl", "shader compile failed: " + GLES20.glGetShaderInfoLog(shader));
            GLES20.glDeleteShader(shader);
            return 0;
        }
        return shader;
    }

    /** Draw the camera texture full-screen. Call on the GL thread (onDrawFrame), after session.update(). */
    void draw(Frame frame) {
        if (textureId == -1 || quadTexCoords == null) return;
        // Recompute the texture coordinates whenever the display geometry changes so the camera image
        // fills the surface with the correct aspect/orientation.
        if (frame.hasDisplayGeometryChanged()) {
            frame.transformCoordinates2d(
                Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, quadCoords,
                Coordinates2d.TEXTURE_NORMALIZED, quadTexCoords);
        }
        if (frame.getTimestamp() == 0) return;   // no frame yet

        quadCoords.position(0);
        quadTexCoords.position(0);

        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);

        GLES20.glUseProgram(program);
        float tx = surfaceW > 0 ? 1.0f / surfaceW : 0.0009f;
        float ty = surfaceH > 0 ? 1.0f / surfaceH : 0.0009f;
        GLES20.glUniform2f(texelUniform, tx, ty);
        GLES20.glUniform1f(sharpenUniform, sharpen);
        GLES20.glUniform1f(contrastUniform, contrast);
        GLES20.glUniform1f(saturationUniform, saturation);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId);
        GLES20.glVertexAttribPointer(positionAttrib, COORDS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, quadCoords);
        GLES20.glVertexAttribPointer(texCoordAttrib, TEXCOORDS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, quadTexCoords);
        GLES20.glEnableVertexAttribArray(positionAttrib);
        GLES20.glEnableVertexAttribArray(texCoordAttrib);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
        GLES20.glDisableVertexAttribArray(positionAttrib);
        GLES20.glDisableVertexAttribArray(texCoordAttrib);

        GLES20.glDepthMask(true);
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
    }
}
