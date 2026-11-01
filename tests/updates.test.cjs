const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '..', 'js', 'updates.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/\bexport /g, '');

function app({ canSave = true, iframe = false } = {}) {
  const calls = [], handlers = {};
  const window = { isSecureContext: true, addEventListener() {} };
  window.self = window;
  window.top = iframe ? {} : window;
  const document = { documentElement: { dataset: {} }, addEventListener() {} };
  const sandbox = {
    document, window, console,
    location: { protocol: 'https:', reload: () => calls.push('reload') },
    flushSave: () => { calls.push('flush'); return canSave; },
    toast: () => calls.push('warning'),
    navigator: {
      serviceWorker: {
        addEventListener: (name, handler) => { handlers[name] = handler; },
        register: (url, options) => {
          calls.push(options.updateViaCache);
          return Promise.resolve({ update: async () => {} });
        },
      },
    },
  };
  vm.runInNewContext(source + '\ninitUpdates();', sandbox);
  return { calls, handlers, document };
}

test('controller change flushes pending scores before reloading, once', () => {
  const a = app();
  a.handlers.controllerchange();
  a.handlers.controllerchange();
  assert.deepEqual(a.calls, ['none', 'flush', 'reload']);
});

test('storage failure keeps the current page and warns instead of losing scores', () => {
  const a = app({ canSave: false });
  a.handlers.controllerchange();
  assert.deepEqual(a.calls, ['none', 'flush', 'warning']);
});

test('embedded preview shows the version but does not register a worker', () => {
  const a = app({ iframe: true });
  assert.match(a.document.documentElement.dataset.appVersion, /^\d{4}\./);
  assert.deepEqual(a.calls, []);
});
