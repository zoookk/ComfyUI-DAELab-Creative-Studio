import {bindMaterialThumbnail} from '../ui/material_thumbnail.mjs';
export {bindMaterialThumbnail} from '../ui/material_thumbnail.mjs';
import {bindInlineEditor} from '../ui/inline_editor.mjs';
import {stopCanvasPropagation} from '../ui/creative_events.mjs';
import {isColumnPrompt,columnValue} from '../features/prompt/table_prompt_template.mjs';
import {columnReferenceOptions,materialReferenceLabel} from './table_reference_options.mjs';
import {readPromptSegments} from '../features/prompt/table_prompt_template_editor.mjs';
import {uid,setValue} from './table_model.mjs';
import {createTableButton as button} from '../ui/table_controls.mjs';

const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text)e.textContent=text;return e;};

export function renderContentCell(cell,row,field,{change,upload,notify,getTable,onCleanup,bindAssetDrag,beginAsync=()=>null,releaseAsync=()=>{}}){
    cell.classList.add('content-cell');
    const value=row.values[field.id],asset=Array.isArray(value)?value[0]:null;
    const display=el('div','content-display');cell.append(display);
    let materialCleanups=[];const clearMaterials=()=>{for(const dispose of materialCleanups)dispose();materialCleanups=[];};onCleanup(clearMaterials);
    const currentRow=()=>getTable().records.find(r=>r.id===row.id);
    function reference(option){
        const chip=el('span','dae-prompt-ref','@'+option.name);chip.contentEditable='false';chip.dataset.fieldId=option.id;if(option.assetIndex!==undefined)chip.dataset.assetIndex=String(option.assetIndex);if(option.assetId||option.asset?.id)chip.dataset.assetId=option.assetId||option.asset.id;
        try{const value=columnValue(getTable(),currentRow()||row,option.id,option.assetIndex,chip.dataset.assetId);chip.title=value.asset?.name||value.text;if(value.asset){chip.dataset.fieldId=value.field.id;chip.dataset.assetId=value.asset.id;chip.dataset.assetIndex=String(value.assetIndex);chip.textContent='@'+value.field.name+' · '+materialReferenceLabel(value.asset,value.assetIndex);const media=el(value.asset.kind==='video'?'video':'img','dae-ref-thumb');media.src=value.asset.url;media.draggable=false;chip.prepend(media);}}catch(e){chip.dataset.invalid='true';chip.textContent+=' · 失效引用';chip.title=e.message;}
        return chip;
    }
    function drawContent(value,editing=false){
        // Keep an already normalized Text node; rich DOM and pending media cleanup still rebuild.
        if(typeof value==='string'&&value!==''&&!materialCleanups.length&&display.classList.contains('content-text')&&!display.classList.contains('content-materials')&&display.childNodes.length===1&&display.firstChild.nodeType===3&&display.firstChild.nodeValue===value)return;
        clearMaterials();display.replaceChildren();const assets=!editing&&Array.isArray(value)?value:[];
        display.classList.toggle('content-materials',!!assets.length);
        display.classList.toggle('content-text',!assets.length);
        if(!assets.length){if(isColumnPrompt(value)){for(const s of value.segments)display.append(s.type==='text'?document.createTextNode(s.text):reference({...s,id:s.fieldId,name:getTable().fields.find(f=>f.id===s.fieldId)?.name||'已删除列'}));}else display.textContent=typeof value==='string'?value:'';return;}
        assets.forEach((asset,index)=>{
            const item=el('div','content-material'),media=el(asset.kind==='video'?'video':'img');media.src=asset.url;
            if(asset.kind!=='video')media.alt=asset.name||'图片';
            item.setAttribute('aria-label',`第 ${index+1} 个素材：${asset.name||'素材'}${field.readonly?'':'，Delete 移除'}`);
            materialCleanups.push(bindMaterialThumbnail(item,media,index,{cell,bindDrag:!bindAssetDrag?null:element=>bindAssetDrag(element,asset),remove:field.readonly?null:()=>change(t=>{const r=t.records.find(r=>r.id===row.id);r.values[field.id]=r.values[field.id].filter(a=>a.id!==asset.id);})}));
            item.ondblclick=e=>{e.stopPropagation();cell.dispatchEvent(new CustomEvent('dae-preview',{bubbles:true,detail:asset}));};
            item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();cell.dispatchEvent(new CustomEvent('dae-preview',{bubbles:true,detail:asset}));}});
            display.append(item);
        });
    }
    drawContent(value);
    if(!field.readonly){
        let original=null,expected=null,group=null;
        const current=()=>getTable().records.find(r=>r.id===row.id)?.values[field.id]??'';
        bindInlineEditor({cell,box:display,label:`编辑 ${field.name}`,onCleanup,notify,allowDoubleClick:!asset,
            draw:editing=>{const live=current();drawContent(live,editing);original=live;expected=JSON.stringify(original);group=uid();},
            read:()=>{const segments=readPromptSegments(display);return segments.some(s=>s.type==='column')?{kind:'column-template',version:1,segments}:segments.map(s=>s.text).join('');},
            write:value=>{if(JSON.stringify(current())!==expected)throw new Error('单元格已被更新，请重新编辑');change(t=>setValue(t,row.id,field.id,value),{render:false,group});expected=JSON.stringify(value);},
            reset:()=>{if(JSON.stringify(current())===expected)change(t=>setValue(t,row.id,field.id,original),{render:false,group});},
            ...(field.type==='content'?{columns:()=>columnReferenceOptions(getTable(),currentRow()||row).filter(f=>f.id!==field.id),getColumnChip:reference}:{})
        });
    }
    if(field.type!=='content'||field.readonly)return;
    const picker=el('input');picker.type='file';picker.multiple=true;picker.accept='.png,.jpg,.jpeg,.webp';picker.hidden=true;cell.append(picker);const add=button('添加图片',()=>picker.click());add.className='content-native-add';cell.append(add);
    picker.onchange=async()=>{const files=[...(picker.files||[])];if(!files.length)return;const ticket=beginAsync({recordId:row.id,fieldId:field.id}),before=JSON.stringify(row.values[field.id]);
        try{const additions=[];for(const file of files)additions.push({id:uid(),url:await upload(file),name:file.name,kind:'image'});change(t=>{const current=t.records.find(r=>r.id===row.id);if(!current||JSON.stringify(current.values[field.id])!==before)throw new Error('单元格已变化，未覆盖当前内容');setValue(t,row.id,field.id,[...(Array.isArray(current.values[field.id])?current.values[field.id]:[]),...additions]);},{tickets:[ticket]});}catch(error){notify(error.message);}finally{releaseAsync(ticket);picker.value='';}};
cell.addEventListener('dae-upload',()=>picker.click());
}

export function previewContentAsset(editor,asset){const d=editor.openDialog(asset.name||'素材预览'),media=el(asset.kind==='video'?'video':'img');media.src=asset.url;media.style.cssText='display:block;max-width:100%;max-height:70vh;object-fit:contain';if(asset.kind==='video'){media.controls=true;media.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();},true);}const close=()=>{media.pause?.();d.remove();};d.append(media,button('关闭预览',close));d.oncancel=close;}
