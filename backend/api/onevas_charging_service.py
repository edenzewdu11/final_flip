"""Onevas charging service for on-demand subscription purchases"""
import requests
import logging
from django.conf import settings
from datetime import datetime

logger = logging.getLogger(__name__)


class OnevasChargingService:
    """Service to handle Onevas charging API requests"""
    
    ONEVAS_CHARGING_URL = "https://onevas.et/api/v1/charging"
    
    def __init__(self):
        self.timeout = 120  # 120 seconds timeout for charging requests (increased from 60)
        self.max_retries = 2  # Maximum number of retries for failed requests
        self.retry_delay = 3  # Delay between retries in seconds
    
    def initiate_charging(self, phone_number, product_number, application_key):
        """
        Initiate a charging request to Onevas with retry logic
        
        Args:
            phone_number: User's phone number (format: 2519...)
            product_number: Onevas product number
            application_key: Onevas application key
        
        Returns:
            dict: Response from Onevas API
        """
        payload = {
            "application_key": application_key,
            "phone_number": phone_number,
            "product_number": product_number
        }
        
        for attempt in range(self.max_retries):
            try:
                logger.info(f"[Onevas Charging] Initiating charging request for {phone_number} (attempt {attempt + 1}/{self.max_retries})")
                response = requests.post(
                    self.ONEVAS_CHARGING_URL,
                    json=payload,
                    timeout=self.timeout,
                    headers={
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                )
                
                logger.info(f"[Onevas Charging] Response status: {response.status_code}")
                
                # Handle non-200 status codes
                if response.status_code != 200:
                    logger.error(f"[Onevas Charging] Non-200 status: {response.status_code}, response: {response.text}")
                    # Retry on 504, 503, 500 errors (server-side issues)
                    if response.status_code in [504, 503, 500] and attempt < self.max_retries - 1:
                        logger.info(f"[Onevas Charging] Retrying after {self.retry_delay} seconds...")
                        import time
                        time.sleep(self.retry_delay)
                        continue
                    
                    # Provide user-friendly error message for common status codes
                    if response.status_code == 504:
                        error_message = 'Onevas service is temporarily unavailable. Please try again later.'
                    elif response.status_code == 503:
                        error_message = 'Onevas service is currently under maintenance. Please try again later.'
                    elif response.status_code == 500:
                        error_message = 'Onevas server error. Please try again later.'
                    else:
                        error_message = f'Onevas API returned status {response.status_code}: {response.text or "No response body"}'
                    
                    return {
                        'status_code': response.status_code,
                        'success': False,
                        'error': f'http_error_{response.status_code}',
                        'message': error_message
                    }
                
                # Try to parse JSON response
                try:
                    data = response.json() if response.content else None
                except ValueError as e:
                    logger.error(f"[Onevas Charging] Failed to parse JSON response: {str(e)}, response: {response.text}")
                    return {
                        'status_code': response.status_code,
                        'success': False,
                        'error': 'json_parse_error',
                        'message': f'Failed to parse response: {response.text or "Empty response"}'
                    }
                
                return {
                    'status_code': response.status_code,
                    'success': True,
                    'data': data,
                    'text': response.text
                }
                
            except requests.exceptions.Timeout:
                logger.error(f"[Onevas Charging] Request timeout for {phone_number} (attempt {attempt + 1}/{self.max_retries})")
                if attempt < self.max_retries - 1:
                    logger.info(f"[Onevas Charging] Retrying after {self.retry_delay} seconds...")
                    import time
                    time.sleep(self.retry_delay)
                    continue
                return {
                    'status_code': None,
                    'success': False,
                    'error': 'timeout',
                    'message': 'Request timed out after multiple retries'
                }
            except requests.exceptions.RequestException as e:
                logger.error(f"[Onevas Charging] Request failed: {str(e)} (attempt {attempt + 1}/{self.max_retries})")
                if attempt < self.max_retries - 1:
                    logger.info(f"[Onevas Charging] Retrying after {self.retry_delay} seconds...")
                    import time
                    time.sleep(self.retry_delay)
                    continue
                return {
                    'status_code': None,
                    'success': False,
                    'error': 'request_exception',
                    'message': str(e)
                }
        
        # This should not be reached, but just in case
        return {
            'status_code': None,
            'success': False,
            'error': 'max_retries_exceeded',
            'message': 'Maximum retries exceeded'
        }
    
    def parse_charging_response(self, response_data):
        """
        Parse Onevas charging response to determine status
        
        Args:
            response_data: Response from Onevas API
        
        Returns:
            tuple: (status, error_message)
        """
        if not response_data.get('success'):
            return 'failed', response_data.get('message', 'Charging request failed')
        
        data = response_data.get('data', {})
        
        # Check for insufficient balance response
        if data.get('error') == 'insufficient_balance' or data.get('code') == 'INSUFFICIENT_BALANCE':
            return 'insufficient_balance', 'Insufficient airtime balance'
        
        # Check for successful charging (handle both string and boolean status)
        if data.get('success') or data.get('status') == 'success' or data.get('status') is True:
            return 'success', None
        
        # Default to failed
        return 'failed', data.get('message', 'Charging failed')
    
    def get_transaction_status(self, transaction_id):
        """
        Check the status of a charging transaction
        
        Args:
            transaction_id: Onevas transaction ID
        
        Returns:
            dict: Transaction status from Onevas
        """
        # Note: Onevas may not have a status check endpoint
        # This is a placeholder for future implementation
        return {
            'status': 'unknown',
            'message': 'Status check not implemented yet'
        }


# Singleton instance
onevas_charging_service = OnevasChargingService()
