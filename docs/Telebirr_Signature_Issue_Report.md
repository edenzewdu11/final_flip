# Telebirr Signature Verification Failure - queryMandate API

## Issue Summary
We are experiencing signature verification failures when calling the `payment.queryMandate` API endpoint. We have followed the documentation exactly but signature verification fails with error code 60200099.

## Merchant Details
- **Merchant App ID:** 1616539484544003
- **Merchant Short Code:** 496462
- **Environment:** Test (developerportal.ethiotelebirr.et:38443)

## Our Implementation Details

### Signature Algorithm
- **Algorithm:** RSA with SHA256
- **Padding:** PKCS#1 v1.5
- **Encoding:** Base64

### Sign String Format
1. Exclude fields: `['sign', 'sign_type', 'header', 'refund_info', 'openType', 'raw_request', 'biz_content', 'wallet_reference_data']`
2. Flatten `biz_content` object - extract fields from nested object
3. Exclude empty fields (None, '', '""')
4. Sort field names alphabetically (A-Z)
5. Build sign string: `key1=value1&key2=value2&key3=value3...`
6. Sign with RSA-SHA256 (PKCS#1 v1.5 padding)
7. Encode signature to base64

## Example Request

### HTTP Request
```
POST /apiaccess/payment/gateway/payment/v1/mandates/query
Content-Type: application/json
X-APP-Key: c4182ef8-9249-458a-985e-06d191f4d505
Authorization: Bearer 93759b97bbc146e25b7a297c1d01de63
```

### Request Body
```json
{
  "method": "payment.queryMandate",
  "nonce_str": "86Bf9J2OGGrg6RdFVotCYkfmms1NJk8w",
  "sign_type": "SHA256WithRSA",
  "timestamp": "1781363642",
  "version": "1.0",
  "biz_content": {
    "appid": "1616539484544003",
    "mandate_contract_id": "",
    "merch_contract_no": "",
    "merch_short_code": "496462"
  },
  "sign": "WtTd5qFBTURUc/hZPBwauybaXlGmPPzB+hnOmTUsHFsUU3eOCLjM1Olkd7SWiskKDLstdxSU7iVt11o/B2VnyCaZUqSrm4aL6rX5kxcRi4qHFSy7j4+JWcnXwH/MvPqgCSMXAEdxq4d7vz+LdecwFAKY47awS0RFcDWXChc6aieEVLYsALrVRfEhmSBmDaNfe+P1IJkMheUlq1GeNCohLedY8g3Pu3MGzI0eigRwPsLD/WMnue1xygWfXMwHfnRK+HWNliOaRbQl3x68nGa1enc8CLVyF4a7boijiBY/R/ZQ71C0TrsdOxHdb7j0/xPDx62SGlEzL4bz3xCh7CvX6A=="
}
```

### Sign String Used
```
appid=1616539484544003&merch_short_code=496462&method=payment.queryMandate&nonce_str=86Bf9J2OGGrg6RdFVotCYkfmms1NJk8w&timestamp=1781363642&version=1.0
```

## Telebirr Response

### HTTP Response
```
HTTP/1.1 500 Internal Server Error
Content-Type: application/json
Content-Length: 67
```

### Response Body
```json
{
  "errorCode": "60200099",
  "errorMsg": "Verify the sign field failed."
}
```

## Our Public Key
```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv2XKDp4NbCWeAnoKKUFQ
sNx2KqlUSxLnYE/nQ6UvH0Vcu8wYKmbp47tlUQkLh3lrO8loHPUBneP/JEUi2Po5
byjXmetMlnKhGPniskDJnIzs9kp+NX3FTYBfh1dwxoleG9twegQjI56RBSG/Xfff
07I7BUnO4Aj4H5dslg8RP2NQdrVROqKdqnet2LDFRUBna3vwkGLxSRDaUGgSzKuI
R8gQ4JblF5RdLgNV+1DNGY2xQumSAfx59fqZeVGvHSmK5FWnnKJZiU/7O3P/v9SX
jfo2vJbgaDjbKDg7dpk3lSRyxfWN6IeayPiGPB7pCGSdVOju/yXIx92kSU2WoF1E
vQIDAQAB
-----END PUBLIC KEY-----
```

## Troubleshooting Steps Already Taken

### 1. Tried Different Padding Algorithms
- ✅ PSS padding (SHA256withRSAandMGF1) - Failed
- ✅ PKCS#1 v1.5 padding (SHA256WithRSA) - Failed

### 2. Verified Sign String Format
- ✅ Excluded `sign` and `sign_type` fields
- ✅ Flattened `biz_content` object
- ✅ Excluded empty fields
- ✅ Sorted alphabetically
- ✅ Joined with `&`

### 3. Verified Key Pair
- ✅ Public key matches private key
- ✅ Keys are valid RSA key pair

## Questions for Telebirr Support

1. **Public Key Verification:** Does the public key registered for merchant app ID 1616539484544003 match the public key provided above?

2. **Signature Algorithm:** What exact signature algorithm and padding does your server expect for the queryMandate API?

3. **Sign String Format:** Is our sign string format correct? Are we missing any required fields or using incorrect formatting?

4. **Working Example:** Can you provide a working example request (with sign string and signature) for the queryMandate API?

5. **Test Tool:** Is there a test tool or method to verify our signature generation before sending to the API?

6. **Environment Issue:** Is this a known issue with the test environment? Should we try the production environment?

## Expected Flow

### Step 1: Sign Mandate Contract ✅
- User signs mandate in SuperApp
- SuperApp returns `{"result":"success"}` to frontend
- **Status:** Success (but no mandate_contract_id returned)

### Step 2: Apply Fabric Token ✅
- Backend calls `/payment/v1/token` with appSecret
- Returns fabric token for API authentication
- **Status:** Success

### Step 3: Query Mandate ❌
- Backend calls `/payment/v1/mandates/query` to get mandate_contract_id
- **Status:** Failed - Signature verification error (60200099)
- **Impact:** Cannot proceed to password-free payments without mandate_contract_id

## Contact Information
- **Company:** Skykin Technologies
- **Merchant App ID:** 1616539484544003
- **Date:** June 13, 2026

## Urgency
This issue is blocking our ability to implement subscription payments with Telebirr. We need to resolve the signature verification issue to proceed with the mandate-based payment flow.
