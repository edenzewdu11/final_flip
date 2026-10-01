"""
Apple In-App Purchase (StoreKit) receipt verification service.

Validates a base64 App Store receipt against Apple's verifyReceipt endpoint.
Tries production first; if Apple responds with status 21007 ("this receipt is
from the test environment"), retries against the sandbox endpoint. This is
Apple's officially recommended approach so the same code path works for
TestFlight/sandbox testing and live App Store purchases.

Docs: https://developer.apple.com/documentation/appstorereceipts/verifyreceipt
"""
import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# Status code returned by Apple when a production receipt is sent to the
# sandbox environment (or vice versa for 21008) and must be retried.
STATUS_SANDBOX_RECEIPT = 21007
STATUS_PRODUCTION_RECEIPT = 21008


class AppleIAPError(Exception):
    """Raised when a receipt cannot be verified with Apple."""


def _post_receipt(url, receipt_data):
    payload = {'receipt-data': receipt_data}
    if getattr(settings, 'APPLE_SHARED_SECRET', ''):
        payload['password'] = settings.APPLE_SHARED_SECRET

    response = requests.post(url, json=payload, timeout=15)
    response.raise_for_status()
    return response.json()


def verify_receipt(receipt_data):
    """
    Verify an App Store receipt with Apple.

    Args:
        receipt_data: base64-encoded receipt string from the device
                       (react-native-iap's `transactionReceipt`).

    Returns:
        dict: Apple's parsed JSON response (status, receipt, latest_receipt_info).

    Raises:
        AppleIAPError: if the receipt is invalid or Apple returns an error status.
    """
    if not receipt_data:
        raise AppleIAPError('Missing receipt data')

    result = _post_receipt(settings.APPLE_VERIFY_RECEIPT_URL_PRODUCTION, receipt_data)

    if result.get('status') == STATUS_SANDBOX_RECEIPT:
        logger.info('[Apple IAP] Production receipt was sandbox, retrying sandbox endpoint')
        result = _post_receipt(settings.APPLE_VERIFY_RECEIPT_URL_SANDBOX, receipt_data)
    elif result.get('status') == STATUS_PRODUCTION_RECEIPT:
        logger.info('[Apple IAP] Sandbox receipt was production, retrying production endpoint')
        result = _post_receipt(settings.APPLE_VERIFY_RECEIPT_URL_PRODUCTION, receipt_data)

    status_code = result.get('status')
    if status_code != 0:
        raise AppleIAPError(f'Apple receipt verification failed (status {status_code})')

    bundle_id = result.get('receipt', {}).get('bundle_id')
    expected_bundle_id = getattr(settings, 'APPLE_BUNDLE_ID', '')
    if expected_bundle_id and bundle_id and bundle_id != expected_bundle_id:
        raise AppleIAPError(f'Receipt bundle_id mismatch: {bundle_id} != {expected_bundle_id}')

    return result


def extract_latest_transaction(verified_receipt, expected_product_id=None):
    """
    Pull the most relevant transaction out of a verified receipt.

    For consumables (coin packs) this is an entry in `receipt.in_app`.
    For auto-renewable subscriptions this is the newest entry in
    `latest_receipt_info` (falls back to `receipt.in_app`).

    Args:
        verified_receipt: dict returned by verify_receipt().
        expected_product_id: if provided, only consider transactions matching
                              this Apple product ID (defends against a client
                              sending a receipt for a different product).

    Returns:
        dict with keys: product_id, transaction_id, original_transaction_id,
                         purchase_date_ms, expires_date_ms (or None).

    Raises:
        AppleIAPError: if no matching transaction is found.
    """
    candidates = verified_receipt.get('latest_receipt_info') or verified_receipt.get('receipt', {}).get('in_app') or []

    if expected_product_id:
        candidates = [c for c in candidates if c.get('product_id') == expected_product_id]

    if not candidates:
        raise AppleIAPError('No matching transaction found in receipt')

    # Newest purchase first (transaction_id / purchase_date_ms are strings).
    candidates.sort(key=lambda c: int(c.get('purchase_date_ms', 0)), reverse=True)
    latest = candidates[0]

    return {
        'product_id': latest.get('product_id'),
        'transaction_id': latest.get('transaction_id'),
        'original_transaction_id': latest.get('original_transaction_id'),
        'purchase_date_ms': latest.get('purchase_date_ms'),
        'expires_date_ms': latest.get('expires_date_ms'),
    }
