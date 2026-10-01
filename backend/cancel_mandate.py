#!/usr/bin/env python
"""
Cancel Telebirr mandate for a specific phone number.
Usage: python cancel_mandate.py <phone_number>
"""
import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from api.services.telebirr_mandate_service import TelebirrMandateService
from api.models_subscription import SubscriptionPlan
from django.contrib.auth import get_user_model

def cancel_mandate_for_phone(phone_number, mandate_contract_id=None):
    """Cancel active Telebirr mandate for a phone number"""
    print(f"{'='*80}")
    print(f"CANCELLING TELEBIRR MANDATE FOR PHONE: {phone_number}")
    print(f"{'='*80}")
    
    # Clean phone number
    cleaned_phone = phone_number.replace('+', '').replace(' ', '')
    if not cleaned_phone.startswith('0'):
        if cleaned_phone.startswith('251'):
            cleaned_phone = '0' + cleaned_phone[3:]
    
    print(f"Cleaned phone number: {cleaned_phone}")
    
    # If mandate_contract_id provided directly, use it
    if mandate_contract_id:
        print(f"✓ Using provided mandate_contract_id: {mandate_contract_id}")
        subscription = None
    else:
        # Find user by phone number
        User = get_user_model()
        user = User.objects.filter(username=f'telebirr_{cleaned_phone}').first()
        
        if not user:
            # Try finding by profile phone
            from api.models import UserProfile
            profile = UserProfile.objects.filter(phone_number=cleaned_phone).first()
            if profile:
                user = profile.user
        
        if not user:
            print(f"❌ User not found for phone: {phone_number}")
            return False
        
        print(f"✓ Found user: {user.username} (ID: {user.id})")
        
        # Find active Telebirr subscription
        subscription = SubscriptionPlan.objects.filter(
            user=user,
            payment_method='telebirr',
            status='active'
        ).first()
        
        if not subscription:
            # Try finding any Telebirr subscription with mandate_contract_id
            subscription = SubscriptionPlan.objects.filter(
                user=user,
                payment_method='telebirr',
                mandate_contract_id__isnull=False
            ).order_by('-created_at').first()
        
        if not subscription:
            print(f"❌ No Telebirr subscription found for user")
            return False
        
        print(f"✓ Found subscription: {subscription.id}")
        print(f"  - Status: {subscription.status}")
        print(f"  - Payment Method: {subscription.payment_method}")
        print(f"  - Mandate Contract ID: {subscription.mandate_contract_id}")
        print(f"  - MCT Contract No: {subscription.mct_contract_no}")
        
        if not subscription.mandate_contract_id:
            print(f"❌ No mandate_contract_id available")
            return False
        
        mandate_contract_id = subscription.mandate_contract_id
    
    # Cancel the mandate
    print(f"\n{'='*80}")
    print("CALLING TELEBIRR CANCEL MANDATE API")
    print(f"{'='*80}")
    
    mandate_service = TelebirrMandateService()
    
    try:
        result = mandate_service.cancel_mandate(
            mandate_contract_id=mandate_contract_id,
            initiator_phone=cleaned_phone,
            reason='Manual cancellation via script'
        )
        
        print(f"✓ Cancel mandate API called")
        print(f"  - Result: {result.get('result')}")
        print(f"  - Code: {result.get('code')}")
        print(f"  - Message: {result.get('msg')}")
        
        if result.get('result') == 'SUCCESS':
            # Update subscription status if we have a subscription record
            if subscription:
                subscription.status = 'cancelled'
                subscription.save()
                print(f"✓ Subscription status updated to 'cancelled'")
            else:
                print(f"✓ Mandate cancelled on Telebirr (no local subscription to update)")
            return True
        else:
            print(f"❌ Cancel mandate failed: {result.get('msg')}")
            return False
            
    except Exception as e:
        print(f"❌ Error cancelling mandate: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python cancel_mandate.py <phone_number> [mandate_contract_id]")
        print("Example: python cancel_mandate.py 0911528271")
        print("Example: python cancel_mandate.py 0911528271 597744")
        sys.exit(1)
    
    phone_number = sys.argv[1]
    mandate_contract_id = sys.argv[2] if len(sys.argv) > 2 else None
    
    if mandate_contract_id:
        confirm_msg = f"Are you sure you want to cancel mandate {mandate_contract_id} for {phone_number}? (yes/no): "
    else:
        confirm_msg = f"Are you sure you want to cancel the mandate for {phone_number}? (yes/no): "
    
    confirm = input(confirm_msg).strip().lower()
    
    if confirm == 'yes':
        success = cancel_mandate_for_phone(phone_number, mandate_contract_id)
        if success:
            print(f"\n{'='*80}")
            print("✓ MANDATE CANCELLED SUCCESSFULLY")
            print(f"{'='*80}")
        else:
            print(f"\n{'='*80}")
            print("❌ FAILED TO CANCEL MANDATE")
            print(f"{'='*80}")
            sys.exit(1)
    else:
        print("Operation cancelled.")
