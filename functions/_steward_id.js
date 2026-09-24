/* functions/_steward_id.js - the StewardID, the patient's one number across every carrier (card QR,
 * Ni-Key NFC tag, wristband barcode, typed by hand). PURE: no I/O, unit-tested in isolation.
 *
 * WHY IT MOVED TO THE SERVER. It used to be minted in the browser (steward-identity-resolver.js) and
 * checked for uniqueness against an object in that one tab's memory. Two devices could issue the same
 * number to two different people, and the server never stored it at all - registerPatient dropped it
 * - so the number printed on the card resolved nowhere. It is now minted here and RESERVED by the store
 * with a create-only write (_opd_patient_store.js), which makes a duplicate impossible, not unlikely.
 *
 * SMP-, NOT SMD-. A clinic code is SMD- plus six characters and the old StewardID was the same shape
 * from an overlapping alphabet, while resolveOrgId treats anything starting SMD- as a clinic. A
 * patient's card scanned into a clinic-code field, or the reverse, was ambiguous. A patient ID now
 * cannot be mistaken for a clinic.
 *
 * FORMAT: SMP-XXXX-XXXXC. Eight Crockford Base32 characters (no I, L, O or U, so nothing reads as a
 * 1 or a 0) and one Luhn mod-32 check character. Read aloud at a desk or typed from a smudged card, a
 * single wrong character and most swapped neighbours are REFUSED rather than resolved to somebody else.
 * 32^8 is about 1.1 trillion numbers, so the reservation retry is for the theoretical case, not a
 * busy one.
 */
export const STEWARD_PREFIX = "SMP-";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const N = ALPHABET.length;   // 32
const BODY = 8;

function luhnCheck(body) {
  let factor = 2, sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    let addend = factor * ALPHABET.indexOf(body[i]);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / N) + (addend % N);
  }
  return ALPHABET[(N - (sum % N)) % N];
}

function luhnValid(bodyWithCheck) {
  let factor = 1, sum = 0;
  for (let i = bodyWithCheck.length - 1; i >= 0; i--) {
    const cp = ALPHABET.indexOf(bodyWithCheck[i]);
    if (cp < 0) return false;
    let addend = factor * cp;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / N) + (addend % N);
  }
  return sum % N === 0;
}

const format = (b9) => STEWARD_PREFIX + b9.slice(0, 4) + "-" + b9.slice(4);

/** A new StewardID from `randomBytes(n)` (a Uint8Array source; crypto.getRandomValues in production). */
export function mintStewardId(randomBytes) {
  const bytes = randomBytes ? randomBytes(BODY) : crypto.getRandomValues(new Uint8Array(BODY));
  let body = "";
  for (let i = 0; i < BODY; i++) body += ALPHABET[bytes[i] % N];   // 256 % 32 === 0: no modulo bias
  return format(body + luhnCheck(body));
}

/**
 * The canonical StewardID for whatever a person or a scanner produced, or null when it is not one.
 * Crockford's own reading rules apply: lower case, I and L read as 1, O as 0, spaces and hyphens
 * ignored. The check character must match - a mistyped ID is null, never a different patient.
 */
export function normalizeStewardId(input) {
  let s = String(input == null ? "" : input).toUpperCase().replace(/[\s-]/g, "");
  if (!s.startsWith("SMP")) return null;
  s = s.slice(3).replace(/[IL]/g, "1").replace(/O/g, "0");
  if (s.length !== BODY + 1 || !/^[0-9A-HJKMNP-TV-Z]+$/.test(s)) return null;
  return luhnValid(s) ? format(s) : null;
}

export const isStewardId = (input) => normalizeStewardId(input) !== null;
