import test from 'node:test';
import assert from 'node:assert/strict';
import {bindInlineEditor} from '../../frontend/src/features/table/table_inline_editor.mjs';

// Real inline lifecycle with a small DOM model; browser default focus navigation
// and latency require separate actual validation.
function setup(t,columns){
 const saved=new Map(),calls=[];
 const set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 class Element{
  constructor(){this.dataset={};this.listeners=new Map();this.attributes=new Map();this.draggable=true;this.contentEditable='false';this.nodeType=1;this.value='before';this.textContent='before';this.children=[];}
  addEventListener(type,fn){const a=this.listeners.get(type)||[];a.push(fn);this.listeners.set(type,a);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
  dispatchEvent(e){for(const fn of this.listeners.get(e.type)||[])fn(e);return !e.defaultPrevented;}
  emit(type,props={}){const e={type,target:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...props};this.dispatchEvent(e);return e;}
  setAttribute(k,v){this.attributes.set(k,String(v));}removeAttribute(k){this.attributes.delete(k);}getAttribute(k){return this.attributes.get(k)??null;}
  querySelectorAll(){return [];}closest(){return null;}contains(n){return n===this||this.children.includes(n);}focus(){document.activeElement=this;}
 }
 const selection={rangeCount:0,anchorNode:null,removeAllRanges(){this.rangeCount=0;},addRange(r){this.range=r;this.anchorNode=r.startContainer;this.rangeCount=1;},getRangeAt(){return this.range;}};
 const doc={activeElement:null,removeEventListener(){},createRange(){return {startContainer:null,selectNodeContents(n){this.startContainer=n;},collapse(){},cloneRange(){return {...this};}};}};
 set('document',doc);set('window',{removeEventListener(){}});set('getSelection',()=>selection);set('cancelAnimationFrame',()=>{});
 t.after(()=>{for(const[k,d]of saved)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const cell=new Element(),box=new Element(),outside=new Element();cell.children.push(box);let model='before';
 const editor=bindInlineEditor({cell,box,columns,label:'Synthetic',read:()=>box.value,write:v=>{calls.push(['write',v]);model=v;},reset:()=>{calls.push(['reset']);model='before';},draw:editing=>{calls.push(['draw',Boolean(editing)]);box.value=model;}});
 const start=()=>{cell.emit('keydown',{key:'Enter'});calls.length=0;};
 return{cell,box,outside,editor,calls,start,model:()=>model};
}
test('plain input saves without reading layout-dependent selection; reference input retains selection lookup',t=>{
 const e=setup(t,()=>[]);e.start();let reads=0;const selection=globalThis.getSelection;globalThis.getSelection=()=>{reads++;return selection();};
 e.box.value=e.box.textContent='plain';e.box.emit('input');assert.equal(e.model(),'plain');assert.equal(reads,0);
 e.box.value=e.box.textContent='plain @';e.box.emit('input');assert.equal(e.model(),'plain @');assert.equal(reads,1);
});
for(const shiftKey of [false,true])test(`native ${shiftKey?'Shift+Tab':'Tab'} request leaves editing intact until actual outside blur, then closes once`,t=>{
  const e=setup(t);e.start();e.box.value='saved';e.box.emit('input');const key=e.box.emit('keydown',{key:'Tab',shiftKey});
  assert.equal(key.defaultPrevented,undefined);assert.equal(e.box.contentEditable,'true');assert.equal(e.cell.dataset.inlineEditing,'true');assert.equal(e.box.getAttribute('role'),'textbox');assert.equal(e.model(),'saved');
  e.box.emit('blur',{relatedTarget:e.outside});assert.equal(e.box.contentEditable,'false');assert.equal(e.cell.dataset.inlineEditing,undefined);assert.equal(e.cell.draggable,true);assert.equal(e.box.getAttribute('role'),null);assert.equal(e.model(),'saved');
  e.box.emit('blur',{relatedTarget:e.outside});assert.deepEqual(e.calls,[['write','saved'],['draw',false]]);
});
test('a canceled Tab does not terminate the current edit before focus actually leaves',t=>{
 const e=setup(t);e.start();e.box.emit('keydown',{key:'Tab',defaultPrevented:true});assert.equal(e.box.contentEditable,'true');assert.deepEqual(e.calls,[]);e.box.value='after-cancel';e.box.emit('input');assert.equal(e.model(),'after-cancel');
});
test('focus moving inside an editor preserves editing and a later external blur closes it',t=>{
 const e=setup(t),child={};e.box.children.push(child);e.start();e.box.emit('keydown',{key:'Tab'});e.box.emit('blur',{relatedTarget:child});assert.equal(e.box.contentEditable,'true');assert.deepEqual(e.calls,[]);e.box.emit('blur',{relatedTarget:e.outside});assert.equal(e.box.contentEditable,'false');
});
test('IME Tab remains owned and only compositionend persists before a later external blur',t=>{
 const e=setup(t);e.start();e.box.emit('compositionstart');e.box.value='中文';e.box.emit('input');const key=e.box.emit('keydown',{key:'Tab',isComposing:true,keyCode:229});e.box.emit('blur',{relatedTarget:e.outside});assert.equal(key.stopped,true);assert.equal(e.box.contentEditable,'true');assert.deepEqual(e.calls,[]);
 e.box.emit('compositionend');assert.equal(e.model(),'中文');e.box.emit('blur',{relatedTarget:e.outside});assert.deepEqual(e.calls,[['write','中文'],['draw',false]]);
});
test('Escape still restores through the owner and explicitly focuses the cell',t=>{
 const e=setup(t);e.start();e.box.value='changed';e.box.emit('input');const key=e.box.emit('keydown',{key:'Escape'});assert.equal(key.defaultPrevented,true);assert.equal(e.model(),'before');assert.equal(e.box.contentEditable,'false');assert.equal(document.activeElement,e.cell);assert.deepEqual(e.calls,[['write','changed'],['reset'],['draw',false]]);
});
test('ordinary external blur and explicit finish retain existing non-Tab lifecycle',t=>{
 const e=setup(t);e.start();e.box.emit('blur',{relatedTarget:e.outside});assert.equal(e.box.contentEditable,'false');assert.deepEqual(e.calls,[['draw',false]]);e.start();e.editor.finish();assert.equal(e.box.contentEditable,'false');assert.deepEqual(e.calls,[['draw',false]]);
});
