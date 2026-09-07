import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as engagement from '../game/engagement.ts';
import { DAY_MS, newEngagement } from '../game/engagement.ts';

const require = createRequire(import.meta.url);
function loadService(file, mocks) {
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, __DEV__: false, Date, Promise,
    require: (name) => name === '../game/engagement' ? engagement : name in mocks ? mocks[name] : require(name),
  });
  return exports;
}

function harness(options = {}) {
  let value = { ...newEngagement(Date.now() - 7 * DAY_MS), completedRounds: 4 };
  let consent = options.consent ?? true;
  let available = true;
  const calls = { initialize: 0, create: 0, show: 0, nativeLoad: 0 };
  const listeners = new Map();
  const emit = (event) => [...(listeners.get(event) ?? [])].forEach((fn) => fn());
  const instance = {
    addAdEventListener(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event).delete(handler);
    },
    load() { if (options.autoLoad !== false) emit('loaded'); },
    async show() { calls.show++; if (options.showFails) throw Error('presentation'); queueMicrotask(() => emit('closed')); },
  };
  const sdk = {
    default: () => ({ setRequestConfiguration: async () => {}, initialize: async () => { calls.initialize++; }, setAppMuted() {} }),
    AdsConsent: {
      requestInfoUpdate: async () => { if (!available) throw Error('consent service'); return { canRequestAds: consent }; },
      getConsentInfo: async () => ({ privacyOptionsRequirementStatus: 'required', canRequestAds: consent }),
      showPrivacyOptionsForm: async () => ({ canRequestAds: consent }),
    },
    AdsConsentStatus: { REQUIRED: 'required' },
    AdsConsentPrivacyOptionsRequirementStatus: { REQUIRED: 'required' },
    MaxAdContentRating: { G: 'G' }, TestIds: { INTERSTITIAL: 'test-unit' },
    AdEventType: { LOADED: 'loaded', ERROR: 'error', CLOSED: 'closed' },
    InterstitialAd: { createForAdRequest: () => { calls.create++; return instance; } },
  };
  const store = { async update(change = (v) => v) {
    if (options.storageFails) throw Error('disk');
    value = change(value); return value;
  } };
  const appState = { currentState: 'active' };
  const service = loadService('../services/ads.ios.ts', {
    'expo-constants': { default: { executionEnvironment: options.expoGo ? 'store' : 'standalone', expoConfig: { extra: { ads: { mode: 'test' } } } }, ExecutionEnvironment: { StoreClient: 'store' } },
    'react-native': { Platform: { OS: 'ios' }, AppState: appState },
    'react-native-google-mobile-ads': new Proxy(sdk, { get(target, property) { calls.nativeLoad++; return target[property]; } }),
    './engagement': { engagementStore: store },
  });
  return { service, calls, appState, emit, value: () => value, revoke: () => { consent = false; }, failConsent: () => { available = false; } };
}

test('no initialization or ad loading before fresh consent, including a failed refresh', async () => {
  for (const failure of ['denied', 'network', 'disk', 'expoGo']) {
    const h = harness({ consent: failure !== 'denied', storageFails: failure === 'disk', expoGo: failure === 'expoGo' });
    if (failure === 'network') h.failConsent();
    await h.service.prepareResultAd(() => true);
    assert.equal(h.calls.create, 0);
    await h.service.refreshAdConsent();
    await h.service.prepareResultAd(() => true);
    assert.equal(h.calls.initialize, 0);
  }
});

test('late loading never presents an ad after the group has continued', async () => {
  const h = harness({ autoLoad: false });
  await h.service.refreshAdConsent();
  await h.service.prepareResultAd(() => true);
  await h.service.showCompletedRoundAd(() => true);
  h.emit('loaded');
  assert.equal(h.calls.show, 0);
  assert.equal(h.value().lastAdRound, 0);
});

test('completed-results presentation waits for close, persists cap and rejects repeated attempts', async () => {
  const h = harness();
  await h.service.refreshAdConsent();
  await h.service.prepareResultAd(() => true);
  await Promise.all([h.service.showCompletedRoundAd(() => true), h.service.showCompletedRoundAd(() => true)]);
  assert.equal(h.calls.show, 1);
  assert.equal(h.value().lastAdRound, 4);
  await h.service.prepareResultAd(() => true);
  await h.service.showCompletedRoundAd(() => true);
  assert.equal(h.calls.show, 1);
});

test('background, navigation, consent revocation and removal all discard ready ads', async () => {
  for (const condition of ['background', 'navigation', 'revoked', 'removed']) {
    const h = harness();
    await h.service.refreshAdConsent();
    await h.service.prepareResultAd(() => true);
    if (condition === 'background') h.appState.currentState = 'background';
    if (condition === 'revoked') { h.revoke(); await h.service.openAdPrivacy(); }
    if (condition === 'removed') h.service.setAdsRemoved(true);
    await h.service.showCompletedRoundAd(() => condition !== 'navigation');
    assert.equal(h.calls.show, 0, condition);
  }
});

test('presentation failure settles so replay can continue', async () => {
  const h = harness({ showFails: true });
  await h.service.refreshAdConsent();
  await h.service.prepareResultAd(() => true);
  await h.service.showCompletedRoundAd(() => true);
  assert.equal(h.calls.show, 1);
});

test('review service records attempts once and rechecks navigation after awaiting availability', async () => {
  let value = { ...newEngagement(Date.now() - 7 * DAY_MS), completedRounds: 4 };
  let active = true;
  let calls = 0;
  const service = loadService('../services/engagement.ts', {
    '@react-native-async-storage/async-storage': { default: { getItem: async () => JSON.stringify(value), setItem: async (_, raw) => { value = JSON.parse(raw); } } },
    'expo-constants': { default: { expoConfig: { version: '2' } } },
    'expo-store-review': { isAvailableAsync: async () => true, requestReview: async () => { calls++; } },
    'react-native': { Platform: { OS: 'ios' }, AppState: { currentState: 'active' } },
  });
  active = false;
  assert.equal(await service.requestMilestoneReview(() => active), false);
  active = true;
  await Promise.all([service.requestMilestoneReview(() => active), service.requestMilestoneReview(() => active)]);
  assert.equal(calls, 1);
  assert.equal(value.reviewTimes.length, 1);
});
