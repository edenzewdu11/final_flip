# FlipStar Coin Purchase & Subscription Flow Walkthrough

This document walks through the end-to-end API flows for buying coins and subscribing via the web app, the Telebirr SuperApp (H5), and USSD.

## 1. Coin Purchase — Onevas (airtime)

- **User action:** Picks a coin package in `frontend/App.jsx` or `frontend/pages/subscription/WalletPage.jsx`.
- **Client call:**
  - `POST /charging/coin-purchase/`
  - Payload: `{ phone_number, coins }`
- **Backend view:** `api.views_charging.purchase_coins_on_demand`
- **Backend logic:**
  - Validates `phone_number` and `coins`.
  - Normalizes the phone number to `251...`.
  - Calculates ETB amount (10 ETB = 100 coins).
  - Calls `onevas_charging_service.initiate_charging(...)`.
- **Third-party call:**
  - `POST ONEVAS_CHARGING_URL` (Onevas airtime charging).
- **Back to client:** The response is returned to the same `api.request` promise in the frontend.

---

## 2. Coin Purchase — Telebirr H5 / SuperApp

This is the in-app webview flow for users inside the Telebirr SuperApp.

- **Client helper:** `frontend/services/TelebirrH5Service.js`

### Step 1 — Get access token from the SuperApp
- `window.consumerapp.evaluate` calls `js_fun_h5GetAccessToken`.
- The SuperApp returns the `access_token` to `window.handleAccessTokenCallback`.

### Step 2 — Auto-login to the backend
- `POST /wallet/telebirr/auth/`
- Payload: `{ access_token }`
- **Backend view:** `api.views_wallet.telebirr_auth`
- Calls `telebirr_service.request_auth_token` -> `POST /payment/v1/token`.

### Step 3 — Initiate payment
- `POST /wallet/telebirr/initiate/`
- **Backend view:** `api.views_wallet.telebirr_initiate_payment`
- Calls `telebirr_service.create_order_ondemand` -> `POST /payment/v1/merchant/preOrder`.
- Backend returns `raw_request` and `merch_order_id`.

### Step 4 — Client invokes the SuperApp payment
- `window.consumerapp.evaluate(js_fun_start_pay, raw_request)`
- The user completes the payment inside the SuperApp.

### Step 5 — Payment callback
- Telebirr calls `POST /wallet/telebirr-callback/`.
- **Backend view:** `api.views_wallet.telebirr_callback`
- Calls `telebirr_service.verify_notify` to verify the payment and credits coins.

### Step 6 — Optional query fallback
- `GET /wallet/telebirr/query/?merch_order_id=...`
- **Backend view:** `api.views_wallet.telebirr_query_order`
- Calls `telebirr_service.query_order`.

---

## 3. Coin Purchase — Telebirr USSD Push

- **User action:** Selects a coin package in the web app top-up modal.
- **Client call:**
  - `POST /wallet/telebirrUssdPurchase/`
  - Payload: `{ package_id }`
  - Source: `frontend/App.jsx`
- **Backend view:** `api.views_wallet.telebirr_ussd_purchase`
- **Backend logic:**
  - Looks up `CoinPackage`.
  - Gets and normalizes the user's phone number.
  - Calculates amount and total coins.
  - Calls the USSD SOAP service wrapper.
- **Third-party call:**
  - `POST ussd_soap_url` (Telebirr BuyGoodsForCustomer / USSD push).
- **Back to client:** Returns `originator_conversation_id`, `conversation_id`, and `message`.

---

## 4. Subscription — Telebirr H5 one-time (web / SuperApp)

Mimics the coin H5 flow but for subscription plans.

- **Client call:**
  - `POST /subscription/telebirr/one-time/initiate/`
  - Payload: `{ plan_type: 'daily' | 'weekly' | 'monthly', phone_number? }`
- **Backend view:** `api.views_subscription.telebirr_one_time_initiate`
- **Backend logic:**
  - Looks up the active `SubscriptionTier`.
  - Generates `merch_order_id`.
  - Calls `telebirr_service.create_order_ondemand`.
- **Third-party calls:**
  - `POST /payment/v1/merchant/preOrder`
  - `POST /payment/v1/token` (for auth inside `telebirr_service`)
- **Back to client:**
  - Returns `raw_request`, `merch_order_id`, `prepay_id`.
  - Client invokes `js_fun_start_pay` in the SuperApp webview.
- **Payment completion:**
  - Telebirr calls `POST /subscription/telebirr/one-time/callback/`.
  - **Backend view:** `api.views_subscription.telebirr_one_time_callback`
  - Activates the subscription.
- **Query fallback:**
  - `POST /subscription/telebirr/one-time/query/`
  - **Backend view:** `api.views_subscription.telebirr_one_time_query`

---

## 5. Subscription — Telebirr USSD Push (web app)

- **User action:** Picks a plan in `frontend/pages/subscription/SubscriptionPage.jsx`.
- **Client call:**
  - `POST /subscription/telebirr/ussd/initiate/`
  - Payload: `{ plan_type, phone_number? }`
- **Backend view:** `api.views_subscription.telebirr_ussd_subscription_initiate`
- **Backend logic:**
  - Looks up `SubscriptionTier`.
  - Normalizes the phone number.
  - Calls the USSD SOAP service.
- **Third-party call:**
  - `POST ussd_soap_url` (Telebirr USSD push for subscription).
- **Status check:**
  - `POST /subscription/telebirr/ussd/status/`
  - **Backend view:** `api.views_subscription.telebirr_ussd_subscription_status`
- **Webhook:**
  - Telebirr calls `POST /webhooks/telebirrSubscriptionUssd/`.
  - **Backend view:** `api.views_subscription.telebirr_ussd_subscription_webhook`

---

## 6. SuperApp-only helpers

- `POST /subscription/check-superapp/`
  - **Backend view:** `api.views_subscription.check_superapp_subscription`
  - Checks if a phone has an active SuperApp/Telebirr subscription.

- `POST /subscription/validate-token/`
  - **Backend view:** `api.views_subscription.validate_subscription_token`
  - Swaps a secure token for the phone number in the frontend (hides phone from URLs).

---

## Summary table

| Feature | Client entry | Backend view | Third-party |
|---|---|---|---|
| Coin purchase (airtime) | `App.jsx`, `WalletPage.jsx` → `POST /charging/coin-purchase/` | `views_charging.purchase_coins_on_demand` | `ONEVAS_CHARGING_URL` |
| Coin purchase (Telebirr H5/SuperApp) | `TelebirrH5Service.js` → `/wallet/telebirr/*` | `views_wallet.telebirr_*` | Telebirr token / preOrder |
| Coin purchase (Telebirr USSD) | `App.jsx` → `POST /wallet/telebirrUssdPurchase/` | `views_wallet.telebirr_ussd_purchase` | `ussd_soap_url` |
| Subscription (Telebirr one-time / H5) | `POST /subscription/telebirr/one-time/initiate/` | `views_subscription.telebirr_one_time_initiate` | Telebirr token / preOrder |
| Subscription (Telebirr USSD) | `SubscriptionPage.jsx` → `POST /subscription/telebirr/ussd/initiate/` | `views_subscription.telebirr_ussd_subscription_initiate` | `ussd_soap_url` |
| SuperApp login/check | `TelebirrH5Service.js` / `POST /subscription/check-superapp/` | `views_subscription.check_superapp_subscription` | n/a (DB check) |

All H5/SuperApp flows are orchestrated by `frontend/services/TelebirrH5Service.js` and rely on `window.consumerapp.evaluate` to talk to the Telebirr webview.
