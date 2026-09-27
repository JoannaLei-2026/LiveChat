const test = require('node:test');
const assert = require('node:assert/strict');
const { createQuota, dayInTaipei } = require('../visitor-quota');
const secret = 'test-only-secret-with-at-least-32-characters';
const cookieHeader = cookie => cookie.split(';')[0];

test('Taipei day switches at 16:00 UTC', () => {
  assert.equal(dayInTaipei(new Date('2026-09-27T15:59:59Z')), '2026-09-27');
  assert.equal(dayInTaipei(new Date('2026-09-27T16:00:00Z')), '2026-09-28');
});

test('returning visitors retain access when full; tampered cookies cannot bypass cap', async () => {
  let remaining = 1;
  let calls = 0;
  const quota = createQuota({ secret, store: { admit: async () => { calls++; return remaining-- > 0; } } });
  const cookie = cookieHeader(await quota.admit());
  assert.ok(quota.permitted(cookie));
  assert.ok(await quota.admit(cookie));
  assert.equal(calls, 1);
  assert.equal(await quota.admit(), null);
  const tampered = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a');
  assert.equal(quota.permitted(tampered), false);
  assert.equal(await quota.admit(tampered), null);
  assert.equal(quota.permitted('livechat_visitor=invalid'), false);
});

test('new day re-admits same browser identity and expires yesterday admission', async () => {
  let time = new Date('2026-09-27T15:59:59Z');
  const admissions = [];
  const quota = createQuota({ secret, now: () => time, store: {
    admit: async (day, id, limit) => { admissions.push({ day, id, limit }); return true; }
  } });
  const yesterday = cookieHeader(await quota.admit());
  time = new Date('2026-09-27T16:00:00Z');
  assert.equal(quota.permitted(yesterday), false);
  assert.ok(quota.permitted(cookieHeader(await quota.admit(yesterday))));
  assert.equal(admissions.length, 2);
  assert.equal(admissions[0].id, admissions[1].id);
  assert.equal(admissions[1].limit, 500);
});

test('database failures do not produce admission', async () => {
  const quota = createQuota({ secret, store: { admit: async () => { throw new Error('database unavailable'); } } });
  await assert.rejects(quota.admit(), /database unavailable/);
  assert.equal(quota.permitted(), false);
});

test('invalid deployment quota settings fail at startup', () => {
  assert.throws(() => createQuota({ store: {}, secret: 'short' }), /SECRET/);
  assert.throws(() => createQuota({ store: {}, secret, limit: NaN }), /LIMIT/);
  assert.throws(() => createQuota({ store: {}, secret, limit: 0 }), /LIMIT/);
});
