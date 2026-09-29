import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { annotationObjection, fromAnnotations, fromCatalog, paymentArgument } from '../src/classify.ts';
import { findEntry, surfaceObjection } from '../src/commands/call.ts';
import type { CatalogTool, Surface } from '../src/emporium-client.ts';
import type { Tool } from '../src/mcp.ts';
import { ROOT } from './helpers/run.ts';

const entry = (fields: Partial<Record<keyof CatalogTool, unknown>>): CatalogTool =>
  ({ superficie_id: 's', tool: 't', ...fields }) as CatalogTool;

const tool = (annotations: Tool['annotations'], extra: Partial<Tool> = {}): Tool => ({
  name: 'x',
  inputSchema: { type: 'object', properties: {} },
  annotations,
  ...extra,
});

describe('catalog class', () => {
  it('allows lectura, and null only with the exact counter name', () => {
    assert.equal(fromCatalog(entry({ por_que_no: 'lectura', en_el_mostrador: null }), null).allowed, true);
    assert.equal(fromCatalog(entry({ por_que_no: null, en_el_mostrador: 's_t' }), 's_t').allowed, true);
  });

  it('refuses every other class as itself', () => {
    for (const c of [
      'escribe',
      'mueve_dinero',
      'riel_de_pago',
      'cobra_por_llamada',
      'pide_credencial',
      'sin_clasificar',
    ]) {
      const v = fromCatalog(entry({ por_que_no: c, en_el_mostrador: null }), 's_t');
      assert.equal(v.allowed, false, c);
      assert.equal(v.toolClass, c);
    }
  });

  it('fails closed: a missing, null-without-counter-name, odd or unknown class is sin_clasificar', () => {
    const cases: [Partial<Record<keyof CatalogTool, unknown>>, string | null][] = [
      [{ en_el_mostrador: 's_t' }, 's_t'], // no por_que_no at all
      [{ por_que_no: undefined, en_el_mostrador: 's_t' }, 's_t'],
      [{ por_que_no: null, en_el_mostrador: null }, 's_t'],
      [{ por_que_no: null, en_el_mostrador: 'other_t' }, 's_t'],
      [{ por_que_no: null, en_el_mostrador: 's_t' }, null],
      [{ por_que_no: 0, en_el_mostrador: 's_t' }, 's_t'],
      [{ por_que_no: false, en_el_mostrador: 's_t' }, 's_t'],
      [{ por_que_no: {}, en_el_mostrador: 's_t' }, 's_t'],
      [{ por_que_no: '', en_el_mostrador: 's_t' }, 's_t'],
      [{ por_que_no: 'toString', en_el_mostrador: 's_t' }, 's_t'],
      [{ por_que_no: 'a_new_class', en_el_mostrador: 's_t' }, 's_t'],
    ];
    for (const [fields, counterName] of cases) {
      const v = fromCatalog(entry(fields), counterName);
      assert.equal(v.allowed, false, JSON.stringify(fields));
      assert.equal(v.toolClass, 'sin_clasificar', JSON.stringify(fields));
    }
  });

  it('only takes the entry of the same surface: a namesake elsewhere does not classify', () => {
    const elsewhere = entry({ superficie_id: 'other', tool: 't', por_que_no: null, en_el_mostrador: 'other_t' });
    assert.equal(findEntry([elsewhere], 's', 't'), undefined);
    const own = entry({ superficie_id: 's', tool: 't', por_que_no: 'cobra_por_llamada', en_el_mostrador: null });
    assert.equal(findEntry([elsewhere, own], 's', 't'), own);
  });
});

describe('annotations', () => {
  it('fallback: allows a read-only, non-destructive tool with no payment argument', () => {
    assert.equal(fromAnnotations(tool({ readOnlyHint: true, destructiveHint: false })).allowed, true);
  });

  it('fallback: refuses a tool without annotations, or not read-only, or destructive', () => {
    assert.equal(fromAnnotations(tool(undefined)).allowed, false);
    assert.equal(fromAnnotations(tool({ readOnlyHint: false })).allowed, false);
    assert.equal(fromAnnotations(tool({ readOnlyHint: true, destructiveHint: true })).allowed, false);
  });

  it("refuses when the surface's own annotations are stricter than the counter's", () => {
    const t = tool(
      { readOnlyHint: true },
      { _meta: { 'emporium/anotaciones_de_la_superficie': { readOnlyHint: false } } },
    );
    assert.equal(fromAnnotations(t).allowed, false);
    assert.equal(annotationObjection(t)?.allowed, false);
  });

  it('objects to present annotations even when the catalog would allow, but not to absent ones', () => {
    assert.equal(annotationObjection(tool({ readOnlyHint: true, destructiveHint: true }))?.allowed, false);
    assert.equal(annotationObjection(tool({ readOnlyHint: false }))?.allowed, false);
    assert.equal(annotationObjection(tool(undefined)), undefined);
  });

  it('finds payment arguments in any case, and x-payment and x402*', () => {
    for (const name of [
      'payment',
      'Payment',
      'PAYMENTPAYLOAD',
      'paymentRequirements',
      'X-PAYMENT',
      'x_payment',
      'x402',
      'X402Payment',
    ]) {
      const t = tool({ readOnlyHint: true }, { inputSchema: { type: 'object', properties: { [name]: {} } } });
      assert.equal(paymentArgument(t), name);
      const v = fromAnnotations(t);
      assert.equal(v.allowed, false, name);
      assert.equal(v.toolClass, 'cobra_por_llamada', name);
    }
    const plain = tool(
      { readOnlyHint: true },
      { inputSchema: { type: 'object', properties: { wallet: {}, paymentsCount: {} } } },
    );
    assert.equal(paymentArgument(plain), undefined);
  });

  it('refuses none of the 49 tools of the recorded counter on its annotations', () => {
    const recorded = JSON.parse(
      readFileSync(join(ROOT, 'test', 'fixtures', 'emporium', 'counter.tools-list.json'), 'utf8'),
    ) as { response: { body: { result: { tools: Tool[] } } } };
    const tools = recorded.response.body.result.tools;
    assert.equal(tools.length, 49);
    for (const t of tools) {
      assert.equal(annotationObjection(t), undefined, t.name);
      assert.equal(fromAnnotations(t).allowed, true, t.name);
    }
  });
});

describe('surface of a forwarded tool', () => {
  const surfaces = [
    { id: 'open', url_mcp: 'u', auth: { tipo: 'none' } },
    { id: 'oauth', url_mcp: 'u', auth: { tipo: 'oauth2.1' } },
    { id: 'silent', url_mcp: 'u' },
  ] as Surface[];

  it('allows only a surface of the catalog that declares auth none', () => {
    assert.equal(surfaceObjection(surfaces, 'open'), undefined);
    for (const id of ['oauth', 'silent', 'missing', 42]) {
      const v = surfaceObjection(surfaces, id);
      assert.equal(v?.allowed, false, String(id));
      assert.equal(v?.toolClass, 'pide_credencial', String(id));
    }
  });
});
