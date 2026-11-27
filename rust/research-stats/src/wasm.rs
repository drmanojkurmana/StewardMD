//! Plain WebAssembly exports (no wasm-bindgen), so the same .wasm file loads
//! in the app's WebView and in a Cloudflare Worker with a few lines of JS:
//!
//!   ptr = rs_alloc(len); write UTF-8 request bytes at ptr;
//!   out = rs_run(ptr, len);            // pointer to the response
//!   outLen = rs_result_len();          // its length in bytes
//!   read the response; rs_free(out, outLen);
//!
//! The request buffer is freed by rs_run.

#![allow(clippy::missing_safety_doc)]

use std::cell::Cell;

thread_local! {
    static LAST_LEN: Cell<usize> = const { Cell::new(0) };
}

#[no_mangle]
pub extern "C" fn rs_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn rs_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        // SAFETY: ptr came from rs_alloc / rs_run with this capacity.
        drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
    }
}

#[no_mangle]
pub unsafe extern "C" fn rs_run(ptr: *mut u8, len: usize) -> *mut u8 {
    // SAFETY: the caller wrote `len` bytes at `ptr`, allocated by rs_alloc(len).
    let input = Vec::from_raw_parts(ptr, len, len.max(1));
    let text = String::from_utf8_lossy(&input).into_owned();
    drop(input);
    let out = crate::run_json(&text).into_bytes().into_boxed_slice();
    LAST_LEN.with(|c| c.set(out.len()));
    Box::into_raw(out) as *mut u8
}

#[no_mangle]
pub extern "C" fn rs_result_len() -> usize {
    LAST_LEN.with(|c| c.get())
}
