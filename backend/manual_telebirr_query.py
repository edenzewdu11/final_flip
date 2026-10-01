#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models_subscription import SubscriptionPlan as UserSubscription
from api.telebirr_service import telebirr_service
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()

phone = '0911528271'
user = User.objects.filter(username=f'telebirr_{phone}').first()

if not user:
    user = User.objects.filter(username=phone).first()

if user:
    print(f"{'='*80}")
    print(f"MANUAL TELEBIRR QUERY FOR: {user.username} (ID: {user.id})")
    print(f"{'='*80}")
    
    # Find pending subscriptions with payment_reference but no payment_order_id
    stuck_subs = UserSubscription.objects.filter(
        user=user,
        status='pending',
        payment_reference__isnull=False,
        payment_order_id__isnull=True
    ).order_by('-created_at')
    
    print(f"\nFound {stuck_subs.count()} stuck pending subscriptions:")
    
    for sub in stuck_subs:
        print(f"\n  - ID: {sub.id}")
        print(f"    Payment reference: {sub.payment_reference}")
        print(f"    Tier: {sub.tier.name if sub.tier else 'N/A'}")
        print(f"    Created: {sub.created_at}")
        
        # Query Telebirr payment status
        try:
            print(f"    Querying Telebirr for payment status...")
            result = telebirr_service.query_order(sub.payment_reference)
            print(f"    Telebirr response: {result}")
            
            if result.get('trade_status') == 'Completed' or result.get('trade_status') == 'SUCCESS':
                print(f"    ✓ Payment successful - activating subscription")
                sub.status = 'active'
                sub.payment_order_id = result.get('payment_order_id')
                sub.save()
                print(f"    ✓ Subscription activated")
            elif result.get('trade_status') == 'FAILED' or result.get('trade_status') == 'CANCELLED':
                print(f"    ✗ Payment failed - marking subscription as failed")
                sub.status = 'failed'
                sub.save()
                print(f"    ✓ Subscription marked as failed")
            else:
                print(f"    ? Payment status: {result.get('trade_status')} - keeping pending")
                
        except Exception as e:
            print(f"    ✗ Error querying Telebirr: {e}")
    
    print(f"\n{'='*80}")
    print("DONE")
    print(f"{'='*80}")
else:
    print(f"User not found with phone: {phone}")
