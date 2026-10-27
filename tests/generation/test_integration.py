import ast
import asyncio
import importlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.contracts.errors import InvalidInput
from backend.generation.assembly import assemble_generation
from backend.generation.http import routes
from backend.integrations.comfyui.generation_nodes import register_routes
from backend.integrations.comfyui.generation_nodes.node import read_current_result, make_node, NODE_ID
from backend.integrations.comfyui.services import CoreServices
from test_service import png, FakeProvider, Admission, GenerationService

ROOT = Path(__file__).resolve().parents[2]


class Request:
    def __init__(self, body=None, query=None): self.body=body;self.query=query or {}
    async def json(self): return self.body


class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='studio-generation-http-');self.root=Path(self.temp.name)
        for part in ('input','output'): (self.root/part).mkdir()
        (self.root/'output/result.png').write_bytes(png())
        self.core=CoreServices(self.root/'user',self.root/'input',self.root/'output')

    async def asyncTearDown(self): self.temp.cleanup()

    async def test_disabled_assembly_imports_no_models_and_health_is_unavailable(self):
        service=assemble_generation(self.core)
        self.assertIs(service.resources, self.core.resources)
        handlers={(m,p):h for m,p,h in routes(service)}
        response=await handlers['GET','/daelab/studio/generation/capabilities'](Request(query={'model':'Qwen-Image-2.1 Turbo（本地）'}))
        self.assertEqual(response.status,503)
        body=json.loads(response.text);self.assertEqual(body['code'],'provider_unavailable');self.assertFalse(body['submitted'])
        response=await handlers['POST','/daelab/prompt-optimization/polish'](Request({'model':'qwen','mode':'reverse','imageDataUrl':'bad'}))
        self.assertEqual(response.status,503)
        self.assertEqual(self.core.jobs.list_jobs(),[])
        self.assertEqual(list((self.root/'input').iterdir()),[])

    async def test_routes_idempotent_and_retired_channel_is_not_registered(self):
        from aiohttp import web
        service=assemble_generation(self.core);server=SimpleNamespace(routes=web.RouteTableDef())
        self.assertEqual(len(register_routes(server,service)),23)
        self.assertTrue(any(r.path.endswith('/generation/fence-unsubmitted') for r in server.routes))
        self.assertTrue(any(r.path.endswith('/prompt-optimization/fence') for r in server.routes))
        self.assertEqual(register_routes(server,service),())
        self.assertFalse(any('/libtv/' in r.path for r in server.routes))
        with self.assertRaises(RuntimeError): register_routes(server,assemble_generation(self.core))

    async def test_native_reads_historical_synthetic_result_without_provider_or_submission(self):
        service=assemble_generation(self.core)
        data={'currentId':'row','fieldId':'out','table':{'records':[{'id':'row','name':'合成任务','values':{'out':[{'url':'/view?filename=result.png&type=output','kind':'image'}]}}]}}
        kind,path,report,url=read_current_result(service,json.dumps(data))
        self.assertEqual(kind,'image');self.assertEqual(path.name,'result.png');self.assertEqual(json.loads(report)[0]['id'],'row')
        self.assertEqual(self.core.jobs.list_jobs(),[])
        data['table']['records'][0]['meta']={'generationColumns':{'out':{'requestId':'retired-package-only','phase':'complete'}}}
        self.assertEqual(read_current_result(service,json.dumps(data))[1].name,'result.png')
        self.assertEqual(self.core.jobs.list_jobs(),[])
        for bad in ['/view?filename=../escape.png&type=output','https://example.test/result.png','/view?filename=result.png&type=input','/view?filename=result.png&type=output&type=input']:
            data['table']['records'][0]['values']['out'][0]['url']=bad
            with self.assertRaises(InvalidInput):read_current_result(service,json.dumps(data))

    async def test_native_current_new_reference_checks_document_table_node_row_field(self):
        import copy
        fake=FakeProvider();service=GenerationService(self.core.jobs,self.core.assets,providers={fake.id:fake},admission=Admission(),poll_interval=0)
        from backend.providers.parameters import IMAGE_MODEL
        scope={'documentId':'document','tableId':'table','nodeId':'node','recordId':'row','fieldId':'out','inputDigest':'a'*64}
        item={'requestId':'owned','source':scope,'input':{'config':{'model':IMAGE_MODEL,'kind':'image','mode':'text2image'},'segments':[{'type':'text','text':'synthetic'}]}}
        await service.submit([item]);await service.wait_idle();result=service.public('owned')['result'];result['provenance']={'requestId':'owned'}
        ref={'requestId':'owned','inputDigest':'a'*64,'source':scope,'model':IMAGE_MODEL}
        data={'currentId':'row','fieldId':'out','sourceScope':{k:scope[k] for k in ('documentId','tableId','nodeId')},'table':{'records':[{'id':'row','values':{'out':[result]},'meta':{'studioGenerationRefs':{'out':[ref]}}}]}}
        self.assertEqual(read_current_result(service,json.dumps(data))[0],'image')
        for key in ('documentId','tableId','nodeId'):
            bad=copy.deepcopy(data);bad['sourceScope'][key]='foreign'
            with self.assertRaises(InvalidInput):read_current_result(service,json.dumps(bad))
        for key in ('recordId','fieldId'):
            bad=copy.deepcopy(data);bad['table']['records'][0]['meta']['studioGenerationRefs']['out'][-1]['source'][key]='foreign'
            with self.assertRaises(InvalidInput):read_current_result(service,json.dumps(bad))
        bad=copy.deepcopy(data);bad.pop('sourceScope')
        with self.assertRaises(InvalidInput):read_current_result(service,json.dumps(bad))
        self.assertEqual(fake.creates,['owned'])

    async def test_native_schema_retains_all_slot_positions_without_loading_torch(self):
        class Type:
            def Input(self,name,**options):return ('input',name,options)
            def Output(self,name,**options):return ('output',name,options)
        class IO:
            ComfyNode=object
            String=Combo=Int=Boolean=Image=Video=Type()
            Autogrow=Type()
            Autogrow.TemplatePrefix=lambda port, **options: {'port': port, **options}
            @staticmethod
            def Custom(_kind):return Type()
            @staticmethod
            def Schema(**values):return values
        fake=SimpleNamespace(io=IO,InputImpl=SimpleNamespace())
        with patch.dict(sys.modules,{'comfy_api':SimpleNamespace(),'comfy_api.latest':fake}):
            node=make_node(None);schema=node.define_schema()
            self.assertEqual(schema['node_id'],NODE_ID)
            self.assertEqual([s[1] for s in schema['inputs']],['project_uuid','request_id','model','mode','prompt','duration','resolution','ratio','sound','reference_files','first_frame','last_frame','reference_images','reference_video','text_input','table_json','task_data','texts','images','groups','videos'])
            for input in schema['inputs'][-4:]:
                self.assertTrue(input[2]['optional'])
                self.assertEqual(input[2]['template']['min'],0)
            self.assertEqual([s[1] for s in schema['outputs']],['video','comfytv_video','local_path','task_report','image'])
            with self.assertRaises(InvalidInput):node.execute('project','request','legacy','text2video','',4,'720p','16:9')

    async def test_native_reads_explicitly_selected_history_result_not_the_latest_task(self):
        import copy
        from backend.providers.parameters import IMAGE_MODEL
        fake=FakeProvider();service=GenerationService(self.core.jobs,self.core.assets,providers={fake.id:fake},admission=Admission(),poll_interval=0)
        scope={'documentId':'doc','tableId':'table','nodeId':'node','recordId':'row','fieldId':'out','inputDigest':'a'*64}
        def item(request_id):return {'requestId':request_id,'source':scope,'input':{'config':{'model':IMAGE_MODEL,'kind':'image','mode':'text2image'},'segments':[{'type':'text','text':'synthetic'}]}}
        await service.submit([item('A')]);await service.wait_idle();result_a=service.public('A')['result'];result_a['provenance']={'requestId':'A'}
        (self.root/'output/result-b.png').write_bytes(png());fake.file='result-b.png'
        await service.submit([item('B')]);await service.wait_idle();result_b=service.public('B')['result'];result_b['provenance']={'requestId':'B'}
        refs=[{'requestId':request_id,'inputDigest':'a'*64,'source':scope,'model':IMAGE_MODEL} for request_id in ('A','B')]
        data={'currentId':'row','fieldId':'out','sourceScope':{key:scope[key] for key in ('documentId','tableId','nodeId')},'table':{'records':[{'id':'row','values':{'out':[result_b,result_a]},'meta':{'studioGenerationRefs':{'out':refs}}}]}}
        self.assertEqual(read_current_result(service,json.dumps(data))[1].name,'result.png')
        for provenance in [None,{}, {'requestId':'missing'}, {'requestId':'B'}]:
            invalid=copy.deepcopy(data);invalid['table']['records'][0]['values']['out'][-1]['provenance']=provenance
            with self.assertRaises(InvalidInput):read_current_result(service,json.dumps(invalid))
        for refs in [None,[],[data['table']['records'][0]['meta']['studioGenerationRefs']['out'][0]]*2]:
            invalid=copy.deepcopy(data);invalid['table']['records'][0]['meta']['studioGenerationRefs']['out']=refs
            with self.assertRaises(InvalidInput):read_current_result(service,json.dumps(invalid))
        self.assertEqual(fake.creates,['A','B'])


class ImportTests(unittest.TestCase):
    def test_imports_need_no_host_network_model_or_process(self):
        result=subprocess.run([sys.executable,'-c',r'''
import sys,socket,subprocess,asyncio
def forbidden(*a,**k):raise AssertionError('No startup IO')
socket.create_connection=forbidden
subprocess.Popen=forbidden
import backend.generation.assembly
import backend.generation.http
import backend.providers.native
import backend.providers.qwen
import backend.integrations.comfyui.generation_nodes
import backend.integrations.comfyui.generation_nodes.native_host
assert not any(n in sys.modules for n in ('torch','folder_paths','server','execution','aiohttp','PIL'))
'''],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_no_secondary_job_store_or_retired_execution_import(self):
        for directory in ('backend/providers','backend/generation','backend/integrations/comfyui/generation_nodes'):
            for file in (ROOT/directory).glob('*.py'):
                tree=ast.parse(file.read_text('utf8'))
                for node in ast.walk(tree):
                    if isinstance(node,(ast.Import,ast.ImportFrom)):
                        names=[n.name for n in node.names]+[getattr(node,'module','') or '']
                        self.assertFalse(any(bad in name for name in names for bad in ('libtv_bridge','sqlite3','subprocess','deepseek','comfy_api_nodes')),str(file))
                self.assertNotIn('atomic_json',file.read_text('utf8'))


if __name__=='__main__':unittest.main()
