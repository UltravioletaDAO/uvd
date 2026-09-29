import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callText } from '../src/commands/call.ts';
import { searchTable } from '../src/commands/search.ts';
import { toolsTable } from '../src/commands/tools.ts';
import { UvdError } from '../src/errors.ts';
import { formatError, stripControl } from '../src/output.ts';

// Text from outside (Emporium, a surface, a tool) that tries to drive the terminal.
const HOSTILE = 'safe \u001b[31mred\u001b[0m \u0007bell \u001b]0;title\u0007 \u009b2J \u007f end';

function assertInert(output: string): void {
  for (const bad of ['\u001b', '\u0007', '\u009b', '\u007f']) {
    assert.ok(!output.includes(bad), `output contains U+${bad.codePointAt(0)?.toString(16).padStart(4, '0')}`);
  }
  assert.match(output, /safe/);
}

describe('terminal control characters in human output', () => {
  it('stripControl keeps newlines and tabs and drops C0, DEL and C1', () => {
    assert.equal(stripControl('a\nb\tc\u0000d\u001be\u007ff\u0085g\u009fh'), 'a\nb\tcdefgh');
  });

  it('are removed from the tools table (description and title)', () => {
    assertInert(
      toolsTable(
        [
          { name: 'a', description: HOSTILE, inputSchema: { type: 'object' } },
          { name: `b${HOSTILE}`, title: HOSTILE, inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
        ],
        200,
      ),
    );
  });

  it('are removed from the search table (descripcion_corta, rotulo) and its notes', () => {
    const output = searchTable(
      {
        items: [
          { tipo: 'tool', superficie_id: 's', tool: 't', en_el_mostrador: 's_t', descripcion_corta: HOSTILE },
          { tipo: 'combo', nombre: HOSTILE, id: 'CMB', forma: 'plan' },
          { tipo: 'servicio', rotulo: HOSTILE, url: 'https://x', puntaje: 1 },
        ],
        notices: { emporium_buscar_servicio: { aviso: HOSTILE, hueco: { por_que_no_hay: HOSTILE } } },
      },
      200,
    );
    assertInert(output);
    assert.match(output, /Notes:/);
  });

  it("are removed from a tool's text", () => {
    assertInert(callText({ content: [{ type: 'text', text: HOSTILE }] }));
  });

  it('are removed from an error message in table mode; JSON mode is unchanged (C0 escaped by JSON)', () => {
    const error = new UvdError('remote', `server said: ${HOSTILE}`, 3);
    assertInert(formatError(error, 'table').text);
    const json = formatError(error, 'json').text;
    assert.ok(!json.includes('\u001b') && !json.includes('\u0007'));
    assert.equal(JSON.parse(json).error.message, `server said: ${HOSTILE}`);
  });
});
