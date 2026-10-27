import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readdirSync} from 'node:fs';

test('host-discovered generation lifecycle creates one bound panel per instance and after reload',async t=>{
 const extensions=[],installs=[],states=new Map(),adapters=new Map();let begins=0,ends=0;
 const app={isGraphReady:true,registerExtension:extension=>extensions.push(extension),extensionManager:{workflow:{activeWorkflow:{}}}};
 const fixture={app,install(node,_app,options={}){
  const record={node,options,disposed:false,syncedLinks:[]};installs.push(record);
  states.set(node,{table:{fields:[],records:[],meta:{}},value:'original'});
  record.document=options.documentFactory?.(()=>states.get(node),value=>states.set(node,value));
  return {sync(){record.syncedLinks.push(node.inputs[0].link);},acceptResult(){},root:{remove(){}},dispose(){record.disposed=true;record.document?.dispose();}};
 }};
 globalThis.__generationEntryFixture=fixture;
 globalThis.addEventListener=()=>{};
 globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]={version:1,registerAdapter(name,adapter){adapters.set(name,adapter);}};
 const hooks=registerHooks({
  resolve(specifier,context,next){
   if(specifier==='/scripts/app.js')return {url:'fixture:generation-app',shortCircuit:true};
   if(specifier.endsWith('/video_tasks_panel.mjs'))return {url:'fixture:generation-panel',shortCircuit:true};
   return next(specifier,context);
  },
  load(url,context,next){
   if(url==='fixture:generation-app')return {format:'module',shortCircuit:true,source:'export const app=globalThis.__generationEntryFixture.app;'};
   if(url==='fixture:generation-panel')return {format:'module',shortCircuit:true,source:'export const installVideoTasks=globalThis.__generationEntryFixture.install;'};
   return next(url,context);
  },
 });
 t.after(()=>{hooks.deregister();delete globalThis.__generationEntryFixture;delete globalThis.addEventListener;delete globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')];});
 const directory=new URL('../../frontend/src/integrations/comfyui/business/',import.meta.url);
 for(const file of readdirSync(directory,{recursive:true}).filter(file=>/\.(?:js|ts)$/.test(file)&&!file.endsWith('.d.ts')).sort())await import(new URL(file,directory));
 const {installBusinessDocuments}=await import('../../frontend/src/integrations/comfyui/business/business_document_host.ts');
 const graph={id:'generation-entry-fixture',extra:{},_nodes:[],getNodeById(id){return this._nodes.find(node=>node.id===id);},serialize(){return {nodes:this._nodes.map(node=>({id:node.id,properties:node.properties,state:states.get(node)})),extra:this.extra};}};
 app.graph=app.rootGraph=graph;
 installBusinessDocuments(app,{begin(){begins++;},end(){ends++;},amend(fn){return fn();}});
 class GenerationNode{constructor(id){this.id=id;this.graph=graph;this.widgets=[];this.properties={};this.inputs=[{name:'native-input'}];this.outputs=[{name:'native-output'}];}}
 for(const extension of extensions)await extension.beforeRegisterNodeDef?.(GenerationNode,{name:'DAELAB.LibTV.VideoGenerate'});
 const a=new GenerationNode(20),b=new GenerationNode(21);graph._nodes.push(a,b);
 for(const node of [a,b]){node.onNodeCreated();node.onAdded();node.onConfigure({widgets_values:[]});}
 await new Promise(resolve=>queueMicrotask(resolve));
 assert.equal(installs.length,2,'coalesced native restore installs each panel once');
 for(const record of installs){
  assert.ok(record.document,'generation panel has the real native document binding');
  assert.equal(typeof record.options.taskIdentity.documentId,'string');
  assert.equal(typeof record.options.taskIdentity.tableId,'string');
  assert.deepEqual(record.node.inputs,[{name:'native-input'}]);assert.deepEqual(record.node.outputs,[{name:'native-output'}]);
 }
 assert.notEqual(installs[0].options.taskIdentity.tableId,installs[1].options.taskIdentity.tableId);
 a.onConnectionsChange();a.inputs[0].link=42;a.onConnectionsChange();
 assert.deepEqual(installs[0].syncedLinks,[],'wait for the native connection update to finish');
 await new Promise(resolve=>queueMicrotask(resolve));
 assert.deepEqual(installs[0].syncedLinks,[42],'coalesced connection changes read the completed link');
 adapters.get('daelab.business').refresh(a);
 assert.deepEqual(installs[0].syncedLinks,[42,42],'creative canvas refresh synchronizes without native drawing');
 assert.deepEqual(installs[1].syncedLinks,[],'other generation instances stay independent');
 installs[0].document.edit('fixture edit',draft=>{draft.value='edited';});
 assert.equal(states.get(a).value,'edited');assert.equal(states.get(b).value,'original');
 assert.equal(begins,1);assert.equal(ends,1);
 const previous=installs[0],identity={...previous.options.taskIdentity};
 a.onConfigure({widgets_values:[]});await new Promise(resolve=>queueMicrotask(resolve));
 assert.equal(installs.length,3);assert.equal(previous.disposed,true);
 assert.throws(()=>previous.document.edit('stale',draft=>{draft.value='stale';}),/Document controller has been released/);
 assert.deepEqual(installs[2].options.taskIdentity,identity);
 installs[2].document.edit('restored edit',draft=>{draft.value='restored';});
 assert.equal(states.get(a).value,'restored');assert.equal(states.get(b).value,'original');
 a.onRemoved();b.onRemoved();assert.equal(installs[1].disposed,true);assert.equal(installs[2].disposed,true);
});
