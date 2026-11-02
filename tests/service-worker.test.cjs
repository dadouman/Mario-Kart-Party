// Sans dépendance : node --test tests/service-worker.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require('node:path').join(__dirname, '..', 'sw.js'), 'utf8');
const scope = 'https://example.test/Mario-Kart-Party/';

function worker({ failAsset = false } = {}) {
  const handlers = {}, stores = new Map(), requests = [];
  let activated = 0, claimed = 0;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {
        async put(key, response) { data.set(String(key), response); },
        async match(key) { return data.get(String(key))?.clone(); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  vm.runInNewContext(source, {
    URL, Response, caches,
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      if (failAsset && String(url).includes('updates.js')) return new Response('', { status: 503 });
      // Simule un cache HTTP encore frais qui contient l'ancienne application.
      const fresh = new URL(String(url)).searchParams.has('__mkp_release') && options?.cache === 'reload';
      return new Response(fresh ? 'NEW INLINE UI' : 'OLD UI');
    },
    self: {
      registration: { scope },
      addEventListener: (type, handler) => { handlers[type] = handler; },
      skipWaiting: async () => { activated++; },
      clients: { claim: async () => { claimed++; } },
    },
  });
  return {
    caches, stores, requests,
    get activated() { return activated; },
    get claimed() { return claimed; },
    async run(type) {
      let promise;
      handlers[type]({ waitUntil: (p) => { promise = p; } });
      await promise;
    },
    async request(url, mode = 'cors') {
      let promise;
      handlers.fetch({
        request: { method: 'GET', url, mode },
        respondWith: (p) => { promise = p; },
      });
      return promise;
    },
  };
}

test('precache bypasses stale HTTP files and stores canonical module URLs', async () => {
  const w = worker();
  await w.run('install');
  assert.equal(w.activated, 1);
  assert.ok(w.requests.length >= 15);
  for (const request of w.requests) {
    assert.ok(new URL(request.url).searchParams.get('__mkp_release'));
    assert.equal(request.options.cache, 'reload');
  }
  const name = (await w.caches.keys())[0];
  const cache = await w.caches.open(name);
  assert.equal(await (await cache.match(scope + 'js/views.js')).text(), 'NEW INLINE UI');
  assert.equal(await (await cache.match(scope + 'js/updates.js')).text(), 'NEW INLINE UI');
  assert.ok([...w.stores.get(name).keys()].every((url) => !new URL(url).search));
});

test('an incomplete release never replaces the active offline version', async () => {
  const w = worker({ failAsset: true });
  await w.caches.open('mkp-v6-inline-grand-prix');
  await assert.rejects(w.run('install'), /Installation incomplète/);
  assert.equal(w.activated, 0);
  assert.ok((await w.caches.keys()).includes('mkp-v6-inline-grand-prix'));
});

test('unsafe legacy multi-tab clients must close before update activation', async () => {
  const w = worker();
  await w.caches.open('mkp-v7-2026.11.02.1');
  await w.run('install');
  assert.equal(w.activated, 0);
  assert.ok((await w.caches.keys()).includes('mkp-v7-2026.11.02.1'));
});

test('activation removes only obsolete app caches', async () => {
  const w = worker();
  await w.caches.open('mkp-v6-inline-grand-prix');
  await w.caches.open('unrelated-app');
  await w.run('install');
  await w.run('activate');
  const names = await w.caches.keys();
  assert.equal(w.claimed, 1);
  assert.ok(!names.includes('mkp-v6-inline-grand-prix'));
  assert.ok(names.includes('unrelated-app'));
  assert.equal(names.filter((n) => n.startsWith('mkp-')).length, 1);
});

test('versioned entry point uses the coherent cache, outside requests are untouched', async () => {
  const w = worker();
  await w.run('install');
  const version = new URL(w.requests[0].url).searchParams.get('__mkp_release');
  const before = w.requests.length;
  const response = await w.request(scope + 'js/app.js?v=' + version);
  assert.equal(await response.text(), 'NEW INLINE UI');
  assert.equal(w.requests.length, before);
  assert.equal(await w.request('https://fonts.example.test/style.css'), undefined);
  assert.equal(await w.request('https://example.test/another-app/'), undefined);
});
