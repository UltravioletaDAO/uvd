import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromAnnotations, fromCatalog } from '../src/classify.ts';
import type { CatalogTool } from '../src/emporium-client.ts';
import type { Tool } from '../src/mcp.ts';

const entry = (por_que_no: string | null): CatalogTool => ({
  superficie_id: 's',
  tool: 't',
  en_el_mostrador: por_que_no ? null : 's_t',
  por_que_no,
});

const tool = (annotations: Tool['annotations'], extra: Partial<Tool> = {}): Tool => ({
  name: 'x',
  inputSchema: { type: 'object', properties: {} },
  annotations,
  ...extra,
});

describe('catalog class', () => {
  it('allows only lectura', () => {
    assert.equal(fromCatalog(entry(null)).allowed, true);
    for (const c of [
      'escribe',
      'mueve_dinero',
      'riel_de_pago',
      'cobra_por_llamada',
      'pide_credencial',
      'sin_clasificar',
    ]) {
      const v = fromCatalog(entry(c));
      assert.equal(v.allowed, false, c);
      assert.equal(v.toolClass, c);
    }
  });
});

describe('annotation fallback', () => {
  it('allows a read-only, non-destructive tool with no payment argument', () => {
    assert.equal(fromAnnotations(tool({ readOnlyHint: true, destructiveHint: false })).allowed, true);
  });
  it('refuses a tool without annotations, or not read-only, or destructive', () => {
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
  });
  it('refuses a tool that takes a payment argument', () => {
    const t = tool({ readOnlyHint: true }, { inputSchema: { type: 'object', properties: { paymentPayload: {} } } });
    const v = fromAnnotations(t);
    assert.equal(v.allowed, false);
    assert.equal(v.toolClass, 'cobra_por_llamada');
  });
});
