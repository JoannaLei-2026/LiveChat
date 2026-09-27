const test = require('node:test');
const assert = require('node:assert/strict');

test('OpenAI Live session endpoint validates requests and proxies SDP without exposing the key', async () => {
  process.env.NODE_PORT = '0';
  process.env.OPENAI_API_KEY = 'owner-key-must-never-be-used';
  const nativeFetch = global.fetch;
  let upstreamRequest;
  global.fetch = async (url, options) => {
    if (url === 'https://api.openai.com/v1/live/sessions') {
      upstreamRequest = options;
      return new Response(JSON.stringify({
        session: { id: 'live_test' },
        transport: { type: 'webrtc', sdp: 'answer-sdp' }
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return nativeFetch(url, options);
  };
  const server = require('../server');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://localhost:${server.address().port}/api/openai/live-session`;
    const origin = new URL(url).origin;
    const post = (body, requestOrigin = origin, key = 'unit-test-visitor-key') => nativeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: requestOrigin, 'X-API-Key': key },
      body: JSON.stringify(body)
    });

    assert.equal((await post({ sdp: 'offer', instructions: 'hi' }, 'https://example.com')).status, 403);
    assert.equal((await post({ sdp: '', instructions: 'hi' })).status, 400);
    assert.equal((await post({ sdp: 'offer', instructions: 'hi' }, origin, '')).status, 400);
    assert.equal(upstreamRequest, undefined);
    const response = await post({ sdp: 'offer-sdp', instructions: '你是導遊。' });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      session: { id: 'live_test' }, transport: { type: 'webrtc', sdp: 'answer-sdp' }
    });
    const body = JSON.parse(upstreamRequest.body);
    assert.equal(body.session.model, 'gpt-live-1');
    assert.equal(body.session.instructions, '你是導遊。');
    assert.equal(body.transport.sdp, 'offer-sdp');
    assert.equal(upstreamRequest.headers.Authorization, 'Bearer unit-test-visitor-key');
    await post({ sdp: 'offer-2', instructions: 'hello' }, origin, 'different-visitor-key');
    assert.equal(upstreamRequest.headers.Authorization, 'Bearer different-visitor-key');
    const health = await (await nativeFetch(`${origin}/api/health`)).json();
    assert.equal(health.requiresUserApiKey, true);
    assert.equal(health.hasApiKey, undefined);
  } finally {
    global.fetch = nativeFetch;
    await new Promise(resolve => server.close(resolve));
  }
});
