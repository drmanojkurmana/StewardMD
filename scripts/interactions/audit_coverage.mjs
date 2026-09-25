/** Structural coverage inventory, not a clinical accuracy benchmark.
 * Enumerates every bundled name and rule. Missing edges mean unknown coverage,
 * never a safe combination. No network, patient data, or generated clinical rules.
 * node scripts/interactions/audit_coverage.mjs /absolute/output/directory
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(process.argv[2] || path.join(root, 'scripts/interactions/build/audit'));
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const sandbox = { window: {}, document: {addEventListener(){}} }; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'interaction-rules.js'), 'utf8'), sandbox);
for (const file of ['drugs.js', 'data/clinical-index.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox);
const localNames=[...sandbox.window.MEDDRUGS._list.map(d=>d.generic), ...sandbox.window.SMD_CLINICAL_INDEX.all().map(d=>d.n)].map(x=>x.toLowerCase().trim());
const browser = sandbox.window.INTERACTION_RULES, shared = read('data/interaction-rules.json');
const signed = new Set(read('scripts/interactions/curated/signoff.json').signed.filter(x => x.status === 'signed' && !/^pending/i.test(x.reviewer || '')).map(x => x.id));
const legacy = new Set(read('scripts/interactions/curated/legacy_rules.json').rules.map(x => x.id));
const universe = [...new Set([...localNames, ...(browser.generics || []), ...Object.keys(browser.drugClasses), ...browser.rules.flatMap(r => r.subjects.filter(s => s.kind === 'generic').map(s => s.value))])].sort();
const index = new Map(universe.map((g,i) => [g,i]));
const members = s => s.kind === 'generic' ? (index.has(s.value) ? [s.value] : []) : s.kind === 'class' ? universe.filter(g => (browser.drugClasses[g] || []).includes(s.value) && !s.value.startsWith('epc:')) : [];
const drugs = new Map(universe.map(g => [g,{generic:g,classes:(browser.drugClasses[g] || []).filter(x=>!x.startsWith('epc:')),ruleIds:[],contextRuleIds:[],pairNeighbours:new Set()}]));
const edges = new Set();
const inventory = browser.rules.map(r => {
 const drugSubjects = r.subjects.filter(s=>s.kind!=='context');
 const sets = drugSubjects.map(members);
 let status = sets.some(s=>!s.length) ? 'unreachable_subject' : 'eligible';
 if (drugSubjects.some(s=>s.kind==='class' && s.value.startsWith('epc:'))) status='excluded_epc_taxonomy';
 if (status==='eligible' && r.type==='duplicate_class' && sets[0]?.length<2) status='insufficient_distinct_drugs';
 const contextual=r.type==='context';
 if(status==='eligible') for(const g of new Set(sets.flat())) drugs.get(g)[contextual?'contextRuleIds':'ruleIds'].push(r.id);
 if(status==='eligible' && r.type==='pair' && sets.length===2) for(const a of sets[0]) for(const b of sets[1]) {
  if(a===b)continue;const i=index.get(a),j=index.get(b);edges.add(Math.min(i,j)*universe.length+Math.max(i,j));drugs.get(a).pairNeighbours.add(b);drugs.get(b).pairNeighbours.add(a);
 }
 return {id:r.id,type:r.type,severity:r.severity,status,subjectMembership:r.subjects.map(s=>({...s,members:s.kind==='context'?null:members(s).length})),sourceUrl:r.sourceUrl||null,evidence:r.evidence||null,reviewDate:r.reviewDate||null,signoff:signed.has(r.id)?'recorded':legacy.has(r.id)?'legacy_exemption':'not_recorded'};
});
const rows=[...drugs.values()].map(d=>({...d,pairNeighbours:d.pairNeighbours.size,coverage:d.ruleIds.length?'some_rule_participation':d.contextRuleIds.length?'context_only':'no_active_rule_participation'}));
const classDifferences=[...new Set([...Object.keys(browser.drugClasses),...Object.keys(shared.drugClasses)])].sort().flatMap(g=>{
 const a=browser.drugClasses[g]||[],b=shared.drugClasses[g]||[];const onlyBrowser=a.filter(x=>!b.includes(x)),onlyShared=b.filter(x=>!a.includes(x));return onlyBrowser.length||onlyShared.length?[{generic:g,onlyBrowser,onlyShared}]:[];
});
const sharedById=new Map(shared.rules.map(r=>[r.id,r]));
const ruleDifferences=browser.rules.filter(r=>JSON.stringify(r)!==JSON.stringify(sharedById.get(r.id))).map(r=>r.id);
const summary={datasetVersion:browser.version,drugNames:universe.length,possibleDistinctNamePairs:universe.length*(universe.length-1)/2,pairsReferencedByEligiblePairRules:edges.size,sourceRules:inventory.length,eligibleBrowserRules:inventory.filter(r=>r.status==='eligible').length,excludedEpcRules:inventory.filter(r=>r.status==='excluded_epc_taxonomy').length,otherUnreachableRules:inventory.filter(r=>!['eligible','excluded_epc_taxonomy'].includes(r.status)).length,noActiveRuleParticipation:rows.filter(r=>r.coverage==='no_active_rule_participation').length,contextOnly:rows.filter(r=>r.coverage==='context_only').length,eligibleWithoutDirectSource:inventory.filter(r=>r.status==='eligible'&&!r.sourceUrl).length,highSeverityWithoutRecordedSignoff:inventory.filter(r=>['major','contraindicated'].includes(r.severity)&&r.signoff==='not_recorded').length,crossConsumerClassDifferences:classDifferences.length,crossConsumerRuleDifferences:ruleDifferences.length,limitations:['Structural inventory of bundled names only; live MEDAPI catalogue may contain more names.','Rule participation and edge counts are not sensitivity, specificity, or proof of clinical coverage.','EPC exclusion applies to the browser engine; WardSynq has its own policy.','No comparison to a gold-standard clinical reference was performed.']};
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'coverage-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(out,'rule-inventory.json'),JSON.stringify(inventory,null,2)+'\n');
fs.writeFileSync(path.join(out,'consumer-differences.json'),JSON.stringify({classes:classDifferences,rules:ruleDifferences},null,2)+'\n');
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
fs.writeFileSync(path.join(out,'all-drug-coverage.csv'),[['generic','coverage','classes','rule_ids','context_rule_ids','pair_neighbours'],...rows.map(d=>[d.generic,d.coverage,d.classes.join(';'),d.ruleIds.join(';'),d.contextRuleIds.join(';'),d.pairNeighbours])].map(r=>r.map(csv).join(',')).join('\n')+'\n');
// Cross-check the app's own monographs without promoting prose to clinical rules.
// Negative studies, route-specific effects and intended co-therapy remain review items.
const escaped=universe.filter(g=>g.length>3).sort((a,b)=>b.length-a.length).map(g=>g.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
const namesPattern=new RegExp('\\b('+escaped.join('|')+')\\b','gi');
const candidates=[], monographs=new Map();
for(const filename of ['data/offline-clinical.json.gz','data/clinical-supplement.json.gz']) {
 const bundle=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,filename))));
 for(const [name,record] of Object.entries(bundle.struct||{})) {
  let gold; try { gold=typeof record.gold==='string'?JSON.parse(record.gold):record.gold; } catch { continue; }
  if(gold && gold.interactions && !monographs.has(name.toLowerCase())) monographs.set(name.toLowerCase(),{gold,filename});
 }
}
for(const [name,{gold,filename}] of monographs) {
 const generic=(gold.generic||name).toLowerCase().trim();
 for(const [authoredSeverity,items] of Object.entries(gold.interactions)) {
  for(const excerpt of Array.isArray(items)?items:[items]) {
   if(typeof excerpt!=='string')continue;
   const mentions=[...new Set([...excerpt.matchAll(namesPattern)].map(m=>m[0].toLowerCase()))];
   for(const other of mentions) {
    if(other===generic)continue;
    const i=index.get(generic),j=index.get(other);
    const hasPairRule=i!==undefined&&j!==undefined&&edges.has(Math.min(i,j)*universe.length+Math.max(i,j));
    candidates.push({generic,mentionedDrug:other,authoredSeverity,excerpt,hasPairRule,sourceFile:filename,sourceReferences:gold.refs||[],status:'requires_clinical_review',reason:'A name mention does not establish a drug interaction; assess negation, route, dose, timing and evidence.'});
   }
  }
 }
}
fs.writeFileSync(path.join(out,'monograph-review-queue.json'),JSON.stringify(candidates,null,2)+'\n');
summary.monographsWithInteractionSections=monographs.size;
summary.monographNameMentionsRequiringReview=candidates.length;
summary.mentionsWithoutEligiblePairRule=candidates.filter(c=>!c.hasPairRule).length;
fs.writeFileSync(path.join(out,'coverage-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
