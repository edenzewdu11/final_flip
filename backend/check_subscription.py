#!/usr/bin/env python
"""
Script to check subscription details for a specific phone number.
Run with: python check_subscription.py <phone_number>
Example: python check_subscription.py 0911227833
"""

import os
import sys
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models import User, UserProfile
from api.models_subscription import SubscriptionPlan, SubscriptionPayment, SubscriptionHistory, SubscriptionTier
from django.utils import timezone
from datetime import timedelta

def check_subscription(phone_number):
    """Check subscription details for a phone number."""
    
    print(f"\n{'='*80}")
    print(f"SUBSCRIPTION CHECK FOR: {phone_number}")
    print(f"{'='*80}\n")
    
    # Build phone variants
    phone_variants = {phone_number}
    if phone_number.startswith('251'):
        phone_variants.add('0' + phone_number[3:])
    elif phone_number.startswith('0'):
        phone_variants.add('251' + phone_number[1:])
    
    print(f"Phone variants being searched: {phone_variants}\n")
    
    # Find user profile
    profile = UserProfile.objects.filter(phone_number__in=phone_variants).first()
    
    if not profile:
        print("❌ No user profile found for this phone number")
        return
    
    try:
        user = profile.user
    except User.DoesNotExist:
        print("❌ Orphaned profile found (user deleted)")
        return
    
    print(f"✅ USER FOUND:")
    print(f"   ID: {user.id}")
    print(f"   Username: {user.username}")
    print(f"   Email: {user.email or 'N/A'}")
    print(f"   Profile Phone: {profile.phone_number}")
    print(f"   Created: {user.date_joined}")
    print()
    
    # Check active subscriptions
    active_subscriptions = SubscriptionPlan.objects.filter(
        user=user,
        status='active'
    ).order_by('-created_at')
    
    if active_subscriptions.exists():
        print(f"✅ ACTIVE SUBSCRIPTIONS ({active_subscriptions.count()}):")
        for sub in active_subscriptions:
            print(f"\n   Subscription ID: {sub.id}")
            print(f"   Plan: {sub.tier.name if sub.tier else 'N/A'}")
            print(f"   Payment Method: {sub.payment_method}")
            print(f"   Status: {sub.status}")
            print(f"   Created: {sub.created_at}")
            print(f"   Start Date: {sub.start_date}")
            print(f"   End Date: {sub.end_date}")
            
            # Calculate duration
            if sub.start_date and sub.end_date:
                duration = sub.end_date - sub.start_date
                print(f"   Duration: {duration.days} days")
                
                # Check if duration matches expected
                if sub.tier:
                    expected_days = sub.tier.duration_days
                    if duration.days != expected_days:
                        print(f"   ⚠️  WARNING: Expected {expected_days} days but got {duration.days} days")
            
            # Check if expired
            if sub.end_date and sub.end_date < timezone.now():
                print(f"   ⚠️  WARNING: Subscription is EXPIRED")
            else:
                days_remaining = (sub.end_date - timezone.now()).days if sub.end_date else 0
                print(f"   Days Remaining: {days_remaining}")
    else:
        print("❌ No active subscriptions found")
    
    # Check all subscriptions (including inactive)
    all_subscriptions = SubscriptionPlan.objects.filter(
        user=user
    ).order_by('-created_at')
    
    print(f"\n📋 ALL SUBSCRIPTIONS ({all_subscriptions.count()}):")
    for sub in all_subscriptions:
        print(f"\n   ID: {sub.id}")
        print(f"   Plan: {sub.tier.name if sub.tier else 'N/A'}")
        print(f"   Status: {sub.status}")
        print(f"   Payment Method: {sub.payment_method}")
        print(f"   Created: {sub.created_at}")
        print(f"   Start: {sub.start_date}")
        print(f"   End: {sub.end_date}")
        if sub.start_date and sub.end_date:
            duration = sub.end_date - sub.start_date
            print(f"   Duration: {duration.days} days")
    
    # Check subscription payments
    payments = SubscriptionPayment.objects.filter(
        user=user
    ).order_by('-created_at')
    
    print(f"\n💳 PAYMENT HISTORY ({payments.count()}):")
    for payment in payments:
        print(f"\n   Payment ID: {payment.id}")
        print(f"   Amount: {payment.amount} ETB")
        print(f"   Status: {payment.status}")
        print(f"   Payment Method: {payment.payment_method}")
        print(f"   Created: {payment.created_at}")
        print(f"   Period Start: {payment.period_start}")
        print(f"   Period End: {payment.period_end}")
        if payment.subscription_plan:
            print(f"   Linked to Subscription: {payment.subscription_plan.id}")
    
    # Check subscription history
    history = SubscriptionHistory.objects.filter(
        user=user
    ).order_by('-created_at')
    
    print(f"\n📜 SUBSCRIPTION HISTORY ({history.count()}):")
    for h in history:
        print(f"\n   Action: {h.action}")
        print(f"   Reason: {h.reason}")
        print(f"   Tier: {h.tier.name if h.tier else 'N/A'}")
        print(f"   Created: {h.created_at}")
    
    print(f"\n{'='*80}\n")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python check_subscription.py <phone_number>")
        print("Example: python check_subscription.py 0911227833")
        sys.exit(1)
    
    phone_number = sys.argv[1]
    check_subscription(phone_number)
