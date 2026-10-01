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
    print(f"MANUAL ACTIVATION FOR: {user.username} (ID: {user.id})")
    print(f"{'='*80}")
    
    # Find pending subscriptions
    pending_subs = UserSubscription.objects.filter(
        user=user,
        status='pending'
    ).order_by('-created_at')
    
    print(f"\nFound {pending_subs.count()} pending subscriptions:")
    
    for i, sub in enumerate(pending_subs, 1):
        print(f"\n  [{i}] ID: {sub.id}")
        print(f"      Tier: {sub.tier.name if sub.tier else 'N/A'}")
        print(f"      Created: {sub.created_at}")
        print(f"      Start: {sub.start_date}")
        print(f"      End: {sub.end_date}")
        print(f"      Payment method: {sub.payment_method}")
        print(f"      Payment reference: {sub.payment_reference}")
        
        # Query Telebirr for payment status
        if sub.payment_reference:
            try:
                print(f"      Querying Telebirr payment status...")
                result = telebirr_service.query_order(sub.payment_reference)
                if result.get('success'):
                    trade_status = result.get('trade_status')
                    print(f"      Telebirr status: {trade_status}")
                else:
                    print(f"      Telebirr query failed: {result.get('error')}")
            except Exception as e:
                print(f"      Telebirr query error: {e}")
    
    # Ask which subscription to activate
    if pending_subs.count() > 0:
        try:
            choice = input(f"\nEnter subscription number to activate (1-{pending_subs.count()}): ")
            choice = int(choice)
            
            if 1 <= choice <= pending_subs.count():
                sub_to_activate = pending_subs[choice - 1]
                
                print(f"\nActivating subscription:")
                print(f"  ID: {sub_to_activate.id}")
                print(f"  Tier: {sub_to_activate.tier.name if sub.tier else 'N/A'}")
                print(f"  End date: {sub_to_activate.end_date}")
                
                confirm = input("Confirm activation? (yes/no): ")
                
                if confirm.lower() == 'yes':
                    sub_to_activate.status = 'active'
                    sub_to_activate.save()
                    print(f"\n✓ Subscription activated successfully")
                    
                    # Cancel other pending subscriptions
                    other_pending = UserSubscription.objects.filter(
                        user=user,
                        status='pending'
                    ).exclude(id=sub_to_activate.id)
                    if other_pending.count() > 0:
                        print(f"\nCancelling {other_pending.count()} other pending subscriptions...")
                        cancelled_count = other_pending.update(status='cancelled')
                        print(f"✓ Cancelled {cancelled_count} pending subscriptions")
                else:
                    print("\n✗ Activation cancelled")
            else:
                print("Invalid choice")
        except ValueError:
            print("Invalid input")
    else:
        print("No pending subscriptions found")
else:
    print(f"User not found with phone: {phone}")
