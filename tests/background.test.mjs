import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';

const built=await build({entryPoints:['src/extension/background.ts'],bundle:true,write:false,format:'iife'});
function adapter({granted=false,denied=false,cancel=false}={}){
  let listener;const calls=[];
  const chrome={
    action:{onClicked:{addListener(){}}},commands:{onCommand:{addListener(){}}},
    runtime:{id:'fixture-extension',onMessage:{addListener(fn){listener=fn}}},
    permissions:{contains:async()=>granted,request:async()=>!denied},
    downloads:{download:async options=>{calls.push(options);if(cancel)throw new Error('User cancelled');return 1;}}
  };
  runInNewContext(built.outputFiles[0].text,{chrome,TextEncoder});
  return {calls,send:message=>new Promise(resolve=>listener(message,{id:'fixture-extension',tab:{id:1}},resolve)),listener};
}
test('optional download denial returns a fallback without invoking save dialog',async()=>{
  const fixture=adapter({denied:true});const response=await fixture.send({type:'download',text:'# Capture',filename:'capture.md'});
  assert.equal(response.ok,true);assert.equal(response.value.fallback,true);assert.equal(fixture.calls.length,0);
});
test('saveAs cancellation is reported as failure instead of saved success',async()=>{
  const fixture=adapter({granted:true,cancel:true});const response=await fixture.send({type:'download',text:'# Capture',filename:'capture.md'});
  assert.equal(fixture.calls[0].saveAs,true);assert.equal(response.ok,false);assert.match(response.error,/cancelled/);
});
test('download rejects invalid payloads and unrelated senders',async()=>{
  const fixture=adapter({granted:true});const response=await fixture.send({type:'download',text:'report',filename:'page.html'});
  assert.equal(response.ok,false);assert.equal(fixture.calls.length,0);
  assert.equal(fixture.listener({type:'download'},{id:'unrelated',tab:{id:1}},()=>assert.fail('must not respond')),false);
});
