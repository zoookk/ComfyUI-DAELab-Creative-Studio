import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {businessRequest,businessFetch,businessAuth,businessHost,bindBusinessService,bindBusinessAuth,installBusinessHost,BusinessCapabilityUnavailable} from '../../frontend/src/contracts/business.js';
import {request} from '../../frontend/src/features/generation/table_generation_api.mjs';
import {createMaterialTable,fillMaterialCell,fillMaterialColumn,fillMaterialRow} from '../../frontend/src/features/table/table_material_columns.mjs';
import {pairInputs,availableModes,applyIOResult,undoIOResult} from '../../frontend/src/features/prompt/llm_io_model.mjs';
import {emptyScriptTable,importTasks,assertLimits,enableGeneration} from '../../frontend/src/features/storyboard/script_parser_model.mjs';
import {bindBusinessHttp} from '../../frontend/src/integrations/comfyui/business/business_http.js';

test('unbound capabilities reject before native fetch and never synthesize a receipt',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Network forbidden in fixture');});
 for(const domain of ['storyboard','script','optimization','generation'])await assert.rejects(businessRequest(domain,'submit',{body:'{}'}),e=>e instanceof BusinessCapabilityUnavailable&&e.preflightRejected===true);
 await assert.rejects(request('submit',{jobs:[]}),e=>e.code==='business-capability-unavailable');
 await assert.rejects(businessAuth(true),/provider-auth/);assert.deepEqual(await businessAuth(),{});
 for(const route of ['/daelab/libtv/submit','https://example.test/api','/api/unknown'])await assert.rejects(businessFetch(route),/unsupported-route/);
 assert.equal(calls,0);
});

test('six backend routes preserve action, form data, body and cancellation through explicit ports',async()=>{
 const cleanups=[],calls=[];
 try{
  for(const domain of ['storyboard','script'])cleanups.push(bindBusinessService(domain,{request:async(action,options)=>{calls.push({domain,action,options});return new Response('{}');}}));
  const controller=new AbortController(),form=new FormData();form.append('file',new Blob(['fixture']),'synthetic.docx');
  const routes=[['storyboard','import_document?preview=1'],['storyboard','parse-prompts'],['script','document'],['script','normalize'],['script','classify'],['script','ai-status']];
  for(const [domain,action] of routes){const options={method:action==='ai-status'?'GET':'POST',body:action==='document'?form:'{"document_id":"fixture"}',signal:controller.signal};await businessFetch(`/daelab/${domain==='script'?'script-parser':domain}/${action}`,options);assert.equal(calls.at(-1).options,options);}
  assert.deepEqual(calls.map(({domain,action})=>[domain,action]),routes);
  assert.equal(calls[2].options.body,form);controller.abort();assert.equal(calls[2].options.signal.aborted,true);
 }finally{cleanups.forEach(fn=>fn());}
});

test('replaced host, service and auth bindings cannot be cleared by an older disposer',async()=>{
 const oldHost=installBusinessHost({marker:'old'}),current={marker:'current'},newHost=installBusinessHost(current);
 const oldService=bindBusinessService('generation',{request:async()=>new Response('old')}),newService=bindBusinessService('generation',{request:async()=>new Response('current')});
 const oldAuth=bindBusinessAuth(async()=>({headers:{fixture:'old'}})),newAuth=bindBusinessAuth(async()=>({headers:{fixture:'current'}}));
 try{oldHost();oldService();oldAuth();assert.equal(businessHost(),current);assert.equal(await(await businessRequest('generation','status')).text(),'current');assert.deepEqual(await businessAuth(true),{headers:{fixture:'current'}});}
 finally{newHost();newService();newAuth();}
 assert.throws(()=>businessHost(),/host\/history/);
});

test('product HTTP assembly reaches only implemented routes and preserves missing-provider 503',async()=>{
 const calls=[],unbind=bindBusinessHttp(async(url,options)=>{calls.push([url,options]);return new Response('{"code":"provider_unavailable","error":"AI 归类未接入"}',{status:503});});
 try{
  const options={method:'POST',body:'{"document_id":"synthetic"}'};
  const response=await businessFetch('/daelab/script-parser/classify',options);assert.equal(response.status,503);assert.equal((await response.json()).code,'provider_unavailable');assert.deepEqual(calls,[['/daelab/script-parser/classify',options]]);
  for(const action of ['../libtv/submit','document?provider=cloud','normalize/../../submit','submit'])await assert.rejects(businessRequest('script',action,{method:'POST'}),/unsupported-route/);
  await assert.rejects(businessRequest('script','normalize',{method:'GET'}),/unsupported-route/);
  for(const domain of ['generation','optimization'])assert.equal((await businessRequest(domain,'submit',{method:'POST'})).status,503);
  assert.equal(calls.length,3);
  assert.equal(calls[1][0],'/daelab/studio/generation/submit');assert.equal(calls[2][0],'/daelab/prompt-optimization/submit');
 }finally{unbind();}
 await assert.rejects(businessFetch('/daelab/script-parser/ai-status'),/script/);
});

test('new default retains old editable columns and rows without the automatic generation column',()=>{
 const workflow=JSON.parse(readFileSync(new URL('../fixtures/workflows/old-default-table.json',import.meta.url),'utf8'));
 const old=JSON.parse(workflow.nodes.find(n=>n.type==='DAELAB.Table').widgets_values[0]),current=createMaterialTable();
 const shape=t=>({fields:t.fields.map(f=>({name:f.name,type:f.type,width:f.width,presentation:f.presentation,readonly:f.readonly,generation:f.generation?{...f.generation,promptFieldId:t.fields.findIndex(v=>v.id===f.generation.promptFieldId)}:undefined})),records:t.records.map(r=>({name:r.name,selected:r.selected,values:t.fields.map(f=>r.values[f.id])}))});
 assert.deepEqual(shape(current),shape({...old,fields:old.fields.filter(f=>f.presentation!=='generation')}));assert.deepEqual(current.fields.map(f=>f.name),['图片/视频','提示词']);assert.deepEqual(current.records.map(r=>r.name),['任务1','任务2','任务3']);
});

test('material cells append ordered assets; 500 rows and 64 columns reject before mutation',()=>{
 const table=createMaterialTable(),row=table.records[0],field=table.fields[0],collection=n=>({assets:Array.from({length:n},(_,i)=>({filename:`synthetic-${i}.png`,kind:'image'}))});
 fillMaterialCell(table,row.id,field.id,collection(2));fillMaterialCell(table,row.id,field.id,collection(2));assert.equal(row.values[field.id].length,4);assert.equal(new Set(row.values[field.id].map(a=>a.id)).size,4);
 const before=JSON.stringify(table);assert.throws(()=>fillMaterialColumn(table,field.id,collection(501)),/500/);assert.equal(JSON.stringify(table),before);
 assert.throws(()=>fillMaterialRow(table,row.id,collection(65)),/64/);assert.equal(JSON.stringify(table),before);
 const exact={fields:Array.from({length:64},(_,i)=>({id:`f${i}`})),records:Array.from({length:500},(_,i)=>({id:`r${i}`}))};assert.equal(assertLimits(exact),exact);assert.throws(()=>assertLimits({...exact,fields:[...exact.fields,{id:'extra'}]}),/64/);
});

test('DOCX normalized scene stays text while repeated reference occurrences keep distinct material identities',()=>{
 const normalized={document_id:'public-synthetic',filename:'synthetic.docx',assets:{a:{id:'a',filename:'same.png',url:'/view?filename=same.png&type=input'}},unassigned:[],audit:[],paragraphs:[],tables:[],tasks:[{source_key:'public-synthetic:t1/r2',row_id:'r2',table_id:'t1',values:{scene:'合成画面描述',notes:'镜头备注'},chapter:'',sources:{},context:[],original_cells:[],issues:[],images:[{id:'occurrence1',asset_id:'a',cell_id:'c1'},{id:'occurrence2',asset_id:'a',cell_id:'c2'}]}]};
 const table=importTasks(emptyScriptTable(),normalized).table,scene=table.fields.find(f=>f.id===table.meta.script_parser.bindings.scene),refs=table.fields.find(f=>f.id===table.meta.script_parser.reference_fields[0]);
 assert.equal(scene.type,'longtext');assert.equal(table.records[0].values[scene.id],'合成画面描述');assert.equal(refs.type,'content');assert.deepEqual(table.records[0].values[refs.id].map(a=>a.provenance.occurrence_id),['occurrence1','occurrence2']);assert.notEqual(table.records[0].values[refs.id][0].id,table.records[0].values[refs.id][1].id);
 enableGeneration(table,'image');assert.deepEqual(table.fields.find(f=>f.id==='sp-image-prompt').promptTemplate.segments,[{type:'column',fieldId:scene.id}]);
});

test('LLM input limits and explicit apply/undo retain source rows without a product simulator',()=>{
 const rows=pairInputs([{version:1,texts:['第一行','第二行'],assets:[]}]);assert.deepEqual(rows.map(r=>r.text),['第一行','第二行']);assert.deepEqual(availableModes(rows),{polish:true,reverse:false,custom:true});
 assert.throws(()=>pairInputs([{version:1,texts:Array(501).fill('text')}]),/500/);
 assert.throws(()=>pairInputs([{version:1,assets:[{kind:'image',url:'https://example.test/image.png'}]}]),/本地图片/);
 const state={ioResult:{requestId:'fixture-result',complete:true,signature:'input-a',rows:[{id:'input-1',result:'建议'}]},appliedIO:{requestId:'previous',rows:[]}};
 const before=structuredClone(state);assert.equal(applyIOResult(state,'input-b'),false);assert.deepEqual(state,before);
 assert.equal(applyIOResult(state,'input-a'),true);assert.notEqual(state.appliedIO,state.ioResult);assert.equal(applyIOResult(state,'input-a'),false);assert.equal(undoIOResult(state),true);assert.deepEqual(state.appliedIO,before.appliedIO);
});
