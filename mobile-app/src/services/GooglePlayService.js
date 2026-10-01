import { Platform } from 'react-native';
import api from '../api';

/**
 * Thin wrapper around `expo-iap` for Google Play Billing purchases.
 *
 * Usage:
 *   await GooglePlayService.init();
 *   const products = await GooglePlayService.getCoinProducts(['com.flipstar.coins.100', ...]);
 *   const result = await GooglePlayService.purchaseCoinPackage(packageId, googleProductId);
 *
 * IMPORTANT: The Google product IDs used here MUST exactly match the
 * In-App Purchase products created in Google Play Console, and MUST match
 * the `google_product_id` configured on the CoinPackage / SubscriptionTier
 * in the Django admin.
 */

let RNIap = null;
let initialized = false;
let initPromise = null;

function getIap() {
  if (!RNIap) {
    // Lazy require so iOS/web builds (which don't ship the native module)
    // never crash on import.
    RNIap = require('expo-iap');
  }
  return RNIap;
}

async function init() {
  if (Platform.OS !== 'android') return false;
  if (initialized) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const iap = getIap();
      await iap.initConnection();
      initialized = true;
      return true;
    } catch (error) {
      console.error('[GooglePlay] initConnection failed:', error);
      initialized = false;
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

async function endConnection() {
  if (!initialized) return;
  try {
    const iap = getIap();
    await iap.endConnection();
  } catch (error) {
    console.error('[GooglePlay] endConnection failed:', error);
  } finally {
    initialized = false;
  }
}

async function getCoinProducts(productIds) {
  if (Platform.OS !== 'android' || !productIds?.length) return [];
  await init();
  try {
    const iap = getIap();
    return await iap.getProducts({ skus: productIds });
  } catch (error) {
    console.error('[GooglePlay] getProducts (coins) failed:', error);
    return [];
  }
}

async function getSubscriptionProducts(productIds) {
  if (Platform.OS !== 'android' || !productIds?.length) return [];
  await init();
  try {
    const iap = getIap();
    return await iap.getSubscriptions({ skus: productIds });
  } catch (error) {
    console.error('[GooglePlay] getSubscriptions failed:', error);
    return [];
  }
}

/**
 * Extract the purchase token from a expo-iap purchase object,
 * across the various shapes returned by different library versions.
 */
function extractPurchaseToken(purchase) {
  return (
    purchase?.purchaseToken ||
    purchase?.transactionReceipt ||
    purchase?.originalJson ||
    null
  );
}

async function finishPurchase(iap, purchase, isConsumable) {
  try {
    await iap.finishTransaction({ purchase, isConsumable });
  } catch (error) {
    console.error('[GooglePlay] finishTransaction failed:', error);
  }
}

/**
 * Buy a consumable coin package via Google Play Billing, then verify the purchase with
 * our backend and credit the coins.
 *
 * @param {number|string} packageId - Our CoinPackage.id
 * @param {string} googleProductId - Google Play Console product ID
 * @returns {Promise<{success: boolean, coinsAdded?: number, error?: string}>}
 */
async function purchaseCoinPackage(packageId, googleProductId) {
  if (Platform.OS !== 'android') {
    return { success: false, error: 'Google Play Billing is only available on Android' };
  }
  if (!googleProductId) {
    return { success: false, error: 'This package is not configured for Google Play purchases yet' };
  }

  await init();
  const iap = getIap();

  try {
    const purchase = await iap.requestPurchase({ sku: googleProductId });
    const resolvedPurchase = Array.isArray(purchase) ? purchase[0] : purchase;
    const purchaseToken = extractPurchaseToken(resolvedPurchase);

    if (!purchaseToken) {
      return { success: false, error: 'No purchase token returned by Google Play' };
    }

    const result = await api.googleVerifyCoinPurchase(packageId, purchaseToken, googleProductId);
    await finishPurchase(iap, resolvedPurchase, true);

    return { success: true, coinsAdded: result.coins_added, balance: result.balance };
  } catch (error) {
    if (error?.code === 'E_USER_CANCELLED') {
      return { success: false, cancelled: true, error: 'Purchase cancelled' };
    }
    console.error('[GooglePlay] purchaseCoinPackage failed:', error);
    return { success: false, error: error?.message || 'Purchase failed' };
  }
}

/**
 * Buy/renew an auto-renewable subscription tier via Google Play Billing, then verify
 * the purchase with our backend and activate the subscription.
 *
 * @param {string} tierId - Our SubscriptionTier.id
 * @param {string} googleProductId - Google Play Console product ID
 * @returns {Promise<{success: boolean, subscription?: object, error?: string}>}
 */
async function purchaseSubscription(tierId, googleProductId) {
  if (Platform.OS !== 'android') {
    return { success: false, error: 'Google Play Billing is only available on Android' };
  }
  if (!googleProductId) {
    return { success: false, error: 'This plan is not configured for Google Play purchases yet' };
  }

  await init();
  const iap = getIap();

  try {
    const purchase = await iap.requestSubscription({ sku: googleProductId });
    const resolvedPurchase = Array.isArray(purchase) ? purchase[0] : purchase;
    const purchaseToken = extractPurchaseToken(resolvedPurchase);

    if (!purchaseToken) {
      return { success: false, error: 'No purchase token returned by Google Play' };
    }

    const result = await api.googleVerifySubscription(tierId, purchaseToken, googleProductId);
    await finishPurchase(iap, resolvedPurchase, false);

    return { success: true, subscription: result.subscription };
  } catch (error) {
    if (error?.code === 'E_USER_CANCELLED') {
      return { success: false, cancelled: true, error: 'Purchase cancelled' };
    }
    console.error('[GooglePlay] purchaseSubscription failed:', error);
    return { success: false, error: error?.message || 'Purchase failed' };
  }
}

export default {
  init,
  endConnection,
  getCoinProducts,
  getSubscriptionProducts,
  purchaseCoinPackage,
  purchaseSubscription,
};