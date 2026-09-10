import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../admin/connect-emr.html',import.meta.url),'utf8');
const apiSource=source.slice(source.indexOf('  var api=function('),source.indexOf('  function jpost('));
function makeApi(fetch,token='test-session-token',timeout=false){
  const context={tok:()=>Promise.resolve(token),fetch,API_ORIGIN:'https://stewardmd.in',AbortController,
    setTimeout:timeout?fn=>setTimeout(fn,1):setTimeout,clearTimeout};
  vm.createContext(context);vm.runInContext(apiSource,context);return context.api;
}
test('no session returns 401 without sending a request',async()=>{
  let calls=0;const result=await makeApi(()=>{calls++;},null)('/api/connect/onboard/tenants');
  assert.equal(result.s,401);assert.equal(calls,0);
});
test('network failure is distinct from an expired session',async()=>{
  const result=await makeApi(()=>Promise.reject(new Error('offline')))('/api/connect/onboard/tenants');
  assert.equal(result.s,0);assert.equal(result.d.error,'network');
});
test('a stalled request times out even when transport ignores abort',async()=>{
  let signal;const result=await makeApi((url,opts)=>{signal=opts.signal;return new Promise(()=>{});},'token',true)('/api/connect/onboard/tenants');
  assert.equal(result.s,408);assert.equal(signal.aborted,true);
});
test('authenticated request preserves caller options and parses HTTP failures',async()=>{
  const opts={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};let request;
  const result=await makeApi((url,init)=>{request={url,init};return Promise.resolve({status:403,json:()=>Promise.resolve({error:'forbidden'})});})('/api/connect/onboard/emr',opts);
  assert.equal(result.s,403);assert.equal(request.url,'https://stewardmd.in/api/connect/onboard/emr');
  assert.equal(request.init.headers.Authorization,'Bearer test-session-token');assert.equal(opts.headers.Authorization,undefined);
});
