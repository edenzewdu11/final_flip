#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models_subscription import SubscriptionPlan as UserSubscription
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()

phone = '0911528271'
user = User.objects.filter(username=f'telebirr_{phone}').first()

if not user:
    user = User.objects.filter(username=phone).first()

if user:
    print(f"{'='*80}")
    print(f"CHECKING CALLBACK DATA FOR: {user.username} (ID: {user.id})")
    print(f"{'='*80}")
    
    # Check recent subscriptions with payment_reference
    recent_subs = UserSubscription.objects.filter(
        user=user,
        payment_reference__isnull=False
    ).order_by('-created_at')[:10]
    
    print(f"\nRecent subscriptions with payment_reference:")
    for sub in recent_subs:
        print(f"  - ID: {sub.id}")
        print(f"    Status: {sub.status}")
        print(f"    Payment reference: {sub.payment_reference}")
        print(f"    Payment order ID: {sub.payment_order_id if hasattr(sub, 'payment_order_id') else 'N/A'}")
        print(f"    Tier: {sub.tier.name if sub.tier else 'N/A'}")
        print(f"    Created: {sub.created_at}")
        print(f"    Start: {sub.start_date}")
        print(f"    End: {sub.end_date}")
        print(f"    Payment method: {sub.payment_method}")
        print()
    
    # Check if there are any active subscriptions
    active_subs = UserSubscription.objects.filter(
        user=user,
        status='active',
        end_date__gt=timezone.now()
    )
    print(f"Active subscriptions: {active_subs.count()}")
    
    # Check for subscriptions without payment_reference
    no_ref_subs = UserSubscription.objects.filter(
        user=user,
        payment_reference__isnull=True
    )
    print(f"Subscriptions without payment_reference: {no_ref_subs.count()}")
else:
    print(f"User not found with phone: {phone}")
