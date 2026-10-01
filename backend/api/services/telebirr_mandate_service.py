import os
import json
import time
import uuid
import requests
import base64
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend
from django.conf import settings
import logging

logger = logging.getLogger(__name__)


class TelebirrMandateService:
    """Service for Telebirr Mandate-based subscription payments"""
    
    def __init__(self):
        self.base_url = getattr(settings, 'TELEBIRR_H5_BASE_URL', 'https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway')
        self.fabric_app_id = getattr(settings, 'TELEBIRR_FABRIC_APP_ID', '')
        self.app_secret = getattr(settings, 'TELEBIRR_APP_SECRET', '')
        self.merchant_app_id = getattr(settings, 'TELEBIRR_MERCHANT_APP_ID', '')
        self.merchant_code = getattr(settings, 'TELEBIRR_MERCHANT_CODE', '496462')
        self.private_key_pem = getattr(settings, 'TELEBIRR_PRIVATE_KEY', '')
        self.verify_ssl = getattr(settings, 'TELEBIRR_VERIFY_SSL', False)
        self.disburse_notify_url = getattr(settings, 'TELEBIRR_DISBURSE_NOTIFY_URL', 'https://196.189.236.140/api/subscription/telebirr-disburse-callback/')
        
        # Mandate template IDs from Telebirr (production)
        self.mandate_templates = {
            'daily': os.getenv('TELEBIRR_MANDATE_TEMPLATE_DAILY', '208003'),
            'weekly': os.getenv('TELEBIRR_MANDATE_TEMPLATE_WEEKLY', '208001'),
            'monthly': os.getenv('TELEBIRR_MANDATE_TEMPLATE_MONTHLY', '207001'),
        }
    
    def apply_fabric_token(self):
        """Apply for fabric token for API authentication"""
        url = f"{self.base_url}/payment/v1/token"
        headers = {
            'Content-Type': 'application/json',
            'x-app-key': self.fabric_app_id,
        }
        data = {
            'appSecret': self.app_secret,
        }
        
        try:
            response = requests.post(
                url,
                headers=headers,
                json=data,
                verify=self.verify_ssl,
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            logger.info(f"[TELEBIRR_MANDATE] Fabric token response: {result}")
            return result.get('token')
        except Exception as e:
            logger.error(f"[TELEBIRR_MANDATE] Failed to get fabric token: {e}")
            raise
    
    def generate_nonce_str(self, length=32):
        """Generate random nonce string"""
        import random
        import string
        chars = string.ascii_letters + string.digits
        return ''.join(random.choice(chars) for _ in range(length))
    
    def generate_mct_contract_no(self):
        """Generate unique merchant contract number (32 digits)"""
        return ''.join(str(uuid.uuid4().int)[:32])
    
    def sign_request(self, request_data):
        """Sign request with RSA private key using SHA256WithRSA"""
        logger.info('[TELEBIRR_MANDATE] ========== SIGN REQUEST START ==========')
        logger.info(f'[TELEBIRR_MANDATE] Request data to sign: {json.dumps(request_data, indent=2)}')
        
        try:
            # Exclude sign and sign_type from signature (per Telebirr documentation).
            # NOTE: mandate_data IS included in the signature (Telebirr rejects
            # the request when it is omitted). To avoid any object-serialization
            # ambiguity (key order / spacing) it is passed as a compact JSON
            # STRING in biz_content, so the signed value is byte-identical to the
            # transmitted value, exactly like the flat string fields that verify.
            exclude_fields = ['sign', 'sign_type', 'header', 'refund_info', 'openType', 'raw_request', 'biz_content', 'wallet_reference_data']
            logger.info(f'[TELEBIRR_MANDATE] Exclude fields: {exclude_fields}')
            
            # Flatten biz_content into main dict for signature
            fields = []
            field_map = {}
            
            for key, value in request_data.items():
                # biz_content is excluded from top-level but its children are included
                if key == 'biz_content' and isinstance(value, dict):
                    for bk, bv in value.items():
                        if bk in exclude_fields or bv is None or bv == '' or bv == '""':
                            continue
                        # Telebirr RECURSIVELY FLATTENS nested objects (e.g.
                        # mandate_data) into the top-level signed fields rather
                        # than signing the JSON blob. So mandate_data's children
                        # (mctContractNo/mandateTemplateId/executeTime) become
                        # their own sorted key=value entries, and there is NO
                        # "mandate_data={...}" entry. This is what makes the
                        # signature verify (60200099) while the body still sends
                        # mandate_data as a real object (Map) as Telebirr requires.
                        if isinstance(bv, dict):
                            for nk, nv in bv.items():
                                if nk not in exclude_fields and nv is not None and nv != '' and nv != '""':
                                    fields.append(nk)
                                    field_map[nk] = nv
                        else:
                            fields.append(bk)
                            field_map[bk] = bv
                elif key not in exclude_fields:
                    if value is not None and value != '' and value != '""':
                        fields.append(key)
                        field_map[key] = value
            
            logger.info(f'[TELEBIRR_MANDATE] Fields to sign: {fields}')
            logger.info(f'[TELEBIRR_MANDATE] Field map: {field_map}')
            
            # Sort alphabetically
            fields.sort()
            
            # Build sign string
            sign_str_list = []
            for key in fields:
                sign_str_list.append(f"{key}={field_map[key]}")
            sign_origin_str = '&'.join(sign_str_list)
            
            logger.info(f"[TELEBIRR_MANDATE] Sign string: {sign_origin_str}")
            
            # Load private key
            private_key = serialization.load_pem_private_key(
                self.private_key_pem.encode(),
                password=None,
                backend=default_backend()
            )
            
            # Sign with SHA256withRSAandMGF1 (RSA-PSS) to match the proven
            # implementation used by the working authToken call (TelebirrService).
            signature = private_key.sign(
                sign_origin_str.encode(),
                padding.PSS(
                    mgf=padding.MGF1(hashes.SHA256()),
                    salt_length=hashes.SHA256().digest_size,
                ),
                hashes.SHA256()
            )
            
            # Convert to base64
            sign_b64 = base64.b64encode(signature).decode()
            
            logger.info(f"[TELEBIRR_MANDATE] Generated signature: {sign_b64[:50]}...")
            return sign_b64
            
        except Exception as e:
            logger.error(f"[TELEBIRR_MANDATE] Failed to sign request: {e}")
            raise
    
    def query_mandate(self, mandate_contract_id=None, mct_contract_no=None):
        """Query mandate contract details"""
        logger.info('=' * 80)
        logger.info('[TELEBIRR_MANDATE] QUERY MANDATE - START')
        logger.info('=' * 80)
        
        fabric_token = self.apply_fabric_token()
        
        url = f"{self.base_url}/payment/v1/mandates/query"
        headers = {
            'Content-Type': 'application/json',
            'x-app-key': self.fabric_app_id,
            'Authorization': fabric_token,
        }
        
        timestamp = str(int(time.time()))
        nonce_str = self.generate_nonce_str()
        
        # Build biz_content with ONLY non-empty fields so the signed string
        # matches exactly what we send (Telebirr verifies over all sent fields).
        biz_content = {
            'appid': self.merchant_app_id,
            'merch_short_code': self.merchant_code,
        }
        if mct_contract_no:
            biz_content['merch_contract_no'] = mct_contract_no
        if mandate_contract_id:
            biz_content['mandate_contract_id'] = mandate_contract_id

        request_data = {
            'method': 'payment.queryMandate',
            'nonce_str': nonce_str,
            'sign_type': 'SHA256WithRSA',
            'timestamp': timestamp,
            'version': '1.0',
            'biz_content': biz_content,
        }
        # Note: phone_number/payer_msisdn is NOT in the Telebirr documentation for query API
        # We can only query by mandate_contract_id or merch_contract_no
        
        logger.info(f'[TELEBIRR_MANDATE] Query mandate parameters:')
        logger.info(f'  - URL: {url}')
        logger.info(f'  - Headers: {headers}')
        logger.info(f'  - mandate_contract_id: {mandate_contract_id}')
        logger.info(f'  - mct_contract_no: {mct_contract_no}')
        
        # Sign request
        sign = self.sign_request(request_data)
        request_data['sign'] = sign
        
        logger.info(f'[TELEBIRR_MANDATE] Request Body (JSON):')
        logger.info(f'{json.dumps(request_data, indent=2)}')
        
        try:
            logger.info(f'[TELEBIRR_MANDATE] Sending POST request to Telebirr...')
            response = requests.post(
                url,
                headers=headers,
                json=request_data,
                verify=self.verify_ssl,
                timeout=30
            )
            
            logger.info(f'[TELEBIRR_MANDATE] Response status: {response.status_code}')
            logger.info(f'[TELEBIRR_MANDATE] Response headers: {dict(response.headers)}')
            logger.info(f'[TELEBIRR_MANDATE] Response body: {response.text}')
            
            response.raise_for_status()
            result = response.json()
            logger.info(f"[TELEBIRR_MANDATE] Query mandate response (parsed JSON): {result}")
            return result
        except Exception as e:
            logger.error(f"[TELEBIRR_MANDATE] Failed to query mandate: {e}")
            # If query with specific params fails, try querying all mandates for the merchant
            if mandate_contract_id or mct_contract_no:
                logger.warning("[TELEBIRR_MANDATE] Query with specific params failed, trying to query all mandates for merchant")
                try:
                    request_data_all = {
                        'method': 'payment.queryMandate',
                        'nonce_str': self.generate_nonce_str(),
                        'sign_type': 'SHA256WithRSA',
                        'timestamp': str(int(time.time())),
                        'version': '1.0',
                        'biz_content': {
                            'appid': self.merchant_app_id,
                            'merch_short_code': self.merchant_code,
                        }
                    }
                    sign_all = self.sign_request(request_data_all)
                    request_data_all['sign'] = sign_all
                    
                    response_all = requests.post(
                        url,
                        headers=headers,
                        json=request_data_all,
                        verify=self.verify_ssl,
                        timeout=30
                    )
                    response_all.raise_for_status()
                    result_all = response_all.json()
                    logger.info(f"[TELEBIRR_MANDATE] Query all mandates response: {result_all}")
                    
                    # If we have a specific mct_contract_no, filter the results
                    if mct_contract_no and result_all.get('result') == 'SUCCESS':
                        biz_content = result_all.get('biz_content', {})
                        mandates = biz_content.get('mandates', [])
                        for mandate in mandates:
                            if mandate.get('merch_contract_no') == mct_contract_no:
                                logger.info(f"[TELEBIRR_MANDATE] Found matching mandate in all mandates query")
                                return result_all
                    
                    return result_all
                except Exception as e2:
                    logger.error(f"[TELEBIRR_MANDATE] Query all mandates also failed: {e2}")
            raise
    
    def cancel_mandate(self, mandate_contract_id, initiator_phone, reason='User cancelled'):
        """Cancel mandate contract"""
        fabric_token = self.apply_fabric_token()
        
        url = f"{self.base_url}/payment/v1/mandateContract/cancel"
        headers = {
            'Content-Type': 'application/json',
            'x-app-key': self.fabric_app_id,
            'Authorization': fabric_token,
        }
        
        timestamp = str(int(time.time()))
        nonce_str = self.generate_nonce_str()
        
        request_data = {
            'method': 'payment.cancelMandate',
            'nonce_str': nonce_str,
            'sign_type': 'SHA256WithRSA',
            'timestamp': timestamp,
            'version': '1.0',
            'biz_content': {
                'merch_code': self.merchant_code,
                'reason': reason,
                'initiator': initiator_phone,  # Customer phone number
                'description': 'Cancel mandate contract',
                'mandate_contract_id': mandate_contract_id,
                'initiator_type': '10',  # SP Operator
            }
        }
        
        # Sign request
        sign = self.sign_request(request_data)
        request_data['sign'] = sign
        
        try:
            response = requests.post(
                url,
                headers=headers,
                json=request_data,
                verify=self.verify_ssl,
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            logger.info(f"[TELEBIRR_MANDATE] Cancel mandate response: {result}")
            return result
        except Exception as e:
            logger.error(f"[TELEBIRR_MANDATE] Failed to cancel mandate: {e}")
            raise
    
    def disburse_order(self, mandate_contract_id, amount, order_id, description='Subscription payment', mct_contract_no=None):
        """Execute password-free payment using disburseOrder API"""
        logger.info('=' * 80)
        logger.info('[TELEBIRR_MANDATE] DISBURSE ORDER - START')
        logger.info('=' * 80)
        logger.info(f'[TELEBIRR_MANDATE] Parameters:')
        logger.info(f'  - mandate_contract_id: {mandate_contract_id}')
        logger.info(f'  - amount: {amount}')
        logger.info(f'  - order_id: {order_id}')
        logger.info(f'  - description: {description}')
        logger.info(f'  - mct_contract_no: {mct_contract_no}')
        
        fabric_token = self.apply_fabric_token()
        
        url = f"{self.base_url}/payment/v1/merchant/disburseOrder"
        headers = {
            'Content-Type': 'application/json',
            'x-app-key': self.fabric_app_id,
            'Authorization': fabric_token,
        }
        
        timestamp = str(int(time.time()))
        nonce_str = self.generate_nonce_str()
        
        request_data = {
            'timestamp': timestamp,
            'method': 'payment.disbursement',
            'nonce_str': nonce_str,
            'sign_type': 'SHA256WithRSA',
            'version': '1.0',
            'biz_content': {
                'appid': self.merchant_app_id,
                'merch_code': self.merchant_code,
                'merch_order_id': order_id,
                'trade_type': 'Mandate',
                'title': description,
                'payee_msisdn': self.merchant_code,
                'total_amount': str(amount),
                'trans_currency': 'ETB',
                'operator_id': '0000',
                'timeout_express': '120m',
                'business_type': 'BuyGoods',
                'note_payer': description,
                'mandate_contract_id': mandate_contract_id,
                'mct_contract_no': mct_contract_no or '',
                'notify_url': self.disburse_notify_url,
            }
        }
        
        logger.info(f'[TELEBIRR_MANDATE] Disburse order parameters:')
        logger.info(f'  - URL: {url}')
        logger.info(f'  - Headers: {headers}')
        
        # Sign request
        sign = self.sign_request(request_data)
        request_data['sign'] = sign
        
        logger.info(f'[TELEBIRR_MANDATE] Request Body (JSON):')
        logger.info(f'{json.dumps(request_data, indent=2)}')
        
        try:
            logger.info(f'[TELEBIRR_MANDATE] Sending POST request to Telebirr...')
            response = requests.post(
                url,
                headers=headers,
                json=request_data,
                verify=self.verify_ssl,
                timeout=30
            )
            
            logger.info(f'[TELEBIRR_MANDATE] Response status: {response.status_code}')
            logger.info(f'[TELEBIRR_MANDATE] Response headers: {dict(response.headers)}')
            logger.info(f'[TELEBIRR_MANDATE] Response body: {response.text}')
            
            response.raise_for_status()
            result = response.json()
            logger.info(f"[TELEBIRR_MANDATE] Disburse order response (parsed JSON): {result}")
            return result
        except Exception as e:
            logger.error(f"[TELEBIRR_MANDATE] Failed to disburse order: {e}")
            raise
    
    def create_mandate_preorder(self, mct_contract_no, mandate_template_id, amount, title, notify_url=None, redirect_url=None):
        """Create preOrder for mandate signing using /payment/v1/merchant/preOrder with mandate_data"""
        logger.info('=' * 80)
        logger.info('[TELEBIRR_MANDATE] CREATE MANDATE PREORDER - START')
        logger.info('=' * 80)
        logger.info(f'[TELEBIRR_MANDATE] Parameters:')
        logger.info(f'  - mct_contract_no: {mct_contract_no}')
        logger.info(f'  - mandate_template_id: {mandate_template_id}')
        logger.info(f'  - amount: {amount}')
        logger.info(f'  - title: {title}')
        logger.info(f'  - notify_url: {notify_url or self.disburse_notify_url}')
        
        fabric_token = self.apply_fabric_token()
        logger.info(f'[TELEBIRR_MANDATE] Fabric token obtained')
        
        url = f"{self.base_url}/payment/v1/merchant/preOrder"
        headers = {
            'Content-Type': 'application/json',
            'x-app-key': self.fabric_app_id,
            'Authorization': fabric_token,
        }
        
        timestamp = str(int(time.time()))
        nonce_str = self.generate_nonce_str()
        merch_order_id = str(int(time.time() * 1000))
        
        # Current date for executeTime (YYYY-MM-DD format)
        from datetime import datetime
        execute_time = datetime.now().strftime('%Y-%m-%d')
        
        request_data = {
            'timestamp': timestamp,
            'method': 'payment.preorder',
            'nonce_str': nonce_str,
            'sign_type': 'SHA256WithRSA',
            'version': '1.0',
            'biz_content': {
                'notify_url': notify_url or self.disburse_notify_url,
                'trade_type': 'InApp',
                'appid': self.merchant_app_id,
                'merch_code': self.merchant_code,
                'merch_order_id': merch_order_id,
                'title': title,
                'total_amount': str(amount),
                'trans_currency': 'ETB',
                'timeout_express': '120m',
                'business_type': 'BuyGoods',
                'payee_identifier': self.merchant_code,
                'payee_identifier_type': '04',
                'payee_type': '5000',
                # mandate_data MUST be a real nested object in the body (Telebirr
                # requires a Map, error 49401024995 if sent as a string). The
                # signature, however, is computed over its COMPACT JSON string
                # form (see sign_request, which json.dumps nested dicts with
                # separators=(',', ':')). The body is also serialized compactly
                # (data=json.dumps(..., separators=(',', ':'))) so the bytes
                # Telebirr re-serializes match what we signed -> passes 60200099.
                'mandate_data': {
                    'mctContractNo': mct_contract_no,
                    'mandateTemplateId': mandate_template_id,
                    'executeTime': execute_time,
                },
            }
        }
        
        logger.info(f'[TELEBIRR_MANDATE] Request data prepared:')
        logger.info(f'  - URL: {url}')
        logger.info(f'  - method: {request_data["method"]}')
        logger.info(f'  - merch_order_id: {merch_order_id}')
        logger.info(f'  - total_amount: {amount}')
        logger.info(f'  - mctContractNo: {mct_contract_no}')
        logger.info(f'  - mandateTemplateId: {mandate_template_id}')
        logger.info(f'  - executeTime: {execute_time}')
        
        # Sign request
        sign = self.sign_request(request_data)
        request_data['sign'] = sign
        logger.info(f'[TELEBIRR_MANDATE] Request signed successfully')
        
        # Log full request details for Telebirr support
        logger.info('=' * 80)
        logger.info('[TELEBIRR_MANDATE] FULL REQUEST DETAILS FOR SUPPORT')
        logger.info('=' * 80)
        logger.info(f'[TELEBIRR_MANDATE] Endpoint URL: {url}')
        logger.info(f'[TELEBIRR_MANDATE] Request Headers:')
        for key, value in headers.items():
            # Mask authorization token for security
            if key.lower() == 'authorization' and value:
                value = value[:20] + '...' if len(value) > 20 else value
            logger.info(f'  - {key}: {value}')
        logger.info(f'[TELEBIRR_MANDATE] Request Body (JSON):')
        logger.info(f'{json.dumps(request_data, indent=2)}')
        logger.info('=' * 80)
        
        try:
            logger.info(f'[TELEBIRR_MANDATE] Sending request to Telebirr API')
            # Serialize the body compactly (no spaces) so the bytes on the wire
            # are byte-identical to what sign_request signed (it uses
            # separators=(',', ':')). requests' json= inserts ', '/': ' spaces
            # which breaks signature verification for nested objects like
            # mandate_data (Telebirr error 60200099 "Verify the sign field failed").
            body = json.dumps(request_data, separators=(',', ':'))
            response = requests.post(
                url,
                headers=headers,
                data=body,
                verify=self.verify_ssl,
                timeout=30
            )
            
            # Log response details
            logger.info(f'[TELEBIRR_MANDATE] Response Status: {response.status_code}')
            logger.info(f'[TELEBIRR_MANDATE] Response Headers:')
            for key, value in response.headers.items():
                logger.info(f'  - {key}: {value}')
            
            try:
                response.raise_for_status()
                result = response.json()
                logger.info(f'[TELEBIRR_MANDATE] Response Body (JSON):')
                logger.info(f'{json.dumps(result, indent=2)}')
                logger.info(f'[TELEBIRR_MANDATE] Preorder response received:')
                logger.info(f'  - result: {result.get("result")}')
                logger.info(f'  - code: {result.get("code")}')
                logger.info(f'  - msg: {result.get("msg")}')
                if result.get('biz_content'):
                    logger.info(f'  - prepay_id: {result.get("biz_content", {}).get("prepay_id")}')
                    logger.info(f'  - merch_order_id: {result.get("biz_content", {}).get("merch_order_id")}')
                logger.info(f'[TELEBIRR_MANDATE] CREATE MANDATE PREORDER - SUCCESS')
                return result
            except Exception as e:
                # Log response body even on error
                logger.error(f'[TELEBIRR_MANDATE] Response Body (Error): {response.text}')
                raise
        except Exception as e:
            logger.error(f'[TELEBIRR_MANDATE] Failed to create mandate preorder: {e}')
            logger.exception('[TELEBIRR_MANDATE] Full traceback')
            logger.info(f'[TELEBIRR_MANDATE] CREATE MANDATE PREORDER - FAILED')
            raise
    
    def create_raw_request(self, prepay_id):
        """Create rawRequest string for frontend startPay"""
        logger.info(f'[TELEBIRR_MANDATE] Creating rawRequest for prepay_id: {prepay_id}')
        
        nonce_str = self.generate_nonce_str()
        timestamp = str(int(time.time()))
        
        raw_request_data = {
            'appid': self.merchant_app_id,
            'merch_code': self.merchant_code,
            'nonce_str': nonce_str,
            'prepay_id': prepay_id,
            'timestamp': timestamp,
        }
        
        # Sign the raw request data
        sign = self.sign_request(raw_request_data)
        
        raw_request = f"appid={self.merchant_app_id}&merch_code={self.merchant_code}&nonce_str={nonce_str}&prepay_id={prepay_id}&timestamp={timestamp}&sign={sign}&sign_type=SHA256WithRSA"
        
        logger.info(f'[TELEBIRR_MANDATE] RawRequest created: {raw_request[:100]}...')
        return raw_request
    
    def create_disburse_order(self, mct_contract_no, amount, title, mandate_contract_id=None, merch_order_id=None, notify_url=None):
        """Create disburse order for password-free deduction"""
        logger.info('=' * 80)
        logger.info('[TELEBIRR_MANDATE] CREATE DISBURSE ORDER - START')
        logger.info('=' * 80)
        logger.info(f'[TELEBIRR_MANDATE] Parameters:')
        logger.info(f'  - mct_contract_no: {mct_contract_no}')
        logger.info(f'  - amount: {amount}')
        logger.info(f'  - title: {title}')
        logger.info(f'  - mandate_contract_id: {mandate_contract_id}')
        logger.info(f'  - merch_order_id: {merch_order_id}')
        logger.info(f'  - notify_url: {notify_url or self.disburse_notify_url}')
        
        fabric_token = self.apply_fabric_token()
        logger.info(f'[TELEBIRR_MANDATE] Fabric token obtained')
        
        url = f"{self.base_url}/payment/v1/merchant/disburseOrder"
        headers = {
            'Content-Type': 'application/json',
            'x-app-key': self.fabric_app_id,
            'Authorization': fabric_token,
        }
        
        timestamp = str(int(time.time()))
        nonce_str = self.generate_nonce_str()
        
        if not merch_order_id:
            merch_order_id = str(int(time.time() * 1000))
            logger.info(f'[TELEBIRR_MANDATE] Generated merch_order_id: {merch_order_id}')
        
        request_data = {
            'timestamp': timestamp,
            'method': 'payment.disbursement',
            'nonce_str': nonce_str,
            'sign_type': 'SHA256WithRSA',
            'version': '1.0',
            'biz_content': {
                'appid': self.merchant_app_id,
                'merch_code': self.merchant_code,
                'merch_order_id': merch_order_id,
                'trade_type': 'Mandate',
                'title': title,
                'payee_msisdn': self.merchant_code,  # Merchant receives payment
                'total_amount': str(amount),
                'trans_currency': 'ETB',
                'operator_id': '0000',
                'timeout_express': '120m',
                'business_type': 'BuyGoods',
                'note_payer': 'Subscription payment',
                'mandate_contract_id': mandate_contract_id or '',
                'mct_contract_no': mct_contract_no,
                'notify_url': notify_url or self.disburse_notify_url,
            }
        }
        
        logger.info(f'[TELEBIRR_MANDATE] Request data prepared:')
        logger.info(f'  - URL: {url}')
        logger.info(f'  - method: {request_data["method"]}')
        logger.info(f'  - merch_order_id: {merch_order_id}')
        logger.info(f'  - total_amount: {amount}')
        logger.info(f'  - mct_contract_no: {mct_contract_no}')
        
        # Sign request
        sign = self.sign_request(request_data)
        request_data['sign'] = sign
        logger.info(f'[TELEBIRR_MANDATE] Request signed successfully')
        
        # Log full request details for Telebirr support
        logger.info('=' * 80)
        logger.info('[TELEBIRR_MANDATE] FULL REQUEST DETAILS FOR SUPPORT (DISBURSE ORDER)')
        logger.info('=' * 80)
        logger.info(f'[TELEBIRR_MANDATE] Endpoint URL: {url}')
        logger.info(f'[TELEBIRR_MANDATE] Request Headers:')
        for key, value in headers.items():
            # Mask authorization token for security
            if key.lower() == 'authorization' and value:
                value = value[:20] + '...' if len(value) > 20 else value
            logger.info(f'  - {key}: {value}')
        logger.info(f'[TELEBIRR_MANDATE] Request Body (JSON):')
        logger.info(f'{json.dumps(request_data, indent=2)}')
        logger.info('=' * 80)
        
        try:
            logger.info(f'[TELEBIRR_MANDATE] Sending request to Telebirr API')
            # Serialize the body compactly (no spaces) so the bytes on the wire
            # are byte-identical to what sign_request signed (it uses
            # separators=(',', ':')). requests' json= inserts ', '/': ' spaces
            # which breaks signature verification for nested objects like
            # mandate_data (Telebirr error 60200099 "Verify the sign field failed").
            body = json.dumps(request_data, separators=(',', ':'))
            response = requests.post(
                url,
                headers=headers,
                data=body,
                verify=self.verify_ssl,
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            logger.info(f'[TELEBIRR_MANDATE] Disburse order response received:')
            logger.info(f'  - result: {result.get("result")}')
            logger.info(f'  - code: {result.get("code")}')
            logger.info(f'  - msg: {result.get("msg")}')
            if result.get('biz_content'):
                logger.info(f'  - payment_order_id: {result.get("biz_content", {}).get("payment_order_id")}')
                logger.info(f'  - merch_order_id: {result.get("biz_content", {}).get("merch_order_id")}')
            logger.info(f'[TELEBIRR_MANDATE] CREATE DISBURSE ORDER - SUCCESS')
            return result
        except Exception as e:
            logger.error(f'[TELEBIRR_MANDATE] Failed to create disburse order: {e}')
            logger.exception('[TELEBIRR_MANDATE] Full traceback')
            logger.info(f'[TELEBIRR_MANDATE] CREATE DISBURSE ORDER - FAILED')
            raise


# Singleton instance
telebirr_mandate_service = TelebirrMandateService()
