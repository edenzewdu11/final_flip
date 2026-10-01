#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models_subscription import SubscriptionPlan
from django.contrib.auth import get_user_model

User = get_user_model()

phone = '0911528271'
user = User.objects.filter(username=f'telebirr_{phone}').first()

if not user:
    user = User.objects.filter(username=phone).first()

if user:
    print(f"{'='*80}")
    print(f"CLEANING PENDING SUBSCRIPTIONS FOR: {user.username} (ID: {user.id})")
    print(f"{'='*80}")
    
    # Find all pending subscriptions
    pending_plans = SubscriptionPlan.objects.filter(user=user, status='pending')
    print(f"\nFound {pending_plans.count()} pending subscriptions:")
    
    for plan in pending_plans:
        print(f"  - ID: {plan.id}")
        print(f"    Tier: {plan.tier.name if plan.tier else 'N/A'}")
        print(f"    Start: {plan.start_date}")
        print(f"    End: {plan.end_date}")
        print(f"    Payment method: {plan.payment_method}")
        print(f"    Created: {plan.created_at}")
    
    # Ask for confirmation
    response = input(f"\nDelete {pending_plans.count()} pending subscriptions? (yes/no): ")
    
    if response.lower() == 'yes':
        deleted_count = pending_plans.delete()[0]
        print(f"\n✓ Deleted {deleted_count} pending subscriptions")
    else:
        print("\n✗ Cancelled - no subscriptions deleted")
else:
    print(f"User not found with phone: {phone}")
