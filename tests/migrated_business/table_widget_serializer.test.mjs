import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import ts from 'typescript';
import {normalizeTable} from '../../frontend/src/features/table/data_table_model.mjs';
import {isTableSource,readTableView} from '../../frontend/src/application/table_exchange.mjs';
import {createBusinessDocument} from '../../frontend/src/application/business_document.ts';
import {scheduleTableInstall} from '../../frontend/src/features/table/table_node_install.mjs';
import {createMaterialTable} from '../../frontend/src/features/table/table_material_columns.mjs';
import {preserveGenerationHistory} from '../../frontend/src/features/generation/table_generation_history.mjs';
import {assertTransition} from '../../frontend/src/features/storyboard/script_parser_model.mjs';
import {enableColumnPrompt,syncGenerationConfigOwners} from '../../frontend/src/features/generation/table_generation_model.mjs';
import {ensureIdentity,NAMESPACE} from '../../frontend/src/features/prompt/prompt_optimization_model.mjs';
import {promptField,promptFingerprint} from '../../frontend/src/features/prompt/table_prompt_model.mjs';
import {isColumnPrompt,effectivePrompt} from '../../frontend/src/features/prompt/table_prompt_template.mjs';
import {writeGenerationResults} from '../../frontend/src/features/storyboard/storyboard_table_adapter.mjs';

// Execute the actual owning assignment, including its original fallback. The
// optional import lets these tests first run against the untouched old source.
const moduleURL=new URL('../../frontend/src/integrations/comfyui/business/table_serializer.ts',import.meta.url);
const helper=existsSync(moduleURL)?await import(moduleURL.href):{};
const source=readFileSync(new URL('../../frontend/src/integrations/comfyui/business/data_table_nodes.mjs',import.meta.url),'utf8');
const tree=ts.createSourceFile('data_table_nodes.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),assignments=[];
function visit(n){if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&n.left.getText(tree)==='data.serializeValue')assignments.push(n.right.getText(tree));ts.forEachChild(n,visit);}
visit(tree);assert.equal(assignments.length,1);
const bind=new Function('node','data','readTableView','createTableWidgetSerializer','return ('+assignments[0]+');');
function owningFunction(name,environment){
 const found=[];function find(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found.push(n);ts.forEachChild(n,find);}find(tree);assert.equal(found.length,1);
 return new Function(...Object.keys(environment),'return ('+found[0].getText(tree)+');')(...Object.values(environment));
}
const legacy=(node,data,read=readTableView)=>{try{return JSON.stringify(read(node));}catch{return data.value;}};
const canonical=value=>JSON.stringify(normalizeTable(value));
const small=()=>({fields:[{id:'f',name:'F',type:'content',width:180}],records:[{id:'r',values:{f:'text'},future:{kept:1}}],meta:{material_columns:true,future:{kept:2}}});
function fixture(raw=canonical(small()),id='1'){
 const data={name:'table_data',value:raw},node={id,type:'DAELAB.Table',mode:0,widgets:[data],inputs:[{name:'table_data',type:'STRING',link:null,widget:{name:'table_data'}},{name:'source_table',type:'STRING',link:null}]};
 const nodes=new Map([[id,node]]),graph={id:'graph',links:{},getNodeById:id=>nodes.get(id)};node.graph=graph;let calls=0;
 const read=n=>{calls++;return readTableView(n);};data.serializeValue=bind(node,data,read,helper.createTableWidgetSerializer);
 return {node,data,graph,nodes,read,get calls(){return calls;},serialize:()=>data.serializeValue()};
}
function nativeStringWidget(h){
 // Fixed 1.53.10 domWidget.ts public instance getter/setter body, backed by
 // useStringWidget's read-only store lookup contract. No private _state access.
 const state={value:h.data.value},reads=[],writes=[],element={tagName:'TEXTAREA',value:h.data.value};
 const widgetStore={getWidget(id){reads.push(id);return state;},registerWidget(){throw Error('Unexpected registration');}};
 const widgetId=(graph,node,name)=>[graph,node,name].join('/');
 const resolveNodeRootGraphId=(node,fallback)=>node.graph?.id??fallback,app={rootGraph:{id:'root'}};
 const node=h.node,name='table_data',inputEl=element;
 const options={getValue(){const graphId=resolveNodeRootGraphId(node,app.rootGraph.id);const widgetState=widgetStore.getWidget(widgetId(graphId,node.id,name));return widgetState?.value??inputEl.value;},setValue(value){writes.push(value);state.value=value;inputEl.value=value;}};
 const accessors=Object.getOwnPropertyDescriptor({get value(){return this.options.getValue?.()??'';},set value(v){this.options.setValue?.(v);this.callback?.(this.value);}},'value');
 h.data.type='customtext';h.data.options=options;h.data.element=element;Object.defineProperty(h.data,'value',{...accessors,configurable:true});
 return {state,reads,writes,element,options};
}

test('two real 500x10 tables reuse only an individually proven canonical serialization',t=>{
 const saved=JSON.parse(readFileSync(new URL('../fixtures/performance/FX-PERF-M-no-video.json',import.meta.url),'utf8'));
 const tables=saved.nodes.filter(n=>n.type==='DAELAB.Table').map(n=>fixture(canonical(n.widgets_values[0]),String(n.id)));
 assert.equal(tables.length,2);
 for(const h of tables){const expected=legacy(h.node,h.data);for(let i=0;i<6;i++)assert.equal(h.serialize(),expected);}
 t.diagnostic('complete readTableView/normalize delegates for 6 serializations per owner: '+tables.map(h=>h.calls).join('/'));
 assert.deepEqual(tables.map(h=>h.calls),[1,1]);
 const changed=JSON.parse(tables[0].data.value);changed.records[0].values['field-00']='edited';tables[0].data.value=JSON.stringify(changed);
 assert.equal(tables[0].serialize(),legacy(tables[0].node,tables[0].data));assert.equal(tables[1].serialize(),tables[1].data.value);
 assert.deepEqual(tables.map(h=>h.calls),[2,1]);
});

test('exact raw changes invalidate while unknown JSON and public mutable snapshots stay isolated',()=>{
 const value=small();value.meta.future=JSON.parse('{"__proto__":{"kept":true},"nested":[null,{"opaque":7}]}');value.fields[0].unknown={keep:true};value.records[0].values.deleted={keep:['x']};
 const h=fixture(canonical(value)),initial=h.data.value;assert.equal(h.serialize(),initial);assert.equal(h.serialize(),initial);assert.equal(h.calls,1);
 const snapshot=readTableView(h.node);snapshot.records[0].values.f='external';snapshot.meta.future.nested[1].opaque=0;
 assert.equal(h.serialize(),initial);assert.equal(h.calls,1);assert.equal(JSON.parse(initial).meta.future.__proto__.kept,true);
 const changed=JSON.parse(initial);changed.records[0].values.f='next';h.data.value=JSON.stringify(changed);assert.equal(h.serialize(),h.data.value);assert.equal(h.calls,2);
 h.data.value=initial;assert.equal(h.serialize(),initial);assert.equal(h.calls,3,'one-entry only; an older string must be proven again');
});

test('first widget, input identity, slot order and metadata changes run the full delegate again',()=>{
 const cases=[h=>{h.node.widgets.unshift({name:'table_data',value:h.data.value});},h=>{h.node.widgets=[h.data];},h=>{h.node.inputs[1]={...h.node.inputs[1]};},h=>{h.node.inputs=[...h.node.inputs];},h=>h.node.inputs.reverse(),h=>h.node.inputs.push({name:'extra',type:'STRING',link:null}),h=>{h.node.inputs[1].type='*';},h=>{h.node.inputs[1].future=1;},h=>{h.node.inputs[0].widget.name='other';},h=>{h.node.inputs[1].name='renamed';}];
 for(const change of cases){const h=fixture();h.serialize();change(h);assert.equal(h.serialize(),legacy(h.node,h.data));assert.equal(h.calls,2);}
 const h=fixture();h.serialize();h.node.widgets[0]={name:'table_data',value:canonical({...small(),meta:{material_columns:true,marker:2}})};
 assert.equal(h.serialize(),legacy(h.node,h.data));assert.notEqual(h.serialize(),h.data.value);assert.equal(h.calls,3);
});

test('node, graph, native lookup, mode, type and serializer ownership never reuse a prior owner cache',()=>{
 const cases=[h=>{h.node.id='changed';},h=>{h.graph.id='save-as';},h=>{h.node.graph={...h.graph};},h=>{h.node.graph=null;},h=>h.nodes.set(h.node.id,{...h.node}),h=>h.nodes.delete(h.node.id),h=>{h.node.mode=2;},h=>{h.node.mode=undefined;},h=>{h.node.type='DAELAB.ScriptParser';}];
 for(const change of cases){const h=fixture();h.serialize();change(h);for(let n=0;n<2;n++)assert.equal(h.serialize(),legacy(h.node,h.data));assert.equal(h.calls,3);}
 const h=fixture();const previous=h.data.serializeValue;h.serialize();h.data.serializeValue=()=> 'replacement';assert.equal(previous(),legacy(h.node,h.data));assert.equal(h.calls,2);
});

test('noncanonical, invalid, missing-ID, object and all liveSource markers retain the legacy path',()=>{
 const base=canonical(small()),raw=JSON.parse(base);const invalidDuplicate=JSON.parse(base);invalidDuplicate.fields.push({...invalidDuplicate.fields[0]});
 const values=[' '+base,'invalid JSON',JSON.stringify(invalidDuplicate),JSON.parse(base),...([null,false,{}, {fields:{f:'f'}}].map(liveSource=>canonical({...raw,meta:{...raw.meta,liveSource}})))];
 for(const value of values){const h=fixture(value);for(let i=0;i<2;i++)assert.deepEqual(h.serialize(),legacy(h.node,h.data));assert.equal(h.calls,2);}
 const h=fixture(JSON.stringify({fields:[{name:'new',type:'content'}],records:[{values:{}}]}));const a=h.serialize(),b=h.serialize();assert.notEqual(a,b);assert.equal(h.calls,2);
 const object=fixture(JSON.parse(base));object.serialize();object.data.value.records[0].values.f='mutable';assert.equal(object.serialize(),legacy(object.node,object.data));assert.equal(object.calls,2);
});

test('link zero, upstream changes and broken/muted sources always use live projection or old error fallback',()=>{
 const h=fixture(),up=fixture(canonical(small()),'up');up.node.graph=h.graph;h.nodes.set('up',up.node);h.serialize();h.node.inputs[1].link=0;h.graph.links[0]={origin_id:'up',origin_slot:0};
 assert.equal(h.serialize(),legacy(h.node,h.data));let value=JSON.parse(up.data.value);value.records[0].values.f='upstream changed';up.data.value=JSON.stringify(value);
 assert.equal(h.serialize(),legacy(h.node,h.data));assert.equal(JSON.parse(h.serialize()).records[0].values.f,'upstream changed');
 up.node.mode=4;assert.equal(h.serialize(),h.data.value);h.graph.links[0].origin_slot=1;assert.equal(h.serialize(),h.data.value);assert.equal(h.calls,6);
 const converted=fixture();converted.serialize();converted.node.inputs[0].link=0;assert.equal(converted.serialize(),legacy(converted.node,converted.data));assert.equal(converted.calls,2);
});

test('native prototype input.link getters invalidate a warmed cache without changing own slot descriptors',()=>{
 const h=fixture(),up=fixture(canonical({...small(),records:[{id:'up-row',values:{f:'live upstream'}}]}),'up'),links=new WeakMap();
 const slot=h.node.inputs[1];delete slot.link;Object.setPrototypeOf(slot,{get link(){return links.get(this)??null;}});
 up.node.graph=h.graph;h.nodes.set('up',up.node);h.graph.links[0]={origin_id:'up',origin_slot:0};
 assert.equal(h.serialize(),h.data.value);assert.equal(h.serialize(),h.data.value);assert.equal(h.calls,1);
 links.set(slot,0);const expected=legacy(h.node,h.data);assert.notEqual(expected,h.data.value);assert.equal(h.serialize(),expected);assert.equal(h.calls,2);
});

test('mid-delegate changes do not arm a stale result; accessor and failed eligibility are safe misses',()=>{
 const h=fixture(),initial=h.data.value,next=canonical({...small(),meta:{material_columns:true,changed:true}});let calls=0;
 h.data.serializeValue=bind(h.node,h.data,n=>{calls++;const table=readTableView(n);if(calls===1)h.data.value=next;return table;},helper.createTableWidgetSerializer);
 assert.equal(h.serialize(),initial);assert.equal(h.serialize(),next);assert.equal(h.serialize(),next);assert.equal(calls,2);
 const accessor=fixture();let reads=0,value=accessor.data.value;Object.defineProperty(accessor.data,'value',{get(){reads++;return value;},set(next){value=next;},configurable:true});
 for(let i=0;i<2;i++)assert.equal(accessor.serialize(),legacy(accessor.node,accessor.data));assert.equal(accessor.calls,2);assert.equal(reads,4,'cache guard must not invoke the value accessor');
 const broken=fixture();broken.graph.getNodeById=()=>{throw Error('lookup unavailable');};for(let i=0;i<2;i++)assert.equal(broken.serialize(),legacy(broken.node,broken.data));assert.equal(broken.calls,2);
});

test('delegate errors keep captured-widget fallback and never become a reusable success',()=>{
 const h=fixture();let calls=0;const error=Error('read failed');h.data.serializeValue=bind(h.node,h.data,()=>{calls++;throw error;},helper.createTableWidgetSerializer);
 assert.equal(h.serialize(),h.data.value);assert.equal(h.serialize(),h.data.value);assert.equal(calls,2);
 const retained={unserializable:1n};h.data.value=retained;assert.equal(h.serialize(),retained);
 const original=Error('fallback getter failed');Object.defineProperty(h.data,'value',{get(){throw original;}});assert.throws(()=>h.serialize(),e=>e===original);
});

test('real install and coalesced lifecycle bind after attachment, normalize/save, and can hit after restore',async()=>{
 for(const [createdTickFinishesFirst,nativeGetter] of [[false,false],[true,false],[false,true],[true,true]]){
  const h=fixture(JSON.stringify(small()));h.node.graph=null;delete h.data.serializeValue;let calls=0,installs=0,renders=0;
  if(nativeGetter)nativeStringWidget(h);
  h.node.properties={};h.node.inputs.pop();h.node.addInput=(name,type)=>h.node.inputs.push({name,type,link:null});h.node.__dataTablePanel={render(){renders++;}};
  const environment={widget:(node,name)=>node.widgets?.find(w=>w.name===name),isGeneric:node=>node.type==='DAELAB.Table',dataName:node=>node.type==='DAELAB.Table'?'table_data':'storyboard_data',app:{canvas:{}},
   normalizeTable,createMaterialTable,preserveGenerationHistory,assertTransition,enableColumnPrompt,syncGenerationConfigOwners,ensureIdentity,NAMESPACE,isTableSource,
   promptField,promptFingerprint,isColumnPrompt,effectivePrompt,writeGenerationResults,clone:structuredClone,
   readTableView:node=>{calls++;return readTableView(node);},createTableWidgetSerializer:helper.createTableWidgetSerializer,notify:message=>{throw Error(message);}};
  for(const name of ['linkedReport','setWidget','hideNative','save'])environment[name]=owningFunction(name,environment);
  const install=owningFunction('install',environment),scheduled=node=>{installs++;install(node);};
  const proxy=new Proxy(h.node,{});scheduleTableInstall(proxy,scheduled); // owning onNodeCreated route
  if(createdTickFinishesFirst){await Promise.resolve();assert.equal(installs,0);assert.equal(h.data.serializeValue,undefined);}
  h.graph._nodes=[h.node];h.node.graph=h.graph;h.nodes.set(h.node.id,h.node);scheduleTableInstall(proxy,scheduled); // owning onAdded route
  h.data.value=JSON.stringify({...small(),meta:{material_columns:true,configured:'saved'}});scheduleTableInstall(proxy,scheduled); // onConfigure, same restore stack
  await Promise.resolve();assert.equal(installs,1);assert.equal(renders,1);assert.equal(JSON.parse(h.data.value).meta.configured,'saved');
  assert.equal(h.data.serializeValue(),h.data.value);assert.equal(h.data.serializeValue(),h.data.value);assert.equal(calls,1,'installed serializer must actually hit after normalize/save');
  const old=h.data.serializeValue;scheduleTableInstall(proxy,scheduled);await Promise.resolve();assert.notEqual(h.data.serializeValue,old);
  h.data.serializeValue();h.data.serializeValue();assert.equal(calls,2,'configure reinstalls a fresh proof');
  const saved=h.data.value,slot=h.node.inputs.findIndex(input=>input.name==='source_table');
  h.nodes.set('text',{id:'text',type:'DAELAB.TextInput'});h.graph.links[0]={origin_id:'text',origin_slot:0};h.node.inputs[slot].link=0;
  h.node.disconnectInput=index=>{delete h.graph.links[h.node.inputs[index].link];h.node.inputs[index].link=null;};
  assert.throws(()=>readTableView(h.node),/多维表格不可用/);
  scheduleTableInstall(proxy,scheduled);await Promise.resolve();
  assert.equal(h.node.inputs[slot].link,null);assert.equal(h.data.value,saved,'restoring an invalid input preserves table data');
  const upstream=fixture(canonical(small()),'upstream');h.nodes.set('upstream',upstream.node);h.graph.links[1]={origin_id:'upstream',origin_slot:0};h.node.inputs[slot].link=1;
  scheduleTableInstall(proxy,scheduled);await Promise.resolve();
  assert.equal(h.node.inputs[slot].link,1,'valid table sources remain connected');
 }
});

test('fixed native customtext getter can hit while store values and public hook identities stay live',()=>{
 const h=fixture(),native=nativeStringWidget(h);let calls=0;
 h.data.serializeValue=bind(h.node,h.data,node=>{calls++;return readTableView(node);},helper.createTableWidgetSerializer);
 assert.equal(h.serialize(),native.state.value);assert.equal(h.serialize(),native.state.value);assert.equal(calls,1);
 assert.equal(native.reads.length,3,'miss pre-read + original delegate, then one live getter for hit');assert.deepEqual(native.writes,[]);
 native.state.value=canonical({...small(),meta:{material_columns:true,next:true}});assert.equal(h.serialize(),native.state.value);assert.equal(h.serialize(),native.state.value);assert.equal(calls,2);assert.deepEqual(native.writes,[]);
 for(const change of [(h,n)=>{h.data.options.getValue=()=>n.state.value;},h=>{h.data.options={...h.data.options};},h=>{h.data.element={...h.data.element};},(h,n)=>{Object.defineProperty(h.data,'value',{get(){return n.state.value;},configurable:true});}]){
  const target=fixture(),native=nativeStringWidget(target);target.data.serializeValue=bind(target.node,target.data,target.read,helper.createTableWidgetSerializer);
  target.serialize();target.serialize();assert.equal(target.calls,1);change(target,native);
  assert.equal(target.serialize(),legacy(target.node,target.data));assert.equal(target.serialize(),legacy(target.node,target.data));assert.equal(target.calls,3,'each changed hook independently invalidates and cannot rearm the old installed proof');
 }
});

test('real document commits retain root serialization, history grouping, external changes and rollback',()=>{
 function run(useLegacy){
  const a=fixture(),b=fixture(canonical(small()),'2'),events=[],snapshots=[];let value=readTableView(a.node);
  if(useLegacy)for(const h of [a,b])h.data.serializeValue=()=>legacy(h.node,h.data,h.read);
  const graph={serialize(){events.push('root.serialize');const result={nodes:[a,b].map(h=>({id:h.node.id,widget:h.serialize()}))};snapshots.push(JSON.stringify(result));return result;}};
  const history={begin(){events.push('begin');graph.serialize();},end(){events.push('end');graph.serialize();},amend(write){events.push('amend');graph.serialize();write();graph.serialize();},undo(){events.push('undo');},redo(){events.push('redo');}};
  const doc=createBusinessDocument({read:()=>value,write:next=>{events.push('write');value=next;a.data.value=JSON.stringify(next);},current:()=>true,identity:()=>({workflowSession:'w',epoch:0,documentId:'1'}),history,historyStamp:()=>JSON.stringify(graph.serialize())});
  for(const text of ['one','two']){const next=structuredClone(value);next.records[0].values.f=text;doc.replace(next,{group:'typing',afterWrite:()=>events.push('observe')});}
  const other=JSON.parse(b.data.value);other.records[0].values.f='external native change';b.data.value=JSON.stringify(other);
  const next=structuredClone(value);next.records[0].values.f='three';doc.replace(next,{group:'typing',afterWrite:()=>events.push('observe')});
  const before=a.data.value;assert.throws(()=>doc.replace({...value,meta:{...value.meta,rejected:true}},{afterWrite(){throw Error('reject');}}),/reject/);assert.equal(a.data.value,before);
  doc.replace(value);doc.undo();doc.redo();return {events,snapshots,a:a.data.value,b:b.data.value,calls:a.calls+b.calls};
 }
 const old=run(true),candidate=run(false);assert.deepEqual({...candidate,calls:0},{...old,calls:0});assert.ok(candidate.calls<old.calls,'only repeated table delegates may decrease; graph/history calls remain');
});
