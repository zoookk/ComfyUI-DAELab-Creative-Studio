import {tableClipboard} from './table_capabilities.js';
import {bindBusinessDocument,tableInputStamp} from './business_document_host.js';
import {businessFetch} from '../../../contracts/business.js';
import {isTableSource,readTableView} from '../../../application/table_exchange.mjs';
import {createTableWidgetSerializer} from './table_serializer.js';
import {removeEmptyTableNode} from '../../../features/table/public_helpers.mjs';
import {preserveGenerationHistory} from '../../../features/generation/table_generation_history.mjs';
import {scheduleTableInstall} from '../../../features/table/public_helpers.mjs';
import {ensureIdentity,NAMESPACE} from '../../../features/prompt/prompt_optimization_model.mjs';
import {attachPromptOptimization} from '../../../features/prompt/prompt_optimization_controller.mjs';
import {assertTransition} from '../../../features/storyboard/script_parser_model.mjs';
import {enableColumnPrompt,syncGenerationConfigOwners} from '../../../features/generation/table_generation_model.mjs';
import {createMaterialTable} from '../../../application/table_material_columns.mjs';
import {attachGenerationColumns} from '../../../features/generation/table_generation_panel.mjs';
import {isColumnPrompt,effectivePrompt} from '../../../features/prompt/table_prompt_template.mjs';
import {installContentPresentation} from '../../../application/table_presentation.mjs';
import {createTablePanelViews} from '../../../features/table/public_helpers.mjs';
import {tableTheme} from '../../../ui/table_controls.mjs';
import {tableHistory} from '../../../application/table_host_history.mjs';
import {createWorkbench,showExistingPanel} from '../../../application/table_workbench.mjs';
import {workbenchTheme} from '../../../ui/table_workbench_theme.mjs';
import {storyboardTaskState,selectedTaskSummary} from '../../../features/storyboard/storyboard_task_state.mjs';
import {app} from '/scripts/app.js';
import {normalizeTable,clone,addField} from '../../../application/table_model.mjs';
import {createPromptEditor} from '../../../features/prompt/table_prompt_editor.mjs';
import {promptConfig,promptField,promptFingerprint} from '../../../features/prompt/table_prompt_model.mjs';
import {createTableEditor,tableButton as button} from '../../../application/table_editor.mjs';
import {createAssetGroups} from '../../../application/table_asset_groups.mjs';
import {readStoryboard,projectStoryboard,serializeStoryboardTable,importRows,writeGenerationResults,addGenerationFields,STORYBOARD_ROLES} from '../../../features/storyboard/storyboard_table_adapter.mjs';
import {previewImport} from '../../../features/storyboard/daelab_storyboard_import.mjs';
import {studioTheme} from '../../../ui/studio_theme.mjs';
import {stopCanvasPropagation} from '../../../ui/list_editor_controls.mjs';
import {removeOwnedWidgets} from './dynamic_widget_lifecycle.mjs';


const TYPES=['DAELAB.Table','DAELAB.StoryboardImport'];
const OWNER='__daelabStoryboardOwned',VERSION='20260928-content4';
const widget=(node,name)=>node.widgets?.find(w=>w.name===name);
const isGeneric=node=>node.type==='DAELAB.Table';
const panelName=node=>isGeneric(node)?'daelab_table_editor':'daelab_storyboard_editor';
const dataName=node=>isGeneric(node)?'table_data':'storyboard_data';
function notify(message,severity='info'){app.extensionManager?.toast?.add?.({severity,summary:'数据表',detail:message,life:7000});}
function setWidget(node,name,value){const w=widget(node,name);if(!w||w.value===value)return;w.value=value;w.callback?.(value,app.canvas,node);node.graph?.setDirtyCanvas?.(true,true);}
function hideNative(node,name){const w=widget(node,name);if(!w)return;w.hidden=true;w.options={...w.options,hidden:true,canvasOnly:true};w.computeSize=()=>[0,-4];w.computeLayoutSize=()=>({minHeight:0,maxHeight:0,minWidth:0});w.draw=()=>{};for(const e of [w.element,w.inputEl])if(e?.style)e.style.display='none';}
async function upload(file){
 // Keep the original display name on the asset; Comfy /view rejects names containing '..'.
 const extension=file.name.match(/\.(png|jpe?g|webp)$/i)?.[0].toLowerCase();
 if(!extension)throw new Error('上传暂支持 PNG、JPG、WebP');
 const body=new FormData();body.append('image',file,`${crypto.randomUUID()}${extension}`);body.append('type','input');body.append('subfolder','DAELAB/table');body.append('overwrite','false');const response=await businessFetch('/upload/image',{method:'POST',body});if(!response.ok)throw new Error(await response.text());const data=await response.json();return '/view?'+new URLSearchParams({filename:data.name,subfolder:data.subfolder||'',type:data.type||'input'});
}
function linkedReport(node){return node.graph?._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch'&&n.inputs?.some(i=>i.name==='storyboard_json'&&node.graph.links[i.link]?.origin_id===node.id))?.properties?.daelabLibTVBatch;}
function save(node,table){
 if(isGeneric(node))for(const field of table.fields)if(!field.readonly&&['text','longtext'].includes(field.type))enableColumnPrompt(table,field.id);
 const report=linkedReport(node);node.properties||={};const reports=node.properties.daelabTableReports||={};if(report)reports[report.project_uuid+':'+report.batch_id]=clone(report);
 for(const r of Object.values(reports).sort((a,b)=>(a.started_at||0)-(b.started_at||0)))writeGenerationResults(table,r);
 for(const row of table.records){const doc=row.values[promptField(table)];if(isColumnPrompt(effectivePrompt(table,row,promptField(table)))){row.meta||={};row.meta.promptEditorFingerprint=promptFingerprint(table,row);}if(doc&&typeof doc==='object'&&!isColumnPrompt(doc))doc.editorFingerprint=promptFingerprint(table,row);}
 node.__dataTable=table;if(isGeneric(node))setWidget(node,'table_data',JSON.stringify(table));else{node.__daelabStoryboardState=projectStoryboard(table);setWidget(node,'storyboard_data',serializeStoryboardTable(table));}
 node.__promptUI?.observe();
}
function fit(node){if(!node.graph)return;const width=Math.max(isGeneric(node)?720:920,node.size?.[0]||1080);node.setSize?.([width,1]);node.arrange?.();node.setSize?.([width,Math.max(558,node.computeSize()[1])]);}

function mappingDialog(node,editor){
 const table=node.__dataTable,m=promptConfig(table),d=editor.openDialog('字段映射'),controls={};
 const hint=document.createElement('p');hint.textContent='绑定字段 ID，改列名或调换列位置不会改变含义。删除绑定字段后，可在这里重新选择。视频仅使用列头图钉标记的素材列；“参考素材”映射决定该列排在参考序列首位。';d.append(hint);
 for(const [role,label] of Object.entries(isGeneric(node)?{image_prompt:'画面描述',camera_notes:'镜头备注',image_url:'参考素材'}:STORYBOARD_ROLES)){
  const row=document.createElement('label');row.append(document.createTextNode(label));const select=document.createElement('select');select.setAttribute('aria-label',label);select.add(new Option('不绑定',''));
  const types=['image_url','video_result'].includes(role)?['assets']:['source','original_fields'].includes(role)?['json']:['text','longtext','select'];
  for(const f of table.fields.filter(f=>types.includes(f.type)))select.add(new Option(f.name,f.id));select.value=m.bindings?.[role]||'';row.append(select);d.append(row);controls[role]=select;
 }
 d.append(button('取消',()=>d.remove()),button('保存映射',()=>{editor.change(t=>{t.meta.prompt_config||=clone(promptConfig(t));const cfg=t.meta.prompt_config;cfg.bindings={...cfg.bindings,...Object.fromEntries(Object.entries(controls).map(([k,s])=>[k,s.value]))};if(t.meta.storyboard)t.meta.storyboard.bindings={...cfg.bindings};for(const [key,type,name] of [['generation_status','text','生成状态'],['video_result','assets','视频结果']])if(!t.fields.some(f=>f.id===cfg.bindings[key]))cfg.bindings[key]=addField(t,{name,type,readonly:true,width:180}).id;});d.remove();}));
 if(table.meta.prompt_mode==='reviewed')d.append(button(isGeneric(node)?'关闭生成配置':'恢复旧模式',()=>{if(!window.confirm('保留解析结果，切换生成模式？可撤销。'))return;editor.change(t=>{delete t.meta.prompt_mode;});d.remove();}));
}



function createPanel(node){
 studioTheme();workbenchTheme();tableTheme();const root=document.createElement('div');root.className='dae-ui dae-table-panel daelab-storyboard-panel';
 const heading=document.createElement('header');heading.className='studio-heading';const title=document.createElement('div');const name=document.createElement('strong');name.textContent=isGeneric(node)?'多维表格':'分镜表';title.append(name);heading.append(title);
 const tabs=document.createElement('nav');tabs.className='studio-tabs';heading.append(tabs);root.append(heading);
 let tools=document.createElement('div');tools.className='studio-group-head';root.append(tools);
 let updateSummary=()=>{},promptUI=null,generationUI=null;
 const widgetDocument=bindBusinessDocument(node,()=>Object.fromEntries(['main_prompt','force_run_token'].filter(name=>widget(node,name)).map(name=>[name,widget(node,name).value])),value=>{for(const [name,item] of Object.entries(value))setWidget(node,name,item);});
 const editor=createTableEditor({getPanelContext:root=>globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root),clipboard:tableClipboard,documentFactory:(read,write)=>bindBusinessDocument(node,read,write,tableInputStamp),removeEmptyNode:table=>removeEmptyTableNode(node,table),validateChange:assertTransition,promptColumnsOnly:isGeneric(node),nativeHistory:tableHistory(app),displayContent:()=>isGeneric(node)&&globalThis[Symbol.for('DAELAB.CreativeCanvas.API.v1')]?.getPanelContext?.(root)?.presentation==='content',getTable:()=>node.__dataTable,setTable:t=>{generationUI?.syncPromptChanges(t,node.__dataTable);save(node,t);updateSummary();},upload,notify,isRowStateEmpty:t=>isGeneric(node)&&!t.meta.prompt_config,getRowState:(t,r)=>isGeneric(node)&&!t.meta.prompt_config?{issues:[],hint:''}:storyboardTaskState(t,r),renderCell:args=>promptUI?.renderCell(args),decorateAsset:(...args)=>promptUI?.decorateAsset(...args),onRestore:()=>{promptUI?.invalidate();generationUI?.invalidate();}});
 const optimization=attachPromptOptimization({node,graph:node.graph,editor,getTable:()=>node.__dataTable,identity:ensureIdentity(node.graph,node),fetchApi:businessFetch});
 function defaults(){return promptConfig(node.__dataTable).defaults||{};}
 function syncDefaults(){const next=defaults();if(JSON.stringify(next)!==JSON.stringify(promptConfig(node.__dataTable).defaults||{}))editor.change(t=>{t.meta.prompt_config||=clone(promptConfig(t));t.meta.prompt_config.defaults=next;});}
 node.__syncPromptDefaults=syncDefaults;
 const feedback=document.createElement('p');feedback.className='table-parse-feedback';feedback.setAttribute('role','status');feedback.hidden=true;
 promptUI=createPromptEditor({renderFrame:(segment,row)=>generationUI?.renderFrame(segment,row),getTable:()=>node.__dataTable,editor,notify,getDefaults:defaults,onStatus:state=>{feedback.textContent=state.message;feedback.dataset.error=String(Boolean(state.error));feedback.hidden=!state.message;root.setAttribute('aria-busy',String(state.busy));},request:async body=>{const r=await businessFetch('/daelab/storyboard/parse-prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'解析接口不可用，请重启 ComfyUI');return data;}});node.__promptUI=promptUI;
 const parseButton=button('解析选中行',()=>{syncDefaults();return promptUI.parse();},true);tools.append(parseButton);
 const groups=createAssetGroups({getTable:()=>node.__dataTable,change:editor.change,beginAsync:editor.beginAsync,canAsync:editor.canAsync,releaseAsync:editor.releaseAsync,upload,notify});
 const tableTab=button('任务表',()=>show(false)),groupTab=button('素材组',()=>show(true));tabs.append(tableTab,groupTab);
 const views=createTablePanelViews({editor,groups,tableTab,groupTab});
 function show(group){views.show(group);}
 let importing=false;
 async function importFile(file){
  if(importing)return;importing=true;const ticket=editor.beginAsync(),snapshot=JSON.stringify(node.__dataTable);
  try{
   const body=new FormData();body.append('file',file,file.name);const response=await businessFetch('/daelab/storyboard/import_document?preview=1',{method:'POST',body});if(!response.ok){let detail='文档解析失败';try{detail=(await response.json()).error||detail;}catch{}throw new Error(detail);}
   const confirmed=await previewImport(await response.json(),upload);if(!confirmed)return;
   if(!editor.canAsync(ticket)||snapshot!==JSON.stringify(node.__dataTable))throw new Error('预览期间表格已变化，未覆盖现有记录，请重新导入');
   editor.applyAsync(ticket,t=>importRows(t,confirmed.result,confirmed.mode));show(false);updateSource();notify(`已导入 ${confirmed.result.shots.length} 条记录`);
  }catch(e){notify(e.message,'error');}finally{editor.releaseAsync(ticket);importing=false;}
 }
 const source=document.createElement('span');source.className='studio-hint';source.style.cssText='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
 const updateSource=()=>source.textContent=node.__dataTable.meta.storyboard?.source_filename||'字段可增删、改名、隐藏和拖动排序';
 if(!isGeneric(node)){
  const picker=document.createElement('input');picker.type='file';picker.accept='.docx,.xlsx,.xlsm,.csv,.tsv,.txt,.md,.pdf';picker.hidden=true;picker.onchange=()=>{const f=picker.files[0];picker.value='';if(f)void importFile(f);};
  editor.toolbar.append(button('导入文稿',()=>picker.click()),picker);
  root.addEventListener('dragover',e=>e.preventDefault());root.addEventListener('drop',e=>{e.preventDefault();const file=e.dataTransfer?.files?.[0];if(file&&/\.(docx|xlsx|xlsm|csv|tsv|txt|md|pdf)$/i.test(file.name))void importFile(file);});
 }
 source.hidden=true;root.title='';
 const run=button(isGeneric(node)?'输出表格':'输出分镜任务',async()=>{try{const force=widget(node,'force_run_token');if(force)widgetDocument.edit('输出表格',draft=>{draft.force_run_token=Number(force.value||0)+1;});await app.queuePrompt(0,1,[node.id]);}catch(e){notify(e.message,'error');}});
 const settings=document.createElement('details');settings.className='table-settings';const summary=document.createElement('summary');summary.textContent='设置';settings.append(summary);
 if(!isGeneric(node))settings.append(button('查看文稿说明',()=>{settings.open=false;const d=editor.openDialog('文稿说明');const p=document.createElement('pre');p.style.whiteSpace='pre-wrap';p.textContent=node.__dataTable.meta.storyboard.document_notes||'这份文稿没有表外说明。';d.append(p,button('关闭',()=>d.remove()));}));
 if(node.type==='DAELAB.StoryboardImport')settings.append(button('添加逐行生成设置',()=>{editor.change(addGenerationFields);settings.open=false;notify('生成秒数和生成方式留空时沿用视频面板。首尾帧按参考素材顺序：第一张首帧，第二张尾帧。');}),run);else settings.append(run);
 if(isGeneric(node))settings.append(button('添加逐行生成设置',()=>{editor.change(addGenerationFields);settings.open=false;}));
 editor.toolbar.append(settings);
 let closeGeneration=null;
 const mapping=button('配置字段映射',()=>mappingDialog(node,editor));editor.toolbar.prepend(mapping,button('编辑整列模板',()=>{let id=promptField(node.__dataTable);if(!node.__dataTable.fields.some(f=>f.id===id))editor.change(t=>{const f=addField(t,{name:'最终提示词',type:'json',presentation:'prompt',width:360});id=f.id;t.meta.prompt_config||={};t.meta.prompt_config.bindings||={};t.meta.prompt_config.bindings.final_prompt=id;});promptUI.editTemplate(id);}));

 const status=document.createElement('div');status.className='table-task-summary';status.setAttribute('role','status');
 updateSummary=()=>{
  const selected=node.__dataTable.records.filter(r=>r.selected).length;tools.hidden=!selected;
  const parseLabel=`解析选中行 (${selected})`,mappingLabel=node.__dataTable.meta.prompt_config?'字段映射':'配置字段映射';
  if(parseButton.textContent!==parseLabel)parseButton.textContent=parseLabel;
  if(mapping.textContent!==mappingLabel)mapping.textContent=mappingLabel;
  const configured=Boolean(node.__dataTable.meta.prompt_config||node.__dataTable.meta.storyboard);parseButton.disabled=!selected||!configured;
  if(isGeneric(node)&&!node.__dataTable.meta.prompt_config){const label=`共 ${node.__dataTable.records.length} 条记录 · 请先点击“配置字段映射”，再解析选中行`;if(status.textContent!==label)status.textContent=label;return;}
  const state=selectedTaskSummary(node.__dataTable);status.replaceChildren(document.createTextNode(`已选 ${state.selected} 条 · ${state.ready} 条可生成 · ${state.invalid} 条待补充${state.active?' · '+state.active+' 条处理中':''}${state.complete?' · '+state.complete+' 条已完成':''}`));status.dataset.invalid=String(state.invalid>0);if(state.invalid)status.append(button('定位问题',()=>{show(false);editor.focusCell(state.issues[0].record,state.issues[0].field);}));parseButton.dataset.primary=String(!state.ready||Boolean(state.invalid));
 };

 const style=widget(node,'main_prompt');if(style){const input=document.createElement('input');input.setAttribute('aria-label','全局风格');input.placeholder='全局画面风格';input.value=style.value||'';let group=null;input.onfocus=()=>{group=crypto.randomUUID();};input.onblur=()=>{group=null;};input.oninput=()=>widgetDocument.edit('全局风格',draft=>{draft.main_prompt=input.value;},{group});editor.toolbar.append(input);}
 editor.toolbar.prepend(tabs);heading.append(editor.toolbar);root.append(editor.root,groups.root,status,feedback);editor.selectionActions.append(...tools.children);tools.remove();tools=editor.selectionActions;updateSource();updateSummary();
 const workbench=createWorkbench(node,root,{title:isGeneric(node)?'多维表格工作台':'分镜工作台',onResize:()=>fit(node),onClose:()=>{closeGeneration?.();promptUI.close();editor.closeDialogs();}});tabs.append(workbench.trigger);
 for(const e of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','wheel','keydown','drop'])root.addEventListener(e,event=>{if(e==='wheel'&&event.ctrlKey||e==='pointerdown'&&event.button===1||e==='mousedown'&&event.button===1)return;stopCanvasPropagation(event);});
 node.__storyboardResultUI=()=>{
  const report=linkedReport(node);if(!report)return;
  const next=clone(node.__dataTable);writeGenerationResults(next,report);if(JSON.stringify(next)!==JSON.stringify(node.__dataTable)){editor.nativeDocument.replace(next,{derived:true,afterWrite:()=>{editor.render();updateSummary();}});}
 };
 const presentation=isGeneric(node)?installContentPresentation({root,editor,getTable:()=>node.__dataTable,notify,editPromptTemplate:id=>promptUI.editTemplate(id),onPresentationChange:active=>views.setContent(active)}):null;
 generationUI=isGeneric(node)?attachGenerationColumns({editor,getTable:()=>node.__dataTable,notify,editPromptTemplate:id=>promptUI.editTemplate(id)}):null;
 let sourceDisposed=false;
 const sourceTimer=isGeneric(node)?setInterval(()=>{
  if(sourceDisposed||!node.graph||node.mode||!node.inputs?.some(i=>i.name==='source_table'&&i.link!=null))return;
  try{
   const next=readTableView(node);
   if(JSON.stringify(next)!==JSON.stringify(node.__dataTable)){
    // A live projection is part of the upstream edit, not another user edit.
    // Otherwise the 500 ms refresh can consume the first Undo with an unchanged
    // source table, and its next refresh can erase Redo after a restore.
    editor.nativeDocument.replace(next,{derived:true,afterWrite:()=>{editor.render();updateSummary();}});
   }
   root.removeAttribute('data-source-error');
  }catch(error){root.dataset.sourceError=error.message;}
 },500):null;
 editor.render();return {tasks:()=>[...optimization.tasks(),...(generationUI?.tasks()||[]),...promptUI.tasks()],root:workbench.host,editor,height:workbench.height,close:()=>{optimization.pause();generationUI?.invalidate();presentation?.close();promptUI.invalidate();promptUI.close();closeGeneration?.();editor.closeDialogs();workbench.close();},render:()=>{optimization.observe();workbench.restoreHeight();promptUI.observe();editor.render();groups.render();updateSource();updateSummary();},destroy:()=>{sourceDisposed=true;widgetDocument.dispose();clearInterval(sourceTimer);optimization.destroy();generationUI?.destroy();presentation?.destroy();promptUI.destroy();delete node.__promptUI;delete node.__syncPromptDefaults;closeGeneration?.();workbench.destroy();editor.destroy();}};
}

function install(node){
 if(!node.graph)return;
 if(isGeneric(node)&&!node.inputs?.some(i=>i.name==='source_table'))node.addInput('source_table','STRING');
 if(isGeneric(node)){
  const index=node.inputs.findIndex(input=>input.name==='source_table'),link=node.graph.links[node.inputs[index].link],source=node.graph.getNodeById(link?.origin_id);
  // Old STRING sockets accepted text nodes; that hidden link blocks table reads.
  if(source&&(!isTableSource(source)||link.origin_slot!==0))node.disconnectInput(index);
 }
 const duplicate=node.graph._nodes?.some(n=>n!==node&&n.properties?.[NAMESPACE]?.tableId&&n.properties[NAMESPACE].tableId===node.properties?.[NAMESPACE]?.tableId);ensureIdentity(node.graph,node,{duplicate});

 const raw=widget(node,dataName(node))?.value;
 try{const next=isGeneric(node)?(raw?normalizeTable(raw):createMaterialTable()):readStoryboard(raw);if(node.__dataTable){preserveGenerationHistory(node.__dataTable,next);assertTransition(node.__dataTable,next,{restoring:true});}node.__dataTable=next;}catch(e){notify(`表格未加载：${e.message}`,'error');return;}
 syncGenerationConfigOwners(node.__dataTable);
 // Loading a saved empty table never deletes its node or links.
 if(isGeneric(node)){const data=widget(node,'table_data');if(data)data.serializeValue=createTableWidgetSerializer(node,data,readTableView);}
 hideNative(node,dataName(node));hideNative(node,'main_prompt');save(node,node.__dataTable);
 if(node.__dataTablePanel){node.__dataTablePanel.render();return;}
 removeOwnedWidgets(node,OWNER);const panel=createPanel(node);node.__dataTablePanel=panel;node.__daelabStoryboardRender=panel.render;
 const w=node.addDOMWidget(panelName(node),'custom',panel.root,{serialize:false,hideOnZoom:false,getHeight:()=>panel.height(),getMinHeight:()=>panel.height(),getValue:()=>'',setValue:()=>panel.render()});
 w[OWNER]=true;w.serialize=false;w.inputEl=panel.root;w.label=isGeneric(node)?'多维表格':'分镜表';w.computeSize=width=>[width||1080,panel.height()];w.computeLayoutSize=()=>({minHeight:panel.height(),maxHeight:panel.height(),minWidth:isGeneric(node)?720:920});
 const removed=w.onRemove?.bind(w);w.onRemove=()=>{panel.destroy();removed?.();panel.root.remove();};
 requestAnimationFrame(()=>fit(node));
}
export function registerTableNodes(){
 if(globalThis.__DAELAB_TABLE_VERSION===VERSION)return;globalThis.__DAELAB_TABLE_VERSION=VERSION;
 app.registerExtension({name:'DAELab.DataTable',beforeRegisterNodeDef(type,data){
  if(!TYPES.includes(data.name))return;
  if(data.name==='DAELAB.Table'){
   const connectInput=type.prototype.onConnectInput;
   type.prototype.onConnectInput=function(index,outputType,output,source,sourceSlot){
    if(this.inputs[index]?.name==='source_table'&&(!isTableSource(source)||sourceSlot!==0))return false;
    return connectInput?.apply(this,arguments)??true;
   };
  }
  for(const method of ['onNodeCreated','onAdded','onConfigure']){const prev=type.prototype[method];type.prototype[method]=function(){const result=prev?.apply(this,arguments);if(method==='onConfigure'&&this.__dataTablePanel){this.__dataTablePanel.close();this.__dataTablePanel.editor.invalidateAsync();this.__dataTablePanel.editor.history.undoStack=[];this.__dataTablePanel.editor.history.redoStack=[];}scheduleTableInstall(this,install);return result;};}
  const removed=type.prototype.onRemoved;type.prototype.onRemoved=function(){removeOwnedWidgets(this,OWNER);delete this.__dataTablePanel;delete this.__daelabStoryboardRender;delete this.__storyboardResultUI;return removed?.apply(this,arguments);};
 }});
}
