import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readdirSync} from 'node:fs';

test('production entry closure loads before graph initialization and exposes only formal business nodes',async t=>{
 const extensions=[],adapters=[],types=new Map();let graphReads=0;
 const app={registerExtension:extension=>extensions.push(extension),isGraphReady:false};
 Object.defineProperty(app,'graph',{get(){graphReads++;throw Error('graph not initialized');}});
 globalThis.__businessFixtureApp=app;
 const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='/scripts/app.js')return {url:'fixture:business-app',shortCircuit:true};return next(specifier,context);},load(url,context,next){if(url==='fixture:business-app')return {format:'module',shortCircuit:true,source:'export const app=globalThis.__businessFixtureApp;'};return next(url,context);}});
 t.after(()=>{hooks.deregister();delete globalThis.__businessFixtureApp;});
 t.mock.method(globalThis,'setInterval',()=>{throw Error('Import must not start polling');});
 globalThis.addEventListener=()=>{};
 globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]={version:1,registerAdapter:(_name,adapter)=>adapters.push(adapter)};
 globalThis.LiteGraph={registerNodeType:(type,constructor)=>types.set(type,constructor)};
 globalThis.LGraphNode=class{constructor(){this.inputs=[];this.outputs=[];this.widgets=[];}addInput(name,type){this.inputs.push({name,type});}addOutput(name,type){this.outputs.push({name,type});}addWidget(_type,name,value){const w={name,value};this.widgets.push(w);return w;}};
 t.after(()=>{delete globalThis.addEventListener;delete globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')];delete globalThis.LiteGraph;delete globalThis.LGraphNode;});
 // ComfyUI discovers every emitted .js file, including entries outside the
 // bootstrap import closure. TS sources also emit discoverable .js modules.
 const directory=new URL('../../frontend/src/integrations/comfyui/business/',import.meta.url);
 for(const file of readdirSync(directory,{recursive:true}).filter(file=>/\.(?:js|ts)$/.test(file)&&!file.endsWith('.d.ts')).sort())await import(new URL(file,directory));
 assert.equal(graphReads,0);assert.equal(new Set(extensions.map(e=>e.name)).size,extensions.length);
 const generationOwners=[];
 for(const extension of extensions){
  class GenerationNode{};
  const before=Object.getOwnPropertyDescriptors(GenerationNode.prototype);
  await extension.beforeRegisterNodeDef?.(GenerationNode,{name:'DAELAB.LibTV.VideoGenerate'});
  if(Object.keys(Object.getOwnPropertyDescriptors(GenerationNode.prototype)).some(key=>!Object.hasOwn(before,key)))generationOwners.push(extension.name);
 }
 assert.deepEqual(generationOwners,['DAELab.Studio.GenerationPanel'],'one native-document generation owner, independent of entry load order');
 class TableNode{constructor(){this.inputs=[{name:'source_table'},{name:'table_data'}];}}
 for(const extension of extensions)await extension.beforeRegisterNodeDef?.(TableNode,{name:'DAELAB.Table'});
 const table=new TableNode();
 for(const type of ['DAELAB.TextInput','DAELAB.LLMStylePreviewB','DAELAB.MediaUpload'])assert.equal(table.onConnectInput(0,'STRING',{}, {type},0),false,type);
 for(const type of ['DAELAB.Table','DAELAB.ScriptParser']){
  assert.equal(table.onConnectInput(0,'STRING',{}, {type},0),true,type);
  assert.equal(table.onConnectInput(0,'STRING',{}, {type},1),false,type);
 }
 assert.equal(table.onConnectInput(1,'STRING',{}, {type:'DAELAB.TextInput'},0),true,'other native inputs keep their contract');
 for(const extension of extensions)extension.registerCustomNodes?.();
 assert.deepEqual([...types.keys()],['DAELAB.LLMStylePreviewB']);
 const formal=new Set(['DAELAB.Table','DAELAB.StoryboardImport','DAELAB.ScriptParser','DAELAB.LLMStylePreviewB','DAELAB.LibTV.VideoGenerate']);
 for(const adapter of adapters)for(const entry of adapter.menu||[])assert.equal(formal.has(entry.type),true,entry.type);
 for(const type of ['DAELAB.LLMStylePreviewA','DAELAB.LLMStylePreviewC','DAELAB.LLMStylePreviewD','DAELAB.LLMStylePreviewE','DAELAB.GPTImageStoryboardStage','DAELAB.LibTV.StoryboardBatch','Unknown.CustomNode']){
  assert.equal(adapters.some(a=>a.matches?.({type})),false,type);
  class Unknown{};const before=Object.getOwnPropertyDescriptors(Unknown.prototype);
  for(const extension of extensions)await extension.beforeRegisterNodeDef?.(Unknown,{name:type});
  assert.deepEqual(Object.getOwnPropertyDescriptors(Unknown.prototype),before,type);
 }
 const node=new(types.get('DAELAB.LLMStylePreviewB'))();
 assert.deepEqual(node.inputs.map(v=>[v.name,v.type]),[['原文','STRING'],['参考图片','IMAGE'],['素材组','DAELAB_ASSETS'],['多维表格','STRING'],['其他输入','*']]);
 assert.deepEqual(node.outputs.map(v=>[v.name,v.type]),[['结果','STRING'],['逐行结果','STRING']]);
 assert.deepEqual(node.widgets.map(v=>v.name),['applied_text','applied_rows']);
});
