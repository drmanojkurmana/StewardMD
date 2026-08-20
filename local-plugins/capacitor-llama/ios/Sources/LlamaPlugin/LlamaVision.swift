import Foundation
import llama

/**
 * On-device IMAGE understanding for the MaiK offline engine.
 *
 * MedGemma 1.5 and Gemma 4 are multimodal, but a GGUF language model alone cannot see: the vision
 * tower lives in a separate "mmproj" projector file (851 MB for the MedGemma packs, 986 MB for
 * Gemma 4 E2B). llama.cpp exposes it through mtmd, which the pinned b10502 xcframework already ships
 * (mtmd.h + mtmd-helper.h are in llama.framework/Headers), so nothing had to be rebuilt for this.
 *
 * FLOW, and why it is not just "tokenise the prompt":
 *   1. mtmd_init_from_file loads the projector against the ALREADY-LOADED text model.
 *   2. The image becomes an mtmd_bitmap (stb_image decodes jpg/png/heic-as-jpg for us).
 *   3. The templated prompt carries a media marker where the picture belongs; mtmd_tokenize splits
 *      that into interleaved TEXT and IMAGE chunks.
 *   4. mtmd_helper_eval_chunks runs the vision encoder and feeds the resulting embeddings plus the
 *      text tokens into the same llama_context, reporting how far the position counter moved.
 *   5. From there decoding is ordinary token generation, which is why this file only owns the prefill
 *      and hands the loop back to LlamaEngine.
 *
 * MEMORY: the projector is loaded on demand and freed as soon as the answer is done. Holding a
 * 2.5 GB model AND a 851 MB projector for the life of the app is what gets an 8 GB phone killed, and
 * an image question is occasional, not the common path.
 *
 * THE MODEL AND THE PROJECTOR MUST MATCH. A MedGemma projector on a Gemma 4 model produces confident
 * nonsense rather than an error, so the pack registry pairs them and the JS layer passes both paths
 * from the same pack. Nothing here can detect a mismatch.
 */
final class LlamaVision {

    /// mtmd context, alive only for the duration of one image answer.
    private var mctx: OpaquePointer?

    deinit { free() }

    func free() {
        if let m = mctx { mtmd_free(m); mctx = nil }
    }

    /// Load the projector against an already-loaded text model.
    func load(mmprojPath: String, model: OpaquePointer, nThreads: Int32, useGpu: Bool) throws {
        free()
        guard FileManager.default.fileExists(atPath: mmprojPath) else {
            throw LlamaError(.modelMissing, "projector not downloaded")
        }
        var p = mtmd_context_params_default()
        p.use_gpu = useGpu
        p.print_timings = false
        p.n_threads = Int32(nThreads)
        guard let m = mtmd_init_from_file(mmprojPath, model, p) else {
            throw LlamaError(.modelCorrupted, "could not load the projector")
        }
        guard mtmd_support_vision(m) else {
            mtmd_free(m)
            throw LlamaError(.badArguments, "this projector has no vision support")
        }
        mctx = m
    }

    /// The token the model expects where an image belongs, e.g. "<__media__>".
    var marker: String {
        guard let m = mctx, let s = mtmd_get_marker(m) else { return String(cString: mtmd_default_marker()) }
        return String(cString: s)
    }

    /**
     * Encode `prompt` (which must contain `marker` once per image) together with the images, feeding
     * everything into `ctx`. Returns the new position counter, from which normal decoding continues.
     */
    func prefill(prompt: String, imagePaths: [String], ctx: OpaquePointer, nBatch: Int32) throws -> Int32 {
        guard let m = mctx else { throw LlamaError(.modelMissing, "projector not loaded") }

        // Decode each image file into a bitmap. Freed on every exit path, including the throws below.
        var bitmaps: [OpaquePointer] = []
        defer { bitmaps.forEach { mtmd_bitmap_free($0) } }
        for path in imagePaths {
            let w = mtmd_helper_bitmap_init_from_file(m, path, false)
            guard let bmp = w.bitmap else {
                throw LlamaError(.badArguments, "could not read the image")
            }
            bitmaps.append(bmp)
        }

        let chunks = mtmd_input_chunks_init()
        defer { mtmd_input_chunks_free(chunks) }

        var rc: Int32 = -1
        prompt.withCString { cstr in
            var txt = mtmd_input_text(text: cstr, text_len: strlen(cstr), add_special: true, parse_special: true)
            // The C call wants an array of CONST pointers; build it from the owned bitmaps.
            var raw: [OpaquePointer?] = bitmaps.map { Optional($0) }
            raw.withUnsafeMutableBufferPointer { buf in
                rc = mtmd_tokenize(m, chunks, &txt, buf.baseAddress, bitmaps.count)
            }
        }
        // 1 = marker count did not match the image count, which is a prompt-building bug on our side,
        // so say that rather than blaming the picture.
        if rc == 1 { throw LlamaError(.generationFailure, "image placeholder count does not match the images") }
        if rc == 2 { throw LlamaError(.badArguments, "the image could not be processed") }
        guard rc == 0 else { throw LlamaError(.generationFailure, "image tokenize failed (\(rc))") }

        var nPast: llama_pos = 0
        // logits_last: true so the very next sample continues the answer instead of re-reading input.
        let ev = mtmd_helper_eval_chunks(m, ctx, chunks, 0, 0, nBatch, true, &nPast)
        guard ev == 0 else { throw LlamaError(.generationFailure, "image encode failed (\(ev))") }
        return Int32(nPast)
    }
}
