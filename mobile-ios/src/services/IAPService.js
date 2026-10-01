import { Platform } from 'react-native';
import AppleIAPService from './AppleIAPService';
import GooglePlayService from './GooglePlayService';

/**
 * Unified In-App Purchase service that automatically uses the correct 
 * platform service (Apple App Store or Google Play Billing).
 * 
 * Usage:
 *   await IAPService.init();
 *   const products = await IAPService.getCoinProducts(['com.flipstar.coins.100']);
 *   const result = await IAPService.purchaseCoinPackage(packageId, productId);
 */

function getPlatformService() {
  return Platform.OS === 'ios' ? AppleIAPService : GooglePlayService;
}

async function init() {
  const service = getPlatformService();
  return await service.init();
}

async function endConnection() {
  const service = getPlatformService();
  return await service.endConnection();
}

async function getCoinProducts(productIds) {
  const service = getPlatformService();
  return await service.getCoinProducts(productIds);
}

async function getSubscriptionProducts(productIds) {
  const service = getPlatformService();
  return await service.getSubscriptionProducts(productIds);
}

/**
 * Purchase a coin package using the appropriate platform service.
 * 
 * @param {number|string} packageId - Our CoinPackage.id
 * @param {string} productId - Platform-specific product ID (Apple or Google)
 * @returns {Promise<{success: boolean, coinsAdded?: number, error?: string}>}
 */
async function purchaseCoinPackage(packageId, productId) {
  const service = getPlatformService();
  return await service.purchaseCoinPackage(packageId, productId);
}

/**
 * Purchase a subscription using the appropriate platform service.
 * 
 * @param {string} tierId - Our SubscriptionTier.id
 * @param {string} productId - Platform-specific product ID (Apple or Google)
 * @returns {Promise<{success: boolean, subscription?: object, error?: string}>}
 */
async function purchaseSubscription(tierId, productId) {
  const service = getPlatformService();
  return await service.purchaseSubscription(tierId, productId);
}

export default {
  init,
  endConnection,
  getCoinProducts,
  getSubscriptionProducts,
  purchaseCoinPackage,
  purchaseSubscription,
};