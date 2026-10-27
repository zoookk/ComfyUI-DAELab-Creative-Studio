import test from 'node:test';
import assert from 'node:assert/strict';
import {renderContentCell} from '../../frontend/src/features/table/table_content_view.mjs';

// Run the real renderer and inline lifecycle. This small DOM records mutations
// and node identity, not browser layout, native selection behavior or latency.
function dom(t){
 const writes=[],previous=new Map();let selection;
 class Text {
  constructor(value){this.nodeType=3;this.nodeName='#text';this.nodeValue=String(value);this.parentNode=null;}
  get textContent(){return this.nodeValue;}set textContent(value){this.nodeValue=String(value);}
  get parentElement(){return this.parentNode;}
 }
 class Element {
  constructor(tag){this.nodeType=1;this.nodeName=this.tagName=tag.toUpperCase();this.childNodes=[];this.parentNode=null;this.dataset={};this.attrs=new Map();this.listeners=new Map();this.className='';this.draggable=false;this.contentEditable='inherit';this.isConnected=true;this.style={};
   this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:name=>this.classList.toggle(name,true),toggle:(name,force)=>{writes.push([this,'class',name,force]);const all=new Set(this.className.split(/\s+/).filter(Boolean));const enabled=force??!all.has(name);enabled?all.add(name):all.delete(name);this.className=[...all].join(' ');return enabled;}};
  }
  get parentElement(){return this.parentNode;}get firstChild(){return this.childNodes[0]??null;}get lastChild(){return this.childNodes.at(-1)??null;}
  get textContent(){return this.childNodes.map(n=>n.textContent).join('');}
  set textContent(value){writes.push([this,'textContent',value]);this.replaceChildren(...(value==null||String(value)===''?[]:[new Text(value)]));}
  append(...nodes){writes.push([this,'append']);for(const node of nodes){if(node.parentNode)node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node),1);node.parentNode=this;this.childNodes.push(node);}}
  prepend(...nodes){for(const node of nodes.reverse()){node.parentNode=this;this.childNodes.unshift(node);}}
  replaceChildren(...nodes){writes.push([this,'replaceChildren']);for(const node of this.childNodes)node.parentNode=null;this.childNodes=[];this.append(...nodes);}
  contains(node){return node===this||this.childNodes.some(n=>n===node||n.contains?.(node));}
  setAttribute(name,value){this.attrs.set(name,String(value));if(name==='contenteditable')this.contentEditable=String(value);}
  getAttribute(name){return this.attrs.get(name)??null;}removeAttribute(name){this.attrs.delete(name);}
  addEventListener(type,fn){const set=this.listeners.get(type)??new Set();set.add(fn);this.listeners.set(type,set);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  dispatchEvent(event){for(const fn of [...(this.listeners.get(event.type)??[])])fn(event);return !event.defaultPrevented;}
  emit(type,props={}){const event={type,target:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...props};this.dispatchEvent(event);return event;}
  querySelectorAll(selector){const result=[];for(const node of this.childNodes){if(node.nodeType!==1)continue;if(selector==='[contenteditable=false]'&&node.contentEditable==='false'||selector==='.dae-prompt-ref[contenteditable="false"]'&&node.classList.contains('dae-prompt-ref')&&node.contentEditable==='false')result.push(node);result.push(...node.querySelectorAll(selector));}return result;}
  closest(selector){if(selector==='button')return this.tagName==='BUTTON'?this:this.parentNode?.closest(selector)??null;return null;}
  focus(){document.activeElement=this;}remove(){if(this.parentNode)this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;this.isConnected=false;}
 }
 class Range {
  constructor(){this.collapsed=true;this.startContainer=null;this.endContainer=null;this.startOffset=0;this.endOffset=0;}
  selectNodeContents(node){this.startContainer=this.endContainer=node;this.startOffset=0;this.endOffset=node.nodeType===3?node.textContent.length:node.childNodes.length;this.collapsed=false;}
  collapse(start){if(!start)this.startOffset=this.endOffset;this.endOffset=this.startOffset;this.collapsed=true;}
  cloneRange(){return Object.assign(new Range(),this);}
  deleteContents(){if(!this.collapsed){if(this.startContainer.nodeType===1)this.startContainer.replaceChildren();else this.startContainer.textContent=this.startContainer.textContent.slice(0,this.startOffset)+this.startContainer.textContent.slice(this.endOffset);this.endOffset=this.startOffset;this.collapsed=true;}}
  insertNode(node){const current=this.startContainer;if(current.nodeType===1){node.parentNode=current;current.childNodes.splice(this.startOffset,0,node);}else{const parent=current.parentNode,index=parent.childNodes.indexOf(current),after=new Text(current.textContent.slice(this.startOffset));current.textContent=current.textContent.slice(0,this.startOffset);node.parentNode=after.parentNode=parent;parent.childNodes.splice(index+1,0,node,after);}}
  setStartAfter(node){this.startContainer=this.endContainer=node.parentNode;this.startOffset=this.endOffset=node.parentNode.childNodes.indexOf(node)+1;this.collapsed=true;}
 }
 selection={rangeCount:0,anchorNode:null,removeAllRanges(){this.rangeCount=0;this.anchorNode=null;},addRange(range){this.range=range;this.rangeCount=1;this.anchorNode=range.startContainer;},getRangeAt(){return this.range;}};
 const document={activeElement:null,createElement:tag=>new Element(tag),createTextNode:value=>new Text(value),createRange:()=>new Range(),removeEventListener(){},addEventListener(){}};
 for(const [name,value] of [['document',document],['window',{addEventListener(){},removeEventListener(){}}],['getSelection',()=>selection],['cancelAnimationFrame',()=>{}]]){previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});}
 t.after(()=>{for(const [name,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 return {Element,Text,writes,selection,reset(){writes.length=0;},mutations(box){return writes.filter(([element])=>element===box);}};
}

function cell(env,id,value,{type='content',readonly=false}={}){
 const field={id:'f',name:'Text',type,readonly},row={id,values:{f:value}},table={fields:[field],records:[row],meta:{}};
 const cell=new env.Element('td');cell.draggable=true;cell.dataset.recordId=id;
 const changes=[],cleanups=[],errors=[];
 renderContentCell(cell,row,field,{getTable:()=>table,change:(fn,options)=>{changes.push(options);fn(table);},upload:async()=>{throw Error('Unexpected upload');},notify:error=>errors.push(error),onCleanup:fn=>cleanups.push(fn)});
 const box=cell.firstChild;
 return {cell,box,row,table,changes,errors,start(){cell.emit('keydown',{key:'Enter'});},tab(){const event=box.emit('keydown',{key:'Tab'});box.emit('blur',{relatedTarget:null});return event;},blur(){box.emit('blur',{relatedTarget:null});},dispose(){for(const fn of cleanups)fn();}};
}

test('two instances retain the exact single Text through unchanged Enter/Tab and ordinary input',t=>{
 const env=dom(t),a=cell(env,'A','alpha'),b=cell(env,'B','beta'),aText=a.box.firstChild,bText=b.box.firstChild;
 env.reset();a.start();assert.equal(a.box.firstChild,aText);assert.deepEqual(env.mutations(a.box),[]);
 assert.equal(a.box.contentEditable,'true');assert.equal(a.box.getAttribute('role'),'textbox');assert.equal(a.cell.dataset.inlineEditing,'true');assert.equal(a.cell.draggable,false);assert.equal(document.activeElement,a.box);
 aText.textContent='changed';a.box.emit('input');assert.equal(a.row.values.f,'changed');env.reset();a.tab();
 assert.equal(a.box.firstChild,aText);assert.deepEqual(env.mutations(a.box),[]);assert.equal(a.box.contentEditable,'false');assert.equal(a.box.getAttribute('role'),null);assert.equal(a.cell.dataset.inlineEditing,undefined);assert.equal(a.cell.draggable,true);
 b.start();b.tab();assert.equal(b.box.firstChild,bText);assert.deepEqual(env.mutations(b.box),[]);assert.equal(b.row.values.f,'beta');assert.equal(b.changes.length,0);assert.equal(a.changes.length,1);
});

for(const type of ['text','longtext'])test(`${type} uses inline multiline editing while preserving string values and cancel`,t=>{
 const env=dom(t),h=cell(env,type,'原文',{type});
 assert.equal(h.cell.childNodes.length,1,'plain text has no upload or separate input controls');
 h.start();h.box.emit('keydown',{key:'Enter'});h.box.emit('paste',{clipboardData:{getData:()=>'<b>第二行</b>'}});h.blur();
 assert.equal(h.row.values.f,'原文\n<b>第二行</b>');assert.equal(typeof h.row.values.f,'string');
 h.start();h.box.firstChild.textContent='未保存';h.box.emit('input');h.box.emit('keydown',{key:'Escape'});
 assert.equal(h.row.values.f,'原文\n<b>第二行</b>');assert.equal(h.box.contentEditable,'false');assert.deepEqual(h.errors,[]);h.dispose();
});

test('different model text, external class changes and non-string values use normalization',t=>{
 const env=dom(t),h=cell(env,'A','same');const first=h.box.firstChild;
 h.row.values.f='external';h.start();assert.notEqual(h.box.firstChild,first);assert.equal(h.box.textContent,'external');h.tab();
 for(const classes of ['content-display','content-display content-text content-materials']){h.box.className=classes;const old=h.box.firstChild;h.start();assert.notEqual(h.box.firstChild,old);assert.equal(h.box.classList.contains('content-text'),true);assert.equal(h.box.classList.contains('content-materials'),false);h.tab();}
 for(const value of [null,42,{unknown:true},new String('external')]){h.row.values.f=value;h.start();assert.equal(h.box.textContent,'');h.tab();}
});

test('empty, split, nested, BR, comment and reference DOM never take the plain Text shortcut',t=>{
 const env=dom(t);
 const cases=[()=>[],()=>[new env.Text('sa'),new env.Text('me')],()=>{const n=new env.Element('span');n.textContent='same';return[n];},()=>[new env.Text('same'),new env.Element('br')],()=>[new env.Text('same'),{nodeType:8,textContent:'',parentNode:null}],()=>{const n=new env.Element('span');n.className='dae-prompt-ref';n.contentEditable='false';n.dataset.fieldId='source';n.textContent='same';return[n];}];
 for(const build of cases){const h=cell(env,'A','same');h.box.replaceChildren(...build());const old=[...h.box.childNodes];env.reset();h.start();assert.equal(h.box.textContent,'same');assert.equal(h.box.childNodes.length,1);assert.equal(h.box.firstChild.nodeType,3);assert.ok(!old.includes(h.box.firstChild));assert.ok(env.mutations(h.box).length>0);h.tab();}
 const empty=cell(env,'empty','');empty.box.append(new env.Text(''));empty.start();assert.equal(empty.box.childNodes.length,0);empty.tab();assert.equal(empty.box.childNodes.length,0);
});

test('structured references keep reference redraw and stale media cleanup is never skipped',t=>{
 const env=dom(t),doc={kind:'column-template',version:1,segments:[{type:'text',text:'lead '},{type:'column',fieldId:'missing'}]},rich=cell(env,'rich',doc);
 const chip=rich.box.lastChild;rich.start();assert.notEqual(rich.box.lastChild,chip);assert.equal(rich.box.lastChild.dataset.fieldId,'missing');assert.equal(rich.box.lastChild.contentEditable,'false');rich.tab();assert.deepEqual(rich.row.values.f,doc);
 const media=cell(env,'media',[{id:'img',url:'/view?filename=synthetic.png',kind:'image'}]);const image=media.box.firstChild.firstChild.firstChild;
 assert.equal(image.listeners.get('load').size,1);media.box.replaceChildren(new env.Text('same'));media.box.className='content-display content-text';media.row.values.f='same';const forged=media.box.firstChild;
 media.start();assert.notEqual(media.box.firstChild,forged);assert.equal(image.listeners.get('load').size,0);assert.equal(media.cell.listeners.get('dae-cell-selection-change').size,0);media.tab();media.dispose();
});

test('real inline IME, Enter, paste, Escape and disposal keep lifecycle and transaction callbacks',t=>{
 const env=dom(t),h=cell(env,'A','initial');h.start();const initial=h.box.firstChild;
 h.box.emit('compositionstart');initial.textContent='IME';h.box.emit('input');assert.equal(h.changes.length,0);const ignored=h.box.emit('keydown',{key:'Tab',isComposing:true});assert.equal(ignored.stopped,true);assert.equal(h.box.contentEditable,'true');
 h.box.emit('compositionend');assert.equal(h.row.values.f,'IME');env.reset();h.blur();assert.equal(h.box.firstChild,initial);assert.deepEqual(env.mutations(h.box),[]);
 h.start();h.box.emit('keydown',{key:'Enter'});assert.equal(h.row.values.f,'IME\n');assert.ok(h.box.childNodes.length>1);h.tab();assert.equal(h.box.childNodes.length,1);assert.equal(h.box.textContent,'IME\n');
 h.start();h.box.emit('paste',{clipboardData:{getData:()=>'<b>plain</b>'}});assert.equal(h.row.values.f,'IME\n<b>plain</b>');h.box.emit('keydown',{key:'Escape'});assert.equal(h.row.values.f,'IME\n');assert.equal(h.box.textContent,'IME\n');assert.equal(document.activeElement,h.cell);
 h.dispose();h.start();assert.equal(h.box.contentEditable,'false');assert.equal(h.cell.listeners.get('keydown').size,0);assert.deepEqual(h.errors,[]);
 const readonly=cell(env,'readonly','saved',{readonly:true});const before=readonly.box.firstChild;readonly.start();readonly.box.emit('input');assert.equal(readonly.box.firstChild,before);assert.equal(readonly.changes.length,0);
});

test('external value changes during editing still reject stale writes and redraw on exit',t=>{
 const env=dom(t),h=cell(env,'A','original');h.start();const editingText=h.box.firstChild;
 h.row.values.f='external';editingText.textContent='local draft';h.box.emit('input');
 assert.equal(h.row.values.f,'external');assert.equal(h.changes.length,0);assert.equal(h.errors.length,1);assert.equal(h.box.getAttribute('aria-invalid'),'true');
 h.tab();assert.equal(h.box.textContent,'external');assert.notEqual(h.box.firstChild,editingText);assert.equal(h.box.getAttribute('aria-invalid'),null);
 h.start();h.box.firstChild.textContent='accepted';h.box.emit('input');h.tab();assert.equal(h.row.values.f,'accepted');assert.equal(h.changes.length,1);
 const restored=cell(env,'restored',JSON.parse(JSON.stringify(h.table)).records[0].values.f);assert.equal(restored.box.textContent,'accepted');
});
