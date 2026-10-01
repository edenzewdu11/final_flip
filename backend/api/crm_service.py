"""
Ethio Telecom CRM Integration Service
Handles SOAP API calls to PresentServiceGift endpoint
"""

import requests
from django.conf import settings
from django.utils import timezone
import uuid
from typing import Dict, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


class CRMService:
    """Service for integrating with Ethio Telecom CRM PresentServiceGift API"""
    
    @classmethod
    def get_endpoint(cls):
        """Get CRM endpoint from settings"""
        from django.conf import settings
        return getattr(settings, 'CRM_ENDPOINT', 'http://10.250.67.208:17130/IPCC/ESB4mVASHandle')
    
    @classmethod
    def get_service_number_a(cls):
        """Get service number A from settings"""
        from django.conf import settings
        return getattr(settings, 'CRM_SERVICE_NUMBER_A', '0911227833')
    
    # Fixed header values from ICD and sample
    VERSION = "1"
    
    @classmethod
    def get_channel_id(cls):
        """Get channel ID from settings"""
        from django.conf import settings
        return getattr(settings, 'CRM_CHANNEL_ID', 'x')
    
    @classmethod
    def get_technical_channel_id(cls):
        """Get technical channel ID from settings"""
        from django.conf import settings
        return getattr(settings, 'CRM_TECHNICAL_CHANNEL_ID', '51')
    
    @classmethod
    def get_tenant_id(cls):
        """Get tenant ID from settings"""
        from django.conf import settings
        return getattr(settings, 'CRM_TENANT_ID', '101')
    
    @classmethod
    def get_currency_id(cls):
        """Get currency ID from settings"""
        from django.conf import settings
        return getattr(settings, 'CRM_CURRENCY_ID', '1048')
    
    @classmethod
    def get_charge_code(cls):
        """Get charge code from settings"""
        from django.conf import settings
        return getattr(settings, 'CRM_CHARGE_CODE', 'CC_GIFT_ONCE_OFF_FEE')
    
    @classmethod
    def get_offering_id(cls):
        """Get default offering ID from settings"""
        from django.conf import settings
        return getattr(settings, 'CRM_OFFERING_ID', 'xxx')
    
    @classmethod
    def generate_transaction_id(cls) -> str:
        """Generate unique transaction ID in format YYYYMMDDHHMMSS"""
        now = timezone.now()
        return now.strftime("%Y%m%d%H%M%S")
    
    @classmethod
    def build_soap_request(
        cls,
        service_number_b: str,
        offering_id: str,
        charge_amount: float,
        access_user: str,
        access_pwd: str,
        transaction_id: Optional[str] = None
    ) -> str:
        """
        Build SOAP request for PresentServiceGift API
        
        Args:
            service_number_b: Recipient phone number
            offering_id: CRM offering/package ID
            charge_amount: Amount in ETB
            access_user: CRM access user
            access_pwd: CRM access password
            transaction_id: Optional transaction ID (auto-generated if not provided)
        
        Returns:
            SOAP XML request string
        """
        if transaction_id is None:
            transaction_id = cls.generate_transaction_id()
        
        soap_request = f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:han="http://soaif.huawei.com/mvas/handle/" xmlns:bas="http://crm.huawei.com/basetype/">
   <soapenv:Header/>
   <soapenv:Body>
      <han:PresentServiceGiftRequest>
         <han:RequestHeader>
            <bas:Version>{cls.VERSION}</bas:Version>
            <bas:TransactionId>{transaction_id}</bas:TransactionId>
            <bas:ChannelId>{cls.get_channel_id()}</bas:ChannelId>
            <bas:TechnicalChannelId>{cls.get_technical_channel_id()}</bas:TechnicalChannelId>
            <bas:TenantId>{cls.get_tenant_id()}</bas:TenantId>
            <bas:AccessUser>{access_user}</bas:AccessUser>
            <bas:AccessPwd>{access_pwd}</bas:AccessPwd>
         </han:RequestHeader>
         <han:PresentServiceGiftBody>
            <han:ServiceNumberA>{cls.get_service_number_a()}</han:ServiceNumberA>
            <han:FeeDeductionInfo>
               <han:DeductInfo>
                  <han:ChargeCode>{cls.get_charge_code()}</han:ChargeCode>
                  <han:ChargeAmt>{charge_amount}</han:ChargeAmt>
                  <han:CurrencyID>{cls.get_currency_id()}</han:CurrencyID>
               </han:DeductInfo>
            </han:FeeDeductionInfo>
            <han:ServiceNumberB>{service_number_b}</han:ServiceNumberB>
            <han:OfferingInfo>
               <han:OfferingId>
                  <han:OfferingId>{offering_id}</han:OfferingId>
               </han:OfferingId>
               <han:EffectiveMode>
                  <han:Mode>I</han:Mode>
               </han:EffectiveMode>
               <han:ActiveMode>
                  <han:Mode>A</han:Mode>
               </han:ActiveMode>
            </han:OfferingInfo>
         </han:PresentServiceGiftBody>
      </han:PresentServiceGiftRequest>
   </soapenv:Body>
</soapenv:Envelope>"""
        return soap_request
    
    @classmethod
    def parse_soap_response(cls, response_text: str) -> Tuple[bool, str, Dict]:
        """
        Parse SOAP response from CRM
        
        Args:
            response_text: SOAP XML response string
        
        Returns:
            Tuple of (success, message, response_data)
        """
        try:
            # Simple XML parsing for response
            import xml.etree.ElementTree as ET
            
            root = ET.fromstring(response_text)
            
            # Define namespaces
            namespaces = {
                'soapenv': 'http://schemas.xmlsoap.org/soap/envelope/',
                'han': 'http://soaif.huawei.com/mvas/handle/',
                'bas': 'http://crm.huawei.com/basetype/'
            }
            
            # Find ResponseHeader
            response_header = root.find('.//han:ResponseHeader', namespaces)
            if response_header is None:
                return False, "Invalid response format", {}
            
            # Get RetCode and RetMsg
            ret_code = response_header.find('bas:RetCode', namespaces)
            ret_msg = response_header.find('bas:RetMsg', namespaces)
            
            if ret_code is None or ret_msg is None:
                return False, "Missing response code or message", {}
            
            code = ret_code.text
            message = ret_msg.text
            
            # Extract transaction ID from echoed request header
            request_header = response_header.find('bas:RequestHeader', namespaces)
            transaction_id = None
            if request_header is not None:
                trans_id_elem = request_header.find('bas:TransactionId', namespaces)
                if trans_id_elem is not None:
                    transaction_id = trans_id_elem.text
            
            success = (code == "0")
            
            response_data = {
                'ret_code': code,
                'ret_msg': message,
                'transaction_id': transaction_id
            }
            
            return success, message, response_data
            
        except ET.ParseError as e:
            logger.error(f"Failed to parse SOAP response: {e}")
            return False, f"XML parsing error: {str(e)}", {}
        except Exception as e:
            logger.error(f"Error parsing SOAP response: {e}")
            return False, f"Error: {str(e)}", {}
    
    @classmethod
    def send_gift(
        cls,
        service_number_b: str,
        offering_id: str,
        charge_amount: float,
        access_user: str,
        access_pwd: str
    ) -> Tuple[bool, str, Dict]:
        """
        Send gift package to user via CRM
        
        Args:
            service_number_b: Recipient phone number
            offering_id: CRM offering/package ID
            charge_amount: Amount in ETB
            access_user: CRM access user
            access_pwd: CRM access password
        
        Returns:
            Tuple of (success, message, response_data)
        """
        transaction_id = cls.generate_transaction_id()
        
        # Build SOAP request
        soap_request = cls.build_soap_request(
            service_number_b=service_number_b,
            offering_id=offering_id,
            charge_amount=charge_amount,
            access_user=access_user,
            access_pwd=access_pwd,
            transaction_id=transaction_id
        )
        
        logger.info(f"Sending CRM gift request - TransactionId: {transaction_id}, ServiceNumberB: {service_number_b}, OfferingId: {offering_id}")
        logger.info(f"SOAP Request:\n{soap_request}")
        
        try:
            # Send SOAP request
            headers = {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://soaif.huawei.com/mvas/handle/PresentServiceGift'
            }
            
            response = requests.post(
                cls.get_endpoint(),
                data=soap_request,
                headers=headers,
                timeout=30
            )
            
            logger.info(f"CRM response status: {response.status_code}")
            logger.info(f"CRM Response:\n{response.text}")
            
            if response.status_code != 200:
                logger.error(f"CRM request failed with status {response.status_code}: {response.text}")
                return False, f"HTTP {response.status_code}: {response.text}", {}
            
            # Parse response
            success, message, response_data = cls.parse_soap_response(response.text)
            
            if success:
                logger.info(f"CRM gift successful - TransactionId: {transaction_id}, Message: {message}")
            else:
                logger.error(f"CRM gift failed - TransactionId: {transaction_id}, Message: {message}")
            
            response_data['transaction_id'] = transaction_id
            response_data['service_number_b'] = service_number_b
            response_data['offering_id'] = offering_id
            response_data['charge_amount'] = charge_amount
            
            return success, message, response_data
            
        except requests.exceptions.Timeout:
            logger.error(f"CRM request timeout - TransactionId: {transaction_id}")
            return False, "Request timeout", {'transaction_id': transaction_id}
        except requests.exceptions.RequestException as e:
            logger.error(f"CRM request error - TransactionId: {transaction_id}, Error: {e}")
            return False, f"Request error: {str(e)}", {'transaction_id': transaction_id}
        except Exception as e:
            logger.error(f"Unexpected error in CRM request - TransactionId: {transaction_id}, Error: {e}")
            return False, f"Unexpected error: {str(e)}", {'transaction_id': transaction_id}
