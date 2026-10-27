"""Stable native output slots. Execution reads verified results and never generates."""
import json
import re
from pathlib import PurePosixPath
from urllib.parse import urlsplit, parse_qs

from ....contracts.errors import InvalidInput
from ....media.validation import MediaResultValidator

NODE_ID = 'DAELAB.LibTV.VideoGenerate'
LEGACY_MODEL_OPTIONS = ['Seedance 2.5', 'Seedance 2.0', 'Seedance 2.0 Mini', 'Seedance 2.0 Fast', 'Minimax H3']


def read_current_result(service, task_data):
    if service is None:
        raise InvalidInput('Persistent asset services are unavailable; no native result can be read.')
    try:
        tasks = json.loads(task_data)
        row = next(r for r in tasks['table']['records'] if r['id'] == tasks['currentId'])
        field_id = tasks['fieldId']
        values = row['values'].get(field_id, [])
        if not values:
            raise InvalidInput('The selected task has no completed image/video result.')
        selected = values[-1]
        reference_map = row.get('meta', {}).get('studioGenerationRefs', {})
        if not isinstance(reference_map, dict):
            raise InvalidInput('Current generation references are malformed.')
        if 'studioGenerationRefs' in row.get('meta', {}):
            references = reference_map.get(field_id)
            provenance = selected.get('provenance')
            if (not isinstance(references, list) or not references or any(not isinstance(item, dict) for item in references)
                    or not isinstance(provenance, dict) or not isinstance(provenance.get('requestId'), str) or not provenance['requestId']):
                raise InvalidInput('Current generation reference is malformed.')
            request_id = provenance['requestId']
            matches = [item for item in references if item.get('requestId') == request_id]
            if len(matches) != 1:
                raise InvalidInput('Selected result must identify exactly one immutable task reference.')
            current = matches[0]
            if not isinstance(current.get('inputDigest'), str) or not re.fullmatch('[a-f0-9]{64}', current['inputDigest']):
                raise InvalidInput('Current generation reference has no frozen input digest.')
            job = service.jobs.get(request_id)
            if job['source'].get('inputDigest') != current['inputDigest'] or current.get('source', {}).get('inputDigest') != current['inputDigest']:
                raise InvalidInput('Current result input digest differs from its immutable source.')
            scope = tasks.get('sourceScope', {})
            expected = {key: scope.get(key) for key in ('documentId', 'tableId', 'nodeId')}
            expected.update(recordId=tasks['currentId'], fieldId=field_id)
            if any(not isinstance(value, str) or not value for value in expected.values()) or any(
                    current.get('source', {}).get(key) != value or job['source'].get(key) != value for key, value in expected.items()):
                raise InvalidInput('Current result does not belong to this document/table/node/row/field.')
            if current.get('model') != job['snapshot']['input'].get('config', {}).get('model'):
                raise InvalidInput('Current result model differs from its frozen task.')
        else:
            # An old package's task ID is not an identity in this SQLite ledger.
            # Preserve it as read-only data and validate only its rooted local media.
            request_id = None
        if request_id:
            receipt = service.completed_result(request_id)
            if receipt['kind'] != 'assets':
                raise InvalidInput('The selected task result is not media.')
            allowed = {item['reference_id'] for item in receipt['items']}
        else:
            # Historical output remains readable, without reviving its old executor.
            allowed = None
        url = urlsplit(selected['url'])
        query = parse_qs(url.query, keep_blank_values=True)
        if url.scheme or url.netloc or url.path not in ('/view', '/api/view') or url.fragment or any(len(v) != 1 for v in query.values()) or query.get('type') != ['output']:
            raise InvalidInput('Native output requires one rooted output file reference.')
        name = query['filename'][0]
        relative = '/'.join(p for p in (query.get('subfolder', [''])[0], name) if p)
        kind = selected.get('kind') or ('image' if PurePosixPath(name).suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp') else 'video')
        if kind not in ('image', 'video'):
            raise InvalidInput('Current result is not image or video.')
        file, relative = service.assets.resolve_reference('output', relative)
        asset = service.assets.register_file('output', relative, kind=kind, provenance={'origin': 'native-result-read'})
        reference = next(r for r in asset['references'] if r['root_key'] == 'output' and r['relative_path'] == relative)
        if allowed is not None and reference['reference_id'] not in allowed:
            raise InvalidInput('Saved display result does not match the immutable task receipt.')
        receipt = service.assets.result_receipt([reference['reference_id']])
        MediaResultValidator(service.assets)(receipt)
        report = json.dumps([{'id': r['id'], 'name': r.get('name', ''), 'results': r['values'].get(field_id, [])} for r in tasks['table']['records']], ensure_ascii=False)
        return kind, file, report, selected['url']
    except (KeyError, TypeError, ValueError, StopIteration):
        raise InvalidInput('Saved current-task result is invalid; no task was submitted.') from None


def make_node(service):
    from comfy_api.latest import io, InputImpl

    class GenerationNode(io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return io.Schema(node_id=NODE_ID, display_name='DAELAB · 生成节点', category='DAELab/Generation',
                description='读取当前任务已核验的图片或视频结果；生成由共享任务服务显式提交。',
                is_output_node=True, not_idempotent=True,
                inputs=[
                    io.String.Input('project_uuid', default=''),
                    io.String.Input('request_id', default='video-001'),
                    io.Combo.Input('model', options=LEGACY_MODEL_OPTIONS),
                    io.Combo.Input('mode', options=['text2video', 'singleImage2video', 'frames2video', 'image2video', 'mixed2video']),
                    io.String.Input('prompt', default='', multiline=True),
                    io.Int.Input('duration', default=4, min=4, max=30),
                    io.Combo.Input('resolution', options=['480p', '720p', '1080p', '4k', '768P', '2K']),
                    io.Combo.Input('ratio', options=['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']),
                    io.Boolean.Input('sound', default=False),
                    io.String.Input('reference_files', default='[]', multiline=True),
                    io.Image.Input('first_frame', optional=True),
                    io.Image.Input('last_frame', optional=True),
                    io.Image.Input('reference_images', optional=True),
                    io.Custom('COMFYTV_VIDEO').Input('reference_video', optional=True),
                    io.String.Input('text_input', optional=True, force_input=True),
                    io.String.Input('table_json', optional=True, force_input=True),
                    io.String.Input('task_data', default='', optional=True, socketless=True, extra_dict={'hidden': True}),
                    io.Autogrow.Input('texts', template=io.Autogrow.TemplatePrefix(io.String.Input('text'), prefix='text', min=0, max=100), optional=True),
                    io.Autogrow.Input('images', template=io.Autogrow.TemplatePrefix(io.Image.Input('image'), prefix='image', min=0, max=100), optional=True),
                    io.Autogrow.Input('groups', template=io.Autogrow.TemplatePrefix(io.Custom('DAELAB_ASSETS').Input('group'), prefix='group', min=0, max=100), optional=True),
                    io.Autogrow.Input('videos', template=io.Autogrow.TemplatePrefix(io.Custom('COMFYTV_VIDEO').Input('video'), prefix='video', min=0, max=100), optional=True),
                ],
                outputs=[io.Video.Output('video'), io.Custom('COMFYTV_VIDEO').Output('comfytv_video'),
                         io.String.Output('local_path'), io.String.Output('task_report'), io.Image.Output('image')])

        @classmethod
        def execute(cls, project_uuid, request_id, model, mode, prompt, duration, resolution, ratio,
                    sound=False, reference_files='[]', first_frame=None, last_frame=None,
                    reference_images=None, reference_video=None, text_input=None, table_json=None, task_data='', texts=None, images=None, groups=None, videos=None):
            if not task_data:
                raise InvalidInput('Legacy LibTV execution is retired. Run the shared generation panel before reading its completed result.')
            kind, file, report, url = read_current_result(service, task_data)
            if kind == 'image':
                import numpy as np
                import torch
                from PIL import Image, ImageOps
                with Image.open(file) as source:
                    image = torch.from_numpy(np.array(ImageOps.exif_transpose(source).convert('RGB'), dtype=np.float32) / 255.0).unsqueeze(0)
                return io.NodeOutput(None, None, str(file), report, image, ui={'daelab_video_task_result': [url]})
            return io.NodeOutput(InputImpl.VideoFromFile(str(file)), url, str(file), report, None, ui={'daelab_video_task_result': [url]})

    return GenerationNode
