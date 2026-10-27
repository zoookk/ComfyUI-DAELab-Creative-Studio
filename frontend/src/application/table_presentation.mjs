import {applyMaterialCellToColumn} from './table_material_columns.mjs';
import {isGeneration,rowGenerationConfig,setRowGenerationConfig,generationConfigField} from '../features/generation/table_generation_model.mjs';
import {isPrompt,promptField} from '../features/prompt/table_prompt_model.mjs';
import {addField,addRecord,removeField,clone,uid,reorder,emptyValue} from './table_model.mjs';
import {createTableButton as button} from '../ui/table_controls.mjs';
import {applyPromptToColumn} from '../features/prompt/table_prompt_template.mjs';
import {previewContentAsset} from './table_content_view.mjs';
import {createPromptOptimizationEntry} from '../features/prompt/prompt_optimization_panel.mjs';
import {isTextColumn} from '../features/prompt/table_prompt_source.mjs';

const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text)e.textContent=text;return e;};

// One instance-owned contextual menu; the existing editor remains the transaction
// owner. This module never reads another plugin's node or private application state.
export function installContentPresentation({root,editor,getTable,notify,editPromptTemplate,enabled=()=>true,onPresentationChange=()=>{}}){
    const toolbar=el('aside','dae-ui content-context');toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','表格选中操作');if(!toolbar.hidden)toolbar.hidden=true;document.body.append(toolbar);
    let selected=null,signature='',disposed=false,columnGrid=null,columnSelection=null,rowGrid=null,rowSelection=null,cellAnchor=null,columnAnchor=null,rowAnchor=null,optimizationEntry=null,nativeMenuOpen=false;
    const context=()=>editor.panelContext?.();
    // Activity checks must not flush the full table layout on every poll/input.
    // Older adapters retain their geometry-based fallback.
    const active=()=>{const panel=context();return enabled()&&panel?.presentation==='content'&&root.isConnected&&(typeof panel.active==='boolean'?panel.active:!!panel.getViewport());};
    const nativeActive=()=>enabled()&&nativeMenuOpen&&root.isConnected&&!context();
    const findCell=()=>{if(!selected?.record)return null;if(!cellAnchor?.isConnected||cellAnchor.dataset.field!==selected.field||cellAnchor.dataset.record!==selected.record)cellAnchor=root.querySelector(`td[data-field="${CSS.escape(selected.field)}"][data-record="${CSS.escape(selected.record)}"]`);return cellAnchor;};
    const field=()=>getTable().fields.find(f=>f.id===selected?.field);
    const mutate=fn=>{try{editor.change(fn);signature='';tick();}catch(e){notify(e.message);}};
    function rename(){
        const row=selected?.kind==='row',item=row?getTable().records.find(r=>r.id===selected.record):field();if(!item)return;
        const title=row?'行':'列',d=editor.openDialog('重命名'+title),input=el('input');input.value=item.name||(row?'任务'+(getTable().records.indexOf(item)+1):'');input.setAttribute('aria-label',title+'名称');
        const save=()=>{if(!input.value.trim())return;mutate(t=>(row?t.records:t.fields).find(x=>x.id===item.id).name=input.value.trim());d.remove();};
        d.append(input,button('保存',save),button('取消',()=>d.remove()));input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing)save();};input.focus();input.select();
    }
    function build(){
        const prompt=isPrompt(field());
        optimizationEntry?.destroy();optimizationEntry=null;
        toolbar.replaceChildren();const label=el('span','content-context-label',selected.kind==='table'?'表格':selected.kind==='column'?field()?.name:selected.kind==='row'?'行':'单元格');toolbar.append(label);
        if(isTextColumn(getTable(),field())&&editor.openPromptOptimization&&(selected.kind==='column'||selected.kind==='cell'&&(nativeActive()||editor.selection().flat().length<=1))){
            const menuEditor={openPromptOptimization:target=>editor.openPromptOptimization({...target,anchor:target.scope==='column'?columnAnchor||target.anchor:findCell()||target.anchor})};
            optimizationEntry=createPromptOptimizationEntry({editor:menuEditor,target:{scope:selected.kind==='column'?'column':'cell',fieldId:selected.field,...(selected.kind==='cell'?{recordId:selected.record}:{})}});toolbar.append(optimizationEntry.element);
        }
        if(nativeActive())return;
        if(selected.kind==='table'){
            toolbar.append(button('提示词模板',()=>{let id=promptField(getTable());if(!getTable().fields.some(f=>f.id===id)){mutate(t=>{const f=addField(t,{name:'最终提示词',type:'json',presentation:'prompt',width:360});id=f.id;t.meta.prompt_config||={};t.meta.prompt_config.bindings||={};t.meta.prompt_config.bindings.final_prompt=id;});}editPromptTemplate?.(id);}),button('撤销',()=>{editor.restore();signature='';}),button('重做',()=>{editor.restore(true);signature='';}));
            const density=el('select');density.setAttribute('aria-label','内容显示');for(const [v,n] of [['comfortable','舒适'],['compact','紧凑']])density.add(new Option(n,v));density.value=getTable().meta.density||'comfortable';density.onchange=()=>mutate(t=>t.meta.density=density.value);toolbar.append(density);
        }else if(selected.kind==='column'){
            toolbar.append(button('重命名',rename));
            toolbar.append(button('复制列',()=>mutate(t=>{const old=t.fields.find(f=>f.id===selected.field),next=addField(t,{...clone(old),id:uid(),name:old.name+' 副本'});reorder(t.fields,next.id,old.id,true);for(const r of t.records){r.values[next.id]=clone(r.values[old.id]??emptyValue(old));if(Array.isArray(r.values[next.id]))for(const a of r.values[next.id])a.id=uid();}selected={kind:'column',field:next.id};})),button('删除列',()=>mutate(t=>{removeField(t,selected.field);selected={kind:'table'};})));
        }else if(selected.kind==='row'){
            const recordId=selected.record;
            toolbar.append(button('重命名',rename),button('复制行',()=>mutate(t=>{
                const source=clone(t.records.find(row=>row.id===recordId)),copy=addRecord(t,source.values,recordId);
                Object.assign(copy,source,{id:copy.id,name:(source.name||'任务'+(t.records.findIndex(r=>r.id===recordId)+1))+' 副本',selected:false});
                if(copy.meta){delete copy.meta.generation;delete copy.meta.generationColumns;}
                selected={kind:'row',record:copy.id};
            })),button('删除行',()=>mutate(t=>{t.records=t.records.filter(r=>r.id!==recordId);selected={kind:'table'};})));
        }else{
            const f=field(),value=getTable().records.find(r=>r.id===selected.record)?.values[f?.id];
            const region=editor.selection().flat(),many=region.length>1;
            if(!many&&f?.type==='content'&&!f.readonly)toolbar.append(button('添加图片',()=>findCell()?.dispatchEvent(new Event('dae-upload'))));
            if(!many&&prompt&&!f.readonly){const fill=button('应用到整列',()=>mutate(t=>{
                const source=t.records.find(row=>row.id===selected.record);
                applyPromptToColumn(t,selected.field,selected.record);
                for(const target of new Set(t.fields.filter(field=>isGeneration(field)&&field.generation.promptFieldId===selected.field).map(field=>generationConfigField(t,field.id)))){
                    const config=rowGenerationConfig(source,target.id,target.generation);
                    for(const row of t.records)setRowGenerationConfig(row,target.id,config);
                }
            }));fill.title='覆盖本列所有行的提示词和当前生成配置；@列引用仍读取各自行的素材，配置不再跟随默认值，可撤销';toolbar.append(fill);}
            if(!many&&['assets','content'].includes(f?.type)&&!f.readonly&&Array.isArray(value)&&value.length){const fill=button('应用到整列',()=>mutate(t=>applyMaterialCellToColumn(t,selected.field,selected.record)));fill.title='用当前格全部素材覆盖本列其他行，保留素材顺序，可撤销';toolbar.append(fill);}
            if(!many&&['assets','content'].includes(f?.type)&&!f.readonly)toolbar.append(button('清空',()=>editor.clearCells([{row:{id:selected.record},field:f}])));
        }
    }
    function choose(e){
        if(toolbar.contains(e.target)||e.target.closest('.prompt-opt-popover,.table-prompt-toggle,dialog,.dae-table-material-preview,.table-text-side,.table-column-popover,.table-structure-control,.table-choice input,.generation-actions,.generation-cell-state'))return;
        if(nativeMenuOpen){nativeMenuOpen=false;selected=null;if(!toolbar.hidden)toolbar.hidden=true;}
        if(e.type==='focusin'&&!root.contains(e.target))return;
        if(!active()||!context()?.contains(e.target)){if(selected)editor.clearSelection();selected=null;if(!toolbar.hidden)toolbar.hidden=true;queueMicrotask(tick);return;}
        if(e.target.closest('[data-inline-editing=true]')){selected=null;editor.clearSelection();if(!toolbar.hidden)toolbar.hidden=true;root.querySelectorAll('[data-column-selected=true]').forEach(e=>delete e.dataset.columnSelected);queueMicrotask(tick);return;}
        const cell=e.target.closest('td[data-field]'),th=e.target.closest('th[data-column]'),row=e.target.closest('.table-choice[data-content-row]');
        selected=cell?{kind:'cell',field:cell.dataset.field,record:cell.dataset.record}:th?{kind:'column',field:th.dataset.column}:row?{kind:'row',record:row.dataset.contentRow}:{kind:'table'};
        if(selected.kind==='column')editor.selectColumn(selected.field);else if(selected.kind!=='cell')editor.clearSelection();signature='';queueMicrotask(tick);
    }
    function tick(){
        if(disposed)return;const showing=String(Boolean(active()));if(root.dataset.contentPresentation!==showing){root.dataset.contentPresentation=showing;onPresentationChange(showing==='true');editor.render();}
        const chosen=String(showing==='true'&&!!context()?.selected||nativeActive());if(root.dataset.contentSelected!==chosen)root.dataset.contentSelected=chosen;
        if(chosen==='false'&&selected){selected=null;editor.clearSelection();}
        if(showing!=='true'&&!nativeActive()){columnGrid=null;columnSelection=null;rowGrid=null;rowSelection=null;if(!toolbar.hidden)toolbar.hidden=true;return;}
        const grid=root.querySelector('table'),column=selected?.kind==='column'?selected.field:null;
        if(grid!==columnGrid||column!==columnSelection){
            columnGrid=grid;columnSelection=column;
            root.querySelectorAll('th[data-column],td[data-field]').forEach(e=>{const chosen=String(Boolean(column)&&(e.dataset.column||e.dataset.field)===column);if(e.dataset.columnSelected!==chosen)e.dataset.columnSelected=chosen;if(e.matches('th')&&e.getAttribute('aria-selected')!==chosen)e.setAttribute('aria-selected',chosen);});
        }
        const row=selected?.kind==='row'?selected.record:null;
        if(grid!==rowGrid||row!==rowSelection){
            rowGrid=grid;rowSelection=row;
            root.querySelectorAll('tr[data-record-id]').forEach(e=>{const chosen=String(Boolean(row)&&e.dataset.recordId===row);if(e.dataset.rowActive!==chosen)e.dataset.rowActive=chosen;const gutter=e.querySelector('.table-choice');if(gutter&&gutter.getAttribute('aria-selected')!==chosen)gutter.setAttribute('aria-selected',chosen);});
        }
        if((!active()||!context()?.selected)&&!nativeActive()||!selected){if(!toolbar.hidden)toolbar.hidden=true;return;}
        const key=JSON.stringify([selected,getTable().fields,editor.selection().reduce((count,row)=>count+row.length,0),selected.kind==='cell'?getTable().records.find(r=>r.id===selected.record)?.values[selected.field]:null]);if(key!==signature){signature=key;build();}
        positionToolbar();
    }
    function positionToolbar(){
        if(disposed)return;
        if(!selected||root.querySelector('[data-inline-editing=true],[data-structure-dragging],[data-structure-popup]')||((!context()?.selected||!active())&&!nativeActive())){if(!toolbar.hidden)toolbar.hidden=true;return;}
        if(selected.kind==='column'&&(!columnAnchor?.isConnected||columnAnchor.dataset.column!==selected.field))columnAnchor=root.querySelector(`th[data-column="${CSS.escape(selected.field)}"]`);
        if(selected.kind==='row'&&(!rowAnchor?.isConnected||rowAnchor.dataset.contentRow!==selected.record))rowAnchor=root.querySelector(`.table-choice[data-content-row="${CSS.escape(selected.record)}"]`);
        let anchor=selected.kind==='cell'?findCell():selected.kind==='column'?columnAnchor:selected.kind==='row'?rowAnchor:null;
        if(!anchor&&selected.kind!=='table'){selected={kind:'table'};signature='';return;}
        if(toolbar.hidden)toolbar.hidden=false;const r=anchor?anchor.getBoundingClientRect():context().getBounds(),bounds=nativeActive()?{left:0,top:0,right:document.documentElement.clientWidth,bottom:document.documentElement.clientHeight,width:document.documentElement.clientWidth}:context().getViewport();toolbar.style.boxSizing='border-box';toolbar.style.maxWidth=Math.max(160,Math.min(bounds.width,document.documentElement.clientWidth)-32)+'px';const h=toolbar.getBoundingClientRect().height,w=toolbar.getBoundingClientRect().width;
        if(r.bottom<bounds.top||r.top>bounds.bottom){if(!toolbar.hidden)toolbar.hidden=true;return;}
        toolbar.style.left=Math.max(bounds.left+8,Math.min(r.left,Math.min(bounds.right,document.documentElement.clientWidth)-w-16))+'px';toolbar.style.top=Math.max(bounds.top+8,Math.min(r.top-h-10>=bounds.top?r.top-h-10:r.bottom+10,bounds.bottom-h-8))+'px';
    }
    const double=e=>{if(e.target.closest('button,input,.dae-column-divider'))return;const row=e.target.closest('.table-choice[data-content-row]');if(row&&root.contains(row)&&active()){e.preventDefault();e.stopPropagation();selected={kind:'row',record:row.dataset.contentRow};rename();return;}const th=e.target.closest('th[data-column]');if(th&&root.contains(th)&&active()){e.preventDefault();e.stopPropagation();selected={kind:'column',field:th.dataset.column};rename();}};
    const showPreview=e=>previewContentAsset(editor,e.detail);
    const nativeContext=e=>{
        if(context()||!editor.openPromptOptimization||e.target.closest('[data-inline-editing=true],input,textarea,select'))return;
        const cell=e.target.closest('td[data-field]'),header=e.target.closest('th[data-column]'),fieldId=cell?.dataset.field||header?.dataset.column;
        const f=getTable().fields.find(item=>item.id===fieldId);if(!isTextColumn(getTable(),f))return;
        e.preventDefault();e.stopPropagation();nativeMenuOpen=true;selected=cell?{kind:'cell',field:fieldId,record:cell.dataset.record}:{kind:'column',field:fieldId};signature='';tick();
    };
    const layout=()=>{if(root.dataset.contentPresentation!==String(Boolean(active())))tick();else positionToolbar();};
    const escape=e=>{if(e.key==='Escape'&&!e.isComposing&&!e.target.matches('input,textarea,select')){nativeMenuOpen=false;selected=null;editor.clearSelection();if(!toolbar.hidden)toolbar.hidden=true;tick();}};
    for(const type of ['pointerdown','focusin'])document.addEventListener(type,choose,true);
    document.addEventListener('keydown',escape,true);root.addEventListener('dblclick',double,true);root.addEventListener('dae-preview',showPreview);root.addEventListener('contextmenu',nativeContext);
    globalThis.addEventListener('dae-canvas-layout',layout);
    const timer=setInterval(tick,100);
    return {close(){nativeMenuOpen=false;if(selected)editor.clearSelection();selected=null;if(!toolbar.hidden)toolbar.hidden=true;},destroy(){disposed=true;clearInterval(timer);optimizationEntry?.destroy();toolbar.remove();for(const type of ['pointerdown','focusin'])document.removeEventListener(type,choose,true);document.removeEventListener('keydown',escape,true);root.removeEventListener('dblclick',double,true);root.removeEventListener('dae-preview',showPreview);root.removeEventListener('contextmenu',nativeContext);globalThis.removeEventListener('dae-canvas-layout',layout);}};
}
