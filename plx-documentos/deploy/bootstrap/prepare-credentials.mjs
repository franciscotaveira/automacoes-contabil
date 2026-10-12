import { writeFileSync } from 'node:fs';

for (const name of ['INTERNAL_TOKEN', 'WAHA_API_KEY']) {
  if (!process.env[name]) throw new Error(`${name}_MISSING`);
}

const credentials = [
  {
    id: 'labInternalHeaderV1',
    name: 'PLX · credencial interna',
    type: 'httpHeaderAuth',
    data: { name: 'X-Internal-Token', value: process.env.INTERNAL_TOKEN },
  },
  {
    id: 'wahaApiHeaderV1',
    name: 'PLX · WAHA API',
    type: 'httpHeaderAuth',
    data: { name: 'X-Api-Key', value: process.env.WAHA_API_KEY },
  },
];

writeFileSync('/tmp/plx-header-credentials.json', JSON.stringify(credentials), { mode: 0o600 });
