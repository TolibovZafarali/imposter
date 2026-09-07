import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as StoreReview from 'expo-store-review';
import { AppState, Platform } from 'react-native';
import { canRequestReview, createEngagementStore } from '../game/engagement';

export const engagementStore = createEngagementStore(AsyncStorage);
export const APP_STORE_URL = 'https://apps.apple.com/app/id6771144493';
let reviewInFlight = false;

export async function requestMilestoneReview(isStillOnResults: () => boolean) {
  if (Platform.OS !== 'ios' || reviewInFlight) return false;
  reviewInFlight = true;
  try {
    const version = Constants.expoConfig?.version ?? '1.0.0';
    const available = await StoreReview.isAvailableAsync();
    if (!available) return false;
    let reserved = false;
    await engagementStore.update((value) => {
      const now = Date.now();
      if (!isStillOnResults() || AppState.currentState !== 'active' ||
        !canRequestReview(value, now, version)) return value;
      reserved = true;
      return { ...value, lastReviewVersion: version, reviewTimes: [...value.reviewTimes, now] };
    });
    if (!reserved || !isStillOnResults() || AppState.currentState !== 'active') return false;
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  } finally {
    reviewInFlight = false;
  }
}
