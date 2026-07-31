// functions/_connect/canonical/coding.js — SCCM shared value types (spec §4.1)
export const COMPARATORS = ["<", "<=", ">=", ">"];

export function coding({ system = null, code = null, display = null, kind = "standard" } = {}) {
  if (kind !== "standard" && kind !== "local") throw new Error("coding.kind must be standard|local");
  return { system, code, display, kind };
}

export function codeable({ coding: codes = [], text = "" } = {}) {
  if (typeof text !== "string" || !text.trim()) throw new Error("CodeableConcept requires a non-empty text fallback");
  return { coding: codes, text: text.trim() };
}

export function quantity({ value = null, unit = null, system = "http://unitsofmeasure.org", code = null, comparator = null } = {}) {
  if (comparator !== null && !COMPARATORS.includes(comparator)) throw new Error("invalid Quantity comparator");
  return { value, unit, system, code, comparator };
}

export function period(start = null, end = null) { return { start, end }; }
export function identifier({ system = null, value = null, type = null } = {}) { return { system, value, type }; }
export function reference(type, id) { return { type, id }; }
export function provenance({ resource, sourceConnector, sourceId = null } = {}) {
  return { resource, sourceConnector, sourceId };
}
