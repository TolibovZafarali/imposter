import Constants, { ExecutionEnvironment } from 'expo-constants';
import { AppState, Platform } from 'react-native';
import type { InterstitialAd } from 'react-native-google-mobile-ads';
import { canOfferAds, canShowAd } from '../game/engagement';
import { engagementStore } from './engagement';

type AdsModule = typeof import('react-native-google-mobile-ads');
const config = Constants.expoConfig?.extra?.ads;
export const adsEnabled = Platform.OS === 'ios' &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient &&
  (config?.mode === 'live' || config?.mode === 'test');
let sdk: AdsModule | null = null;
let initialized = false;
let consentRefreshed = false;
let consentAllowed = false;
let consentGeneration = 0;
let refreshing = false;
let adsRemoved = false;
let preparing = false;
let presenting = false;
let ad: InterstitialAd | null = null;
let loadedAt = 0;
let cleanup: (() => void) | null = null;

const getSdk = () => {
  if (!adsEnabled || adsRemoved) return null;
  try {
    // Expo Go and ad-free native builds do not contain the native module.
    sdk ??= require('react-native-google-mobile-ads') as AdsModule;
    return sdk;
  } catch {
    return null;
  }
};

export function discardPreparedAd() {
  cleanup?.();
  cleanup = null;
  ad = null;
  loadedAt = 0;
}

export function setAdsRemoved(removed: boolean) {
  adsRemoved = removed;
  if (removed) discardPreparedAd();
}

export async function refreshAdConsent() {
  const module = getSdk();
  if (!module || consentRefreshed || presenting || refreshing) return;
  refreshing = true;
  const generation = consentGeneration;
  consentAllowed = false;
  discardPreparedAd();
  try {
    const info = await module.AdsConsent.requestInfoUpdate();
    if (generation === consentGeneration) {
      consentAllowed = info.canRequestAds;
      consentRefreshed = true;
    }
  } catch {
    if (generation === consentGeneration) consentAllowed = false;
  } finally {
    refreshing = false;
  }
}

export async function prepareAdConsentAtSetup(isStillAtSetup: () => boolean) {
  const module = getSdk();
  if (!module || presenting) return;
  presenting = true;
  try {
    if (!canOfferAds(await engagementStore.update(), Date.now()) ||
      !isStillAtSetup() || AppState.currentState !== 'active') return;
    consentGeneration++;
    consentAllowed = false;
    discardPreparedAd();
    await module.AdsConsent.requestInfoUpdate();
    if (!isStillAtSetup() || AppState.currentState !== 'active') return;
    const info = await module.AdsConsent.loadAndShowConsentFormIfRequired();
    consentAllowed = info.canRequestAds;
    consentRefreshed = true;
  } catch {
    consentAllowed = false;
  } finally {
    presenting = false;
  }
}

export async function openAdPrivacy() {
  const module = getSdk();
  if (!module || presenting) return;
  presenting = true;
  consentGeneration++;
  consentAllowed = false;
  discardPreparedAd();
  try {
    await module.AdsConsent.requestInfoUpdate();
    const current = await module.AdsConsent.getConsentInfo();
    const info = current.status !== module.AdsConsentStatus.REQUIRED &&
      current.privacyOptionsRequirementStatus === module.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED
      ? await module.AdsConsent.showPrivacyOptionsForm()
      : await module.AdsConsent.loadAndShowConsentFormIfRequired();
    consentAllowed = info.canRequestAds;
    consentRefreshed = true;
  } finally {
    presenting = false;
  }
}

export async function prepareResultAd(isStillOnResults: () => boolean) {
  if (preparing || presenting || ad || !consentRefreshed || !consentAllowed) return;
  preparing = true;
  const generation = consentGeneration;
  try {
    const module = getSdk();
    if (!module || !canOfferAds(await engagementStore.update(), Date.now()) || !isStillOnResults()) return;
    if (!initialized) {
      await module.default().setRequestConfiguration({ maxAdContentRating: module.MaxAdContentRating.G });
      await module.default().initialize();
      module.default().setAppMuted(true);
      initialized = true;
    }
    if (!isStillOnResults() || adsRemoved || !consentAllowed || generation !== consentGeneration) return;
    const unitId = __DEV__ || config.mode === 'test' ? module.TestIds.INTERSTITIAL : config.interstitialId;
    if (typeof unitId !== 'string') return;
    const instance = module.InterstitialAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true });
    ad = instance;
    const loaded = instance.addAdEventListener(module.AdEventType.LOADED, () => {
      if (ad === instance) loadedAt = Date.now();
    });
    const error = instance.addAdEventListener(module.AdEventType.ERROR, discardPreparedAd);
    cleanup = () => { loaded(); error(); };
    instance.load();
  } catch {
    discardPreparedAd();
  } finally {
    preparing = false;
  }
}

export async function showCompletedRoundAd(isStillOnResults: () => boolean) {
  const module = getSdk();
  const instance = ad;
  if (!module || !instance || !loadedAt || Date.now() - loadedAt > 55 * 60_000 ||
    presenting || !consentAllowed || !isStillOnResults() || AppState.currentState !== 'active') {
    discardPreparedAd();
    return;
  }
  presenting = true;
  try {
    let reserved = false;
    await engagementStore.update((value) => {
      const now = Date.now();
      if (!canShowAd(value, now, adsRemoved) || !isStillOnResults() ||
        AppState.currentState !== 'active' || !consentAllowed) return value;
      reserved = true;
      // Persist the attempt before presentation so a crash cannot bypass the cap.
      return { ...value, lastAdAt: now, lastAdRound: value.completedRounds, adTimes: [...value.adTimes, now] };
    });
    if (!reserved || !isStillOnResults() || adsRemoved || AppState.currentState !== 'active') return;
    await new Promise<void>((resolve) => {
      const finish = () => { closed(); failed(); resolve(); };
      const closed = instance.addAdEventListener(module.AdEventType.CLOSED, finish);
      const failed = instance.addAdEventListener(module.AdEventType.ERROR, finish);
      instance.show().catch(finish);
    });
  } catch {
    // Monetization failure must never prevent replay.
  } finally {
    presenting = false;
    discardPreparedAd();
  }
}
