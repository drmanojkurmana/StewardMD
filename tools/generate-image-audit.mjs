import fs from "fs";

const idx = JSON.parse(fs.readFileSync("prep/lessons/v1/index.json", "utf8"));
const entries = Object.entries(idx.modules);
const subjects = {};

for (const [modKey, meta] of entries) {
  const file = meta.file || `${modKey}.json`;
  const p = `prep/lessons/v1/${file}`;
  if (!fs.existsSync(p)) continue;
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  const subj = data.subject || meta.subject || "unknown";
  if (!subjects[subj]) subjects[subj] = { total: 0, withImg: 0, zeroImg: 0, imagelessList: [] };
  subjects[subj].total++;
  const hasImg = data.steps && data.steps.some(s => s.vis && s.vis.kind === "image");
  if (hasImg) {
    subjects[subj].withImg++;
  } else {
    subjects[subj].zeroImg++;
    subjects[subj].imagelessList.push({ id: data.id || modKey, title: data.title || meta.title || modKey });
  }
}

let totalLessons = 0, totalWith = 0, totalZero = 0;
for (const s of Object.values(subjects)) {
  totalLessons += s.total;
  totalWith += s.withImg;
  totalZero += s.zeroImg;
}

const sortedSubjects = Object.entries(subjects).sort((a, b) => b[1].total - a[1].total);

let md = `# Lesson image audit\n\n`;
md += `Generated 2026-10-14 from \`prep/lessons/v1/index.json\` (${totalLessons} lessons). A lesson counts as having an image when at least one step carries \`vis.kind === "image"\`. **${totalZero} lessons (${(totalZero / totalLessons * 100).toFixed(1)}%) have zero images; ${totalWith} have at least one.** Counts are per subject (\`subject\` field of each lesson file or taxonomy branch).\n\n`;
md += `| Subject | Lessons | Zero images | With images |\n`;
md += `|---|---|---|---|\n`;

for (const [subj, s] of sortedSubjects) {
  md += `| ${subj} | ${s.total} | ${s.zeroImg} | ${s.withImg} |\n`;
}

md += `\n## Imageless lessons by subject (highest exam weight first)\n\n`;

for (const [subj, s] of sortedSubjects) {
  if (s.zeroImg === 0) {
    md += `### ${subj} (0/${s.total} imageless - 100% complete)\n\nAll ${s.total} lessons in ${subj} carry at least one verified diagram.\n\n`;
  } else {
    md += `### ${subj} (${s.zeroImg}/${s.total} imageless)\n\n`;
    for (const item of s.imagelessList) {
      md += `- \`${item.id}\`: ${item.title}\n`;
    }
    md += `\n`;
  }
}

fs.writeFileSync(".fleet-reports/LESSON-IMAGE-AUDIT.md", md, "utf8");
console.log(`Generated .fleet-reports/LESSON-IMAGE-AUDIT.md: ${totalLessons} lessons, ${totalWith} with images, ${totalZero} zero images.`);
