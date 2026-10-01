#!/usr/bin/env python
"""
Query Telebirr for all active mandates for a phone number.
Usage: python query_telebirr_mandates.py <phone_number>
"""
import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from api.services.telebirr_mandate_service import TelebirrMandateService

def query_mandates_for_phone(phone_number):
    """Query Telebirr for all mandates for a phone number"""
    print(f"{'='*80}")
    print(f"QUERYING TELEBIRR MANDATES FOR PHONE: {phone_number}")
    print(f"{'='*80}")
    
    # Clean phone number
    cleaned_phone = phone_number.replace('+', '').replace(' ', '')
    if not cleaned_phone.startswith('0'):
        if cleaned_phone.startswith('251'):
            cleaned_phone = '0' + cleaned_phone[3:]
    
    print(f"Cleaned phone number: {cleaned_phone}")
    
    # Query Telebirr for all mandates for this merchant
    mandate_service = TelebirrMandateService()
    
    print(f"\n{'='*80}")
    print("CALLING TELEBIRR QUERY MANDATE API")
    print(f"{'='*80}")
    
    try:
        # Query without specific mandate ID to get all mandates for merchant
        result = mandate_service.query_mandate()
        
        print(f"✓ Query mandate API called")
        print(f"  - Result: {result.get('result')}")
        print(f"  - Code: {result.get('code') or result.get('errorCode')}")
        print(f"  - Message: {result.get('msg') or result.get('errorMsg')}")
        
        if result.get('result') == 'SUCCESS':
            biz_content = result.get('biz_content', {})
            mandates = biz_content.get('mandates', [])
            
            # Also check if response has a single mandate
            if not mandates and biz_content.get('mandate_contract_id'):
                mandates = [biz_content]
            
            print(f"\n{'='*80}")
            print(f"FOUND {len(mandates)} MANDATE(S) ON TELEBIRR")
            print(f"{'='*80}")
            
            # Filter mandates for this phone number
            phone_variants = {cleaned_phone, cleaned_phone.replace('0', '251', 1), '251' + cleaned_phone[1:]}
            
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
                else:
                    print(f"  - Does NOT match our phone number")
            
            # Find active mandates for this phone
            active_mandates = [
                m for m in mandates 
                if (m.get('identifier') or m.get('phone_number', '')) in phone_variants
                and (m.get('status') or m.get('mandate_status')) == 'ACTIVE'
            ]
            
            print(f"\n{'='*80}")
            print(f"SUMMARY")
            print(f"{'='*80}")
            print(f"Total mandates on Telebirr: {len(mandates)}")
            print(f"Active mandates for phone {cleaned_phone}: {len(active_mandates)}")
            
            if active_mandates:
                print(f"\n⚠️  ACTIVE MANDATES FOUND - These need to be cancelled before creating new ones:")
                for m in active_mandates:
                    print(f"  - Mandate Contract ID: {m.get('mandate_contract_id')}")
                    print(f"    MCT Contract No: {m.get('merch_contract_no')}")
            else:
                print(f"\n✓ No active mandates found for phone {cleaned_phone}")
                print(f"  You should be able to create a new mandate.")
            
            return True
        else:
            print(f"❌ Query failed: {result.get('msg') or result.get('errorMsg')}")
            return False
            
    except Exception as e:
        print(f"❌ Error querying mandates: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python query_telebirr_mandates.py <phone_number>")
        print("Example: python query_telebirr_mandates.py 0911528271")
        sys.exit(1)
    
    phone_number = sys.argv[1]
    query_mandates_for_phone(phone_number)
