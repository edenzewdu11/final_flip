# Telebirr Mandate Subscription Flow - Technical Documentation

## Overview
This document describes the complete end-to-end flow for creating a Telebirr mandate-based subscription in the Flipstar application. The flow uses the Telebirr preOrder API with mandate_data to enable password-free recurring payments.

---

## Step 1: User Initiates Subscription in SuperApp

**Description:** User selects a subscription plan (Daily/Weekly/Monthly) in the SuperApp. The frontend retrieves the plan details including price and duration type.

**Frontend URL:** N/A (Client-side action)

**Frontend Action:**
- User taps on a subscription tier (e.g., Daily - 3 ETB)
- Frontend captures: `duration_type` ('daily'), `price_etb` (3)

**Our Backend URL:** N/A (No backend call yet)

**Telebirr URL:** N/A

---

## Step 2: Frontend Calls Backend Preorder Endpoint

**Description:** Frontend calls our backend API to create a mandate preorder. The request includes the plan type, amount, and title.

**Frontend URL:** `https://uat.flipstar.et/api/subscription/telebirr/mandate/preorder/`

**Frontend Request Body:**
```json
{
  "plan_type": "daily",
  "amount": "3",
  "title": "Subscription"
}
```

**Our Backend URL:** `https://uat.flipstar.et/api/subscription/telebirr/mandate/preorder/`

**Our Backend Method:** POST

**Our Backend Handler:** `telebirr_mandate_preorder` in `views_subscription.py`

**Telebirr URL:** N/A

---

## Step 3: Backend Generates Merchant Contract Number

**Description:** Backend generates a unique merchant contract number (mct_contract_no) for this mandate request. This is a 44-digit random number used to identify the mandate.

**Frontend URL:** N/A

**Our Backend URL:** N/A (Internal processing)

**Our Backend Action:**
- Generate `mct_contract_no` using `generate_mct_contract_no()` method
- Example: `19786161294534349932063892929169`

**Telebirr URL:** N/A

---

## Step 4: Backend Calls Telebirr Fabric Token Endpoint

**Description:** Backend requests a fabric token from Telebirr to authenticate subsequent API calls. This token is required for all Telebirr API requests.

**Frontend URL:** N/A

**Our Backend URL:** N/A (Internal processing)

**Telebirr URL:** `https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway/payment/v1/token`

**Telebirr Method:** GET

**Telebirr Request Headers:**
```
Content-Type: application/json
X-APP-Key: c4182ef8-9249-458a-985e-06d191f4d505
```

**Telebirr Response:**
```json
{
  "token": "Bearer cf2e2135acc33249fa7db09eaa175f54",
  "effectiveDate": "20260613105622",
  "expirationDate": "20260613115622"
}
```

---

## Step 5: Backend Calls Telebirr PreOrder Endpoint with Mandate Data

**Description:** Backend creates a preorder request with mandate_data to initiate the mandate signing process. This is the critical step that is currently returning a 500 error.

**Frontend URL:** N/A

**Our Backend URL:** N/A (Internal processing)

**Telebirr URL:** `https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway/payment/v1/merchant/preOrder`

**Telebirr Method:** POST

**Telebirr Request Headers:**
```
Content-Type: application/json
X-APP-Key: c4182ef8-9249-458a-985e-06d191f4d505
Authorization: Bearer cf2e2135acc33249fa7db09eaa175f54
```

**Telebirr Request Body:**
```json
{
  "timestamp": "1781337409",
  "method": "payment.preorder",
  "nonce_str": "Aol50OLpVCDUo8RgZj00BxSMz8J6Pb0V",
  "sign_type": "SHA256WithRSA",
  "version": "1.0",
  "sign": "BbLAm95bftvH+oOVjk7pGvOUStVX2gsC1e2hFF06G5OBcKT3by...",
  "biz_content": {
    "notify_url": "https://uat.flipstar.et/api/subscription/telebirr-disburse-callback/",
    "redirect_url": "https://uat.flipstar.et/",
    "trade_type": "InApp",
    "appid": "1616539484544003",
    "merch_code": "496462",
    "merch_order_id": "1781337409938",
    "title": "Subscription",
    "total_amount": "3",
    "trans_currency": "ETB",
    "timeout_express": "120m",
    "business_type": "BuyGoods",
    "payee_identifier": "496462",
    "payee_identifier_type": "04",
    "payee_type": "5000",
    "mandate_data": {
      "mctContractNo": "19786161294534349932063892929169",
      "mandateTemplateId": "131001",
      "executeTime": "2026-06-13"
    }
  }
}
```

**Telebirr Expected Response:**
```json
{
  "result": "SUCCESS",
  "code": "0",
  "msg": "success",
  "sign": "...",
  "biz_content": {
    "prepay_id": "...",
    "merch_order_id": "1781337409938"
  }
}
```

**Telebirr Actual Response (Current Issue):**
```
HTTP 500 Internal Server Error
```

**Error Details:**
- Status Code: 500
- Error Message: "500 Server Error: Internal Server Error for url: https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway/payment/v1/merchant/preOrder"
- This error occurs consistently regardless of the amount or plan type

---

## Step 6: Backend Creates RawRequest String

**Description:** Backend creates a rawRequest string from the prepay_id received from Telebirr. This string is used by the frontend to call the SuperApp startPay function.

**Frontend URL:** N/A

**Our Backend URL:** N/A (Internal processing)

**Our Backend Action:**
- Generate nonce_str and timestamp
- Sign the raw request data with SHA256WithRSA
- Construct rawRequest string with all parameters

**RawRequest Format:**
```
appid=1616539484544003&merch_code=496462&nonce_str=...&prepay_id=...&timestamp=...&sign=...&sign_type=SHA256WithRSA
```

**Telebirr URL:** N/A

---

## Step 7: Backend Returns Response to Frontend

**Description:** Backend returns the rawRequest and related data to the frontend for the SuperApp integration.

**Frontend URL:** `https://uat.flipstar.et/api/subscription/telebirr/mandate/preorder/`

**Our Backend URL:** `https://uat.flipstar.et/api/subscription/telebirr/mandate/preorder/`

**Our Backend Response:**
```json
{
  "success": true,
  "message": "Preorder created successfully",
  "rawRequest": "appid=1616539484544003&merch_code=496462&nonce_str=...&prepay_id=...&timestamp=...&sign=...&sign_type=SHA256WithRSA",
  "mct_contract_no": "19786161294534349932063892929169",
  "prepay_id": "...",
  "merch_order_id": "1781337409938"
}
```

**Telebirr URL:** N/A

---

## Step 8: Frontend Calls SuperApp startPay with RawRequest

**Description:** Frontend calls the SuperApp's native startPay function with the rawRequest string to initiate the mandate signing UI in the SuperApp.

**Frontend URL:** N/A (SuperApp native call)

**Frontend Action:**
```javascript
window.ma.native("startPay", {
  rawRequest: "appid=1616539484544003&merch_code=496462&nonce_str=...&prepay_id=...&timestamp=...&sign=...&sign_type=SHA256WithRSA"
});
```

**Our Backend URL:** N/A

**Telebirr URL:** N/A (SuperApp handles the Telebirr interaction)

---

## Step 9: SuperApp Displays Mandate Signing UI

**Description:** SuperApp displays the mandate signing interface to the user, showing the subscription details and requesting authorization for password-free payments.

**Frontend URL:** N/A (SuperApp UI)

**Our Backend URL:** N/A

**Telebirr URL:** N/A (SuperApp internal)

---

## Step 10: User Authorizes Mandate in SuperApp

**Description:** User reviews the mandate details and authorizes the subscription by confirming in the SuperApp UI.

**Frontend URL:** N/A (SuperApp UI)

**Our Backend URL:** N/A

**Telebirr URL:** N/A (SuperApp internal)

---

## Step 11: SuperApp Callback to Frontend

**Description:** After user authorization, SuperApp calls the frontend's callback function with the mandate signing result.

**Frontend URL:** N/A (SuperApp callback)

**Frontend Callback Handler:** `window.handleinitDataCallback`

**SuperApp Callback Data:**
```json
{
  "result": "success",
  "mandate_contract_id": "...",
  "merch_contract_no": "19786161294534349932063892929169"
}
```

**Our Backend URL:** N/A

**Telebirr URL:** N/A

---

## Step 12: Frontend Sends Mandate Result to Backend

**Description:** Frontend sends the mandate signing result to our backend to complete the subscription setup.

**Frontend URL:** `https://uat.flipstar.et/api/subscription/telebirr/mandate/callback/`

**Frontend Request Body:**
```json
{
  "mandate_contract_id": "...",
  "merch_contract_no": "19786161294534349932063892929169",
  "result": "success"
}
```

**Our Backend URL:** `https://uat.flipstar.et/api/subscription/telebirr/mandate/callback/`

**Our Backend Method:** POST

**Our Backend Handler:** `telebirr_mandate_callback` in `views_subscription.py`

**Telebirr URL:** N/A

---

## Step 13: Telebirr Callback to Our Backend (Async)

**Description:** Telebirr sends an asynchronous callback to our backend with the final mandate status and contract details.

**Frontend URL:** N/A

**Our Backend URL:** `https://uat.flipstar.et/api/subscription/telebirr-disburse-callback/`

**Our Backend Method:** POST

**Our Backend Handler:** `telebirr_disburse_callback` in `views_subscription.py`

**Telebirr URL:** N/A (Telebirr initiates this call)

**Telebirr Callback Body:**
```json
{
  "mandate_contract_id": "...",
  "merch_contract_no": "19786161294534349932063892929169",
  "contract_status": "ACTIVE",
  "result": "SUCCESS"
}
```

---

## Step 14: Backend Creates User Subscription

**Description:** Backend creates the user subscription record in the database with the mandate details and activates the subscription.

**Frontend URL:** N/A

**Our Backend URL:** N/A (Internal processing)

**Our Backend Action:**
- Create UserSubscription record
- Link mandate_contract_id and merch_contract_no
- Set subscription status to active
- Set expiration date based on plan type

**Telebirr URL:** N/A

---

## Configuration Details

### Merchant Credentials
- **Merchant App ID:** 1616539484544003
- **Merchant Code:** 496462
- **Fabric App ID:** c4182ef8-9249-458a-985e-06d191f4d505
- **Mandate Template ID:** 131001 (for all plan types)

### Subscription Plans
- **Daily:** 3 ETB
- **Weekly:** 20 ETB
- **Monthly:** 70 ETB

### Callback URLs
- **Notify URL:** https://uat.flipstar.et/api/subscription/telebirr-disburse-callback/
- **Redirect URL:** https://uat.flipstar.et/

### Endpoints
- **Our Backend Preorder:** https://uat.flipstar.et/api/subscription/telebirr/mandate/preorder/
- **Our Backend Callback:** https://uat.flipstar.et/api/subscription/telebirr-disburse-callback/
- **Telebirr Fabric Token:** https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway/payment/v1/token
- **Telebirr PreOrder:** https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway/payment/v1/merchant/preOrder

---

## Current Issue

**Problem:** Telebirr preOrder endpoint returns HTTP 500 Internal Server Error

**Endpoint:** `https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway/payment/v1/merchant/preOrder`

**Error:** 500 Server Error: Internal Server Error

**Request Details:**
- Method: payment.preorder
- Includes mandate_data with mctContractNo, mandateTemplateId, and executeTime
- Request is properly signed with SHA256WithRSA
- All required parameters are included per Telebirr documentation

**Request Being Sent:**
```json
{
  "timestamp": "1781337409",
  "method": "payment.preorder",
  "nonce_str": "Aol50OLpVCDUo8RgZj00BxSMz8J6Pb0V",
  "sign_type": "SHA256WithRSA",
  "version": "1.0",
  "sign": "BbLAm95bftvH+oOVjk7pGvOUStVX2gsC1e2hFF06G5OBcKT3by...",
  "biz_content": {
    "notify_url": "https://uat.flipstar.et/api/subscription/telebirr-disburse-callback/",
    "redirect_url": "https://uat.flipstar.et/",
    "trade_type": "InApp",
    "appid": "1616539484544003",
    "merch_code": "496462",
    "merch_order_id": "1781337409938",
    "title": "Subscription",
    "total_amount": "3",
    "trans_currency": "ETB",
    "timeout_express": "120m",
    "business_type": "BuyGoods",
    "payee_identifier": "496462",
    "payee_identifier_type": "04",
    "payee_type": "5000",
    "mandate_data": {
      "mctContractNo": "19786161294534349932063892929169",
      "mandateTemplateId": "131001",
      "executeTime": "2026-06-13"
    }
  }
}
```

**Required Action:** Please investigate why the preOrder endpoint is returning a 500 error for this request. Verify if:
1. The preOrder endpoint is enabled for mandate creation on merchant account 1616539484544003
2. The mandate template ID 131001 is valid and active
3. There are no configuration issues preventing mandate creation
