import { Platform } from 'react-native';
import api from '../api';

/**
 * Thin wrapper around `expo-iap` for Apple StoreKit purchases.
 *
 * Usage:
 *   await AppleIAPService.init();
 *   const products = await AppleIAPService.getCoinProducts(['com.flipstar.coins.100', ...]);
 *   const result = await AppleIAPService.purchaseCoinPackage(packageId, appleProductId);
 *
 * IMPORTANT: The Apple product IDs used here MUST exactly match the
 * In-App Purchase products created in App Store Connect, and MUST match
 * the `apple_product_id` configured on the CoinPackage / SubscriptionTier
 * in the Django admin.
 */

let RNIap = null;
let initialized = false;
let initPromise = null;

function getIap() {
  if (!RNIap) {
    // Lazy require so Android/web builds (which don't ship the native module)
    // never crash on import.
    RNIap = require('expo-iap');
  }
  return RNIap;
}

async function init() {
  if (Platform.OS !== 'ios') return false;
  if (initialized) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const iap = getIap();
      await iap.initConnection();
      initialized = true;
      return true;
    } catch (error) {
      console.error('[AppleIAP] initConnection failed:', error);
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
    console.error('[AppleIAP] endConnection failed:', error);
  } finally {
    initialized = false;
  }
}

async function getCoinProducts(productIds) {
  if (Platform.OS !== 'ios' || !productIds?.length) return [];
  await init();
  try {
    const iap = getIap();
    return await iap.getProducts({ skus: productIds });
  } catch (error) {
    console.error('[AppleIAP] getProducts (coins) failed:', error);
    return [];
  }
}

async function getSubscriptionProducts(productIds) {
  if (Platform.OS !== 'ios' || !productIds?.length) return [];
  await init();
  try {
    const iap = getIap();
    return await iap.getSubscriptions({ skus: productIds });
  } catch (error) {
    console.error('[AppleIAP] getSubscriptions failed:', error);
    return [];
  }
}

/**
 * Extract the base64 receipt string from a expo-iap purchase object,
 * across the various shapes returned by different library versions.
 */
function extractReceipt(purchase) {
  return (
    purchase?.transactionReceipt ||
    purchase?.originalJson ||
    purchase?.receipt ||
    null
  );
}

async function finishPurchase(iap, purchase, isConsumable) {
  try {
    await iap.finishTransaction({ purchase, isConsumable });
  } catch (error) {
    console.error('[AppleIAP] finishTransaction failed:', error);
  }
}

/**
 * Buy a consumable coin package via StoreKit, then verify the receipt with
 * our backend and credit the coins.
 *
 * @param {number|string} packageId - Our CoinPackage.id
 * @param {string} appleProductId - Apple App Store Connect product ID
 * @returns {Promise<{success: boolean, coinsAdded?: number, error?: string}>}
 */
async function purchaseCoinPackage(packageId, appleProductId) {
  if (Platform.OS !== 'ios') {
    return { success: false, error: 'Apple In-App Purchase is only available on iOS' };
  }
  if (!appleProductId) {
    return { success: false, error: 'This package is not configured for Apple purchases yet' };
  }

  await init();
  const iap = getIap();

  try {
    const purchase = await iap.requestPurchase({ sku: appleProductId });
    const resolvedPurchase = Array.isArray(purchase) ? purchase[0] : purchase;
    const receiptData = extractReceipt(resolvedPurchase);

    if (!receiptData) {
      return { success: false, error: 'No receipt returned by StoreKit' };
    }

    const result = await api.appleVerifyCoinPurchase(packageId, receiptData, appleProductId);
    await finishPurchase(iap, resolvedPurchase, true);

    return { success: true, coinsAdded: result.coins_added, balance: result.balance };
  } catch (error) {
    if (error?.code === 'E_USER_CANCELLED') {
      return { success: false, cancelled: true, error: 'Purchase cancelled' };
    }
    console.error('[AppleIAP] purchaseCoinPackage failed:', error);
    return { success: false, error: error?.message || 'Purchase failed' };
  }
}

/**
 * Buy/renew an auto-renewable subscription tier via StoreKit, then verify
 * the receipt with our backend and activate the subscription.
 *
 * @param {string} tierId - Our SubscriptionTier.id
 * @param {string} appleProductId - Apple App Store Connect product ID
 * @returns {Promise<{success: boolean, subscription?: object, error?: string}>}
 */
async function purchaseSubscription(tierId, appleProductId) {
  if (Platform.OS !== 'ios') {
    return { success: false, error: 'Apple In-App Purchase is only available on iOS' };
  }
  if (!appleProductId) {
    return { success: false, error: 'This plan is not configured for Apple purchases yet' };
  }

  await init();
  const iap = getIap();

  try {
    const purchase = await iap.requestSubscription({ sku: appleProductId });
    const resolvedPurchase = Array.isArray(purchase) ? purchase[0] : purchase;
    const receiptData = extractReceipt(resolvedPurchase);

    if (!receiptData) {
      return { success: false, error: 'No receipt returned by StoreKit' };
    }

    const result = await api.appleVerifySubscription(tierId, receiptData, appleProductId);
    await finishPurchase(iap, resolvedPurchase, false);

    return { success: true, subscription: result.subscription };
  } catch (error) {
    if (error?.code === 'E_USER_CANCELLED') {
      return { success: false, cancelled: true, error: 'Purchase cancelled' };
    }
    console.error('[AppleIAP] purchaseSubscription failed:', error);
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