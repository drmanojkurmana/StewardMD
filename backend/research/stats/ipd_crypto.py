"""Worker-side decryption of envelope-encrypted IPD snapshots (5C.2).

Byte-compatible mirror of functions/api/research/_ipd.js (deriveKek /
encryptSnapshot / decryptSnapshot):

- KEK: HKDF-SHA256 over env RESEARCH_IPD_KEK (UTF-8 bytes), salt
  "research-ipd-kek-v1", info "ipd-snapshot-wrap", 32-byte output.
  Unset or shorter than 16 characters -> ipd_kek_unconfigured.
- wrappedKey: AES-KW (RFC 3394, no padding) of the 32-byte AES-GCM data
  key -> 40 wrapped bytes.
- ciphertext: AES-256-GCM with a 12-byte IV and the 128-bit tag appended
  to the ciphertext (WebCrypto layout); no AAD.

Plaintext is returned in memory only. This module never writes files and
never logs key material, ciphertext or plaintext; failures raise
IpdCryptoError carrying a stable code and no detail.
"""
from __future__ import annotations

import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.keywrap import InvalidUnwrap, aes_key_unwrap

KEK_ENV = "RESEARCH_IPD_KEK"
KEK_MIN_CHARS = 16
KEK_SALT = b"research-ipd-kek-v1"
KEK_INFO = b"ipd-snapshot-wrap"
ENVELOPE_ALG = "AES-256-GCM"
ENVELOPE_WRAP = "AES-KW"
IV_BYTES = 12
WRAPPED_KEY_BYTES = 40  # AES-KW of a 32-byte key: 32 + 8 integrity bytes


class IpdCryptoError(Exception):
    """Stable-code decryption failure; the message never carries detail."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def derive_kek(secret) -> bytes:
    """HKDF-SHA256 wrapping key, identical to _ipd.js deriveKek."""
    if not isinstance(secret, str) or len(secret) < KEK_MIN_CHARS:
        raise IpdCryptoError("ipd_kek_unconfigured")
    return HKDF(
        algorithm=hashes.SHA256(), length=32, salt=KEK_SALT, info=KEK_INFO
    ).derive(secret.encode("utf-8"))


def _b64_field(envelope: dict, name: str, size: int) -> bytes:
    value = envelope.get(name)
    if not isinstance(value, str) or not value:
        raise ValueError(f"bad envelope.{name}")
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"bad envelope.{name}") from exc
    if len(raw) != size:
        raise ValueError(f"bad envelope.{name}")
    return raw


def validate_envelope(envelope) -> None:
    """Raise ValueError unless the envelope matches the _ipd.js format."""
    if not isinstance(envelope, dict):
        raise ValueError("bad envelope")
    if envelope.get("alg") != ENVELOPE_ALG or envelope.get("wrap") != ENVELOPE_WRAP:
        raise ValueError("bad envelope.alg/wrap")
    _b64_field(envelope, "iv", IV_BYTES)
    _b64_field(envelope, "wrappedKey", WRAPPED_KEY_BYTES)


def decrypt_snapshot(envelope, ciphertext: bytes, *, kek_secret=None) -> bytes:
    """Unwrap the data key and decrypt one snapshot; plaintext bytes in memory.

    kek_secret defaults to env RESEARCH_IPD_KEK. An unset/short KEK fails
    ipd_kek_unconfigured; a wrong KEK, tampered ciphertext or malformed
    envelope fails ipd_decrypt_failed (stable code, no detail, mirroring
    the API's 500 ipd_decrypt_failed).
    """
    if kek_secret is None:
        kek_secret = os.environ.get(KEK_ENV)
    kek = derive_kek(kek_secret)
    try:
        validate_envelope(envelope)
        iv = _b64_field(envelope, "iv", IV_BYTES)
        wrapped = _b64_field(envelope, "wrappedKey", WRAPPED_KEY_BYTES)
        data_key = aes_key_unwrap(kek, wrapped)
        return AESGCM(data_key).decrypt(iv, ciphertext, None)
    except (ValueError, TypeError, InvalidUnwrap, InvalidTag) as exc:
        raise IpdCryptoError("ipd_decrypt_failed") from exc
