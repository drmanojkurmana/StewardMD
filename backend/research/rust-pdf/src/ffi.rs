//! Plain C / WebAssembly exports (no wasm-bindgen), so the same functions
//! load in the app's WebView, in a Cloudflare Worker (as .wasm) and in the
//! Python worker (as a .so through ctypes):
//!
//!   ptr = rs_alloc(len); copy the PDF bytes to ptr;
//!   out = rs_run(ptr, len);            // or rs_run_limits(ptr, len, pages, bytes)
//!   outLen = rs_result_len();          // response length in bytes (UTF-8 JSON)
//!   read the response; rs_free(out, outLen);
//!
//! The request buffer is freed by rs_run.

#![allow(clippy::missing_safety_doc)]

use std::cell::Cell;

use crate::{extract, extract_lines, Error, Limits};

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

fn respond(json: String) -> *mut u8 {
    let out = json.into_bytes().into_boxed_slice();
    LAST_LEN.with(|c| c.set(out.len()));
    Box::into_raw(out) as *mut u8
}

#[no_mangle]
pub unsafe extern "C" fn rs_run_limits(ptr: *mut u8, len: usize, max_pages: usize, max_bytes: usize) -> *mut u8 {
    // SAFETY: the caller wrote `len` bytes at `ptr`, allocated by rs_alloc(len).
    let input = Vec::from_raw_parts(ptr, len, len.max(1));
    let v = match extract(&input, &Limits { max_pages, max_bytes }) {
        Ok(v) => v,
        Err(Error::Code(c)) => serde_json::json!({ "error": c }),
        Err(Error::Unsupported(r)) => serde_json::json!({ "unsupported": r }),
    };
    drop(input);
    respond(serde_json::to_string(&v).unwrap_or_else(|_| "{\"error\":\"internal\"}".into()))
}

#[no_mangle]
pub unsafe extern "C" fn rs_run(ptr: *mut u8, len: usize) -> *mut u8 {
    let d = Limits::default();
    rs_run_limits(ptr, len, d.max_pages, d.max_bytes)
}

/// PrepNucleus: stream-order lines for the chosen pages. `pages` points to
/// `npages` u32 page numbers (1-based), allocated with rs_alloc(npages * 4);
/// both buffers are freed here.
#[no_mangle]
pub unsafe extern "C" fn rs_lines(ptr: *mut u8, len: usize, pages: *mut u8, npages: usize, max_bytes: usize) -> *mut u8 {
    // SAFETY: as rs_run_limits; `pages` holds npages little-endian u32s.
    let input = Vec::from_raw_parts(ptr, len, len.max(1));
    let pbuf = Vec::from_raw_parts(pages, npages * 4, (npages * 4).max(1));
    let wanted: Vec<usize> = pbuf.chunks_exact(4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize).collect();
    let v = match extract_lines(&input, &wanted, max_bytes) {
        Ok(v) => v,
        Err(Error::Code(c)) => serde_json::json!({ "error": c }),
        Err(Error::Unsupported(r)) => serde_json::json!({ "unsupported": r }),
    };
    drop(input);
    drop(pbuf);
    respond(serde_json::to_string(&v).unwrap_or_else(|_| "{\"error\":\"internal\"}".into()))
}

#[no_mangle]
pub extern "C" fn rs_result_len() -> usize {
    LAST_LEN.with(|c| c.get())
}

/// getrandom's custom backend for plain wasm32. Reading PDFs never needs
/// random numbers, so this always reports "unsupported".
#[cfg(target_arch = "wasm32")]
#[no_mangle]
unsafe extern "Rust" fn __getrandom_v03_custom(_dest: *mut u8, _len: usize) -> Result<(), getrandom::Error> {
    Err(getrandom::Error::UNSUPPORTED)
}
