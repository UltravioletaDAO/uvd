// Serves the RECORDED Emporium fixtures (test/fixtures/emporium/ only: nothing derived or
// synthetic) on 127.0.0.1 until killed. For the delivery criteria and for trying uvd offline:
//
//   node scripts/serve-fixtures.ts --port 47100 &
//   UVD_EMPORIUM_URL=http://127.0.0.1:47100 uvd search wallet

import { parseArgs } from 'node:util';
import { startFixtureServer } from '../test/helpers/fixture-server.ts';

const { values } = parseArgs({ options: { port: { type: 'string', default: '0' } } });
const server = await startFixtureServer({ port: Number(values.port) });
console.log(server.url);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close().finally(() => process.exit(0));
  });
}
