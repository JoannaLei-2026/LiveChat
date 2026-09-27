const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const RealWebSocket = require('ws');

test('Gemini connections use isolated visitor keys and reject missing keys without using owner credentials', async () => {
  const upstreamKeys = [];
  class FakeUpstream extends EventEmitter {
    constructor(url) {
      super();
      upstreamKeys.push(new URL(url).searchParams.get('key'));
      this.readyState = RealWebSocket.OPEN;
      queueMicrotask(() => this.emit('open'));
    }
    send() {}
    terminate() { this.readyState = RealWebSocket.CLOSED; this.emit('close'); }
  }
  FakeUpstream.Server = RealWebSocket.Server;
  FakeUpstream.OPEN = RealWebSocket.OPEN;
  const wsModule = require.cache[require.resolve('ws')];
  wsModule.exports = FakeUpstream;
  process.env.NODE_PORT = '0';
  process.env.GEMINI_API_KEY = 'owner-key-must-never-be-used';
  const server = require('../server');
  const clients = [];
  try {
    await once(server, 'listening');
    for (const apiKey of [undefined, 'visitor-one-test-key', 'visitor-two-test-key']) {
      const client = new RealWebSocket(`ws://localhost:${server.address().port}`);
      clients.push(client);
      await once(client, 'open');
      const reply = once(client, 'message');
      client.send(JSON.stringify({ type: 'init', apiKey, systemInstruction: 'Hello' }));
      const message = JSON.parse((await reply)[0].toString());
      assert.equal(message.type, apiKey ? 'init_success' : 'error');
    }
    assert.deepEqual(upstreamKeys, ['visitor-one-test-key', 'visitor-two-test-key']);
  } finally {
    wsModule.exports = RealWebSocket;
    await Promise.all(clients.map(async client => {
      const closed = once(client, 'close');
      client.close();
      await closed;
    }));
    await new Promise(resolve => server.close(resolve));
  }
});
