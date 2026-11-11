const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../tasks.js');

const ok = { ui: 'A', db: 'a', color: '#aabbcc' };

test('shipped TASK_DEFS are valid', () => {
  assert.equal(T.validateTaskDefs(T.TASK_DEFS), null);
});
test('accepts a minimal valid list', () => {
  assert.equal(T.validateTaskDefs([ok]), null);
});
test('rejects duplicate db', () => {
  assert.notEqual(T.validateTaskDefs([ok, { ...ok, ui: 'B' }]), null);
});
test('rejects comma or newline in db', () => {
  assert.notEqual(T.validateTaskDefs([{ ...ok, db: 'a,b' }]), null);
  assert.notEqual(T.validateTaskDefs([{ ...ok, db: 'a\nb' }]), null);
  assert.notEqual(T.validateTaskDefs([{ ...ok, db: 'a\rb' }]), null);
});
test('rejects bad color', () => {
  for (const color of ['red', '#fff', undefined]) {
    assert.notEqual(T.validateTaskDefs([{ ...ok, color }]), null);
  }
});
test('rejects empty ui or db, and empty list', () => {
  assert.notEqual(T.validateTaskDefs([{ ...ok, ui: '' }]), null);
  assert.notEqual(T.validateTaskDefs([{ ...ok, ui: '  ' }]), null);
  assert.notEqual(T.validateTaskDefs([{ ...ok, db: '' }]), null);
  assert.notEqual(T.validateTaskDefs([]), null);
  assert.notEqual(T.validateTaskDefs(undefined), null);
});
