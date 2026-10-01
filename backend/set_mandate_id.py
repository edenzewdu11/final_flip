#!/usr/bin/env python
"""
Management script to manually set mandate_id for a user's DirectDebitMandate
Run this on production: USER_ID=165 MANDATE_ID=3042162 python manage.py shell < set_mandate_id.py
"""

import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models_subscription import SubscriptionPlan
from api.models_direct_debit import DirectDebitMandate

# Get user_id from environment variable
user_id = os.environ.get('USER_ID')
if not user_id:
    print("ERROR: Please provide USER_ID as environment variable")
    print("Usage: USER_ID=165 MANDATE_ID=3042162 python manage.py shell < set_mandate_id.py")
    exit(1)

# Get mandate_id from environment variable
mandate_id_to_set = os.environ.get('MANDATE_ID')
if not mandate_id_to_set:
    print("ERROR: Please provide MANDATE_ID as environment variable")
    print("Usage: USER_ID=165 MANDATE_ID=3042162 python manage.py shell < set_mandate_id.py")
    print("\nAvailable mandates from Telebirr webhook:")
    print("  COIN_165_20260718134554 -> MandateID 3075710 (coin purchase, expired)")
    print("  FLP01783339053 -> MandateID 3042162 (monthly subscription)")
    print("  FLP01783335837 -> MandateID 3042434 (monthly subscription)")
    print("  FLP01783338481 -> MandateID 3041491 (monthly subscription)")
    print("  FLP01783351074 -> MandateID 3043121 (weekly subscription)")
    print("  FLP01783349885 -> MandateID ??? (weekly subscription)")
    exit(1)

# Find active DirectDebitMandate for user
direct_debit_mandate = DirectDebitMandate.objects.filter(
    user__id=user_id,
    status='active'
).order_by('-created_at').first()

if not direct_debit_mandate:
    print(f"No active DirectDebitMandate found for user {user_id}")
    exit(1)

print(f"Found DirectDebitMandate: {direct_debit_mandate.id}")
print(f"User: {direct_debit_mandate.user.username if direct_debit_mandate.user else 'None'}")
print(f"  PayerReferenceNumber: {direct_debit_mandate.payer_reference_number}")
print(f"  PayerMSISDN: {direct_debit_mandate.payer_msisdn}")
print(f"  Current MandateID: {direct_debit_mandate.mandate_id}")
print(f"  Status: {direct_debit_mandate.status}")

# Also show linked subscription if any
if direct_debit_mandate.subscription_plan:
    print(f"\nLinked Subscription:")
    print(f"  ID: {direct_debit_mandate.subscription_plan.id}")
    print(f"  Status: {direct_debit_mandate.subscription_plan.status}")
    print(f"  end_date: {direct_debit_mandate.subscription_plan.end_date}")

print(f"\nSetting mandate_id to: {mandate_id_to_set}")
direct_debit_mandate.mandate_id = mandate_id_to_set[:18]
direct_debit_mandate.save(update_fields=['mandate_id'])
print(f"Updated mandate_id to: {direct_debit_mandate.mandate_id}")
