import base64
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
import collector
import server


class PanelTests(unittest.TestCase):
    def test_projection_does_not_claim_verified_and_rejects_foreign_group(self):
        row={'id':1,'status':'done','attempts':2,'created_at':1,'updated_at':2,
             'payload_json':json.dumps({'group_id':collector.GROUP,'source_filename':'a.pdf','sender_id':'private','secret':'secret'}),
             'response_json':json.dumps({'drive_file_id':'ABC','status':'ORGANIZED'}),'last_error':'Bearer secret'}
        d=collector.project_job(row)
        self.assertEqual(d['integrity'],'NAO_VERIFICADA')
        self.assertEqual(d['notification'],'DESCONHECIDA')
        self.assertNotIn('secret',json.dumps(d))
        self.assertNotIn('private',json.dumps(d))
        row['payload_json']='{"group_id":"another"}'
        self.assertIsNone(collector.project_job(row))

    def test_observation_is_idempotent_and_changes_append(self):
        with sqlite3.connect(':memory:') as db:
            doc={'id':'1','status':'queued','attempts':0,'declared_outcome':'UNKNOWN','review':'DESCONHECIDA','storage':'SEM_REFERENCIA','notification':'DESCONHECIDA','updated_at':1}
            collector.observe(db,[doc],10);collector.observe(db,[doc],20)
            self.assertEqual(len(doc['observations']),1)
            doc['status']='done';collector.observe(db,[doc],30)
            self.assertEqual(len(doc['observations']),2)
            self.assertEqual(doc['observations'][1]['observed_at'],10)

    def test_http_auth_scope_and_missing_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            server.DATA=Path(tmp);server.AUTH=Path(tmp)/'users.json'
            salt=b'1234567890123456';password='test-pass'
            key=hashlib.scrypt(password.encode(),salt=salt,n=16384,r=8,p=1).hex()
            server.AUTH.write_text(json.dumps({'a':{'salt':salt.hex(),'hash':key,'tenants':['plx']},'b':{'salt':salt.hex(),'hash':key,'tenants':['foreign']}}))
            snapshot={'generated_at':time.time()-100,'coverage':'PARTIAL','coverage_note':'test','sources':{},'documents':[{'id':'1','tenant_id':'plx','status':'done','review':'PENDENTE','drive_file_id':'x','filename':'a.pdf','group_id':'g'}], 'session':{'status':'WORKING'},'health':{},'executions':[{'id':'1'}]}
            (server.DATA/'snapshot.json').write_text(json.dumps(snapshot))
            http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
            thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
            def request(path,user=None,method='GET'):
                headers={} if not user else {'Authorization':'Basic '+base64.b64encode((user+':'+password).encode()).decode()}
                req=urllib.request.Request('http://127.0.0.1:'+str(http.server_port)+path,headers=headers,method=method)
                try:
                    with urllib.request.urlopen(req) as r:return r.status,json.load(r)
                except urllib.error.HTTPError as e:
                    with e:return e.code,json.load(e)
            try:
                self.assertEqual(request('/api/overview')[0],401)
                code,res=request('/api/overview','a');self.assertEqual(code,200);self.assertTrue(res['stale']);self.assertEqual(res['total'],1)
                self.assertEqual([stage['id'] for stage in res['pipeline']],['ingress','queue','worker','drive','notify'])
                self.assertEqual(res['clients'][0]['id'],'plx')
                self.assertEqual(res['clients'][0]['documents'],1)
                _,res=request('/api/overview','b');self.assertEqual(res['total'],0);self.assertEqual(res['executions'],[]);self.assertEqual(res['session'],{})
                self.assertEqual(request('/api/documents/1','b')[0],404)
                code,res=request('/api/metrics','a');self.assertEqual(code,200);self.assertEqual(res['metrics']['document_received_total'],1);self.assertEqual(res['metrics']['document_archived_total'],1)
                self.assertEqual(request('/api/documents?tenant=plx','b')[1]['total'],0)
                self.assertEqual(request('/api/documents?offset=bad','a')[0],400)
                self.assertEqual(request('/api/documents/1','a',method='POST')[0],405)
                (server.DATA/'snapshot.json').unlink()
                self.assertEqual(request('/api/overview','a')[0],503)
            finally:
                http.shutdown();http.server_close();thread.join()


if __name__=='__main__': unittest.main()
