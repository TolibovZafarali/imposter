import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from '@babel/core';

const require = createRequire(import.meta.url);
const sourceUrl = new URL('../services/appAttest.ts', import.meta.url);
const preset = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] });
const metroRuntime = readFileSync(require.resolve('metro-runtime/src/polyfills/require'), 'utf8');

for (const platform of ['ios', 'android', 'web']) {
  test(`default integrity loader on ${platform} preserves lazy native exports`, async () => {
    let notificationReads = 0;
    const integrity = {
      isSupported: true,
      generateKeyAsync: async () => 'key',
      attestKeyAsync: async () => 'attestation',
      generateAssertionAsync: async () => 'assertion',
    };
    const reactNative = {
      Platform: { OS: platform },
      get PushNotificationIOS() {
        notificationReads += 1;
        throw new Error('Unavailable native notification module');
      },
    };
    const context = vm.createContext({
      __DEV__: false,
      __METRO_GLOBAL_PREFIX__: '',
      exports: {},
      require,
      process: { env: { EXPO_OS: platform } },
    });
    context.global = context;
    vm.runInContext(metroRuntime, context);
    context.__d((_global, _require, _default, _all, module) => {
      module.exports = reactNative;
    }, 'react-native', []);
    context.__d((_global, _require, _default, _all, module) => {
      module.exports = integrity;
    }, '@expo/app-integrity', []);

    const { code } = transformSync(readFileSync(sourceUrl, 'utf8'), {
      filename: sourceUrl.pathname,
      babelrc: false,
      configFile: false,
      presets: [preset],
      caller: { name: 'metro', bundler: 'metro', platform, isDev: false, isServer: false, engine: 'hermes' },
      plugins: [({ types: t }) => ({
        visitor: {
          CallExpression(path) {
            if (!t.isImport(path.node.callee)) return;
            // Execute dynamic imports through Metro's real namespace loader.
            path.replaceWith(t.callExpression(
              t.memberExpression(t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('resolve')), []), t.identifier('then')),
              [t.arrowFunctionExpression([], t.callExpression(t.memberExpression(t.identifier('__r'), t.identifier('importAll')), path.node.arguments))],
            ));
          },
        },
      })],
    });
    vm.runInContext(code, context);
    const result = await vm.runInContext('defaultDependencies.loadAppIntegrity()', context);
    assert.equal(notificationReads, 0, 'checking platform must not initialize unrelated native modules');
    assert.equal(result.isSupported, platform === 'ios');
    assert.equal(result.generateKeyAsync, integrity.generateKeyAsync);
    assert.equal(result.attestKeyAsync, integrity.attestKeyAsync);
    assert.equal(result.generateAssertionAsync, integrity.generateAssertionAsync);
  });
}
