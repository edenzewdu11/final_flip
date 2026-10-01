#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models_contest import UserSubscription
from api.models_direct_debit import DirectDebitMandate
from api.models import Subscription
from api.models_subscription import SubscriptionPlan, SubscriptionPayment
from django.contrib.auth import get_user_model

User = get_user_model()

phone = '0911528271'
user = User.objects.filter(username=f'telebirr_{phone}').first()

if not user:
    user = User.objects.filter(username=phone).first()

if user:
    print(f"{'='*80}")
    print(f"USER: {user.username} (ID: {user.id})")
    print(f"{'='*80}")
    
    # Check all UserSubscription records
    print(f"\n[1] UserSubscription (new model):")
    user_subs = UserSubscription.objects.filter(user=user)
    print(f"    Total: {user_subs.count()}")
    for sub in user_subs:
        print(f"    - ID: {sub.id}")
        print(f"      Status: {sub.status}")
        print(f"      End date: {sub.end_date}")
        print(f"      Plan: {sub.plan}")
        print(f"      Mandate: {sub.mandate}")
        if sub.mandate:
            print(f"        mandate_contract_id: {sub.mandate.mandate_contract_id}")
            print(f"        mct_contract_no: {sub.mandate.mct_contract_no}")
            print(f"        mandate status: {sub.mandate.status}")
    
    # Check all old Subscription records
    print(f"\n[2] Subscription (old model):")
    old_subs = Subscription.objects.filter(user=user)
    print(f"    Total: {old_subs.count()}")
    for sub in old_subs:
        print(f"    - ID: {sub.id}")
        print(f"      Plan: {sub.plan}")
        print(f"      Expires at: {sub.expires_at}")
        # Try to get payment_method if it exists
        if hasattr(sub, 'payment_method'):
            print(f"      Payment method: {sub.payment_method}")
        if hasattr(sub, 'status'):
            print(f"      Status: {sub.status}")
        # Print all available fields
        print(f"      All fields: {dir(sub)}")
    
    # Check all DirectDebitMandate records
    print(f"\n[3] DirectDebitMandate:")
    mandates = DirectDebitMandate.objects.filter(user=user)
    print(f"    Total: {mandates.count()}")
    for mandate in mandates:
        print(f"    - ID: {mandate.id}")
        # Check available fields dynamically
        if hasattr(mandate, 'mandate_id'):
            print(f"      mandate_id: {mandate.mandate_id}")
        if hasattr(mandate, 'mandate_contract_id'):
            print(f"      mandate_contract_id: {mandate.mandate_contract_id}")
        if hasattr(mandate, 'mct_contract_no'):
            print(f"      mct_contract_no: {mandate.mct_contract_no}")
        if hasattr(mandate, 'status'):
            print(f"      Status: {mandate.status}")
        if hasattr(mandate, 'phone_number'):
            print(f"      Phone: {mandate.phone_number}")
        if hasattr(mandate, 'payer_msisdn'):
            print(f"      Payer MSISDN: {mandate.payer_msisdn}")
        # Print all available fields
        print(f"      Available fields: {[f for f in dir(mandate) if not f.startswith('_')]}")
    
    # Check all SubscriptionPlan records
    print(f"\n[4] SubscriptionPlan:")
    plans = SubscriptionPlan.objects.filter(user=user)
    print(f"    Total: {plans.count()}")
    for plan in plans:
        print(f"    - ID: {plan.id}")
        print(f"      Tier: {plan.tier}")
        print(f"      Status: {plan.status}")
        print(f"      Start date: {plan.start_date}")
        print(f"      End date: {plan.end_date}")
        print(f"      Payment method: {plan.payment_method}")
        print(f"      mandate_contract_id: {plan.mandate_contract_id}")
        print(f"      mct_contract_no: {plan.mct_contract_no}")
    
    # Check all SubscriptionPayment records
    print(f"\n[5] SubscriptionPayment:")
    payments = SubscriptionPayment.objects.filter(user=user)
    print(f"    Total: {payments.count()}")
    for payment in payments:
        print(f"    - ID: {payment.id}")
        print(f"      Amount: {payment.amount}")
        if hasattr(payment, 'status'):
            print(f"      Status: {payment.status}")
        if hasattr(payment, 'payment_method'):
            print(f"      Payment method: {payment.payment_method}")
        if hasattr(payment, 'transaction_id'):
            print(f"      Transaction ID: {payment.transaction_id}")
        if hasattr(payment, 'created_at'):
            print(f"      Created at: {payment.created_at}")
        # Print all available fields
        print(f"      Available fields: {[f for f in dir(payment) if not f.startswith('_')]}")
    
    # Check all users with this phone in username
    print(f"\n[6] All users with phone in username:")
    all_users = User.objects.filter(username__contains=phone)
    print(f"    Total: {all_users.count()}")
    for u in all_users:
        print(f"    - {u.username} (ID: {u.id})")
else:
    print(f"User not found with phone: {phone}")
