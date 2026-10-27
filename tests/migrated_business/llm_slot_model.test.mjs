import test from 'node:test';
import assert from 'node:assert/strict';
import {slotRows,slotSignature,appliedSnapshot,outputText} from '../../frontend/src/features/prompt/llm_slot_model.mjs';
import {applyIOResult,undoIOResult} from '../../frontend/src/features/prompt/llm_io_model.mjs';
function fixture(){const upstream={id:1,title:'文字',getOutputData:()=> '湖畔展厅'},node={id:2,type:'DAELAB.LLMStylePreviewB',inputs:[{link:1}],properties:{llmStylePreview:{mode:'polish',model:'mock',instruction:''}}};node.graph={links:{1:{origin_id:1,origin_slot:0}},getNodeById:id=>id===1?upstream:node};return {node,upstream,s:node.properties.llmStylePreview};}
test('linked input takes precedence and disconnecting restores manual text',()=>{const {node,s}=fixture();s.source='手动文字';s.inputIds=['99'];assert.equal(slotRows(node)[0].text,'湖畔展厅');node.inputs[0].link=null;assert.equal(slotRows(node)[0].text,'手动文字');assert.equal(s.source,'手动文字');s.source=' \n ';assert.deepEqual(slotRows(node),[]);});
test('manual input participates in approved output validation and survives serialization',()=>{
    const {node,s}=fixture();node.inputs[0].link=null;s.source='第一段\n\n第二段';
    assert.deepEqual(slotRows(node).map(row=>row.text),['第一段','第二段']);
    s.ioResult={complete:true,requestId:'manual',signature:slotSignature(node),rows:[{result:'优化结果'}]};
    applyIOResult(s,slotSignature(node));assert.equal(outputText(node),'优化结果');
    node.properties=JSON.parse(JSON.stringify(node.properties));assert.equal(outputText(node),'优化结果');
    node.properties.llmStylePreview.source='修改原文';assert.equal(appliedSnapshot(node).ready,false);
    node.properties.llmStylePreview.source='第一段\n\n第二段';assert.equal(outputText(node),'优化结果');
    node.inputs[0].link=1;assert.equal(appliedSnapshot(node).ready,false);
});
test('applied result propagates, undo and upstream edits invalidate output',()=>{const {node,upstream,s}=fixture();s.ioResult={complete:true,requestId:'one',signature:slotSignature(node),rows:[{result:'湖畔极简展厅'}]};assert.throws(()=>outputText(node));applyIOResult(s,slotSignature(node));assert.equal(outputText(node),'湖畔极简展厅');undoIOResult(s);assert.equal(appliedSnapshot(node).ready,false);applyIOResult(s,slotSignature(node));upstream.getOutputData=()=> '其他';assert.throws(()=>outputText(node));});
test('unsupported sources and unavailable nodes report parse errors',()=>{const {node,upstream}=fixture();upstream.getOutputData=()=>123;assert.throws(()=>slotRows(node),/无法解析/);upstream.mode=4;assert.throws(()=>slotRows(node),/停用/);});
test('chained nodes consume approved output and reject cycles',()=>{const {node,s}=fixture();s.appliedIO={complete:true,signature:slotSignature(node),rows:[{result:'approved'}]};const child={id:3,type:node.type,inputs:[{link:2}],properties:{llmStylePreview:{}}};const graph=node.graph;graph.links[2]={origin_id:2,origin_slot:0};child.graph=graph;assert.equal(slotRows(child)[0].text,'approved');node.inputs[0].link=2;assert.throws(()=>slotRows(node),/循环/);});
