import test from 'node:test';
import assert from 'node:assert/strict';
import {isTableSource,readTableSnapshot,writeTablePrompts} from '../../frontend/src/features/table/table_exchange.mjs';
import {promptContent} from '../../frontend/src/features/prompt/table_prompt_template.mjs';
import {importVideoTasks,syncVideoTaskInputs} from '../../frontend/src/features/generation/video_tasks_model.mjs';
import {generationInput,LOCAL_VIDEO_MODEL,setRowGenerationConfig} from '../../frontend/src/features/generation/table_generation_model.mjs';
import {generationParameterModes,generationModes} from '../../frontend/src/features/prompt/table_prompt_settings.mjs';
import {frameReferenceOptions} from '../../frontend/src/features/table/table_reference_menu.mjs';
import {bindLinkedTaskReference} from '../../frontend/src/features/generation/video_task_linked_prompt.mjs';
import {generationInputKind,generationInputNames} from '../../frontend/src/features/generation/generation_input.js';

test('image upload resolves its real IMAGE output for single generation, including a combined text input',()=>{
 const image={type:'DAELAB.MediaUpload',widgets:[{name:'asset_data',value:'{"kind":"image"}'}],outputs:['COMFYTV_IMAGE','COMFYTV_IMAGES','COMFYTV_VIDEO','IMAGE','VIDEO'].map(type=>({type}))};
 const text={type:'DAELAB.TextInput',outputs:[{type:'STRING'}]},target={inputs:[{name:'text_input',link:1}],graph:{links:{1:{origin_id:10,origin_slot:0}},getNodeById:()=>text}};
 assert.equal(generationInputKind(image,3),'image');assert.equal(generationInputKind(image,-1),'image');
 assert.equal(generationInputKind(image,0),null);assert.equal(generationInputKind(image,4),null);
 assert.deepEqual(generationInputNames(target,image,3),['first_frame','last_frame','reference_images']);
});

function sourceNode(type='DAELAB.ScriptParser'){
 const table={fields:[{id:'shot',name:'镜号',type:'text'},{id:'scene',name:'画面',type:'text'},{id:'media',name:'图片',type:'content'},
  {id:'prompt',name:'拼接',type:'json',presentation:'prompt',promptTemplate:{kind:'column-template',version:1,segments:[{type:'column',fieldId:'shot',valueType:'text'},{type:'text',text:'的运镜下，呈现'},{type:'column',fieldId:'scene',valueType:'text'}]}}],
  records:['1','2'].map(id=>({id,values:{shot:id,scene:'画面'+id,prompt:'',media:[{id:'a'+id,kind:'image',url:'/view?filename=a'+id+'.png'},{id:'b'+id,kind:'image',url:'/view?filename=b'+id+'.png'}]}})),meta:{generationInput:{version:1,promptFieldId:'prompt'}}};
 const data={name:'table_data',value:JSON.stringify(table)};
 const editor={change(update){const t=JSON.parse(data.value);update(t);data.value=JSON.stringify(t);},refreshCells(){}};
 return {type,mode:0,widgets:[data],[type==='DAELAB.ScriptParser'?'__scriptPanel':'__dataTablePanel']:{editor}};
}

test('single generation accepts autogrow text and image sockets while table input stays exclusive',()=>{
 const text={type:'DAELAB.TextInput',outputs:[{type:'STRING'}]},image={type:'LoadImage',outputs:[{type:'IMAGE'}]},table={type:'DAELAB.Table'};
 const target={inputs:[{name:'text_input',link:1},{name:'texts.text0'},{name:'images.image0'}],graph:{links:{1:{origin_id:1,origin_slot:0}},getNodeById:()=>text}};
 assert.deepEqual(generationInputNames(target,{...text},0),['text_input','texts.text0']);
 assert.deepEqual(generationInputNames(target,image,0),['first_frame','last_frame','reference_images','images.image0']);
 assert.deepEqual(generationInputNames(target,table,0),[]);
 target.graph.getNodeById=()=>table;assert.deepEqual(generationInputNames(target,text,0),[]);
});

test('each source connects once per generator and groups mix with text, images and video',()=>{
 const group={id:10,type:'DAELAB.MaterialGroup',outputs:[{type:'DAELAB_ASSETS'}]},text={id:11,type:'DAELAB.TextInput',outputs:[{type:'STRING'}]},video={id:12,type:'Other.Video',outputs:[{type:'COMFYTV_VIDEO'}]};
 const target={inputs:[{name:'groups.group0',link:1},{name:'groups.group1'},{name:'text_input'},{name:'reference_video'}],graph:{links:{1:{origin_id:10,origin_slot:0}},getNodeById:()=>group}};
 assert.equal(generationInputKind(group,0),'group');assert.equal(generationInputKind(group,-1),'group');
 assert.deepEqual(generationInputNames(target,group,0),[]);assert.deepEqual(generationInputNames(target,{...group},0),[]);
 assert.deepEqual(generationInputNames(target,group,0,0),['groups.group0','groups.group1']);
 assert.deepEqual(generationInputNames(target,text,0),['text_input']);assert.deepEqual(generationInputNames(target,video,0),['reference_video']);
 assert.deepEqual(generationInputNames({inputs:[{name:'groups.group0'}]},group,0),['groups.group0'],'a different target remains available');
});

test('additional video sources use free native autogrow inputs without replacing earlier links',()=>{
 const first={id:1,type:'DAELAB.MediaUpload',widgets:[{name:'asset_data',value:'{"kind":"video"}'}]},second={...first,id:2};
 const target={inputs:[{name:'reference_video',link:1},{name:'videos.video0'}],graph:{links:{1:{origin_id:1,origin_slot:2}},getNodeById:()=>first}};
 assert.deepEqual(generationInputNames(target,second,2),['reference_video','videos.video0']);assert.deepEqual(generationInputNames(target,first,2),[]);
});

test('parser and generic table export the same row-expanded template into generation input',()=>{
 for(const type of ['DAELAB.ScriptParser','DAELAB.Table']){
  const n=sourceNode(type);assert(isTableSource(n));
  const state=importVideoTasks(readTableSnapshot(n));
  for(const row of state.table.records)assert.equal(generationInput(state.table,state.fieldId,row.id).segments.map(s=>s.text).join(''),row.id+'的运镜下，呈现画面'+row.id);
 }
 assert.equal(isTableSource({type:'Unrelated'}),false);
});

test('frame bindings survive writeback to a source without generation column, two instances, reload and re-import',()=>{
 for(const type of ['DAELAB.Table','DAELAB.ScriptParser']){
  const n=sourceNode(type),before=readTableSnapshot(n),a=importVideoTasks(before),b=importVideoTasks(before);
  const segments=[...['first','last'].map((role,i)=>({type:'frame',role,generationFieldId:a.fieldId,binding:{fieldId:'media',assetId:(i?'b':'a')+'1'}})),{type:'text',text:'连续镜头'}];
  writeTablePrompts(n,[{recordId:'1',fieldId:'prompt',expected:promptContent(before,before.records[0],'prompt'),segments}]);
  const source=readTableSnapshot(n);
  for(const state of [a,b]){
   syncVideoTaskInputs(state,source,before);
   const input=generationInput(state.table,state.fieldId,'1');
   assert.equal(input.config.mode,'frames2video');assert.deepEqual(input.assets.map(a=>a.id),['a1','b1']);
   const saved=JSON.parse(JSON.stringify(state));assert.deepEqual(generationInput(saved.table,saved.fieldId,'1'),input);
  }
  const reimport=importVideoTasks(source);assert.deepEqual(generationInput(reimport.table,reimport.fieldId,'1').assets.map(a=>a.id),['a1','b1']);
  assert.deepEqual(source.records[1],before.records[1]);
 }
});

test('local FL modes remain separate and unsupported saved modes are not offered or submitted',()=>{
 const modes=['text2video','singleImage2video','frames2video'];
 const schema={properties:{modeType:{items:Object.fromEntries(modes.map(m=>[m,[]]))}},config:{strictModes:true}};
 const config={kind:'video',model:LOCAL_VIDEO_MODEL,mode:'mixed2video'};
 assert.deepEqual(generationParameterModes(config,schema),modes);assert.deepEqual(generationModes(schema,'video'),modes);assert.equal(config.mode,'mixed2video');
 const s=importVideoTasks(readTableSnapshot(sourceNode())),f=s.table.fields.find(f=>f.id===s.fieldId);
 setRowGenerationConfig(s.table.records[0],s.fieldId,{...f.generation,model:LOCAL_VIDEO_MODEL,mode:'mixed2video'});
 assert.throws(()=>generationInput(s.table,s.fieldId,'1'),/仅支持/);
});

test('frame picker excludes text, video and audio while retaining image identity and ordinal',()=>{
 const t=readTableSnapshot(sourceNode()),row=t.records[0];
 row.values.media.unshift({id:'v',kind:'video',url:'/view?filename=v.mp4'});
 row.values.media.push({id:'sound',kind:'audio',url:'/view?filename=s.wav'});
 const options=frameReferenceOptions(t,row,'result');assert.equal(options.length,1);
 assert.deepEqual(options[0].children.map(o=>[o.asset.id,o.assetIndex]),[['a1',1],['b1',2]]);
 assert.deepEqual(frameReferenceOptions(t,row,'media'),[]);
});

test('local FL rejects reference ports without silently assigning frames or changing the prompt',()=>{
 const s=importVideoTasks(readTableSnapshot(sourceNode())),f=s.table.fields.find(f=>f.id===s.fieldId),row=s.table.records[0];
 const before=JSON.stringify(row);
 assert.throws(()=>bindLinkedTaskReference(s.table,row,s.fieldId,{...f.generation,model:LOCAL_VIDEO_MODEL},s.table.fields.find(f=>f.id==='media')),/首帧／尾帧接口/);
 assert.equal(JSON.stringify(row),before);
});
