import tempfile
import unittest
from pathlib import Path

from app import create_app


class ReviewAppTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(Path(self.tmp.name) / 'review.sqlite3', 'fixture-key')
        self.client = self.app.test_client()
        self.headers = {'X-Review-Key': 'fixture-key', 'X-Tenant-ID': 'tenant-a'}

    def tearDown(self):
        self.tmp.cleanup()

    def test_queue_claim_resolve_and_tenant_isolation(self):
        response = self.client.post('/api/items', headers=self.headers, json={'correlation_id': 'a:g:m', 'filename': 'nota.pdf', 'reason': 'LOW_CONFIDENCE'})
        self.assertEqual(response.status_code, 202)
        item_id = response.get_json()['item']['id']
        duplicate = self.client.post('/api/items', headers=self.headers, json={'correlation_id': 'a:g:m', 'reason': 'LOW_CONFIDENCE'})
        self.assertEqual(duplicate.get_json()['item']['id'], item_id)
        foreign = self.client.get('/api/items', headers={**self.headers, 'X-Tenant-ID': 'tenant-b'})
        self.assertEqual(foreign.get_json()['items'], [])
        self.assertEqual(self.client.post(f'/api/items/{item_id}/claim', headers=self.headers, json={'actor': 'operador'}).status_code, 200)
        self.assertEqual(self.client.post(f'/api/items/{item_id}/resolve', headers=self.headers, json={'resolution': 'CNPJ confirmado'}).status_code, 200)

    def test_authentication_fails_closed(self):
        self.assertEqual(self.client.get('/api/items').status_code, 401)
        self.assertEqual(self.client.get('/api/items', headers={'X-Review-Key': 'fixture-key'}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
