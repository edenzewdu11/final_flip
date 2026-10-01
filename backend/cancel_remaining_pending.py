#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models_subscription import SubscriptionPlan as UserSubscription
from django.contrib.auth import get_user_model

User = get_user_model()

phone = '0911528271'
user = User.objects.filter(username=f'telebirr_{phone}').first()

if not user:
    user = User.objects.filter(username=phone).first()

if user:
    print(f"{'='*80}")
    print(f"CANCELLING REMAINING PENDING SUBSCRIPTIONS FOR: {user.username} (ID: {user.id})")
    print(f"{'='*80}")
    
    # Find all pending subscriptions
    pending_subs = UserSubscription.objects.filter(
        user=user,
        status='pending'
    )
    
    print(f"\nFound {pending_subs.count()} pending subscriptions:")
    for sub in pending_subs:
        print(f"  - ID: {sub.id}")
        print(f"    Tier: {sub.tier.name if sub.tier else 'N/A'}")
        print(f"    Created: {sub.created_at}")
    
    if pending_subs.count() > 0:
        cancelled_count = pending_subs.update(status='cancelled')
        print(f"\n✓ Cancelled {cancelled_count} pending subscriptions")
    else:
        print("\nNo pending subscriptions found")
else:
    print(f"User not found with phone: {phone}")
