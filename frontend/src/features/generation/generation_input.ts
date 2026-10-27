type InputKind = 'table' | 'rows' | 'text' | 'image' | 'video' | 'group' | null;
type NodeId = string | number;
interface InputNode {
  id?: NodeId;
  type?: string;
  outputs?: { type: string | number }[];
  inputs?: { name: string; link?: NodeId | null }[];
  widgets?: { name: string; value: unknown }[];
  graph?: {
    links: Record<NodeId, { origin_id: NodeId; origin_slot: number }>;
    getNodeById(id: NodeId): InputNode | null | undefined;
  };
}

export function generationInputKind(source: InputNode, slot: number): InputKind {
  if (['DAELAB.Table', 'DAELAB.ScriptParser'].includes(source.type || '')) return slot <= 0 ? 'table' : null;
  if (source.type === 'DAELAB.LLMStylePreviewB') return slot === 1 ? 'rows' : 'text';
  if (source.type === 'DAELAB.MediaUpload') {
    const raw = source.widgets?.find(widget => widget.name === 'asset_data')?.value;
    let asset: { kind?: string } | null;
    try { asset = JSON.parse(String(raw || '{}')) as { kind?: string } | null; }
    catch { return null; }
    if (asset?.kind === 'image') return slot < 0 || source.outputs?.[slot]?.type === 'IMAGE' ? 'image' : null;
    if (asset?.kind === 'video') return slot < 0 || slot === 2 ? 'video' : null;
    return null;
  }
  const types = (slot < 0 ? source.outputs : source.outputs?.slice(slot, slot + 1))?.map(output => output.type) || [];
  if (types.includes('IMAGE')) return 'image';
  if (types.includes('COMFYTV_VIDEO')) return 'video';
  if (types.includes('DAELAB_ASSETS')) return 'group';
  return types.includes('STRING') ? 'text' : null;
}

export function generationInputRole(name: string): string {
  return name.startsWith('texts.') ? 'text_input' : name.startsWith('images.') ? 'reference_images' : name.startsWith('videos.') ? 'reference_video' : name.startsWith('groups.') ? 'group' : name;
}

export function generationInputNames(target: InputNode, source: InputNode, slot: number, replacing = -1): string[] {
  const kind = generationInputKind(source, slot);
  if (!kind) return [];
  if ((target.inputs || []).some((input, index) => {
    if (index === replacing || input.link == null) return false;
    const link = target.graph?.links[input.link], upstream = link && target.graph?.getNodeById(link.origin_id);
    return upstream === source || source.id != null && String(link?.origin_id) === String(source.id);
  })) return [];
  const existing = (target.inputs || []).flatMap((input, index) => {
    if (index === replacing || input.link == null) return [];
    const link = target.graph?.links[input.link], upstream = link && target.graph?.getNodeById(link.origin_id);
    return [upstream && link ? generationInputKind(upstream, link.origin_slot) : null];
  });
  if (existing.length && (kind === 'table' || kind === 'rows' || existing.some(value => !['text', 'image', 'video', 'group'].includes(value || '')))) return [];
  if (kind === 'table' || kind === 'rows') return ['table_json'];
  if (kind === 'text') return ['text_input', ...(target.inputs || []).filter(input => input.name.startsWith('texts.')).map(input => input.name)];
  if (kind === 'video') return ['reference_video', ...(target.inputs || []).filter(input => input.name.startsWith('videos.')).map(input => input.name)];
  if (kind === 'group') return (target.inputs || []).filter(input => input.name.startsWith('groups.')).map(input => input.name);
  return ['first_frame', 'last_frame', 'reference_images', ...(target.inputs || []).filter(input => input.name.startsWith('images.')).map(input => input.name)];
}
