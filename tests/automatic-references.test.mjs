import test from 'node:test';
import assert from 'node:assert/strict';
import { detectReferenceProfiles } from '../src/image/automatic-references.mjs';

const profiles = [
  { displayName: 'はりたん', slug: 'haritan' },
  { displayName: 'ぽろあーく', slug: 'poro' },
];
const names = (prompt, registered = profiles) => detectReferenceProfiles(prompt, registered).map(p => p.displayName);

test('automatic references find full Japanese registered names in prompt order, only once each', () => {
  assert.deepEqual(names('はりたんが散歩している'), ['はりたん']);
  assert.deepEqual(names('ぽろあーくとはりたんがトランプをしている'), ['ぽろあーく', 'はりたん']);
  assert.deepEqual(names('はりたんとはりたんのぬいぐるみ'), ['はりたん']);
  assert.deepEqual(names('海辺の景色'), []);
  assert.deepEqual(names('haritan and poro'), []); // Internal slugs are not automatic aliases.
  assert.deepEqual(names('はりた'), []);
  assert.deepEqual(names('はりたん', []), []);
});

test('matching normalizes width and case without using names as regular expressions', () => {
  const registered = [{ displayName: 'Ａｌｉｃｅ', slug: 'alice' }, { displayName: 'a+b', slug: 'a-b' }];
  assert.deepEqual(names('ALICE と a+b', registered), ['Ａｌｉｃｅ', 'a+b']);
  assert.deepEqual(names('aaab', registered), []);
});

test('longest name at one position wins while later independent shorter names still match', () => {
  const registered = [...profiles, { displayName: 'はりたん2', slug: 'haritan2' }];
  assert.deepEqual(names('はりたん2とぽろあーく', registered), ['はりたん2', 'ぽろあーく']);
  assert.deepEqual(names('はりたん2とはりたん', registered), ['はりたん2', 'はりたん']);
  assert.deepEqual(names('ABC', [{ displayName: 'AB', slug: 'ab' }, { displayName: 'BC', slug: 'bc' }]), ['AB']);
});

test('ambiguous normalized names fail instead of choosing an arbitrary image', () => {
  const registered = [{ displayName: 'Alice', slug: 'a' }, { displayName: 'ＡＬＩＣＥ', slug: 'b' }];
  assert.throws(() => names('alice', registered), /自動参照の登録名が重複/);
  assert.deepEqual(names('Nobody', registered), []);
});

test('matching is literal and does not interpret negation; the command provides an opt-out', () => {
  assert.deepEqual(names('はりたんは描かない'), ['はりたん']);
});
