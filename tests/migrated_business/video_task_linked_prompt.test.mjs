import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoTasks} from '../../frontend/src/features/generation/video_tasks_model.mjs';
import {bindLinkedTaskReference,replaceLinkedTaskText,linkedTaskTexts,clearLinkedTaskInput} from '../../frontend/src/features/generation/video_task_linked_prompt.mjs';
import {generationInput,rowGenerationConfig} from '../../frontend/src/features/generation/table_generation_model.mjs';
function fixture(){const state=createVideoTasks({model:'Seedance 2.5',prompt:'first'}),{table,fieldId}=state,row=table.records[0],field=table.fields.find(f=>f.id===fieldId);const column={id:'video',name:'参考视频',type:'content',videoInput:'reference_video'};table.fields.push(column);row.values.video=[{id:'v1',url:'/view?filename=one.mp4&type=input',kind:'video'}];const config=()=>rowGenerationConfig(row,fieldId,field.generation);return {table,fieldId,row,column,config,input:()=>generationInput(table,fieldId,row.id)};}
test('connected video becomes an actual generation reference without adding prompt mentions',()=>{const f=fixture(),before=structuredClone(f.row.values[f.config().promptFieldId]);bindLinkedTaskReference(f.table,f.row,f.fieldId,f.config(),f.column);assert.deepEqual(f.row.values[f.config().promptFieldId],before);replaceLinkedTaskText(f.table,f.row,f.config(),['updated']);const input=f.input();assert.equal(input.config.mode,'mixed2video');assert.equal(input.assets[0].id,'v1');assert.deepEqual(input.segments,[{type:'text',text:'updated'}]);});
test('reference replacement and repeat synchronization retain one current asset',()=>{const f=fixture();bindLinkedTaskReference(f.table,f.row,f.fieldId,f.config(),f.column);f.row.values.video=[{id:'v2',url:'/view?filename=two.mp4&type=input',kind:'video'}];for(let i=0;i<2;i++)bindLinkedTaskReference(f.table,f.row,f.fieldId,f.config(),f.column);assert.equal(f.input().assets.length,1);assert.equal(f.input().assets[0].id,'v2');});
test('two instances and serialization keep their own linked references',()=>{const a=fixture(),b=fixture();bindLinkedTaskReference(a.table,a.row,a.fieldId,a.config(),a.column);assert.equal(b.input().config.mode,'text2video');assert.equal(b.input().assets.length,0);const restored=JSON.parse(JSON.stringify(a.table));assert.deepEqual(generationInput(restored,a.fieldId,a.row.id),a.input());});

test('multiple text sources append in connection order and disconnect independently after reload',()=>{
 const state=createVideoTasks({model:'Seedance 2.5'}),row=state.table.records[0],config=state.table.fields.find(f=>f.id===state.fieldId).generation;
 state.inputs={'texts.text0':{recordId:row.id,order:2,texts:['第二段']},text_input:{recordId:row.id,order:1,texts:['第一段']},'texts.text1':{recordId:row.id,order:3,texts:['第三段']}};
 replaceLinkedTaskText(state.table,row,config,linkedTaskTexts(state,row.id));
 assert.equal(row.values[config.promptFieldId].segments.at(-1).text,'第一段\n第二段\n第三段');
 const restored=JSON.parse(JSON.stringify(state));clearLinkedTaskInput(restored,'texts.text0');
 assert.equal(restored.table.records[0].values[config.promptFieldId].segments.at(-1).text,'第一段\n第三段');
 clearLinkedTaskInput(restored,'text_input');assert.equal(linkedTaskTexts(restored,row.id).join(''),'第三段');
 assert.equal(state.table.records[0].values[config.promptFieldId].segments.at(-1).text,'第一段\n第二段\n第三段');
});

test('multiple image references retain earlier frame images and remove only a disconnected source',()=>{
 const state=createVideoTasks({model:'Seedance 2.5',prompt:'画面'}),{table,fieldId}=state,row=table.records[0],output=table.fields.find(f=>f.id===fieldId);
 const names=['first_frame','last_frame','reference_images','images.image0','images.image1'];state.inputs={};
 for(const [i,name] of names.entries()){
  const column={id:'image'+i,type:'content',videoInput:name};table.fields.push(column);row.values[column.id]=[{id:'asset'+i,kind:'image',url:'/view?filename=image'+i+'.png&type=input'}];state.inputs[name]={recordId:row.id};
  bindLinkedTaskReference(table,row,fieldId,rowGenerationConfig(row,fieldId,output.generation),column);
 }
 assert.deepEqual(generationInput(table,fieldId,row.id).assets.map(a=>a.id),names.map((_,i)=>'asset'+i));
 clearLinkedTaskInput(state,'images.image0');assert.deepEqual(generationInput(table,fieldId,row.id).assets.map(a=>a.id),['asset0','asset1','asset2','asset4']);
});

test('disconnecting a mixed group removes its text and media while retaining independent inputs',()=>{
 const state=createVideoTasks({model:'Seedance 2.5'}),{table,fieldId}=state,row=table.records[0],config=table.fields.find(f=>f.id===fieldId).generation;
 const column={id:'group-media',type:'content',videoInput:'groups.group0'};table.fields.push(column);row.values[column.id]=[{id:'group-image',kind:'image',url:'/view?filename=group.png&type=input'}];
 state.inputs={text_input:{recordId:row.id,order:1,texts:['独立文字']},'groups.group0':{recordId:row.id,order:2,texts:['组文字一','组文字二']}};
 replaceLinkedTaskText(table,row,config,linkedTaskTexts(state,row.id));bindLinkedTaskReference(table,row,fieldId,config,column);
 assert.equal(generationInput(table,fieldId,row.id).assets.length,1);
 clearLinkedTaskInput(state,'groups.group0');const input=generationInput(table,fieldId,row.id);
 assert.equal(input.assets.length,0);assert.deepEqual(input.segments,[{type:'text',text:'独立文字'}]);
});

test('multiple videos remain references without automatic mentions, while manual mentions survive',()=>{
 const f=fixture(),second={id:'video2',name:'参考视频',type:'content',videoInput:'videos.video0'};f.table.fields.push(second);f.row.values.video2=[{id:'v2',url:'/view?filename=two.mp4&type=input',kind:'video'}];
 bindLinkedTaskReference(f.table,f.row,f.fieldId,f.config(),f.column);bindLinkedTaskReference(f.table,f.row,f.fieldId,f.config(),second);
 assert.deepEqual(f.input().assets.map(a=>a.id),['v1','v2']);assert.deepEqual(f.input().segments,[{type:'text',text:'first'}]);
 const prompt=f.row.values[f.config().promptFieldId];prompt.segments.push({type:'column',fieldId:'video2',assetId:'v2'});const before=structuredClone(prompt);
 bindLinkedTaskReference(f.table,f.row,f.fieldId,f.config(),second);assert.deepEqual(f.row.values[f.config().promptFieldId],before);
 assert.deepEqual(f.input().segments,[{type:'text',text:'first'},{type:'asset',index:1}]);assert.equal(f.input().assets.length,2);
});
