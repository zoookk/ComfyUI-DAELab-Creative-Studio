import test from 'node:test';
import assert from 'node:assert/strict';
import {bindInlineEditor} from '../../frontend/src/features/table/table_inline_editor.mjs';

// Execute the real box and cell listeners in DOM bubbling order. This model does
// not claim browser default Tab navigation, caret geometry or actual IME coverage.
function setup(t){
 const saved=new Map();
 const set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 class Element{
  constructor(name='DIV'){this.nodeName=name;this.nodeType=1;this.dataset={};this.attributes=new Map();this.listeners=new Map();this.children=[];this.parentNode=null;this.contentEditable='false';this.draggable=true;this.value='';this.style={};}
  get textContent(){return this.value;}
  remove(){if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}
  append(child){this.children.push(child);child.parentNode=this;}
  contains(node){return node===this||this.children.some(child=>child===node||child.contains?.(node));}
  addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==fn));}
  dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);if(event.bubbles&&!event.stopped)this.parentNode?.dispatchEvent(event);return !event.defaultPrevented;}
  emit(type,props={}){const event={type,target:this,bubbles:type!=='blur',preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...props};this.dispatchEvent(event);return event;}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.get(key)??null;}
  removeAttribute(key){this.attributes.delete(key);}
  querySelectorAll(){return [];}
  focus(){document.activeElement=this;}
 }
 const selection={rangeCount:0,anchorNode:null,removeAllRanges(){this.rangeCount=0;},addRange(range){this.range=range;this.anchorNode=range.startContainer;this.rangeCount=1;},getRangeAt(){return this.range;}};
 const doc={createElement:name=>new Element(name),activeElement:null,removeEventListener(){},createTextNode(text){return {nodeType:3,textContent:text};},createRange(){return {
  startContainer:null,selectNodeContents(node){this.startContainer=node;},collapse(){this.collapsed=true;},cloneRange(){return {...this};},
  deleteContents(){},insertNode(node){this.startContainer.append(node);this.startContainer.value+=node.textContent;},setStartAfter(node){this.startContainer=node.parentNode;}
 };}};
 set('document',doc);set('window',{removeEventListener(){}});set('getSelection',()=>selection);set('cancelAnimationFrame',()=>{});
 t.after(()=>{for(const[key,descriptor]of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
 function owner(initial='before'){
  const cell=new Element('TD'),box=new Element(),outside=new Element('BUTTON'),calls=[];cell.append(box);box.value=initial;let value=initial,starts=0;
  cell.addEventListener('dae-inline-edit-start',()=>starts++);
  const binding=bindInlineEditor({cell,box,label:'Edit owned value',read:()=>box.value,write:next=>{calls.push(['write',next]);value=next;},reset:()=>{calls.push(['reset']);value=initial;},draw:editing=>{calls.push(['draw',Boolean(editing)]);box.value=value;}});
  return {cell,box,outside,calls,binding,value:()=>value,starts:()=>starts};
 }
 return {owner,Element};
}

test('TD entry, input, Tab blur, return to preview and Enter reopen the same owner without rewriting its value',t=>{
 const {owner}=setup(t),a=owner('A'),b=owner('B');
 a.cell.emit('keydown',{key:'Enter'});assert.equal(a.box.contentEditable,'true');
 a.box.value='A changed';a.box.emit('input');
 const tab=a.box.emit('keydown',{key:'Tab'});assert.equal(tab.defaultPrevented,undefined);assert.equal(a.box.contentEditable,'true');
 a.outside.focus();a.box.emit('blur',{relatedTarget:a.outside});assert.equal(a.box.contentEditable,'false');
 // The browser's Shift+Tab default action returns focus; no synthetic handler
 // is asked to navigate. The following Enter really bubbles box -> owning TD.
 a.box.focus();a.box.setAttribute('aria-label','label changed by presentation');
 const enter=a.box.emit('keydown',{key:'Enter'});
 assert.equal(a.box.contentEditable,'true');assert.equal(enter.defaultPrevented,true);assert.equal(enter.stopped,true);
 assert.equal(document.activeElement,a.box);assert.equal(a.box.getAttribute('role'),'textbox');assert.equal(a.cell.dataset.inlineEditing,'true');assert.equal(a.starts(),2);
 assert.deepEqual(a.calls,[['draw',true],['write','A changed'],['draw',false],['draw',true]]);
 assert.equal(a.value(),'A changed');assert.equal(a.box.value,'A changed');assert.equal(b.box.contentEditable,'false');assert.equal(b.value(),'B');assert.deepEqual(b.calls,[]);
});

test('an exact inactive preview supports first entry independently in two instances',t=>{
 const {owner}=setup(t),a=owner('A'),b=owner('B');
 b.box.focus();b.box.emit('keydown',{key:'Enter'});assert.equal(b.box.contentEditable,'true');assert.equal(b.starts(),1);assert.equal(a.starts(),0);
 b.box.emit('blur',{relatedTarget:a.box});a.box.focus();a.box.emit('keydown',{key:'Enter'});
 assert.equal(a.box.contentEditable,'true');assert.equal(b.box.contentEditable,'false');assert.equal(a.starts(),1);assert.equal(b.starts(),1);assert.equal(a.value(),'A');assert.equal(b.value(),'B');
});

test('buttons, reference chips, nested spans and foreign targets do not activate the owning preview',t=>{
 const {owner,Element}=setup(t),a=owner(),b=owner('other');
 for(const name of ['BUTTON','SPAN','DIV']){
  const child=new Element(name);child.setAttribute('contenteditable','false');a.box.append(child);
  const event=child.emit('keydown',{key:'Enter'});assert.equal(event.defaultPrevented,undefined);assert.equal(a.starts(),0);
 }
 const button=new Element('BUTTON');a.cell.append(button);button.emit('keydown',{key:'Enter'});
 a.cell.emit('keydown',{key:'Enter',target:b.cell});a.cell.emit('keydown',{key:'Enter',target:b.box});
 a.box.emit('keydown',{key:' '});assert.equal(a.starts(),0);assert.equal(b.starts(),0);assert.deepEqual(a.calls,[]);
});

test('inactive entry rejects event composition flags on both TD and preview',t=>{
 const {owner}=setup(t);
 for(const targetName of ['cell','box'])for(const flags of [{isComposing:true},{keyCode:229}]){
  const a=owner();const event=a[targetName].emit('keydown',{key:'Enter',...flags});
  assert.equal(a.starts(),0);assert.equal(a.box.contentEditable,'false');assert.equal(event.defaultPrevented,undefined);assert.deepEqual(a.calls,[]);
 }
});

test('the internal composition lease also prevents inactive preview entry until composition ends',t=>{
 const {owner}=setup(t),a=owner();a.box.emit('compositionstart');
 a.box.emit('keydown',{key:'Enter'});assert.equal(a.starts(),0);assert.equal(a.box.contentEditable,'false');
 a.box.emit('compositionend');a.box.emit('keydown',{key:'Enter'});assert.equal(a.starts(),1);assert.equal(a.box.contentEditable,'true');
});

test('active Enter inserts one newline without a second start; IME Enter does not insert',t=>{
 const {owner}=setup(t),a=owner('text');a.cell.emit('keydown',{key:'Enter'});a.calls.length=0;
 a.box.emit('compositionstart');const composing=a.box.emit('keydown',{key:'Enter',isComposing:true,keyCode:229});
 assert.equal(composing.stopped,true);assert.equal(a.value(),'text');assert.deepEqual(a.calls,[]);
 a.box.emit('compositionend');a.calls.length=0;
 const enter=a.box.emit('keydown',{key:'Enter'});assert.equal(enter.defaultPrevented,true);assert.equal(a.value(),'text\n');assert.deepEqual(a.calls,[['write','text\n']]);assert.equal(a.starts(),1);assert.equal(a.box.contentEditable,'true');
});

test('a TD key while already editing does not intercept or restart editing',t=>{
 const {owner}=setup(t),a=owner();a.cell.emit('keydown',{key:'Enter'});a.calls.length=0;
 const enter=a.cell.emit('keydown',{key:'Enter'});assert.equal(enter.defaultPrevented,undefined);assert.equal(enter.stopped,undefined);assert.equal(a.starts(),1);assert.deepEqual(a.calls,[]);
});

test('disposal removes both TD and preview re-entry through the owning cell listener',t=>{
 const {owner}=setup(t),a=owner();a.cell.emit('keydown',{key:'Enter'});a.box.emit('blur',{relatedTarget:a.outside});a.binding.dispose();a.calls.length=0;
 a.box.emit('keydown',{key:'Enter'});a.cell.emit('keydown',{key:'Enter'});assert.equal(a.starts(),1);assert.equal(a.box.contentEditable,'false');assert.deepEqual(a.calls,[]);
});
