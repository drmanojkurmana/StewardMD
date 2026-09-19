#!/usr/bin/env node
/* Turn a Claude Code session transcript into something another agent can actually read.
 *
 * A long session's .jsonl is mostly TOOL OUTPUT - file dumps, test logs, crawl results. This session's
 * is 155MB, which no agent can take. What another agent needs is the conversation: what the owner
 * asked for, and what was decided. That is a few hundred KB.
 *
 *   node scripts/session-digest.mjs <transcript.jsonl> [out.md] [--tools] [--max-chars N]
 *
 *   --tools       also include a one-line summary of each tool call (name + first args), no output
 *   --max-chars   truncate any single message to N chars (default 4000)
 *
 * Patient identifiers are masked on the way out: any run of 4+ digits becomes '#'. This file may be
 * handed to a third-party CLI, so that is not optional.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const out = args.filter((a) => !a.startsWith('--'))[1] || null;
const withTools = args.includes('--tools');
const maxChars = Number((args.find((a) => a.startsWith('--max-chars=')) || '').split('=')[1]) || 4000;

if (!src) {
  console.error('usage: node scripts/session-digest.mjs <transcript.jsonl> [out.md] [--tools] [--max-chars=N]');
  process.exit(1);
}

const mask = (s) => String(s == null ? '' : s).replace(/\d{4,}/g, '#');
const clip = (s) => (s.length > maxChars ? s.slice(0, maxChars) + `\n…[${s.length - maxChars} more chars]` : s);

/** Pull readable text out of a message's content, which is either a string or a block array. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && b.text) parts.push(b.text);
    else if (b.type === 'thinking') continue;                    // never echo private reasoning
    else if (b.type === 'tool_use' && withTools) {
      const a = JSON.stringify(b.input || {}).slice(0, 160);
      parts.push(`[tool: ${b.name} ${a}]`);
    }
  }
  return parts.join('\n');
}

const lines = [];
let nUser = 0, nAsst = 0, seen = 0;
const rl = createInterface({ input: createReadStream(src), crlfDelay: Infinity });

for await (const line of rl) {
  if (!line.trim()) continue;
  seen += 1;
  let d;
  try { d = JSON.parse(line); } catch { continue; }
  const m = d.message || d;
  const role = m.role || d.type;
  if (role !== 'user' && role !== 'assistant') continue;
  const txt = textOf(m.content).trim();
  if (!txt) continue;
  // skip the harness's own injected blocks - they are not the conversation
  if (/^<(system-reminder|local-command|command-name|task-notification)/.test(txt)) continue;
  const when = d.timestamp ? String(d.timestamp).slice(5, 16).replace('T', ' ') : '';
  if (role === 'user') { nUser += 1; lines.push(`\n## OWNER ${when}\n\n${clip(mask(txt))}`); }
  else { nAsst += 1; lines.push(`\n### assistant ${when}\n\n${clip(mask(txt))}`); }
}

const header = `# Session digest\n\nSource: \`${src}\`\nLines read: ${seen}\nOwner messages: ${nUser}\nAssistant messages: ${nAsst}\nTool output: excluded${withTools ? ' (tool CALLS summarised)' : ''}\nDigit runs of 4+ masked as '#'.\n`;
const body = header + lines.join('\n');
if (out) { writeFileSync(out, body); console.error(`wrote ${out} (${(body.length / 1024).toFixed(0)} KB, ${nUser} owner / ${nAsst} assistant)`); }
else process.stdout.write(body);
