import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UvdError } from '../src/errors.ts';
import { formatError, renderTable, resolveFormat } from '../src/output.ts';

describe('output format', () => {
  it('is JSON when stdout is not a terminal', () => {
    assert.equal(resolveFormat({ json: false, isTTY: false }), 'json');
  });
  it('is a table on a terminal, and JSON there with --json', () => {
    assert.equal(resolveFormat({ json: false, isTTY: true }), 'table');
    assert.equal(resolveFormat({ json: true, isTTY: true }), 'json');
  });
});

describe('renderTable', () => {
  it('aligns columns under a header and a rule', () => {
    const out = renderTable(
      [
        { key: 'a', header: 'NAME' },
        { key: 'b', header: 'X' },
      ],
      [
        { a: 'one', b: '1' },
        { a: 'three', b: '3' },
      ],
    );
    assert.equal(out, 'NAME   X\n-----  -\none    1\nthree  3');
  });
  it('shrinks flexible columns to the width and marks the cut', () => {
    const out = renderTable(
      [
        { key: 'a', header: 'A' },
        { key: 'b', header: 'B', flexible: true },
      ],
      [{ a: 'x', b: 'y'.repeat(80) }],
      40,
    );
    for (const line of out.split('\n')) assert.ok(line.length <= 40, line);
    assert.match(out, /…$/);
  });
});

describe('formatError', () => {
  it('writes a single JSON line with the code and exit code in JSON mode', () => {
    const { text, exitCode } = formatError(new UvdError('refused', 'no', 5, { tool: 't' }), 'json');
    assert.equal(exitCode, 5);
    assert.ok(text.endsWith('\n') && !text.slice(0, -1).includes('\n'));
    assert.deepEqual(JSON.parse(text), {
      error: { code: 'refused', message: 'no', exitCode: 5, details: { tool: 't' } },
    });
  });
  it('writes a plain line otherwise, and maps unknown errors to exit 1', () => {
    assert.deepEqual(formatError(new Error('boom'), 'table'), { text: 'uvd: boom\n', exitCode: 1 });
  });
});
