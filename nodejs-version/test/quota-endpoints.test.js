const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');

test('HTTP and WebSocket gates reject absent or forged admission; full and unavailable store fail closed', async () => {
  // Substitute only the persistence boundary; real cookies, HTTP and WS are exercised.
  const quotaModule = require('../visitor-quota');
  const originalStore = quotaModule.firestoreStore;
  let available = true;
  let full = false;
  quotaModule.firestoreStore = () => ({ admit: async () => {
    if (!available) throw new Error('offline');
    return !full;
  } });
  process.env.NODE_PORT = '0';
  process.env.DAILY_VISITOR_LIMIT = '500';
  process.env.VISITOR_COOKIE_SECRET = 'test-only-cookie-secret-with-32-characters';
  const server = require('../server');
  try {
    await once(server, 'listening');
    const origin = `http://localhost:${server.address().port}`;
    const access = cookie => fetch(`${origin}/api/access`, {
      method: 'POST', headers: { Origin: origin, Cookie: cookie || '' }
    });
    assert.equal((await fetch(`${origin}/api/access`, { method: 'POST' })).status, 403);
    const denied = await fetch(`${origin}/api/openai/live-session`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: 'offer', instructions: 'hi' })
    });
    assert.equal(denied.status, 403);
    const checkUpgrade = async (cookie, expected) => {
      const client = new WebSocket(origin.replace('http:', 'ws:'), { origin, headers: { Cookie: cookie || '' } });
      client.on('error', () => {});
      await new Promise((resolve, reject) => {
        client.on('open', () => {
          try { assert.equal(expected, 101); client.once('close', resolve); client.close(); }
          catch (error) { client.terminate(); reject(error); }
        });
        client.on('unexpected-response', (req, res) => {
          res.resume(); client.terminate();
          try { assert.equal(res.statusCode, expected); resolve(); } catch (error) { reject(error); }
        });
      });
    };
    await checkUpgrade('', 403);
    const admitted = await access();
    assert.equal(admitted.status, 200);
    const cookie = admitted.headers.get('set-cookie').split(';')[0];
    assert.match(admitted.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    await checkUpgrade(cookie, 101);
    await checkUpgrade(cookie + 'tampered', 403);
    full = true;
    assert.equal((await access()).status, 429);
    assert.equal((await access(cookie)).status, 200);
    available = false;
    assert.equal((await access()).status, 503);
  } finally {
    quotaModule.firestoreStore = originalStore;
    await new Promise(resolve => server.close(resolve));
  }
});
