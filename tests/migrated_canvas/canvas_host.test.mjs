import '../migrated_business/register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
const {canvasHistory,installLayoutHistory}=await import('../../frontend/src/integrations/comfyui/canvas/creative_history.mjs');
import {installComfyTVAdapter} from '../../frontend/src/integrations/comfyui/canvas/adapters/comfytv.mjs';
import {suppressGroupSlots,GROUP_TYPE} from '../../frontend/src/features/groups/material_group_model.mjs';

// Exercise the actual typed adapter without checking generated web files into source.
const source=new URL('../../frontend/src/integrations/comfyui/canvas/canvas_host.ts',import.meta.url);
const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {createCanvasHostPort,enterCanvasGraphMode}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

function fixture(){
  const events=[],diagnostics=[],nodes=[];
  const graph={extra:{unknown:{keep:true}},_nodes:nodes,
    getNodeById:id=>nodes.find(n=>n.id===id),
    serialize(){return {nodes:nodes.map(n=>({id:n.id})),extra:this.extra};},
    add(n){nodes.push(n);n.graph=this;events.push('add');},
    remove(n){nodes.splice(nodes.indexOf(n),1);events.push('remove');},
    removeLink(id){events.push(['removeLink',id]);},
    change(){events.push('changed');},setDirtyCanvas(){events.push('redraw');},
  };
  const tracker={changeCount:0,initialState:{},activeState:{},undoQueue:[],redoQueue:[],
    captureCanvasState(){events.push('capture');},squashState:{flush(){events.push('flush');}},
    beforeChange(){this.changeCount++;events.push('begin');},afterChange(){this.changeCount--;events.push('end');},
    undo(){events.push('undo');},redo(){events.push('redo');},updateModified(){events.push('modified');},
  };
  const app={graph,rootGraph:graph,canvas:{setDirty(){events.push('native-redraw');}},
    api:{async fetchApi(url,options){events.push([url,options]);return {ok:true};}},
    extensionManager:{workflow:{activeWorkflow:{activeMode:'graph',changeTracker:tracker}}},
  };
  const diagnose=d=>diagnostics.push(d),history=canvasHistory(app,{diagnose});
  const definition={nodeData:{input:{required:{name:['STRING']}}}};
  const registry={registered_node_types:{'Test.Node':definition},createNode(type){
    return {id:String(nodes.length+1),type,
      configure(data){Object.assign(this,data);},
      connect(output,target,input){const link={source:this.id,output,target:target.id,input};events.push(link);return link;},
    };
  }};
  const host=createCanvasHostPort(app,registry,history,diagnose);
  return {host,history,app,graph,tracker,events,diagnostics,diagnose,registry,definition};
}

test('host port borrows the native graph and delegates original slot indices without a shadow graph',async()=>{
  const {host,graph,app,events,definition}=fixture();
  assert.equal(host.graph(),graph);assert.equal(host.nodes(graph),graph._nodes);
  assert.equal(host.nodeDefinition('Test.Node'),definition);
  host.history.begin();
  const a=host.createNode('Test.Node');host.addNode(graph,a);
  const b=host.createNode('Test.Node');host.addNode(graph,b);
  const raw={unknown:{value:'preserve'},outputs:[{links:[17]}],inputs:[{link:17}]};
  host.configureNode(a,raw);
  assert.equal(a.unknown,raw.unknown);assert.equal(a.outputs,raw.outputs);
  assert.deepEqual(host.connect(graph,a,3,b,7),{source:a.id,output:3,target:b.id,input:7});
  host.history.end();
  assert.equal(events.filter(e=>e==='begin').length,2);
  assert.equal(events.filter(e=>e==='end').length,2);
  let callback;
  const widget={value:'before',callback(...args){callback=args;}},event=new Event('change');
  host.setWidgetValue(graph,a,widget,'after',event);
  assert.deepEqual(callback,['after',app.canvas,a,null,event]);
  assert.equal(await host.runAction({run(node,nativeApp){assert.equal(nativeApp,app);return node;}},a),a);
  assert.equal(host.serialize(graph).extra,graph.extra);
  host.removeLink(graph,17);host.removeNode(graph,b);
  assert.deepEqual(graph._nodes,[a]);assert.deepEqual(graph.extra.unknown,{keep:true});
});

for(const missing of ['serialize','captureCanvasState','beforeChange','afterChange','flush']){
  test(`missing ${missing} diagnoses and refuses editing before graph/widget changes`,()=>{
    const {host,graph,tracker,diagnostics,events}=fixture();
    if(missing==='serialize')delete graph.serialize;
    else if(missing==='flush')delete tracker.squashState.flush;
    else delete tracker[missing];
    assert.throws(()=>host.createNode('Test.Node'),/宿主缺少/);
    assert.throws(()=>host.history.begin(),/宿主缺少/);
    assert.equal(graph._nodes.length,0);assert.deepEqual(events,[]);
    assert.ok(diagnostics.length>=2);assert.equal(diagnostics[0].code,'canvas-host-capability');
    assert.match(diagnostics[0].capability,missing==='serialize'?/serialization/:new RegExp(missing));
  });
}

test('missing history refuses derived changes instead of executing an untracked mutation',()=>{
  const {history,app,diagnostics}=fixture();
  delete app.extensionManager.workflow.activeWorkflow.changeTracker;
  let changed=false;
  assert.throws(()=>history.amend(()=>{changed=true;}),/history.captureCanvasState/);
  assert.equal(changed,false);assert.equal(diagnostics.length,1);
});

test('stale graph and removed widget owners cannot mutate a replacement workflow',()=>{
  const {host,app,graph,events,diagnostics}=fixture();
  const node=host.createNode('Test.Node');host.addNode(graph,node);
  graph.remove(node);const widget={value:'original'};
  assert.throws(()=>host.setWidgetValue(graph,node,widget,'wrong',new Event('change')),/live-widget-owner/);
  assert.equal(widget.value,'original');
  app.graph={...graph,_nodes:[]};events.length=0;
  assert.throws(()=>host.addNode(graph,node),/工作流已切换/);
  host.changed(graph);host.redraw(graph); // Disposing the old view is harmless.
  assert.deepEqual(events,[]);assert.equal(app.graph._nodes.length,0);
  assert.equal(diagnostics.at(-1).code,'canvas-host-stale');
});

test('an edit closes its original tracker when the active workflow changes',()=>{
  const {history,app,tracker,events}=fixture();
  history.begin();const replacement={...tracker,afterChange(){throw new Error('wrong tracker');}};
  app.extensionManager.workflow.activeWorkflow.changeTracker=replacement;
  history.end();assert.equal(tracker.changeCount,0);assert.equal(events.at(-1),'end');
});

test('navigation updates only view coordinates and keeps undo/redo and editable fields',()=>{
  const {history,tracker,events}=fixture();
  const a={extra:{daelabCreativeCanvasV1:{cards:{one:{x:1}},viewport:{x:0,y:0,zoom:1},unknown:'keep'}}};
  const b=structuredClone(a);tracker.initialState=a;tracker.activeState=a;tracker.undoQueue=[b];tracker.redoQueue=[a,b];
  const undo=tracker.undoQueue,redo=tracker.redoQueue;
  history.updateViewport({x:2,y:3,zoom:.5});
  assert.equal(tracker.undoQueue,undo);assert.equal(tracker.redoQueue,redo);assert.deepEqual(events,[]);
  assert.deepEqual(b.extra.daelabCreativeCanvasV1,{cards:{one:{x:1}},viewport:{x:2,y:3,zoom:.5},unknown:'keep'});
});

test('ordinary startup/load delegates without touching an uninitialized graph getter',async()=>{
  let calls=0;
  const app={get graph(){throw new Error('ComfyApp graph accessed before initialization');},
    async loadGraphData(...args){calls++;return args;}};
  const original={nodes:[],extra:{unknown:{keep:true}}};installLayoutHistory(app);
  const result=await app.loadGraphData(original);assert.equal(result[0],original);assert.equal(calls,1);
  await app.loadGraphData(original,false,false,null);assert.equal(calls,2);
});

test('layout-only history restores preserve native nodes, panel owners, cards and other workflow fields',async()=>{
  const {app,graph,tracker}=fixture();let loads=0,syncs=0;
  const owner={id:'1',properties:{daelabLayoutRevision:1,unknown:{keep:true}},panel:{keep:true}};
  graph._nodes.push(owner);
  graph.serialize=()=>({nodes:[{id:owner.id,properties:owner.properties}],extra:graph.extra});
  graph.extra.daelabCreativeCanvasV1={active:true,cards:{'1':{x:10,y:20}},viewport:{x:1,y:2,zoom:1}};
  const card=graph.extra.daelabCreativeCanvasV1.cards['1'],panel=owner.panel;
  tracker.workflow={};tracker._restoringState=true;
  app.daelabCreativeCanvas={active:true,sync(){syncs++;}};
  app.loadGraphData=async()=>{loads++;};installLayoutHistory(app);
  const snapshot=structuredClone(graph.serialize());snapshot.extra.daelabCreativeCanvasV1.cards['1'].x=50;
  snapshot.nodes[0].properties.daelabLayoutRevision=2;
  await app.loadGraphData(snapshot,false,false,tracker.workflow);
  assert.equal(loads,0);assert.equal(syncs,1);assert.equal(graph._nodes[0],owner);assert.equal(owner.panel,panel);
  assert.equal(graph.extra.daelabCreativeCanvasV1.cards['1'],card);assert.equal(card.x,50);
  assert.equal(owner.properties.daelabLayoutRevision,2);assert.deepEqual(graph.extra.unknown,{keep:true});
  const edit=structuredClone(snapshot);edit.nodes[0].properties.unknown.keep=false;
  await app.loadGraphData(edit,false,false,tracker.workflow);assert.equal(loads,1);
});

test('optional ComfyTV registration never reads the host graph before initialization',()=>{
  const registrations=[];
  installComfyTVAdapter({get graph(){throw new Error('graph not initialized');},registerExtension:extension=>registrations.push(extension)});
  assert.equal(registrations.length,1);assert.equal(typeof registrations[0].beforeRegisterNodeDef,'function');
});

test('mode capability failure rejects overlay entry and supported app mode uses the native command',async()=>{
  const diagnostics=[];await assert.rejects(enterCanvasGraphMode({},d=>diagnostics.push(d)),/mode/);
  const app={extensionManager:{workflow:{activeWorkflow:{activeMode:'app',initialMode:null}}}};
  await assert.rejects(enterCanvasGraphMode(app,d=>diagnostics.push(d)),/mode/);
  assert.equal(diagnostics.length,2);const commands=[];
  app.extensionManager.command={execute:id=>{commands.push(id);app.extensionManager.workflow.activeWorkflow.activeMode='graph';}};
  await enterCanvasGraphMode(app,d=>diagnostics.push(d));assert.deepEqual(commands,['Comfy.ToggleLinear']);
  app.extensionManager.workflow.activeWorkflow.activeMode='graph';
  await enterCanvasGraphMode(app,d=>diagnostics.push(d));assert.equal(commands.length,1);
  app.extensionManager.workflow.activeWorkflow.activeMode=null;
  await enterCanvasGraphMode(app,d=>diagnostics.push(d));assert.equal(commands.length,1);
  app.extensionManager.workflow.activeWorkflow.initialMode='unknown-mode';
  await assert.rejects(enterCanvasGraphMode(app,d=>diagnostics.push(d)),/mode/);
  assert.equal(commands.length,1);
});

test('native null mode supports an omitted initialMode but missing/unknown capabilities still reject',async()=>{
  const diagnostics=[],workflow={activeMode:null};
  const app={extensionManager:{workflow:{activeWorkflow:workflow}}};
  await enterCanvasGraphMode(app,d=>diagnostics.push(d));
  assert.equal(diagnostics.length,0);assert.equal(workflow.activeMode,null);
  for(const candidate of [null,{}, {initialMode:'graph'}, {activeMode:undefined}, {activeMode:'builder:arrange'}, {activeMode:null,initialMode:'future-mode'}]){
    app.extensionManager.workflow.activeWorkflow=candidate;
    await assert.rejects(enterCanvasGraphMode(app,d=>diagnostics.push(d)),/mode/);
  }
  app.extensionManager.workflow.activeWorkflow=workflow;app.isGraphReady=false;
  await assert.rejects(enterCanvasGraphMode(app,d=>diagnostics.push(d)),/mode/);
  assert.equal(diagnostics.length,7);
});

test('native app command must actually enter graph mode on the same workflow',async()=>{
  const diagnostics=[],workflow={activeMode:'app'};
  const app={extensionManager:{workflow:{activeWorkflow:workflow},command:{execute:async()=>{}}}};
  await assert.rejects(enterCanvasGraphMode(app,d=>diagnostics.push(d)),/mode/);
  app.extensionManager.command.execute=async()=>{throw new Error('native failure');};
  await assert.rejects(enterCanvasGraphMode(app,d=>diagnostics.push(d)),/mode/);
  app.extensionManager.command.execute=async()=>{
    workflow.activeMode='graph';app.extensionManager.workflow.activeWorkflow={activeMode:'graph'};
  };
  await assert.rejects(enterCanvasGraphMode(app,d=>diagnostics.push(d)),/mode/);
  assert.equal(diagnostics.length,3);
});

function canvasExtensionFixture(){
  const calls=[],workflow={activeMode:null,initialMode:null},graph={extra:{daelabCreativeCanvasV1:{active:true}}};
  const app={isGraphReady:true,graph,extensionManager:{workflow:{activeWorkflow:workflow}},registerExtension(extension){this.extension=extension;}};
  const view={active:false,show(){this.active=true;calls.push('show');},hide(persist){this.active=false;calls.push(['hide',persist]);}};
  const entry=readFileSync(new URL('../../frontend/src/integrations/comfyui/canvas/creative_canvas.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?$/gm,'').replaceAll('import.meta.url',JSON.stringify('file:///test/creative_canvas.js'));
  const noop=()=>{};
  const bound=new Function('app','enterCanvasGraphMode','publishAPI','publishInputExchange','publishPanelContext','installComfyTVAdapter','document','console','STATE_KEY',
    entry+'\nreturn {extension:app.extension,setView(value){view=value;},switchMode,installWorkflowView};')(
      app,enterCanvasGraphMode,noop,noop,noop,noop,{querySelector:()=>null},{error:noop},'daelabCreativeCanvasV1');
  bound.setView(view);return {...bound,app,view,workflow,calls};
}

test('saved canvas restores after native loading activates the workflow and preserves the load contract',async()=>{
  const {app,calls,view,installWorkflowView}=canvasExtensionFixture();
  const args=[{nodes:[]},false,true,'saved workflow',{skipAssetScans:true}],result={loaded:true};
  let finish;
  app.loadGraphData=async function(...received){
    assert.equal(this,app);assert.deepEqual(received,args);
    assert.deepEqual(calls,[['hide',false]]);assert.equal(view.active,false);
    app.extensionManager.workflow.activeWorkflow=null;
    await new Promise(resolve=>finish=resolve);
    app.extensionManager.workflow.activeWorkflow={activeMode:null,initialMode:'graph'};
    return result;
  };
  installWorkflowView();const loading=app.loadGraphData(...args);
  assert.equal(view.active,false);finish();
  assert.equal(await loading,result);
  assert.deepEqual(calls,[['hide',false],'show']);
  assert.equal(app.graph.extra.daelabCreativeCanvasV1.active,true);
});

test('pending overlay entry cannot reopen a workflow after a load or supersede a later mode choice',async()=>{
  const {app,switchMode,workflow,calls,view,installWorkflowView}=canvasExtensionFixture();
  app.loadGraphData=async()=>{};app.graph.extra.daelabCreativeCanvasV1.active=false;installWorkflowView();
  const restore=switchMode(true),loading=app.loadGraphData();
  assert.equal(await restore,false);assert.equal(view.active,false);
  await loading;
  const show=switchMode(true),hide=switchMode(false);
  assert.equal(await show,false);assert.equal(await hide,true);assert.equal(view.active,false);
  const pending=switchMode(true);
  app.extensionManager.workflow.activeWorkflow={activeMode:'graph'};
  assert.equal(await pending,false);assert.equal(calls.includes('show'),false);
  assert.equal(workflow.activeMode,null);
});

test('a superseded load cannot restore the overlay and failed loads retain native errors',async()=>{
  const {app,calls,view,installWorkflowView}=canvasExtensionFixture();
  let finish;
  const failure=new Error('native load failed');
  app.loadGraphData=async kind=>{
    if(kind==='slow')await new Promise(resolve=>finish=resolve);
    if(kind==='error')throw failure;
  };
  installWorkflowView();const slow=app.loadGraphData('slow');
  app.graph.extra.daelabCreativeCanvasV1.active=false;await app.loadGraphData('graph');
  app.graph.extra.daelabCreativeCanvasV1.active=true;finish();await slow;
  assert.equal(calls.includes('show'),false);assert.equal(view.active,false);
  await assert.rejects(app.loadGraphData('error'),error=>error===failure);
  assert.equal(calls.includes('show'),false);
});

test('host readiness prevents all history graph reads before native initialization',async()=>{
  const diagnostics=[],workflow={};let calls=0;
  const tracker={_restoringState:true,changeCount:0,workflow};
  const app={isGraphReady:false,extensionManager:{workflow:{activeWorkflow:{changeTracker:tracker}}},
    get graph(){throw new Error('early graph read');},get rootGraph(){throw new Error('early rootGraph read');},
    async loadGraphData(){calls++;}};
  installLayoutHistory(app);await app.loadGraphData({},false,false,workflow);
  assert.equal(calls,1);
  const history=canvasHistory(app,{diagnose:d=>diagnostics.push(d)});
  assert.throws(()=>history.begin(),/graph-initialization/);assert.equal(diagnostics.length,1);
});

test('group slot visibility uses explicit native nodes and preserves independent groups',()=>{
  const a={id:1},b={id:2},g={id:3,type:GROUP_TYPE,properties:{members:[1],collapsed:false}},h={id:4,type:GROUP_TYPE,properties:{members:[2],collapsed:false}};
  const nodes=[a,b,g,h],selected=new Set([1]);
  assert.equal(suppressGroupSlots(nodes,g,selected),true);
  assert.equal(suppressGroupSlots(nodes,h,selected),false);
  assert.equal(suppressGroupSlots(nodes,a,selected),false);
  assert.equal(suppressGroupSlots(nodes,b,selected),true);
  g.properties.collapsed=true;assert.equal(suppressGroupSlots(nodes,g,selected),false);
  assert.equal(suppressGroupSlots(nodes,a,selected),true);
});

test('Canvas core/groups contain no restricted host APIs, registry, private graph fields or host DOM selectors',()=>{
  const root=new URL('../../frontend/src/',import.meta.url);
  for(const folder of ['canvas','features/groups'])for(const name of readdirSync(new URL(folder+'/',root))){
    if(!/\.(mjs|js|css|ts)$/.test(name))continue;
    const source=readFileSync(new URL(folder+'/'+name,root),'utf8');
    assert.doesNotMatch(source,/\bapp\s*\.|\bLiteGraph\b|extensionManager|changeTracker|\._nodes\b|data-testid|#graph-canvas/,folder+'/'+name);
    assert.doesNotMatch(source,/\bgraph\.(?:add|remove|removeLink|serialize|change|setDirtyCanvas)\s*\(/,folder+'/'+name);
  }
});
