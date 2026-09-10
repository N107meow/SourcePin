import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
test('personal information heuristics report unique counts without returning values',async()=>{
 const result=await build({entryPoints:['src/core/review.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const {scanPersonalInfo}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const text='demo@example.test demo@example.test 13800138000 110101199001011234 北京市示例路123号';
 assert.deepEqual(scanPersonalInfo(text),{email:1,phone:1,identity:1,address:1});
 assert.deepEqual(scanPersonalInfo('width: 1200; height: 10000; no matches'),{email:0,phone:0,identity:0,address:0});
});
