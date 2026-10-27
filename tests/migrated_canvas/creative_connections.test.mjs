import test from 'node:test';
import assert from 'node:assert/strict';
import {MATERIAL_SLOT,resolveOutput,targetChoices,outputSelector,inputSlots} from '../../frontend/src/canvas/creative_connections.mjs';
import {registerAdapter} from '../../frontend/src/canvas/creative_contract.mjs';
const upload=kind=>({type:'DAELAB.MediaUpload',widgets:[{name:'asset_data',value:JSON.stringify({filename:'asset',kind})}],outputs:['COMFYTV_IMAGE','COMFYTV_IMAGES','COMFYTV_VIDEO','IMAGE','VIDEO'].map(type=>({type}))});
test('one material outlet resolves each target without changing other edges',()=>{
 const image=upload('image'),video=upload('video');
 for(const [type,slot] of [['COMFYTV_IMAGE',0],['COMFYTV_IMAGES',1],['IMAGE',3]])assert.equal(resolveOutput(image,MATERIAL_SLOT,type),slot);
 assert.equal(resolveOutput(video,MATERIAL_SLOT,'VIDEO'),4);assert.equal(resolveOutput(video,MATERIAL_SLOT,'COMFYTV_VIDEO'),2);
 assert.equal(resolveOutput(image,MATERIAL_SLOT,'VIDEO'),-1);assert.equal(resolveOutput(video,MATERIAL_SLOT,'IMAGE'),-1);
 assert.equal(resolveOutput(upload(null),MATERIAL_SLOT,'IMAGE'),-1);
 assert.equal(outputSelector(image,3),outputSelector(image,0));
});
test('ambiguous semantic inputs remain explicit choices, including occupied inputs',()=>{
 const source=upload('image');const target={inputs:[{name:'first_frame',type:'IMAGE'},{name:'last_frame',type:'IMAGE',link:123},{name:'video',type:'VIDEO'},{name:'text',type:'STRING',widget:{}}]};
 assert.deepEqual(targetChoices(source,MATERIAL_SLOT,target).map(c=>c.name),['first_frame','last_frame']);
 assert.deepEqual(targetChoices(source,MATERIAL_SLOT,source),[]);
});

test('disabled canvas input hides slots and rejects card connections without changing saved inputs or outputs',()=>{
 const unregister=registerAdapter('test.table-input',{matches:n=>n.type==='test.Table',canConnectInput:()=>false});
 try{
  const source={outputs:[{type:'STRING'}]},peer={inputs:[{name:'text',type:'STRING'}]};
  for(const link of [null,17]){
   const table={type:'test.Table',inputs:[{name:'source_table',type:'STRING',link}],outputs:[{name:'table_json',type:'STRING',links:[23]}]},before=JSON.stringify(table);
   assert.deepEqual(inputSlots(table),[]);assert.deepEqual(targetChoices(source,0,table),[]);
   assert.equal(resolveOutput(table,MATERIAL_SLOT,'STRING'),0);assert.equal(targetChoices(table,MATERIAL_SLOT,peer).length,1);
   assert.equal(JSON.stringify(table),before);
  }
  assert.deepEqual(inputSlots(peer),[0]);assert.equal(targetChoices(source,0,peer).length,1);
 }finally{unregister();}
});
