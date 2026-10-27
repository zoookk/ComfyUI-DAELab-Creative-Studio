import test from 'node:test';
import assert from 'node:assert/strict';
import {bindGenerationHttp} from '../../web/integrations/comfyui/business/business_http.js';
import {createBusinessDocument} from '../../web/application/business_document.js';
import {tableInputStamp} from '../../web/integrations/comfyui/business/business_document_host.js';
import {createMaterialTable} from '../../web/features/table/table_material_columns.mjs';
import {attachGenerationTasks} from '../../web/features/generation/table_generation_tasks.mjs';
import {addGenerationColumn} from '../../web/features/generation/table_generation_model.mjs';

function fixture(t){
 let markSubmitted;
 const submissionReady=new Promise(resolve=>{markSubmitted=resolve;});
 let table=createMaterialTable(),steps=0,epoch=0,release,report,submitFault=null,statusFault=null;table.records=table.records.slice(0,1);const field=addGenerationColumn(table,{name:'生成列（仅测试用）'}),row=table.records[0];row.values[field.generation.promptFieldId]='合成独立测试输入';
 const original=structuredClone(table),calls=[],history=[];
 const native=createBusinessDocument({read:()=>table,write:value=>{table=value;},current:()=>true,stamp:tableInputStamp,identity:()=>({workflowSession:'w',epoch,documentId:'node'}),history:{begin(){steps++;history.push(structuredClone(table));},end(){},amend(fn){fn();},undo(){table=history.pop();},redo(){}}});
 const editor={root:{querySelectorAll:()=>[]},nativeDocument:native,taskIdentity:{documentId:'document',tableId:'table',nodeId:'node'},change:(fn,options)=>native.edit('编辑',fn,options),beginAsync:(target,id)=>native.beginRequest(id,target),canAsync:native.canApply,releaseAsync:native.releaseRequest,applyAsync:(tickets,fn,options)=>{if(!native.controller.applyResults(tickets,'应用结果',fn,options))throw Error('stale');}};
 const unbind=bindGenerationHttp(async(url,options)=>{const body=options.body?JSON.parse(options.body):{};calls.push({url,body});
  if(url.includes('/capabilities'))return new Response(JSON.stringify({local:true,available:true}));
  if(url.endsWith('/submit')&&submitFault){const status=submitFault;submitFault=null;return new Response(JSON.stringify({error:'synthetic rejection',submitted:false,code:'synthetic-fault'}),{status});}
  if(url.endsWith('/status')&&body.requestIds&&!report)return new Response(JSON.stringify({error:'missing',code:statusFault?'storage_unavailable':'record_not_found'}),{status:statusFault||404});
   if(url.endsWith('/fence-unsubmitted')){if(statusFault)return new Response(JSON.stringify({error:'storage unavailable',code:'storage_unavailable'}),{status:statusFault});report={requestId:body.requestId,source:body.source,inputFingerprint:'a'.repeat(64),state:'cancelled',phase:'needs_input',preparation:'fenced',replacementAllowed:true,version:1};}
  if(url.endsWith('/submit')){const job=body.jobs[0];report={requestId:job.requestId,source:job.source,inputFingerprint:'a'.repeat(64),state:'succeeded',phase:'complete',version:3,result:{url:'/view?filename=synthetic.png&type=output',kind:'image',asset_id:'asset',reference_id:'ref'},receipt:{kind:'assets',items:[{asset_id:'asset',reference_id:'ref'}]}};await new Promise(resolve=>{release=resolve;markSubmitted();});}
  return new Response(JSON.stringify({jobs:report?[report]:[],nextOffset:null}));
 });
 const notices=[],tasks=attachGenerationTasks({editor,getTable:()=>table,notify:message=>notices.push(message),prepareGeneration:async()=>{},canGenerate:()=>true});
 t.after(()=>{tasks.destroy();native.dispose();unbind();});
 return {tasks,native,calls,notices,field,row,original,rejectOnce(status){submitFault=status;},statusFailure(status){statusFault=status;},get table(){return table;},get steps(){return steps;},async submitted(){let timeout;try{await Promise.race([submissionReady,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Generation did not reach the test submit handler')),5000);})]);}finally{clearTimeout(timeout);}},complete(){release();},switch(){epoch++;}};
}
test('actual table submit stores only immutable references; completion uses one native result transaction and poll never writes facts',async t=>{
 t.mock.timers.enable({apis:['setInterval']});const f=fixture(t),pending=f.tasks.generate(f.field.id,f.row.id);await f.submitted();
 assert.equal(f.table.records[0].meta.generationColumns,undefined);assert.equal(f.steps,1);const refs=f.table.records[0].meta.studioGenerationRefs[f.field.id];assert.equal(refs.length,1);assert.equal(refs[0].phase,undefined);assert.equal(refs[0].input,undefined);
 f.complete();await pending;assert.equal(f.table.records[0].values[f.field.id].length,1);assert.equal(f.steps,1);
 t.mock.timers.tick(3000);await new Promise(setImmediate);assert.equal(f.steps,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/submit')).length,1);
 f.native.undo();assert.equal(f.table.records[0].values[f.field.id].length,0);t.mock.timers.tick(3000);await new Promise(setImmediate);assert.equal(f.table.records[0].values[f.field.id].length,0);assert.equal(f.tasks.stateFor(f.table.records[0],f.field.id).phase,'complete');
 await f.tasks.reviewResult(f.field.id,f.row.id);assert.equal(f.table.records[0].values[f.field.id].length,1);assert.equal(f.steps,2);assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
});
test('actual delayed table response after workflow replacement is retained only as task facts',async t=>{
 const f=fixture(t),pending=f.tasks.generate(f.field.id,f.row.id);await f.submitted();f.switch();f.complete();await pending;
 assert.equal(f.table.records[0].values[f.field.id].length,0);assert.equal(f.steps,1);assert.equal(f.tasks.stateFor(f.table.records[0],f.field.id).phase,'complete');
});
test('actual resume uses recover for the same request and never submits a replacement',async t=>{
 const f=fixture(t),pending=f.tasks.generate(f.field.id,f.row.id);await f.submitted();f.complete();await pending;
 await f.tasks.generate(f.field.id,f.row.id,true);assert.equal(f.calls.filter(c=>c.url.endsWith('/submit')).length,1);
 const recover=f.calls.find(c=>c.url.endsWith('/recover'));assert.deepEqual(recover.body.requestIds,[f.table.records[0].meta.studioGenerationRefs[f.field.id][0].requestId]);
});

test('temporary 404 remains locked; explicit durable fencing precedes a new user request',async t=>{
 const f=fixture(t);f.rejectOnce(429);await f.tasks.generate(f.field.id,f.row.id);const first=f.table.records[0].meta.studioGenerationRefs[f.field.id][0].requestId;
 await f.tasks.generate(f.field.id,f.row.id);assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
  await f.tasks.generate(f.field.id,f.row.id,true);assert.equal(f.tasks.stateFor(f.table.records[0],f.field.id).phase,'needs_recovery');assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
  await f.tasks.generate(f.field.id,f.row.id);assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
  await f.tasks.fenceOriginal(f.field.id,f.row.id);assert.equal(f.tasks.stateFor(f.table.records[0],f.field.id).phase,'needs_input');assert.equal(f.calls.filter(call=>call.url.endsWith('/fence-unsubmitted')).length,1);
 const pending=f.tasks.generate(f.field.id,f.row.id);await f.submitted();f.complete();await pending;
 const refs=f.table.records[0].meta.studioGenerationRefs[f.field.id];assert.equal(refs.length,2);assert.equal(refs[0].requestId,first);assert.notEqual(refs[1].requestId,first);assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,2);
});
test('database unavailability never supplies missing-task evidence or enables replacement submission',async t=>{
 const f=fixture(t);f.rejectOnce(500);await f.tasks.generate(f.field.id,f.row.id);f.statusFailure(503);await f.tasks.generate(f.field.id,f.row.id,true);await f.tasks.generate(f.field.id,f.row.id);
 assert.equal(f.tasks.stateFor(f.table.records[0],f.field.id).phase,'needs_recovery');assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
});
