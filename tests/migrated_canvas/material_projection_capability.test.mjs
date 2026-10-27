import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function syntax(path){const source=readFileSync(new URL(path,import.meta.url),'utf8');return ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);}
function extract(tree,predicate){const found=[];function visit(node){if(predicate(node))found.push(node);ts.forEachChild(node,visit);}visit(tree);return found;}
const canvas=syntax('../../frontend/src/canvas/creative_canvas_view.mjs');
const projection=extract(canvas,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='projectMaterialPorts');assert.equal(projection.length,1);
const adapterSyntax=syntax('../../frontend/src/integrations/comfyui/business/creative_canvas_adapter.js');
const methods=extract(adapterSyntax,n=>ts.isMethodDeclaration(n)&&['materialTargets','projectedMaterialTargets'].includes(n.name.getText(adapterSyntax)));
const columnSyntax=syntax('../../frontend/src/application/table_material_columns.mjs');
const columnFunctions=extract(columnSyntax,n=>ts.isVariableDeclaration(n)&&['columnDropTypes','columnFillCount'].includes(n.name.getText(columnSyntax)));
function adapter(){return new Function(`const materialTargetCache=new WeakMap();${columnFunctions.map(n=>'const '+n.getText(columnSyntax)+';').join('\n')}return {${methods.map(n=>n.getText(adapterSyntax)).join(',\n')}};`)();}

function world(){
 const events=[],ports=[],portStarts=new WeakMap();let selected=null;
 function element(id,rect={left:20,top:80,width:180,height:40}){
  const classes=new Set(),attrs=new Map();
  const e={id,dataset:{},style:{},children:[],hidden:false,inert:false,disabled:false,rect:{...rect,right:rect.left+rect.width,bottom:rect.top+rect.height}};
  e.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)};
  e.closest=selector=>selector==='th'?(e.head||null):selector==='.dae-table-scroll'?e.scroll:null;
  e.getBoundingClientRect=()=>{events.push(['rect',id]);return e.rect;};e.contains=x=>x?.attached!==false;
  e.append=x=>{e.children.push(x);x.parentElement=e;};e.remove=()=>{e.removed=true;};
  e.setAttribute=(k,v)=>attrs.set(k,String(v));e.getAttribute=k=>attrs.get(k)??null;e.addEventListener=(type,fn)=>{e[type]=fn;};e.focus=()=>{e.focused=true;};
  return e;
 }
 const button=()=>{const p=element('port-'+ports.length);ports.push(p);return p;};
 const compile=new Function('adapterFor','button','state','portStarts','select','getComputedStyle',`const visible=true,wires={getScreenCTM:()=>({a:state.viewport.zoom})};let magneticPort=null;function setMagnet(value){magneticPort=value;} ${projection[0].getText(canvas)}return {run:projectMaterialPorts,setMagnet,get magnet(){return magneticPort;}};`);
 const api=compile(node=>node.adapter,button,{viewport:{zoom:.5}},portStarts,node=>{selected=node;},()=>({overflowX:'visible'}));
 function card(id,a){return {node:{id,title:'Table '+id,adapter:a,inputs:[{name:'source_table',link:null}],outputs:[{name:'table_json',slot_index:0,links:[]}]},body:element('body-'+id),element:element('card-'+id,{left:0,top:0,width:640,height:500})};}
 function snapshot(c){return [...(c.materialPorts?.values()||[])].map(({original,entry,port})=>({id:original.id,key:entry.key,side:entry.side,unknown:entry.unknown,slot:entry.slot,accepts:entry.accepts,callback:entry.previewElements,hidden:port.hidden,disabled:port.disabled,left:port.style.left,top:port.style.top,label:port.getAttribute('aria-label'),title:port.title}));}
 return {element,api,events,ports,card,snapshot,portStarts,get selected(){return selected;}};
}
function tableFixture(w,id,rows=500,fields=10){
 const scroll=w.element('scroll-'+id,{left:0,top:0,width:2500,height:800});let grid={dataset:{cellsRevision:'0'}};
 const columns=Array.from({length:fields},(_,i)=>{const e=w.element(`head-${id}-${i}`,{left:20+i*180,top:80,width:180,height:40});e.dataset.column='field-'+i;e.head=e;e.scroll=scroll;return e;});
 const cells=Array.from({length:rows*fields},(_,i)=>{const e=w.element(`cell-${id}-${i}`);e.dataset.field='field-'+i%fields;e.dataset.record='row-'+Math.floor(i/fields);e.scroll=scroll;return e;});
 const rowHeads=Array.from({length:rows},(_,i)=>{const e=w.element(`row-${id}-${i}`);e.dataset.contentRow='row-'+i;e.scroll=scroll;return e;});
 const root={querySelector:selector=>{assert.equal(selector,'table');return grid;},querySelectorAll:selector=>selector==='th[data-column]'?columns:selector==='td[data-field]'?cells:selector==='.table-choice[data-content-row]'?rowHeads:[]};
 const node={id,type:'DAELAB.Table',__dataTable:{fields:columns.map(e=>({id:e.dataset.column,type:'content'}))},__dataTablePanel:{root}};
 return {node,columns,cells,rowHeads,scroll,root,get grid(){return grid;},replaceGrid(){grid={dataset:{cellsRevision:'0'}};}};
}

test('explicit projected target capability avoids copying 5500 non-projected owned targets per 500x10 table',()=>{
 const w=world(),a=adapter();let reads=0;
 for(const id of [1,2]){
  const t=tableFixture(w,id),full=a.materialTargets(t.node);assert.equal(full.length,5510);
  for(const target of full)Object.defineProperty(target,'unknown',{enumerable:true,get(){reads++;return 'kept';}});
  const c=w.card(id,a);c.node=Object.assign(t.node,{adapter:a,title:'Table '+id,inputs:c.node.inputs,outputs:c.node.outputs});const native=JSON.stringify([c.node.inputs,c.node.outputs]);
  const before=reads;w.api.run(c);assert.equal(c.materialPorts.size,10);assert.equal(reads-before,10,'only explicitly projected targets should be snapshotted');
  assert.equal(JSON.stringify([c.node.inputs,c.node.outputs]),native,'projection never changes native slots');
  assert.equal(a.materialTargets(t.node),full,'complete public drop-target array remains stable');
  assert.equal(full.filter(x=>x.project===false).length,5500);assert(w.snapshot(c).every(x=>x.unknown==='kept'));
 }
 assert.equal(reads,20);assert.equal(w.ports.length,20);
});

test('optional capability dispatch preserves target-before-source snapshot order and unknown own fields',()=>{
 const w=world(),events=[],head=w.element('head'),source=w.element('source'),symbol=Symbol('future');let callbacks=0;
 const target={key:'target',element:head,project:true,slot:42,side:'wrong',get unknown(){events.push('target-copy');return {opaque:true};},previewElements(){callbacks++;},[symbol]:'symbol-value'};
 const a={materialTargets(){throw new Error('complete target capability must not be used');},projectedMaterialTargets(){events.push('projected');return [target];},materialSources(){events.push('sources');return [{element:source,key:'out',side:'wrong',unknown:'out-future'}];}};
 const c=w.card(1,a);w.api.run(c);assert.deepEqual(events,['projected','target-copy','sources']);
 const values=[...c.materialPorts.values()];assert.deepEqual(values.map(x=>[x.entry.key,x.entry.side]),[['target','input'],['out','output']]);
 assert.equal(values[0].entry[symbol],'symbol-value');assert.equal(values[0].entry.previewElements,target.previewElements);assert.equal(callbacks,0);assert.equal(values[0].entry.slot,42);
});

test('absent or non-function opt-in retains legacy inherited/non-enumerable/getter behavior and callback ordering',()=>{
 for(const optional of [undefined,false]){
  const w=world(),events=[];const inherited=Object.assign(Object.create({project:false}),{element:w.element('inherited'),key:'inherited'});
  const hidden=Object.defineProperty({element:w.element('hidden'),key:'hidden'},'project',{value:false,enumerable:false});
  const skipped={key:'skip',project:false,get unknown(){events.push('skipped-unknown');return 'kept';}};
  const getter={get key(){events.push('key');return 'getter';},get project(){events.push('project');return true;},element:w.element('getter'),get unknown(){events.push('unknown');return 'future';}};
  const a={projectedMaterialTargets:optional,materialTargets(){events.push('targets');return [inherited,hidden,skipped,getter];},materialSources(){events.push('sources');getter.element.disabled=true;return [];}};
  const c=w.card(1,a);w.api.run(c);assert.deepEqual(events,['targets','skipped-unknown','key','project','unknown','sources']);
  assert.deepEqual(w.snapshot(c).map(x=>x.key),['inherited','hidden','getter']);assert.equal(w.snapshot(c)[2].disabled,true);
 }
});

test('owned projected list shares exact column descriptors and same revision/grid invalidation without cross-owner cache',()=>{
 const w=world(),a=adapter(),left=tableFixture(w,1,2,3),right=tableFixture(w,2,2,3);assert.equal(typeof a.projectedMaterialTargets,'function');
 const full=a.materialTargets(left.node),projected=a.projectedMaterialTargets(left.node),other=a.projectedMaterialTargets(right.node);
 assert.equal(projected.length,3);assert(projected.every((v,i)=>v===full[i]));assert.equal(a.projectedMaterialTargets(left.node),projected);assert.equal(a.materialTargets(left.node),full);
 assert.deepEqual(projected[0].previewElements(1),[left.columns[0],left.cells[0],left.cells[3]]);
 assert.deepEqual(projected[0].accepts,['image','video']);
 left.columns.reverse();left.grid.dataset.cellsRevision='1';const reordered=a.projectedMaterialTargets(left.node);assert.notEqual(reordered,projected);assert.deepEqual(reordered.map(x=>x.key),['field-2','field-1','field-0']);
 assert.equal(a.projectedMaterialTargets(right.node),other);
 left.node.__dataTable.fields.find(f=>f.id==='field-1').hidden=true;left.grid.dataset.cellsRevision='2';assert.deepEqual(a.projectedMaterialTargets(left.node).map(x=>x.key),['field-2','field-0']);
 const previous=a.projectedMaterialTargets(left.node);left.replaceGrid();assert.notEqual(a.projectedMaterialTargets(left.node),previous);
 left.columns.length=0;left.cells.length=0;left.rowHeads.length=0;left.grid.dataset.cellsRevision='3';assert.deepEqual(a.projectedMaterialTargets(left.node),[]);assert.deepEqual(a.materialTargets(left.node),[]);
});

test('new capability preserves real projected DOM, geometry, focused port reuse and removal versus legacy path',()=>{
 const w=world(),a=adapter(),t=tableFixture(w,1,2,2),full=a.materialTargets(t.node);const newCard=w.card(1,a),oldCard=w.card(2,{materialTargets:()=>a.materialTargets(t.node)});newCard.node=Object.assign(t.node,{adapter:a,title:'Table 1'});
 w.api.run(oldCard);w.api.run(newCard);assert.deepEqual(w.snapshot(newCard),w.snapshot(oldCard));
 const original=t.columns[0],current=newCard.materialPorts.get(original).port;current.pointerdown({button:0,preventDefault(){},stopImmediatePropagation(){}});assert.equal(current.focused,true);assert.equal(w.selected,newCard.node);
 original.rect.left+=20;original.rect.right+=20;t.scroll.rect.right=100;original.disabled=true;w.api.run(oldCard);w.api.run(newCard);assert.deepEqual(w.snapshot(newCard),w.snapshot(oldCard));assert.equal(newCard.materialPorts.get(original).port,current);
 w.api.setMagnet(current);t.columns.splice(0,1);t.node.__dataTable.fields.splice(0,1);t.grid.dataset.cellsRevision='1';w.api.run(oldCard);w.api.run(newCard);assert.deepEqual(w.snapshot(newCard),w.snapshot(oldCard));assert.equal(current.removed,true);assert.equal(w.api.magnet,null);
 assert.equal(full.length,8,'old arrays remain intact for existing consumers');
});

test('non-table provider and missing table panel retain complete legacy targets without trusting stale table cache',()=>{
 const w=world(),a=adapter();assert.equal(typeof a.projectedMaterialTargets,'function');
 const future={project:false,get unknown(){throw new Error('do not eagerly inspect provider records');}};
 const video={type:'DAELAB.LibTV.VideoGenerate',__libtvPanel:{materialTargets:()=>[future]}};const result=a.projectedMaterialTargets(video);assert.equal(result[0],future);
 const t=tableFixture(w,1,2,2);a.projectedMaterialTargets(t.node);delete t.node.__dataTablePanel;assert.deepEqual(a.projectedMaterialTargets(t.node),[]);
});


test('provider exceptions remain synchronous and never invoke another target API or later source callback',()=>{
 for(const explicit of [false,true]){
  const w=world(),error=new Error('provider failed'),events=[];
  const a={materialTargets(){events.push('full');throw error;},materialSources(){events.push('sources');return [];}};
  if(explicit)a.projectedMaterialTargets=function(){events.push('projected');throw error;};
  const c=w.card(1,a);assert.throws(()=>w.api.run(c),e=>e===error);
  assert.deepEqual(events,[explicit?'projected':'full']);assert.equal(w.ports.length,0);assert.equal(c.materialPorts,undefined);
 }
});
