import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseLeadSingles, selectedLeadSingle, setLeadSingle } from '../preparation/master-flags.js';

test('only one master can be the lead single', () => {
  const masters = [
    { id: 'one', leadSingle: true },
    { id: 'two', leadSingle: true },
    { id: 'three' },
  ];
  const normalised = normaliseLeadSingles(masters);
  assert.deepEqual(normalised.map((master) => master.leadSingle), [true, false, false]);

  const changed = setLeadSingle(normalised, 'three', true);
  assert.deepEqual(changed.map((master) => master.leadSingle), [false, false, true]);
  assert.equal(selectedLeadSingle(changed).id, 'three');

  const cleared = setLeadSingle(changed, 'three', false);
  assert.equal(selectedLeadSingle(cleared), null);
});
