# Telebirr Mandate Flow — "Mandate contract info not found" (60330006)

## Status Update
- The previous **signature verification failure (60200099)** is now **RESOLVED** — switching to RSA-PSS/MGF1/SHA256 fixed it. Telebirr now accepts our signature and returns a signed response.
- We are now blocked by a new error on `queryMandate`: **`60330006 — "Mandate contract info not found."`**

## Merchant Details
- **Merchant App ID:** 1616539484544003
- **Merchant Short Code:** 496462
- **Environment:** UAT (developerportal.ethiotelebirr.et:38443)
- **Mandate Template IDs in use:** daily=131001, weekly=131002, monthly=131003
- **Test phone:** 251900000099

## Our Current Flow

### Step 1 — Sign mandate in SuperApp (H5)
We call the SuperApp `js_fun_execute` with the merchant URL scheme:
```
businessType: "Mandate"
execute: merchant://10000000016?mctShortCode=496462&mctContractNo=13914944014676830082798538736535&mandateTemplateId=131001&thirdAppId=1616539484544003
```
The SuperApp returns:
```json
{"result":"success"}
```
Note: the callback does **NOT** include a `mandate_contract_id`, and we do not pass a `notify_url` in this scheme (so we receive no server-to-server callback).

### Step 2 — Apply Fabric Token
`POST /payment/v1/token` → **200 OK** (works).

### Step 3 — Query Mandate (FAILS with 60330006)
Request body:
```json
{
  "method": "payment.queryMandate",
  "nonce_str": "GnFx56igIpqS0moEKUK5rQ7YOOoWEsiB",
  "sign_type": "SHA256WithRSA",
  "timestamp": "1781506075",
  "version": "1.0",
  "biz_content": {
    "appid": "1616539484544003",
    "merch_short_code": "496462",
    "merch_contract_no": "13914944014676830082798538736535"
  },
  "sign": "vKbnfx5YNWMM...=="
}
```

Sign string:
```
appid=1616539484544003&merch_contract_no=13914944014676830082798538736535&merch_short_code=496462&method=payment.queryMandate&nonce_str=GnFx56igIpqS0moEKUK5rQ7YOOoWEsiB&timestamp=1781506075&version=1.0
```

Response (HTTP 299):
```json
{
  "errorCode": "60330006",
  "errorMsg": "Mandate contract info not found.",
  "code": "60330006",
  "msg": "Mandate contract info not found.",
  "result": "FAIL",
  "sign": "...",
  "sign_type": "SHA256WithRSA"
}
```

This query is made within ~150ms of the SuperApp returning `{"result":"success"}`.

## Questions for Telebirr Support

1. **Mandate creation:** After the SuperApp `js_fun_execute` (businessType=Mandate, `merchant://` scheme) returns `{"result":"success"}`, is the mandate contract considered created and queryable? Or must we first call `payment.preorder` (preOrder) with `mandate_data` (mctContractNo, mandateTemplateId, executeTime) to register the mandate?

2. **Retrieving mandate_contract_id:** What is the correct way to obtain the `mandate_contract_id` after a SuperApp mandate sign? 
   - Via `payment.queryMandate` using `merch_contract_no`? 
   - Via an async server-to-server callback (if so, where do we configure the notify URL for the mandate sign)?

3. **Propagation delay:** Is there a delay between the SuperApp sign success and when the mandate becomes queryable via `queryMandate`? If so, what is the expected window?

4. **Template IDs:** Are mandate template IDs 131001 / 131002 / 131003 valid and active for merchant app ID 1616539484544003? Could `60330006` be caused by an invalid/unregistered template?

5. **Working example:** Can you provide an end-to-end example (request + response) for: SuperApp mandate sign → retrieve mandate_contract_id → disburseOrder?

## What We Have Already Verified
- Fabric token: works (200).
- authToken (auto-login): works (200, signature verified by Telebirr).
- queryMandate signature: now accepted (no more 60200099).
- Only remaining blocker: `60330006 Mandate contract info not found`.
