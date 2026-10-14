import assert from 'node:assert/strict';
import test from 'node:test';

import { nextPress, type Draft, type Press } from '../src/ui/draft.ts';

const type = (draft: Draft, keys: string[], decimal = true) => {
  let last: Press | undefined;
  for (const key of keys) last = nextPress(last, draft, key, decimal);
  return last?.to.text;
};

test('presses before the next render build on each other', () => {
  assert.equal(type({ text: '20', fresh: true }, ['1', '2', '3', '4']), '1234');
  assert.equal(type({ text: '', fresh: false }, ['1', '.', '5']), '1.5');
  assert.equal(type({ text: '135', fresh: false }, ['del', 'del', '0']), '10');
});

test('a rendered draft replaces the pending chain', () => {
  const first = nextPress(undefined, { text: '', fresh: false }, '1', true);
  assert.equal(nextPress(first, { text: '9', fresh: false }, '2', true).to.text, '92');
});

test('a render of an earlier press keeps the chain', () => {
  const empty = { text: '', fresh: true };
  const one = nextPress(undefined, empty, '1', true);
  const two = nextPress(one, empty, '2', true);
  const three = nextPress(two, { text: '1', fresh: false }, '3', true);
  assert.equal(nextPress(three, { text: '12', fresh: false }, '4', true).to.text, '1234');
});

test('an outside change after the chain caught up replaces it', () => {
  const one = nextPress(undefined, { text: '', fresh: false }, '1', true);
  const two = nextPress(one, { text: '1', fresh: false }, '2', true);
  const three = nextPress(two, { text: '12', fresh: false }, '3', true);
  const caught = nextPress(three, { text: '123', fresh: false }, '4', true);
  assert.equal(caught.to.text, '1234');
  assert.equal(nextPress(caught, { text: '12', fresh: false }, '5', true).to.text, '125');
  assert.equal(nextPress(caught, { text: '1234', fresh: true }, '5', true).to.text, '5');
});
