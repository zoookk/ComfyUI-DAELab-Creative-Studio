import test from 'node:test';
import assert from 'node:assert/strict';
import {createTableModel} from '../../frontend/src/features/table/index.ts';
import {tableModel} from '../../frontend/src/application/table_model.mjs';
import {createMaterialTable} from '../../frontend/src/features/table/table_material_columns.mjs';

test('public model preserves unknown root, field, row, value and metadata keys through normalize/serialize',()=>{
 const raw={version:1,fields:[{id:'f',name:'F',type:'json',future:{a:1}}],records:[{id:'r',values:{f:{kind:'future',config:[1,2]},deleted:'keep'},extra:true}],meta:{unknown:['a']},future:{nested:true}};
 for(const model of [createTableModel(),tableModel]){
  const first=model.normalizeTable(raw),next=model.normalizeTable(JSON.stringify(first));
  assert.deepEqual(next,first);assert.deepEqual(next.future,raw.future);
  assert.deepEqual(next.fields[0].future,raw.fields[0].future);assert.equal(next.records[0].values.deleted,'keep');
  assert.deepEqual(next.records[0].values.f,raw.records[0].values.f);assert.equal(next.records[0].extra,true);
  first.future.nested=false;assert.equal(raw.future.nested,true);
 }
});
test('model extensions are per instance and no provider is needed for base editing',()=>{
 let calls=0;const extended=createTableModel({migratePromptSource:t=>{calls++;return t;}}),base=createTableModel();
 const table=base.normalizeTable({fields:[{id:'text',name:'Text',type:'text'}],records:[{id:'row',values:{text:''}}]});
 base.setValue(table,'row','text','中文');assert.equal(table.records[0].values.text,'中文');assert.equal(calls,0);
 extended.normalizeTable({});assert.equal(calls,1);base.normalizeTable({});assert.equal(calls,1);
});
test('production composition preserves default columns, rows and local material validation',()=>{
 const table=createMaterialTable();assert.equal(table.records.length,3);assert.equal(table.fields.length,2);
 assert.deepEqual(table.fields.map(f=>f.presentation||f.type),['content','prompt']);
 assert.throws(()=>tableModel.convertValue(table.fields[0],[{url:'https://example.invalid/image.png'}]),/本地素材/);
 const assets=[{id:'a',url:'/view?filename=a.png',name:'A'},{id:'b',url:'/view?filename=b.png',name:'B'}];
 tableModel.setValue(table,table.records[0].id,table.fields[0].id,assets);
 assert.deepEqual(table.records[0].values[table.fields[0].id].map(a=>a.id),['a','b']);
});

test('public structural writes reject capacity overflow without partial writes',()=>{
 const model=createTableModel(),table=model.normalizeTable({});
 for(let n=0;n<64;n++)model.addField(table,{id:`f${n}`});
 for(let n=0;n<500;n++)model.addRecord(table);
 const before=JSON.stringify(table);
 assert.throws(()=>model.addField(table),/64/);assert.throws(()=>model.addRecord(table),/500/);
 assert.equal(JSON.stringify(table),before);
});
