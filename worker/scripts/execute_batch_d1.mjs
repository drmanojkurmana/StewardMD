import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const SQL_FILE = path.join(ROOT, 'worker', 'data', 'import_gold_68.sql');

const content = fs.readFileSync(SQL_FILE, 'utf8');
const stmts = content.split('\n')
  .map(s => s.trim())
  .filter(s => s.startsWith('INSERT OR REPLACE INTO drug_structured'));

console.log(`Total statements to execute: ${stmts.length}`);

function runStatement(stmt, index) {
  return new Promise((resolve, reject) => {
    execFile('npx', ['wrangler', 'd1', 'execute', 'stewardmd-prod', '--remote', '--command=' + stmt], {
      cwd: path.join(ROOT, 'worker')
    }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[${index + 1}/${stmts.length}] ERROR:`, stderr || err.message);
        reject(err);
      } else {
        const match = stmt.match(/VALUES\s*\('([^']+)'/);
        const drugName = match ? match[1] : `Stmt ${index + 1}`;
        console.log(`[${index + 1}/${stmts.length}] Success: ${drugName}`);
        resolve(stdout);
      }
    });
  });
}

async function runAll() {
  const BATCH_SIZE = 3;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    const chunk = stmts.slice(i, i + BATCH_SIZE);
    const combined = chunk.join(';\n');
    try {
      await runStatement(combined, i);
      ok += chunk.length;
    } catch (e) {
      // If batch fails, try one-by-one
      for (const single of chunk) {
        try {
          await runStatement(single, i);
          ok++;
        } catch (err) {
          fail++;
        }
      }
    }
  }
  console.log(`\nExecution complete: ${ok} succeeded, ${fail} failed.`);
}

runAll();
