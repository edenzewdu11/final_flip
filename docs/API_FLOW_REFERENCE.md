# FlipStar External API Flow Reference

Lists only client-to-backend flows that trigger outside (Telebirr/Onevas/CRM/B2C/etc.) API calls.

## `/auth/forgot-password-phone/`
- **Backend view:** `api.views.forgot_password_phone_request`
- **Client call:** `POST` `/auth/forgot-password-phone/` from `frontend/api.js`
  - **Payload:** JSON.stringify({ phone })
- **Third-party calls:**
  - `POST ONEVAS_SMS_URL`  payload: json=payload

## `/auth/resend-subscription-otp/`
- **Backend view:** `api.views.resend_subscription_otp`
- **Client call:** `POST` `/auth/resend-subscription-otp/` from `frontend/api.js`
  - **Payload:** JSON.stringify({ phone })
- **Client call:** `POST` `/auth/resend-subscription-otp/` from `frontend/components/auth/PhoneLoginModal.jsx`
  - **Payload:** { phone }
- **Third-party calls:**
  - `POST ONEVAS_SMS_URL`  payload: json=payload

## `/auth/send-login-otp/`
- **Backend view:** `api.views.send_login_otp`
- **Client call:** `POST` `/auth/send-login-otp/` from `frontend/components/auth/PhoneLoginModal.jsx`
  - **Payload:** otpPayload
- **Third-party calls:**
  - `POST ONEVAS_SMS_URL`  payload: json=payload

## `/auth/send-phone-otp/`
- **Backend view:** `api.views.send_phone_otp`
- **Client call:** `POST` `/auth/send-phone-otp/` from `frontend/api.js`
  - **Payload:** JSON.stringify({ phone })
- **Third-party calls:**
  - `POST ONEVAS_SMS_URL`  payload: json=payload

## `/charging/on-demand/`
- **Backend view:** `api.views_charging.initiate_on_demand_charging`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST self.ONEVAS_CHARGING_URL`  payload: json=payload

## `/charging/coin-purchase/`
- **Backend view:** `api.views_charging.purchase_coins_on_demand`
- **Client call:** `POST` `/charging/coin-purchase/` from `frontend/App.jsx`
  - **Payload:** JSON.stringify({
          phone_number: phoneNumber,
          coins: selectedPackage.total_coins,
        })
- **Client call:** `POST` `/charging/coin-purchase/` from `frontend/pages/subscription/WalletPage.jsx`
  - **Payload:** JSON.stringify({
              phone_number: phoneNumber,
              coins: selectedPackage.total_coins,
            })
- **Third-party calls:**
  - `POST self.ONEVAS_CHARGING_URL`  payload: json=payload

## `/direct-debit/activate/`
- **Backend view:** `api.views_direct_debit.activate_direct_debit_mandate`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST self.soap_url`  payload: data=soap_envelope

## `/direct-debit/cancel/`
- **Backend view:** `api.views_direct_debit.cancel_direct_debit_mandate`
- **Client call:** `POST` `/direct-debit/cancel/` from `frontend/pages/subscription/SubscriptionPage.jsx`
  - **Payload:** JSON.stringify({
            mandate_id: currentSubscription.mandate_id,
          })
- **Third-party calls:**
  - `POST self.soap_url`  payload: data=soap_envelope

## `/direct-debit/one-off-subscription/`
- **Backend view:** `api.views_direct_debit.create_one_off_subscription`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST self.soap_url`  payload: data=soap_envelope

## `/telebirr/b2c/initiate/`
- **Backend view:** `api.views_direct_debit.initiate_b2c_payment`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST b2c_soap_url`  payload: data=soap_envelope

## `/direct-debit/initiate/`
- **Backend view:** `api.views_direct_debit.initiate_direct_debit`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST self.soap_url`  payload: data=soap_envelope

## `/direct-debit/query/`
- **Backend view:** `api.views_direct_debit.query_mandate_from_telebirr`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST self.soap_url`  payload: data=soap_envelope

## `/webhooks/telebirr-direct-debit/`
- **Backend view:** `api.views_direct_debit.telebirr_direct_debit_webhook`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST ONEVAS_SMS_URL`  payload: json=payload
  - `POST self.soap_url`  payload: data=soap_envelope
  - `POST self.soap_url`  payload: data=soap_envelope
  - `POST self.soap_url`  payload: data=soap_envelope

## `/webhooks/telebirrDirectDebit/`
- **Backend view:** `api.views_direct_debit.telebirr_direct_debit_webhook`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST ONEVAS_SMS_URL`  payload: json=payload
  - `POST self.soap_url`  payload: data=soap_envelope
  - `POST self.soap_url`  payload: data=soap_envelope
  - `POST self.soap_url`  payload: data=soap_envelope

## `/subscription/telebirr/one-time/callback/`
- **Backend view:** `api.views_subscription.telebirr_one_time_callback`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST self.ONEVAS_SMS_URL`  payload: json=payload

## `/subscription/telebirr/one-time/initiate/`
- **Backend view:** `api.views_subscription.telebirr_one_time_initiate`
- **Client call:** `POST` `/subscription/telebirr/one-time/initiate/` from `frontend/services/TelebirrH5Service.js`
  - **Payload:** JSON.stringify(requestBody)
- **Third-party calls:**
  - `POST url`  payload: json=req_obj
  - `POST url`  payload: json={'appSecret': self.app_secret}

## `/subscription/telebirr/one-time/query/`
- **Backend view:** `api.views_subscription.telebirr_one_time_query`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST self.ONEVAS_SMS_URL`  payload: json=payload
  - `POST url`  payload: json=req
  - `POST url`  payload: json={'appSecret': self.app_secret}

## `/subscription/telebirr/ussd/initiate/`
- **Backend view:** `api.views_subscription.telebirr_ussd_subscription_initiate`
- **Client call:** `POST` `/subscription/telebirr/ussd/initiate/` from `frontend/pages/subscription/SubscriptionPage.jsx`
  - **Payload:** JSON.stringify(requestBody)
- **Third-party calls:**
  - `POST ussd_soap_url`  payload: data=soap_envelope

## `/webhooks/telebirrSubscriptionUssd/`
- **Backend view:** `api.views_subscription.telebirr_ussd_subscription_webhook`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST ONEVAS_SMS_URL`  payload: json=payload

## `/wallet/withdraw/`
- **Backend view:** `api.views_wallet.request_withdrawal`
- **Client call:** `POST` `/wallet/withdraw/` from `frontend/pages/subscription/WalletPage.jsx`
  - **Payload:** JSON.stringify({
          point_amount: parseInt(amount),
          payout_method: 'telebirr',
          payout_account: phoneNumber,
          payout_account_name: '',
        })
- **Third-party calls:**
  - `POST b2c_soap_url`  payload: data=soap_envelope

## `/wallet/telebirr/auth/`
- **Backend view:** `api.views_wallet.telebirr_auth`
- **Client call:** `POST` `/wallet/telebirr/auth/` from `frontend/services/TelebirrH5Service.js`
  - **Payload:** JSON.stringify({ access_token: accessToken })
- **Third-party calls:**
  - `POST url`  payload: json=req
  - `POST url`  payload: json={'appSecret': self.app_secret}

## `/wallet/telebirr-callback/`
- **Backend view:** `api.views_wallet.telebirr_callback`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST self.ONEVAS_SMS_URL`  payload: json=payload

## `/wallet/telebirr/initiate/`
- **Backend view:** `api.views_wallet.telebirr_initiate_payment`
- **Client call:** `POST` `/wallet/telebirr/initiate/` from `frontend/services/TelebirrH5Service.js`
  - **Payload:** JSON.stringify({ package_id: packageId })
- **Client call:** `POST` `/wallet/telebirr/initiate/` from `frontend/pages/gift/GiftPage.jsx`
  - **Payload:** JSON.stringify({
          package_id: packageId,
          phone_number: phoneNumber,
        })
- **Third-party calls:**
  - `POST url`  payload: json=req_obj
  - `POST url`  payload: json={'appSecret': self.app_secret}

## `/wallet/telebirr/query/`
- **Backend view:** `api.views_wallet.telebirr_query_order`
- **Client call:** not found in generated client docs
- **Third-party calls:**
  - `POST url`  payload: json=req
  - `POST url`  payload: json={'appSecret': self.app_secret}

## `/wallet/telebirrUssdPurchase/`
- **Backend view:** `api.views_wallet.telebirr_ussd_purchase`
- **Client call:** `POST` `/wallet/telebirrUssdPurchase/` from `frontend/App.jsx`
  - **Payload:** JSON.stringify({
          package_id: selectedPackage.id,
          phone_number: phoneNumber,
        })
- **Third-party calls:**
  - `POST ussd_soap_url`  payload: data=soap_envelope
