#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const input = process.argv[2] || 'adapter-spec.json';
const out = process.argv[3] || 'adapter-draft.js';
const spec = JSON.parse(await readFile(input, 'utf8'));

if (spec.format !== 'stewardmd-connect-adapter-draft/v1' || spec.consent?.confirmed !== true) {
  throw new Error('invalid_or_unconsented_adapter_spec');
}
if (spec.productionWrites !== false || spec.credentialsStored !== false || spec.rawResponsesStored !== false) {
  throw new Error('unsafe_adapter_spec');
}

const id = `${slug(spec.origin.split('//')[1] || 'hospital')}-web`;
const endpoints = (spec.candidates || []).slice(0, 100).map(x => ({ url: x.url, status: x.status, mimeType: x.mimeType, responseSchema: x.responseSchema }));

const source = `// GENERATED DRAFT — HUMAN REVIEW REQUIRED.
// This file is a connector skeleton, not production code.
// It intentionally has NO credentials, cookies, tokens, or PHI.
import { UpstreamError } from '../functions/_connect/permission.js';

export const connector = {
  meta: {
    id: ${JSON.stringify(id)},
    name: ${JSON.stringify(`Web EMR adapter (${spec.origin})`)},
    version: '0.1.0-draft',
    profile: 'pull',
    kinds: ['web-emr'],
    sccmVersion: '1.0',
    lifecycle: 'experimental',
    capabilities: {
      resources: Object.entries(${JSON.stringify(spec.capabilities || {})}).filter(([,v]) => v).map(([k]) => k),
      operations: ['read', 'search'],
      authKinds: ['doctor-session'],
      emitsBundle: false
    }
  },

  async capabilities(ctx) {
    return { resources: this.meta.capabilities.resources, operations: this.meta.capabilities.operations };
  },

  async authenticate(ctx) {
    if (!ctx?.request) throw new UpstreamError('doctor_session_required');
    return { ok: true, mode: 'doctor-session' };
  },

  async validate(ctx) {
    return { ok: true, draft: true, endpointCount: ${endpoints.length} };
  },

  async fetchPatient(ctx, patientRef) {
    // TODO: map an approved candidate endpoint to the canonical patient lookup.
    // Never replay an observed request until a human reviewer has approved the adapter.
    throw new UpstreamError('adapter_not_approved');
  },

  async normalize(ctx, raw) {
    // TODO: implement deterministic mapping after review.
    throw new UpstreamError('adapter_not_approved');
  },

  discovery: ${JSON.stringify(endpoints, null, 2)}
};

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48); }
`;

await writeFile(out, source, { mode: 0o600 });
console.log(`Wrote ${out}. It is intentionally inert until reviewed and implemented.`);
