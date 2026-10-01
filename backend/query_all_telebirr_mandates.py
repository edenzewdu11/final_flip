#!/usr/bin/env python
"""
Query Telebirr for ALL mandates for the merchant, then filter by phone.
Usage: python query_all_telebirr_mandates.py <phone_number>
"""
import os
import sys
import django
import time
import requests
import json

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from api.services.telebirr_mandate_service import TelebirrMandateService

def query_all_mandates_for_merchant():
    """Query Telebirr for ALL mandates for the merchant"""
    mandate_service = TelebirrMandateService()
    
    # Get Fabric token
    fabric_token = mandate_service.apply_fabric_token()
    
    url = f"{mandate_service.base_url}/payment/v1/mandates/query"
    headers = {
        'Content-Type': 'application/json',
        'x-app-key': mandate_service.fabric_app_id,
        'Authorization': fabric_token,
    }
    
    timestamp = str(int(time.time()))
    nonce_str = mandate_service.generate_nonce_str()
    
    # Query ALL mandates for merchant (no specific mandate ID)
    request_data = {
        'method': 'payment.queryMandate',
        'nonce_str': nonce_str,
        'sign_type': 'SHA256WithRSA',
        'timestamp': timestamp,
        'version': '1.0',
        'biz_content': {
            'appid': mandate_service.merchant_app_id,
            'merch_short_code': mandate_service.merchant_code,
        }
    }
    
    sign = mandate_service.sign_request(request_data)
    request_data['sign'] = sign
    
    print(f"{'='*80}")
    print("QUERYING ALL MANDATES FOR MERCHANT")
    print(f"{'='*80}")
    print(f"Merchant App ID: {mandate_service.merchant_app_id}")
    print(f"Merchant Short Code: {mandate_service.merchant_code}")
    
    try:
        response = requests.post(
            url,
            headers=headers,
            json=request_data,
            verify=mandate_service.verify_ssl,
            timeout=30
        )
        
        print(f"Response status: {response.status_code}")
        result = response.json()
        print(f"Result: {result.get('result')}")
        print(f"Code: {result.get('code') or result.get('errorCode')}")
        print(f"Message: {result.get('msg') or result.get('errorMsg')}")
        
        if result.get('result') == 'SUCCESS':
            biz_content = result.get('biz_content', {})
            mandates = biz_content.get('mandates', [])
            
            print(f"\n{'='*80}")
            print(f"FOUND {len(mandates)} TOTAL MANDATE(S) ON TELEBIRR")
            print(f"{'='*80}")
            
            return mandates
        else:
            print(f"❌ Query failed: {result.get('msg') or result.get('errorMsg')}")
            return []
            
    except Exception as e:
        print(f"❌ Error querying mandates: {e}")
        import traceback
        traceback.print_exc()
        return []

def filter_mandates_by_phone(mandates, phone_number):
    """Filter mandates for a specific phone number"""
    # Clean phone number
    cleaned_phone = phone_number.replace('+', '').replace(' ', '')
    if not cleaned_phone.startswith('0'):
        if cleaned_phone.startswith('251'):
            cleaned_phone = '0' + cleaned_phone[3:]
    
    print(f"\n{'='*80}")
    print(f"FILTERING FOR PHONE: {cleaned_phone}")
    print(f"{'='*80}")
    
    # Phone number variants to check
    phone_variants = {
        cleaned_phone,
        cleaned_phone.replace('0', '251', 1),
        '251' + cleaned_phone[1:],
        cleaned_phone[1:],  # without leading 0
    }
    
    print(f"Phone variants to match: {phone_variants}")
    
    matching_mandates = []
    
    for mandate in mandates:
        mandate_phone = mandate.get('identifier') or mandate.get('phone_number') or ''
        mandate_contract_id = mandate.get('mandate_contract_id')
        mct_contract_no = mandate.get('merch_contract_no')
        status = mandate.get('status') or mandate.get('mandate_status')
        
        print(f"\nMandate Contract ID: {mandate_contract_id}")
        print(f"  - MCT Contract No: {mct_contract_no}")
        print(f"  - Phone: {mandate_phone}")
        print(f"  - Status: {status}")
        
        # Check if this mandate belongs to our phone number
        if mandate_phone in phone_variants:
            print(f"  ✓ MATCHES our phone number {cleaned_phone}")
            matching_mandates.append(mandate)
        else:
            print(f"  - Does NOT match our phone number")
    
    return matching_mandates

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python query_all_telebirr_mandates.py <phone_number>")
        print("Example: python query_all_telebirr_mandates.py 0911528271")
        sys.exit(1)
    
    phone_number = sys.argv[1]
    
    # Query all mandates
    all_mandates = query_all_mandates_for_merchant()
    
    if all_mandates:
        # Filter for our phone
        matching_mandates = filter_mandates_by_phone(all_mandates, phone_number)
        
        print(f"\n{'='*80}")
        print(f"SUMMARY")
        print(f"{'='*80}")
        print(f"Total mandates on Telebirr: {len(all_mandates)}")
        print(f"Matching mandates for phone {phone_number}: {len(matching_mandates)}")
        
        if matching_mandates:
            print(f"\n⚠️  MATCHING MANDATES FOUND:")
            for m in matching_mandates:
                print(f"  - Mandate Contract ID: {m.get('mandate_contract_id')}")
                print(f"    MCT Contract No: {m.get('merch_contract_no')}")
                print(f"    Status: {m.get('status') or m.get('mandate_status')}")
                print(f"    Phone: {m.get('identifier') or m.get('phone_number')}")
        else:
            print(f"\n✓ No matching mandates found for phone {phone_number}")
