// ponytail: one generator file for all 6 manufacturer layouts instead of 6 template files +
// a stamping script. Cases are data; render is a small function per manufacturer. Upgrade to
// separate .html template files only if a human needs to hand-edit a single brand's markup.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'cases');
mkdirSync(OUT, { recursive: true });

// ---------- shared building blocks ----------

const W = 1800, H = 1200;

function wavePath(kind, w, h) {
  // deterministic squiggle, no RNG -> reproducible pixels across runs
  const pts = [];
  const n = 220;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = t * w;
    let y;
    if (kind === 'ecg') {
      const beat = (t * 8) % 1;
      const spike = beat > 0.46 && beat < 0.54 ? (0.5 - Math.abs(beat - 0.5)) * 16 : 0;
      y = h / 2 - spike * 20 + Math.sin(t * 60) * 2;
    } else if (kind === 'pleth') {
      y = h / 2 - Math.abs(Math.sin(t * 26)) * (h * 0.32) + Math.sin(t * 100) * 1.5;
    } else { // resp
      y = h / 2 - Math.sin(t * 10) * (h * 0.28);
    }
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

function waveformsSvg(color1, color2, color3, h) {
  const rowH = h / 3;
  return `<svg width="100%" height="${h}" viewBox="0 0 1080 ${h}" preserveAspectRatio="none" style="position:absolute;left:0;top:0">
    <polyline points="${wavePath('ecg', 1080, rowH)}" fill="none" stroke="${color1}" stroke-width="3"/>
    <g transform="translate(0,${rowH})"><polyline points="${wavePath('pleth', 1080, rowH)}" fill="none" stroke="${color2}" stroke-width="3"/></g>
    <g transform="translate(0,${rowH * 2})"><polyline points="${wavePath('resp', 1080, rowH)}" fill="none" stroke="${color3}" stroke-width="3"/></g>
  </svg>`;
}

function softkeys(labels) {
  return `<div class="softkeys">${labels.map(l => `<div class="key">${l}</div>`).join('')}</div>`;
}

function topBar({ bed, patient, clock, extra }) {
  return `<div class="topbar"><span class="bed">${bed}</span><span class="patient">${patient}</span><span class="extra">${extra || ''}</span><span class="clock">${clock}</span></div>`;
}

function banner(text) {
  return text ? `<div class="banner">${text}</div>` : '';
}

// difficulty -> {stageStyle, monitorStyle, overlays[]}
function applyDifficulty(tags, glareTargetRect, partialOffset) {
  let monitorStyle = '';
  let stageStyle = '';
  const overlays = [];
  if (tags.includes('tilt')) {
    monitorStyle += 'transform:perspective(1400px) rotateY(18deg) rotateX(6deg);transform-origin:center center;';
  }
  if (tags.includes('glare')) {
    const r = glareTargetRect || { x: 1150, y: 100, w: 500, h: 900 };
    overlays.push(`<div style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:radial-gradient(circle,rgba(255,255,255,.55),rgba(255,255,255,0) 70%);opacity:.35;pointer-events:none"></div>`);
  }
  if (tags.includes('low-light')) {
    monitorStyle += 'filter:brightness(.45) contrast(.9) blur(1.2px);';
  }
  if (tags.includes('partial') && partialOffset) {
    // shift the whole monitor down by exactly (100 + tileHeight) so the stage's
    // overflow:hidden crops the ENTIRE last numcol tile (always RESP/RR, see TILE_ORDER)
    // below the fold, while every earlier tile stays fully visible.
    monitorStyle += `top:${partialOffset}px;`;
  }
  if (tags.includes('label-obscured')) {
    // OCR must genuinely fail to read the label here: a translucent gradient still lets
    // Vision read text through it, so this is a fully OPAQUE white patch (opacity 1, no
    // gradient fade over the text itself) sized to the label's exact box, with a soft glow
    // bleeding outward for a "glare" look that never dips the core below opaque.
    const r = glareTargetRect || { x: 1160, y: 330, w: 260, h: 90 };
    overlays.push(`<div style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:#ffffff;border-radius:10px;box-shadow:0 0 40px 20px rgba(255,255,255,.6);pointer-events:none"></div>`);
  }
  return { monitorStyle, stageStyle, overlays };
}

function shell({ id, monitorInner, tags, glareRect, partialOffset }) {
  const { monitorStyle, stageStyle, overlays } = applyDifficulty(tags, glareRect, partialOffset);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${id}</title>
  <style>
    html,body{margin:0;padding:0;background:#000;}
    .stage{width:${W}px;height:${H}px;overflow:hidden;position:relative;${stageStyle}}
    .monitor{width:${W}px;height:${H}px;position:relative;background:#03141f;font-family:Arial,Helvetica,sans-serif;color:#fff;box-sizing:border-box;${monitorStyle}}
    .topbar{position:absolute;top:0;left:0;right:0;height:56px;background:#0a2233;display:flex;align-items:center;padding:0 24px;gap:32px;font-size:26px;border-bottom:2px solid #14344a}
    .topbar .clock{margin-left:auto}
    .banner{position:absolute;top:56px;left:0;right:0;height:44px;background:#e8c400;color:#1a1a00;font-weight:bold;font-size:26px;display:flex;align-items:center;padding-left:24px;letter-spacing:1px}
    .softkeys{position:absolute;bottom:0;left:0;right:0;height:64px;background:#0a2233;display:flex;border-top:2px solid #14344a}
    .softkeys .key{flex:1;display:flex;align-items:center;justify-content:center;font-size:17px;border-right:1px solid #14344a;text-align:center;padding:0 4px}
    .waves{position:absolute;left:0;top:100px;width:60%;height:1000px}
    .numcol{position:absolute;top:100px;right:0;width:40%;height:1000px;display:flex;flex-direction:column}
    .tile{flex:1;position:relative;border-bottom:1px solid #14344a;padding:8px 20px;box-sizing:border-box;overflow:hidden}
  </style></head><body><div class="stage"><div class="monitor">${monitorInner}</div>${overlays.join('')}</div></body></html>`;
}

// ---------- per-manufacturer tile styles ----------

function tilePhilips({ label, unit, value, limits, color, small }) {
  const lim = limits ? `<div style="position:absolute;left:20px;top:44px;font-size:20px;color:#ccc;line-height:1.3">${limits[0]}<br>${limits[1]}</div>` : '';
  return `<div class="tile">
    <div style="position:absolute;left:20px;top:8px;font-size:30px;color:${color};font-weight:bold">${label}</div>
    ${lim}
    <div style="position:absolute;right:24px;top:2px;font-size:${small ? 90 : 130}px;font-weight:bold;color:${color};line-height:1">${value}</div>
    ${unit ? `<div style="position:absolute;right:26px;bottom:6px;font-size:18px;color:${color}">${unit}</div>` : ''}
  </div>`;
}

function tileGE({ label, unit, value, limitsText, color, sub, note }) {
  return `<div class="tile">
    <div style="font-size:34px;color:${color};font-weight:bold">${label} <span style="font-size:18px;color:#9ab">${unit || ''}</span></div>
    <div style="font-size:18px;color:#9ab">${limitsText || ''}</div>
    ${note ? `<div style="font-size:16px;color:#9ab">${note}</div>` : ''}
    <div style="position:absolute;right:24px;top:14px;font-size:120px;font-weight:bold;color:${color};line-height:1">${value}</div>
    ${sub ? `<div style="position:absolute;right:26px;bottom:8px;font-size:20px;color:#9ab">${sub}</div>` : ''}
  </div>`;
}

function tileDraeger({ label, unit, value, hi, lo, color }) {
  return `<div class="tile">
    <div style="background:#14344a;color:#fff;font-size:24px;padding:2px 8px;display:inline-block">${label} ${unit ? `<span style="font-size:16px;color:#aac">${unit}</span>` : ''}</div>
    <div style="position:absolute;right:24px;top:10px;font-size:120px;font-weight:bold;color:${color};line-height:1">${value}</div>
    <div style="position:absolute;left:20px;bottom:6px;font-size:18px;color:#ccc">${hi != null ? `&#9650;${hi} &#9660;${lo}` : ''}</div>
  </div>`;
}

function tileMindray({ label, unit, value, limits, color, sub, note }) {
  return `<div class="tile">
    <div style="font-size:28px;font-weight:bold;color:${color}">${label} <span style="font-size:16px;color:#9ab">${unit || ''}</span></div>
    ${limits ? `<div style="position:absolute;right:24px;top:12px;font-size:18px;color:#9ab;text-align:right">${limits[0]}<br>${limits[1]}</div>` : ''}
    ${note ? `<div style="font-size:16px;color:#9ab">${note}</div>` : ''}
    <div style="position:absolute;right:24px;top:44px;font-size:110px;font-weight:bold;color:${color};line-height:1">${value}</div>
    ${sub ? `<div style="position:absolute;left:20px;bottom:6px;font-size:18px;color:#9ab">${sub}</div>` : ''}
  </div>`;
}

function tileNihon({ label, unit, value, limits, color, sub }) {
  return `<div class="tile" style="display:flex;align-items:center">
    <div style="font-size:28px;color:${color};font-weight:bold;width:150px">${label}<br><span style="font-size:15px;color:#9ab">${unit || ''}</span>${sub ? `<br><span style="font-size:14px;color:#9ab">${sub}</span>` : ''}</div>
    <div style="font-size:110px;font-weight:bold;color:${color};line-height:1;flex:1;text-align:center">${value}</div>
    ${limits ? `<div style="font-size:18px;color:#9ab;text-align:right;line-height:1.3">${limits[0]}<br>${limits[1]}</div>` : ''}
  </div>`;
}

function tileGeneric({ label, unit, value, color }) {
  return `<div class="tile">
    <div style="font-size:30px;color:${color};font-weight:bold">${label} <span style="font-size:16px;color:#9ab">${unit || ''}</span></div>
    <div style="position:absolute;right:24px;top:10px;font-size:110px;font-weight:bold;color:${color};line-height:1">${value}</div>
  </div>`;
}

// ---------- manufacturer renderers ----------
// each takes (c) = one case object (see CASES below) and returns full HTML string

function renderPhilips(c) {
  const f = c.fields, col = { ecg: '#33ff33', spo2: '#00e5ff', art: '#ff3b30', resp: '#ffe600', nibp: '#ff5fd6' };
  const tiles = [
    tilePhilips({ label: 'HR', unit: 'bpm', value: f.hr.v, limits: c.limits.hr, color: col.ecg }) ,
    tilePhilips({ label: 'SpO2', unit: '%', value: f.spo2.v, limits: c.limits.spo2, color: col.spo2, small: true }),
    tilePhilips({ label: 'ART', unit: 'mmHg', value: `${f.artSbp}/${f.artDbp} (${f.artMap})`, limits: c.limits.art, color: col.art, small: true }),
    tilePhilips({ label: 'RESP', unit: 'rpm', value: f.rr.v, limits: c.limits.rr, color: col.resp, small: true }),
  ].join('');
  const inner = `
    ${topBar({ bed: c.bed, patient: c.patient, clock: c.clock, extra: 'Adult &middot; Screen D' })}
    ${banner(c.banner)}
    <div class="waves">${waveformsSvg(col.ecg, col.spo2, col.art, 1000)}
      <div style="position:absolute;left:16px;top:8px;color:${col.ecg};font-size:20px">Sinus Tach&nbsp;&nbsp;ST-I ${f.st.I} &nbsp;ST-II ${f.st.II} &nbsp;ST-III ${f.st.III} &nbsp;PVC ${f.pvc}</div>
      <div style="position:absolute;left:16px;top:${1000 / 3 + 6}px;color:${col.spo2};font-size:20px">Pulse ${f.pulse}</div>
    </div>
    <div class="numcol">${tiles}</div>
    ${softkeys(['Silence', 'Pause Alarms', 'Start/Stop', 'Zero', 'Recordings', 'Monitor Standby', 'Main Setup', 'Main Screen'])}
  `;
  return shell({ id: c.id, monitorInner: inner, tags: c.difficulty, glareRect: c.glareRect, partialOffset: c.partialOffset });
}

function renderGE(c) {
  const f = c.fields, col = { ecg: '#33ff33', spo2: '#3fd0ff', nibp: '#e8e8e8', art: '#ff3b30', resp: '#ffe600' };
  const tiles = [
    tileGE({ label: 'HR', unit: 'bpm', value: f.hr.v, limitsText: `${c.limits.hr[1]} - ${c.limits.hr[0]}`, color: col.ecg, note: `PVC ${f.pvc}` }),
    tileGE({ label: 'SpO2', unit: '%', value: f.spo2.v, limitsText: `${c.limits.spo2[1]} - ${c.limits.spo2[0]}`, color: col.spo2, sub: `PR ${f.pulse}` }),
    tileGE({ label: 'NBP', unit: 'mmHg', value: `${f.nibpSbp}/${f.nibpDbp} (${f.nibpMap})`, sub: f.nibpTime, color: col.nibp }),
    f.artSbp != null ? tileGE({ label: 'ART', unit: 'mmHg', value: `${f.artSbp}/${f.artDbp} (${f.artMap})`, color: col.art }) : '',
    tileGE({ label: 'RESP', unit: 'rpm', value: f.rr.v, limitsText: `${c.limits.rr[1]} - ${c.limits.rr[0]}`, color: col.resp }),
  ].join('');
  const inner = `
    ${topBar({ bed: c.bed, patient: c.patient, clock: c.clock, extra: 'Trend' })}
    ${banner(c.banner)}
    <div class="waves">${waveformsSvg(col.ecg, col.spo2, col.resp, 1000)}</div>
    <div class="numcol">${tiles}</div>
    ${softkeys(['Silence Alarms', 'NBP Go/Stop', 'Admit/Discharge', 'Trends', 'Monitor Setup'])}
  `;
  return shell({ id: c.id, monitorInner: inner, tags: c.difficulty, glareRect: c.glareRect, partialOffset: c.partialOffset });
}

function renderDraeger(c) {
  const f = c.fields, col = { ecg: '#33ff33', spo2: '#00e5ff', art: '#ff3b30', resp: '#ffe600', temp: '#e8e8e8' };
  const tiles = [
    tileDraeger({ label: 'HR', unit: 'bpm', value: f.hr.v, hi: c.limits.hr[0], lo: c.limits.hr[1], color: col.ecg }),
    tileDraeger({ label: 'SpO2', unit: '%', value: f.spo2.v, hi: c.limits.spo2[0], lo: c.limits.spo2[1], color: col.spo2 }),
    tileDraeger({ label: 'ART', unit: 'mmHg', value: `${f.artSbp}/${f.artDbp} (${f.artMap})`, hi: c.limits.art ? c.limits.art[0] : null, lo: c.limits.art ? c.limits.art[1] : null, color: col.art }),
    tileDraeger({ label: 'TEMP', unit: '&deg;C', value: f.temp, hi: null, lo: null, color: col.temp }),
    tileDraeger({ label: 'RESP', unit: 'rpm', value: f.rr.v, hi: c.limits.rr[0], lo: c.limits.rr[1], color: col.resp }),
  ].join('');
  const inner = `
    ${topBar({ bed: c.bed, patient: c.patient, clock: c.clock, extra: 'Adult' })}
    ${banner(c.banner)}
    <div class="waves">${waveformsSvg(col.ecg, col.spo2, col.art, 1000)}</div>
    <div class="numcol">${tiles}</div>
    ${softkeys(['Alarm Pause', 'NIBP Start', 'Freeze', 'Layout', 'Patient Data', 'Standby'])}
  `;
  return shell({ id: c.id, monitorInner: inner, tags: c.difficulty, glareRect: c.glareRect, partialOffset: c.partialOffset });
}

function renderMindray(c) {
  const f = c.fields, col = { ecg: '#33ff33', spo2: '#00e5ff', nibp: '#e8e8e8', art: '#ff3b30', resp: '#ffe600', temp: '#e8e8e8' };
  const tiles = [
    tileMindray({ label: 'HR', unit: 'bpm', value: f.hr.v, limits: c.limits.hr, color: col.ecg, note: `PVC ${f.pvc}` }),
    tileMindray({ label: 'SpO2', unit: '%', value: f.spo2.v, limits: c.limits.spo2, color: col.spo2, sub: `PI ${f.pi}  PR ${f.pulse}` }),
    tileMindray({ label: 'NIBP', unit: 'mmHg', value: `${f.nibpSbp}/${f.nibpDbp} (${f.nibpMap})`, color: col.nibp, sub: f.nibpTime }),
    f.artSbp != null ? tileMindray({ label: 'ART', unit: 'mmHg', value: `${f.artSbp}/${f.artDbp} (${f.artMap})`, limits: c.limits.art, color: col.art }) : '',
    tileMindray({ label: 'RESP', unit: 'rpm', value: f.rr.v, limits: c.limits.rr, color: col.resp }),
  ].join('');
  const inner = `
    ${topBar({ bed: c.bed, patient: c.patient, clock: c.clock, extra: 'Bed 4' })}
    ${banner(c.banner)}
    <div class="waves">${waveformsSvg(col.ecg, col.spo2, col.resp, 1000)}</div>
    <div class="numcol">${tiles}</div>
    ${softkeys(['Alarm', 'NIBP', 'Freeze', 'Record', 'Setup', 'Standby'])}
  `;
  return shell({ id: c.id, monitorInner: inner, tags: c.difficulty, glareRect: c.glareRect, partialOffset: c.partialOffset });
}

function renderNihon(c) {
  const f = c.fields, col = { ecg: '#c8e600', spo2: '#00e5ff', nibp: '#e666ff', resp: '#e8e8e8', temp: '#e8e8e8' };
  const tiles = [
    tileNihon({ label: 'HR', unit: 'bpm', value: f.hr.v, limits: c.limits.hr, color: col.ecg, sub: `PR ${f.pulse}` }),
    tileNihon({ label: 'SpO2', unit: '%', value: f.spo2.v, limits: c.limits.spo2, color: col.spo2 }),
    tileNihon({ label: 'NIBP', unit: 'mmHg', value: `${f.nibpSbp}/${f.nibpDbp} (${f.nibpMap})`, color: col.nibp }),
    tileNihon({ label: 'TEMP', unit: '&deg;C', value: f.temp, color: col.temp }),
    tileNihon({ label: 'RESP', unit: 'rpm', value: f.rr.v, limits: c.limits.rr, color: col.resp }),
  ].join('');
  const inner = `
    ${topBar({ bed: c.bed, patient: c.patient, clock: c.clock, extra: c.date })}
    ${banner(c.banner)}
    <div class="waves">${waveformsSvg(col.ecg, col.spo2, col.resp, 1000)}</div>
    <div class="numcol">${tiles}</div>
    ${softkeys(['Alarm Silence', 'NIBP', 'Print', 'Trend', 'Menu', 'Review', 'Setup', 'Home'])}
  `;
  return shell({ id: c.id, monitorInner: inner, tags: c.difficulty, glareRect: c.glareRect, partialOffset: c.partialOffset });
}

function renderGeneric(c) {
  const f = c.fields, col = { ecg: '#33ff33', spo2: '#00e5ff', nibp: '#e8e8e8' };
  const tiles = [
    tileGeneric({ label: 'HR', unit: 'bpm', value: f.hr.v, color: col.ecg }),
    tileGeneric({ label: 'SpO2', unit: '%', value: f.spo2.v, color: col.spo2 }),
    tileGeneric({ label: 'NIBP', unit: 'mmHg', value: `${f.nibpSbp}/${f.nibpDbp} (${f.nibpMap})`, color: col.nibp }),
  ].join('');
  const inner = `
    ${topBar({ bed: c.bed, patient: c.patient, clock: c.clock, extra: 'Transport' })}
    ${banner(c.banner)}
    <div class="waves" style="top:100px;height:1000px">${waveformsSvg(col.ecg, col.spo2, col.nibp, 1000)}</div>
    <div class="numcol" style="top:100px;height:1000px">${tiles}</div>
    ${softkeys(['Alarm', 'NIBP', 'Power'])}
  `;
  return shell({ id: c.id, monitorInner: inner, tags: c.difficulty, glareRect: c.glareRect, partialOffset: c.partialOffset });
}

const RENDERERS = {
  'philips-intellivue': renderPhilips,
  'ge-carescape': renderGE,
  'draeger-infinity': renderDraeger,
  'mindray-beneview': renderMindray,
  'nihon-kohden': renderNihon,
  'generic-transport': renderGeneric,
};

const LAYOUT_TAG = {
  'philips-intellivue': 'right-column-limits-left',
  'ge-carescape': 'right-column-label-above',
  'draeger-infinity': 'right-column-triangle-limits',
  'mindray-beneview': 'right-column-limits-right',
  'nihon-kohden': 'right-column-label-left-limits-right',
  'generic-transport': 'right-column-minimal',
};

// which pressure channel(s) each manufacturer shows, and whether ART exists (needed for
// the close-candidate ART-vs-NIBP cases)
const HAS_ART = { 'philips-intellivue': true, 'ge-carescape': true, 'draeger-infinity': true, 'mindray-beneview': true, 'nihon-kohden': false, 'generic-transport': false };
const HAS_NIBP = { 'philips-intellivue': false, 'ge-carescape': true, 'draeger-infinity': false, 'mindray-beneview': true, 'nihon-kohden': true, 'generic-transport': true };
// mindray's template does not draw a TEMP tile (only HR/SpO2/NIBP/ART/RESP), even though the
// real device has one — audit fix: don't claim "visible" for a tile that isn't rendered.
const HAS_TEMP = { 'philips-intellivue': false, 'ge-carescape': false, 'draeger-infinity': true, 'mindray-beneview': false, 'nihon-kohden': true, 'generic-transport': false };
const HAS_RR = { 'philips-intellivue': true, 'ge-carescape': true, 'draeger-infinity': true, 'mindray-beneview': true, 'nihon-kohden': true, 'generic-transport': false };
// Pulse and PVC/ST are only "visible" where the template actually draws a labelled element
// for them (see renderX functions) — audit fix for the "Pulse/PVC missed" benchmark defect.
const HAS_PULSE = { 'philips-intellivue': true, 'ge-carescape': true, 'draeger-infinity': false, 'mindray-beneview': true, 'nihon-kohden': true, 'generic-transport': false };
const HAS_PVC = { 'philips-intellivue': true, 'ge-carescape': true, 'draeger-infinity': false, 'mindray-beneview': true, 'nihon-kohden': false, 'generic-transport': false };
const HAS_ST = { 'philips-intellivue': true, 'ge-carescape': false, 'draeger-infinity': false, 'mindray-beneview': false, 'nihon-kohden': false, 'generic-transport': false };

// tile count in each manufacturer's numcol (HR, SpO2, ... in that order — SpO2 is always
// index 1) — used to compute the SpO2 tile's on-screen rect and the crop offset below.
const TILE_COUNT = { 'philips-intellivue': 4, 'ge-carescape': 5, 'draeger-infinity': 5, 'mindray-beneview': 5, 'nihon-kohden': 5, 'generic-transport': 3 };

// How far to shift the whole monitor down (via the "partial" difficulty tag) so the stage's
// overflow:hidden crops the ENTIRE last numcol tile (RESP/RR) off-canvas while every earlier
// tile stays fully visible: last tile's un-shifted top is (1100 - tileHeight); shifting by
// exactly (100 + tileHeight) puts that top exactly at the stage's bottom edge (y=1200).
// Manufacturers with no RR tile at all (generic-transport) need no crop.
function partialOffset(manufacturer) {
  if (!HAS_RR[manufacturer]) return 0;
  return Math.round(100 + 1000 / TILE_COUNT[manufacturer]);
}

// Tight bounding box (relative to the SpO2 tile's own top edge) around just the "SpO2"
// label text for each layout, used by the label-obscured glare so it covers the label without
// touching the value (which sits far to the right in every layout) or bleeding into the
// neighbouring HR tile above.
const LABEL_RECT = {
  'philips-intellivue': { x: 1090, w: 190, h: 56, yOff: 2 },
  'ge-carescape': { x: 1090, w: 260, h: 90, yOff: 2 },
  'draeger-infinity': { x: 1090, w: 210, h: 46, yOff: 0 },
  'mindray-beneview': { x: 1090, w: 250, h: 70, yOff: 2 },
  'nihon-kohden': { x: 1090, w: 190, h: 92, yOff: 'center' },
  'generic-transport': { x: 1090, w: 250, h: 60, yOff: 2 },
};

function spo2LabelRect(manufacturer, offsetPx) {
  const n = TILE_COUNT[manufacturer];
  const tileH = 1000 / n;
  const tileTop = 100 + tileH * 1;
  const spec = LABEL_RECT[manufacturer];
  const y = spec.yOff === 'center' ? tileTop + (tileH - spec.h) / 2 : tileTop + spec.yOff;
  return { x: spec.x, y: Math.round(y + offsetPx), w: spec.w, h: spec.h };
}

// ---------- variant numeric presets (manufacturer-agnostic) ----------

const VARIANTS = {
  clean: { hr: 72, spo2: 98, sbp: 118, dbp: 76, map: 90, rr: 16, temp: '37.0', pulse: 72, pvc: 0, pi: '3.2', st: { I: 0.0, II: 0.1, III: 0.1 }, limits: { hr: [120, 50], spo2: [100, 90], rr: [30, 8] }, banner: null },
  'limit-vs-value': { hr: 90, spo2: 94, sbp: 108, dbp: 64, map: 79, rr: 14, temp: '36.8', pulse: 90, pvc: 0, pi: '2.8', st: { I: 0.0, II: 0.0, III: 0.1 }, limits: { hr: [150, 50], spo2: [100, 90], rr: [30, 8] }, banner: null,
    notes: 'alarm limits 150/50 (HR) and 100 (SpO2) are plausible-looking numbers but are LIMITS, not the current reading.' },
  'high-acuity': { hr: 138, spo2: 88, sbp: 78, dbp: 44, map: 55, rr: 34, temp: '38.9', pulse: 136, pvc: 4, pi: '0.9', st: { I: -1.2, II: -0.8, III: 0.3 }, limits: { hr: [120, 50], spo2: [100, 90], rr: [30, 8] }, banner: '** RR HIGH' },
  'tilt-glare': { hr: 82, spo2: 96, sbp: 130, dbp: 85, map: 100, rr: 18, temp: '37.2', pulse: 82, pvc: 0, pi: '3.0', st: { I: 0.0, II: 0.1, III: 0.0 }, limits: { hr: [120, 50], spo2: [100, 90], rr: [30, 8] }, banner: null },
  'low-light-blur': { hr: 96, spo2: 93, sbp: 122, dbp: 78, map: 93, rr: 20, temp: '37.5', pulse: 96, pvc: 1, pi: '2.1', st: { I: 0.1, II: 0.2, III: 0.0 }, limits: { hr: [120, 50], spo2: [100, 90], rr: [30, 8] }, banner: null },
  'partial-obscured': { hr: 88, spo2: 97, sbp: 126, dbp: 80, map: 95, rr: 22, temp: '37.0', pulse: 88, pvc: 0, pi: '3.4', st: { I: 0.0, II: 0.0, III: 0.0 }, limits: { hr: [120, 50], spo2: [100, 90], rr: [30, 8] }, banner: null },
};

const DIFFICULTY_TAGS = {
  clean: ['clean'],
  'limit-vs-value': ['clean'],
  'high-acuity': ['clean'],
  'tilt-glare': ['tilt', 'glare'],
  'low-light-blur': ['low-light', 'blur'],
  'partial-obscured': ['partial', 'label-obscured'],
};

const CLOCKS = ['20:38', '09:14', '14:02', '23:47', '06:29', '11:55'];
const BEDS = { 'philips-intellivue': 'Bed 12', 'ge-carescape': 'Bed 7', 'draeger-infinity': 'ICU-4', 'mindray-beneview': 'Bed 4', 'nihon-kohden': 'Bed 9', 'generic-transport': 'Bed T1' };
const PATIENTS = ['Not Admitted', 'Bed 4', 'Demo', ''];

function buildFields(manufacturer, v, idx) {
  const artSbp = HAS_ART[manufacturer] ? v.sbp : null;
  const artDbp = HAS_ART[manufacturer] ? v.dbp : null;
  const artMap = HAS_ART[manufacturer] ? v.map : null;
  const nibpSbp = HAS_NIBP[manufacturer] ? v.sbp : null;
  const nibpDbp = HAS_NIBP[manufacturer] ? v.dbp : null;
  const nibpMap = HAS_NIBP[manufacturer] ? v.map : null;
  return {
    hr: { v: v.hr }, spo2: { v: v.spo2 }, rr: { v: v.rr },
    artSbp, artDbp, artMap, nibpSbp, nibpDbp, nibpMap,
    nibpTime: CLOCKS[idx % CLOCKS.length], temp: v.temp, pulse: v.pulse, pvc: v.pvc, pi: v.pi, st: v.st,
  };
}

function fieldStatus(manufacturer, variantKey, fields) {
  const rrStatus = !HAS_RR[manufacturer] ? 'not_applicable' : (variantKey === 'partial-obscured' ? 'not_visible' : 'visible');
  const spo2Status = variantKey === 'partial-obscured' ? 'ambiguous' : 'visible';
  const out = {
    hr: { status: 'visible', value: fields.hr.v },
    spo2: spo2Status === 'ambiguous'
      ? { status: 'ambiguous', value: fields.spo2.v, why: 'label obscured by glare; value legible but parameter identity unconfirmed without the label' }
      : { status: 'visible', value: fields.spo2.v },
    pulse: HAS_PULSE[manufacturer] ? { status: 'visible', value: fields.pulse } : { status: 'not_applicable' },
    pvc: HAS_PVC[manufacturer] ? { status: 'visible', value: fields.pvc } : { status: 'not_applicable' },
    rr: rrStatus === 'not_applicable' ? { status: 'not_applicable' } : rrStatus === 'not_visible' ? { status: 'not_visible' } : { status: 'visible', value: fields.rr.v },
    temp: HAS_TEMP[manufacturer] ? { status: 'visible', value: Number(fields.temp) } : { status: 'not_applicable' },
    nibp: fields.nibpSbp != null ? { status: 'visible', value: { sbp: fields.nibpSbp, dbp: fields.nibpDbp, map: fields.nibpMap } } : { status: 'not_applicable' },
    art: fields.artSbp != null ? { status: 'visible', value: { sbp: fields.artSbp, dbp: fields.artDbp, map: fields.artMap } } : { status: 'not_applicable' },
    st: HAS_ST[manufacturer] ? { status: 'visible', value: fields.st } : { status: 'not_applicable' },
    etco2: { status: 'not_applicable' },
  };
  // primary sbp/dbp/map = ART if present else NIBP
  const primary = fields.artSbp != null ? { sbp: fields.artSbp, dbp: fields.artDbp, map: fields.artMap, source: 'ART' } : fields.nibpSbp != null ? { sbp: fields.nibpSbp, dbp: fields.nibpDbp, map: fields.nibpMap, source: 'NIBP' } : null;
  out.sbp = primary ? { status: 'visible', value: primary.sbp, source: primary.source } : { status: 'not_applicable' };
  out.dbp = primary ? { status: 'visible', value: primary.dbp, source: primary.source } : { status: 'not_applicable' };
  out.map = primary ? { status: 'visible', value: primary.map, source: primary.source } : { status: 'not_applicable' };
  return out;
}

function buildCase(manufacturer, variantKey, n) {
  const v = VARIANTS[variantKey];
  const tags = DIFFICULTY_TAGS[variantKey];
  const id = `${manufacturer}-${variantKey}-${String(n).padStart(2, '0')}`;
  const fields = buildFields(manufacturer, v, n);
  const clock = CLOCKS[(n + Object.keys(RENDERERS).indexOf(manufacturer)) % CLOCKS.length];
  const offset = variantKey === 'partial-obscured' ? partialOffset(manufacturer) : 0;
  const c = {
    id, manufacturer, variantKey, layout: LAYOUT_TAG[manufacturer], difficulty: tags,
    bed: BEDS[manufacturer], patient: PATIENTS[n % PATIENTS.length], clock,
    date: '2026-09-14', banner: v.banner, limits: v.limits, fields,
    partialOffset: offset,
    glareRect: variantKey === 'tilt-glare' ? { x: 1180, y: 300, w: 480, h: 500 } : variantKey === 'partial-obscured' ? spo2LabelRect(manufacturer, offset) : null,
    notes: v.notes || `${manufacturer} ${variantKey} synthetic fixture.`,
  };
  return c;
}

const MANUFACTURERS = Object.keys(RENDERERS);
const VARIANT_KEYS = Object.keys(VARIANTS);

const CASES = [];
MANUFACTURERS.forEach((m, mi) => {
  VARIANT_KEYS.forEach((vk, vi) => CASES.push(buildCase(m, vk, mi * 10 + vi + 1)));
});

// ---------- 3 extra close-candidate cases ----------

function closeCandidateCase(id, manufacturer, opts) {
  const v = VARIANTS.clean;
  const fields = buildFields(manufacturer, v, 1);
  Object.assign(fields, opts.fieldOverrides || {});
  const c = {
    id, manufacturer, variantKey: 'clean', layout: LAYOUT_TAG[manufacturer], difficulty: ['close-candidates'],
    bed: BEDS[manufacturer], patient: 'Not Admitted', clock: opts.clock || '20:38',
    date: '2026-09-14', banner: null, limits: v.limits, fields,
    glareRect: null, notes: opts.notes,
  };
  return c;
}

CASES.push(closeCandidateCase('philips-intellivue-close-01', 'philips-intellivue', {
  fieldOverrides: { hr: { v: 105 }, pulse: 104 },
  notes: 'Pulse (104, SpO2 channel) sits right next to HR (105, ECG channel) — parser must not swap them.',
}));
CASES.push(closeCandidateCase('mindray-beneview-close-02', 'mindray-beneview', {
  fieldOverrides: { nibpSbp: 121, nibpDbp: 79, nibpMap: 93, artSbp: 119, artDbp: 66, artMap: 84 },
  notes: 'NIBP 121/79 (93) and ART 119/66 (84) are close and adjacent — parser must not conflate ART with NIBP.',
}));
CASES.push(closeCandidateCase('ge-carescape-close-03', 'ge-carescape', {
  fieldOverrides: { hr: { v: 106 }, pulse: 105, nibpSbp: 121, nibpDbp: 79, nibpMap: 93, artSbp: 119, artDbp: 66, artMap: 84 },
  notes: 'Combined close-candidate case: HR/Pulse (106/105) and NIBP/ART (121/79(93) vs 119/66(84)) both close.',
}));

// ---------- write everything ----------

for (const c of CASES) {
  const html = RENDERERS[c.manufacturer](c);
  writeFileSync(join(OUT, `${c.id}.html`), html);
  const statusFields = fieldStatus(c.manufacturer, c.variantKey, c.fields);
  const json = {
    id: c.id,
    manufacturer: c.manufacturer,
    layout: c.layout,
    difficulty: c.difficulty,
    image: `${c.id}.png`,
    imageSize: { w: W, h: H },
    synthetic: true,
    fields: statusFields,
    // generic-transport's tiles never draw an alarm-limit number (tileGeneric takes no
    // limits param) — don't claim limit distractors that aren't on screen.
    distractors: { alarmLimits: c.manufacturer === 'generic-transport' ? {} : c.limits, clock: c.clock, banner: c.banner || undefined },
    notes: c.notes,
  };
  writeFileSync(join(OUT, `${c.id}.json`), JSON.stringify(json, null, 2));
}

console.log(`generated ${CASES.length} cases in ${OUT}`);
const perManufacturer = {};
for (const c of CASES) perManufacturer[c.manufacturer] = (perManufacturer[c.manufacturer] || 0) + 1;
console.log(perManufacturer);
