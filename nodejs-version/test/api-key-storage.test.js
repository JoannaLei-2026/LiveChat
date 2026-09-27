const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../public/api-key-storage.js'), 'utf8');
function load(storage) {
  const context = { window: {}, localStorage: storage };
  vm.runInNewContext(source, context);
  return context.window.apiKeyStorage;
}

test('provider keys survive page reload separately and can be cleared independently', () => {
  const data = new Map();
  const storage = {
    getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key)
  };
  const firstPage = load(storage);
  assert.equal(firstPage.read('gemini'), '');
  assert.equal(firstPage.save('gemini', 'gemini-test-visitor-key'), true);
  assert.equal(firstPage.save('openai', 'openai-test-visitor-key'), true);
  const reopenedPage = load(storage);
  assert.equal(reopenedPage.read('gemini'), 'gemini-test-visitor-key');
  assert.equal(reopenedPage.read('openai'), 'openai-test-visitor-key');
  assert.equal(reopenedPage.clear('gemini'), true);
  assert.equal(load(storage).read('gemini'), '');
  assert.equal(load(storage).read('openai'), 'openai-test-visitor-key');
});

test('blocked browser storage falls back without crashing page', () => {
  const denied = () => { throw new Error('Access denied'); };
  const keys = load({ getItem: denied, setItem: denied, removeItem: denied });
  assert.equal(keys.read('gemini'), '');
  assert.equal(keys.save('gemini', 'test-key'), false);
  assert.equal(keys.clear('gemini'), false);
});
