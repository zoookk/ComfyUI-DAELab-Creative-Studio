import {generationInputDigest} from '../generation/generation_session.js';
import {ensureIdentity} from './prompt_optimization_model.mjs';
import {assertBusinessService,businessJson} from '../../contracts/business.js';
import {snapshotJson} from '../../contracts/json_snapshot.js';
import {createTableButton,tableIcon} from '../../ui/table_controls.mjs';
import {tableHistory} from '../../application/table_host_history.mjs';

import {availableModes,applyIOResult,undoIOResult} from './llm_io_model.mjs';
import {slotRows,slotSignature,outputText} from './llm_slot_model.mjs';
import {optimizeRow} from './llm_local_provider.mjs';
import {createLLMTask} from './llm_task_model.mjs';
// Reconcile against the actual controls, including shared-control changes. Do
// not cache render inputs: Slot validation, task snapshots and native outputs
// must still be refreshed on every render.
const setProperty=(element,key,value)=>{if(element[key]!==value)element[key]=value;};
const setAttribute=(element,key,value)=>{if(element.getAttribute(key)!==value)element.setAttribute(key,value);};
const toggleAttribute=(element,key,enabled)=>{if(element.hasAttribute(key)!==enabled)element.toggleAttribute(key,enabled);};
const toggleClass=(element,key,enabled)=>{if(element.classList.contains(key)!==enabled)element.classList.toggle(key,enabled);};
export function bindIOPanel({node,nativeDocument=null,root,source,instruction,select,run,upload,result,materialHint}){
    const saved=()=>node.properties.llmStylePreview;
    saved().instruction??=instruction.value;
    if(!['polish','reverse'].includes(saved().mode))saved().mode='polish';
    const listeners=[],on=(el,event,fn)=>{el.addEventListener(event,fn);listeners.push(()=>el.removeEventListener(event,fn));};
    const make=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;};
    const heading=result.querySelector('.llm-style-result-head');heading.querySelector('.llm-style-result-actions')?.remove();result.before(heading);
    const paragraph=make('p','',''),status=make('div','llm-style-preview-status');status.setAttribute('role','status');
    const actions=make('div','llm-style-result-actions');result.replaceChildren(paragraph,status,actions);
    const changed=()=>{node.graph?.change?.();render();};
    const apply=createTableButton('',()=>{
        if(disposed||busy||node.mode||apply.disabled)return;
        try{
            const confirm=()=>{if(!nativeDocument)return applyIOResult(saved(),signature());if(!proposalTicket&&restoredProposal===saved().ioResult?.requestId)proposalTicket=nativeDocument.beginRequest(restoredProposal);if(!proposalTicket||!nativeDocument.canApply(proposalTicket))throw new Error('输入或工作流已变化，请重新生成');let applied=false;nativeDocument.controller.applyResult(proposalTicket,'应用 LLM 审阅结果',draft=>{const historical=draft.ioResult;if(proposalState)draft.ioResult=snapshotJson(proposalState);applied=applyIOResult(draft,signature());if(historical===undefined)delete draft.ioResult;else draft.ioResult=historical;});return applied;};
            const context=globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root);
            if(node.outputs?.[1]?.links?.length){
                const history=nativeDocument?null:tableHistory();history?.begin();
                try{if(confirm())message='已应用 · 逐行结果通过连线传递';}finally{history?.end();}
            }else if(context?.confirmOutput?context.confirmOutput(confirm):confirm())message=context?.confirmOutput?'已应用 · 结果文本框已连接':'已应用 · 下游通过连线读取';
        }catch(error){message=error.message;}
        changed();
    });tableIcon(apply,'check-line','同意更改');
    const undo=createTableButton('',()=>{if(nativeDocument){void Promise.resolve(nativeDocument.undo()).catch(error=>{message=error.message;render();});return;}if(undoIOResult(saved())){message='已撤销应用';changed();}});tableIcon(undo,'arrow-go-back-line','撤销应用');
    const recover=createTableButton('恢复原结果',()=>void recoverProposal());
    const regenerate=createTableButton('',()=>run.click());tableIcon(regenerate,'restart-line','重新生成');
    for(const b of [apply,undo,regenerate])b.classList.add('llm-style-result-action');actions.append(apply,undo,regenerate,recover);
    const sourceSection=source.closest('.llm-style-source');source.placeholder='输入原始文字，或连接文本节点';
    const imageSection=make('section','llm-style-section llm-style-image-source'),imageBox=make('div','llm-style-image-upload'),image=make('img','llm-style-image-preview'),imageText=make('span','llm-style-image-text','通过 Slot 连接参考图片');
    imageSection.append(make('span','llm-style-label','参考图片'),imageBox);imageBox.append(image,imageText);sourceSection.after(imageSection);materialHint.parentElement.hidden=true;
    select.replaceChildren(new Option('Qwen3.5-9B · 本地','qwen'),new Option('DeepSeek · API','deepseek'));
    saved().model??='qwen';if(!['qwen','deepseek'].includes(saved().model)){const legacy=new Option('旧模型配置（未接入）',saved().model);legacy.disabled=true;select.add(legacy);}select.value=saved().model;
    const generationTask=createLLMTask();
    let busy=false,disposed=false,message='',task=[],lastInput='',proposalTicket=null,proposalState=null;
    const restoredProposal=saved().ioResult?.complete?saved().ioResult.requestId:null;
    const project=proposal=>{proposalState=snapshotJson(proposal);};
    function signature(){try{return slotSignature(node);}catch{return '';}}
    function render(){
        if(disposed)return;
        let rows=[],error='',waiting=false;try{rows=slotRows(node);}catch(e){error=e.message;waiting=!!e.waiting;}
        const inputKey=JSON.stringify(rows),modes=availableModes(rows);
        if(inputKey!==lastInput){
            const next=snapshotJson(saved());
            const linkedInstructions=[...new Set(rows.map(r=>r.instruction).filter(Boolean))].join('\n\n');
            if(linkedInstructions){
                if(next.slotInstruction===undefined)next.manualInstruction=next.instruction;
                next.slotInstruction=linkedInstructions;next.instruction=linkedInstructions;setProperty(instruction,'value',linkedInstructions);next.mode='reverse';
            }else if(next.slotInstruction!==undefined){
                next.instruction=next.manualInstruction||'';setProperty(instruction,'value',next.instruction);delete next.slotInstruction;delete next.manualInstruction;
            }
            if(!modes[next.mode]){if(modes.reverse)next.mode='reverse';else if(modes.polish)next.mode='polish';}
            try{if(JSON.stringify(next)!==JSON.stringify(saved())){if(nativeDocument)nativeDocument.replace(next,{derived:true});else Object.assign(saved(),next);}lastInput=inputKey;}catch(error){message=error.message;}
        }
        // Native history can replace saved configuration without recreating this
        // panel. Reconcile changed text only; ordinary input already persisted
        // before this render, so equal values keep their caret/selection intact.
        const savedInstruction=saved().instruction;
        if(savedInstruction!=null)setProperty(instruction,'value',String(savedInstruction));
        for(const b of root.querySelectorAll('[data-mode]')){const selected=b.dataset.mode===saved().mode;setAttribute(b,'aria-pressed',String(selected));toggleAttribute(b,'data-primary',selected);}
        const mode=saved().mode||'polish',reverse=mode==='reverse',disabled=busy||!!node.mode;
        setProperty(sourceSection,'hidden',reverse);setProperty(imageSection,'hidden',!reverse);
        const linked=node.inputs?.some(input=>input.link!=null)||false;
        setProperty(source,'readOnly',linked);
        setProperty(source,'value',linked?rows.map(r=>r.text).filter(Boolean).join('\n\n'):saved().source||'');
        const first=rows.find(r=>r.image)?.image;setProperty(image,'hidden',!first);if(first&&image.getAttribute('src')!==first.url)image.src=first.url;setProperty(image,'alt',first?.name||'参考图片');setProperty(imageText,'hidden',!!first);toggleClass(imageBox,'has-image',!!first);
        for(const control of [source,instruction,select])setProperty(control,'disabled',disabled);
        setProperty(instruction,'readOnly',saved().slotInstruction!==undefined);
        for(const b of root.querySelectorAll('[data-mode]'))setProperty(b,'disabled',disabled);
        const valid=availableModes(rows)[mode];
        setProperty(run,'disabled',disabled||!!error||!valid);setProperty(run,'title','使用原始文字或连线输入生成建议；应用后输出');setProperty(run.lastChild,'textContent',busy?'生成中…':'生成');setAttribute(run,'aria-busy',String(busy));
        const d=proposalState||saved().ioResult,stamp=signature(),stale=d?.signature!==stamp,isApplied=!!d?.requestId&&saved().appliedIO?.requestId===d.requestId;
        setProperty(paragraph,'textContent',d?.rows.map(r=>r.result).filter(Boolean).join('\n\n')||'');
        setProperty(apply,'disabled',disabled||!d?.complete||stale||isApplied||!!nativeDocument&&(proposalTicket?!nativeDocument.canApply(proposalTicket):restoredProposal!==d?.requestId));setProperty(apply,'hidden',isApplied);
        setProperty(recover,'disabled',disabled||!nativeDocument);setProperty(undo,'disabled',disabled||!saved().ioUndo);setProperty(undo,'hidden',!saved().ioUndo);setProperty(regenerate,'disabled',run.disabled||!d);
        setProperty(status,'textContent',error||(d&&stale?'输入已改变，请重新生成':message|| (d?`${d.provider==='qwen'?'本地 Qwen 结果':d.provider==='deepseek'?'DeepSeek 结果':'示例结果 · 未调用模型'}${isApplied?' · 已应用':' · 待应用'}`:rows.length&&!valid?'当前输入不支持此模式':rows.length?`${rows.length} 项输入 · 等待生成`:'请输入原始文字或连接输入')));
        task=[...generationTask.snapshot(),...(!busy&&error?[{id:'llm-input',label:waiting?'等待输入':'输入异常',state:waiting?'queued':'error',detail:error}]:[])];
        try{node.setOutputData?.(0,outputText(node));}catch{node.setOutputData?.(0,null);}
    }
    on(select,'change',()=>{message='';changed();});for(const field of [source,instruction])on(field,'input',()=>{message='';changed();});
    for(const b of root.querySelectorAll('[data-mode]'))on(b,'click',()=>{message='';changed();});
    on(run,'click',async()=>{
        if(run.disabled||node.mode)return;
        const state=saved(),graph=node.graph,stamp=signature();busy=true;message='';render();
        const current=()=>!disposed&&node.graph===graph&&(!nativeDocument||nativeDocument.canApply(proposalTicket))&&!node.mode&&signature()===stamp;
        const rowTickets=[];
        try{
            const rows=slotRows(node),provider=state.model;if(!['qwen','deepseek'].includes(provider))throw new Error('该历史模型配置不可执行，请明确选择已接入的提供方');
            assertBusinessService('optimization');generationTask.start(rows.length,state.mode,provider);render();
            const proposal={version:1,requestId:crypto.randomUUID(),rows:[],mode:state.mode,instruction:state.instruction||'',signature:stamp,provider,complete:false};if(proposalTicket)nativeDocument?.releaseRequest(proposalTicket);proposalTicket=nativeDocument?.beginRequest(proposal.requestId)||null;project(proposal);
            if(!nativeDocument)throw new Error('原生编辑会话尚未就绪，未提交');const identity=ensureIdentity(graph,node),inputDigest=await generationInputDigest(stamp);if(!current())throw new Error('输入或工作流已变化，未提交');const existing=[];let offset=0;do{const page=await businessJson('generation','status',{source:{...identity,nodeId:proposalTicket.documentId},limit:500,offset});existing.push(...page.jobs);offset=page.nextOffset;}while(Number.isSafeInteger(offset)&&offset>0);if(!current())throw new Error('输入或工作流已变化，未提交');if(existing.some(report=>report.source?.operation==='standalone-optimization'&&report.source.inputDigest===inputDigest&&!['succeeded','failed','cancelled'].includes(report.state)))throw new Error('原请求尚未确定，请先恢复原结果；未创建新请求');const createdAt=Date.now(),requests=rows.map((row,index)=>{const requestId=crypto.randomUUID(),ticket=nativeDocument.beginRequest(requestId,{recordId:String(row.id),fieldId:'instruction'});rowTickets.push(ticket);return {requestId,recordId:String(row.id),sourceScope:{...identity,nodeId:ticket.documentId,workflowSession:ticket.workflowSession,epoch:ticket.epoch,recordId:String(row.id),fieldId:'instruction',inputVersion:ticket.inputVersion,operation:'standalone-optimization',groupId:proposal.requestId,rowIndex:index,rowCount:rows.length,inputDigest,createdAt}};});nativeDocument.edit('记录优化请求',draft=>{draft.studioTextRequests={groupId:proposal.requestId,inputDigest,requests};});
            if(['qwen','deepseek'].includes(provider))for(const row of rows){
                if(!current())throw new Error('输入或节点状态已改变，已停止后续提交');
                message=`${provider==='qwen'?'本地 Qwen':'DeepSeek'} 处理中 ${proposal.rows.length+1}/${rows.length} · 并发 1`;render();
                const reference=requests[proposal.rows.length],ticket=rowTickets[proposal.rows.length];
                const output=await optimizeRow(row,state.mode,row.instruction??state.instruction??'',{model:provider,requestId:reference.requestId,sourceScope:reference.sourceScope});if(!nativeDocument.canApply(ticket))throw new Error('输入或工作流已变化，结果保留在账本中');
                if(!current())throw new Error('输入或节点状态已改变，结果未应用');
                proposal.rows.push(output);project(proposal);generationTask.completeRow();render();
            }
            if(current()){proposal.complete=true;project(proposal);message='';generationTask.finish();}
        }catch(e){message='异常：'+e.message;generationTask.fail(e.message);}finally{for(const ticket of rowTickets)nativeDocument?.releaseRequest(ticket);busy=false;render();}
    });
    async function recoverProposal(){
        if(disposed||busy||node.mode||!nativeDocument)return;
        busy=true;const stamp=signature(),rows=slotRows(node),ticket=nativeDocument.beginRequest(crypto.randomUUID());render();
        try{
            const inputDigest=await generationInputDigest(stamp),identity=ensureIdentity(node.graph,node),reports=[];let offset=0;
            do{const response=await businessJson('generation','status',{source:{...identity,nodeId:ticket.documentId},limit:500,offset});reports.push(...response.jobs);offset=response.nextOffset;}while(Number.isSafeInteger(offset)&&offset>0);
            if(!nativeDocument.canApply(ticket)||signature()!==stamp)throw new Error('输入或工作流已变化，原结果仅保留在账本');
            const matches=reports.filter(report=>report.source?.operation==='standalone-optimization'&&report.source.documentId===identity.documentId&&report.source.tableId===identity.tableId&&report.source.nodeId===ticket.documentId&&report.source.fieldId==='instruction'&&report.source.inputDigest===inputDigest).sort((a,b)=>(a.source.createdAt||0)-(b.source.createdAt||0)),latest=matches.at(-1);
            if(!latest)throw new Error('当前输入没有可恢复的结果；未提交新任务');
            const group=matches.filter(report=>report.source.groupId===latest.source.groupId).sort((a,b)=>a.source.rowIndex-b.source.rowIndex);
            if(group.length!==rows.length||group.some((report,index)=>report.source.rowCount!==rows.length||report.source.rowIndex!==index||report.source.recordId!==String(rows[index].id)||report.state!=='succeeded'||report.receipt?.kind!=='text'||report.receipt.text!==report.result))throw new Error('原任务尚未全部完成；请继续查询原结果，未重新提交');
            if(proposalTicket)nativeDocument.releaseRequest(proposalTicket);nativeDocument.releaseRequest(ticket);proposalTicket=nativeDocument.beginRequest(latest.source.groupId);
            project({version:1,requestId:latest.source.groupId,signature:stamp,provider:saved().model,mode:saved().mode,instruction:saved().instruction||'',complete:true,rows:rows.map((row,index)=>({...row,result:group[index].result,requestId:group[index].requestId,status:'completed'}))});message='原结果已恢复，请审阅后同意更改';
        }catch(error){message=error.message;}finally{nativeDocument.releaseRequest(ticket);busy=false;render();}
    }
    const timer=setInterval(()=>{if(root.isConnected)render();},500);render();
    const release=()=>{disposed=true;if(proposalTicket)nativeDocument?.releaseRequest(proposalTicket);clearInterval(timer);for(const off of listeners)off();};release.sync=render;release.tasks=()=>task;return release;
}
