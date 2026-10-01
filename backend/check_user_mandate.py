#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models_contest import UserSubscription
from api.models_direct_debit import DirectDebitMandate
from api.models import Subscription
from django.contrib.auth import get_user_model

User = get_user_model()

user_id = 159
user = User.objects.filter(id=user_id).first()

if user:
    print(f"User: {user.username} (ID: {user.id})")
    
    # Check old Subscription model
    old_subs = Subscription.objects.filter(user=user)
    print(f"\nOld Subscriptions: {old_subs.count()}")
    for sub in old_subs:
        print(f"  - ID: {sub.id}, plan: {sub.plan}, expires_at: {sub.expires_at}")
    
    # Check UserSubscription
    subs = UserSubscription.objects.filter(user=user)
    print(f"\nUserSubscriptions: {subs.count()}")
    for sub in subs:
        print(f"  - ID: {sub.id}, status: {sub.status}, end_date: {sub.end_date}")
        print(f"    mandate: {sub.mandate}")
        if sub.mandate:
            print(f"      mandate_contract_id: {sub.mandate.mandate_contract_id}")
            print(f"      mct_contract_no: {sub.mandate.mct_contract_no}")
            print(f"      status: {sub.mandate.status}")
    
    # Check DirectDebitMandate
    mandates = DirectDebitMandate.objects.filter(user=user)
    print(f"\nDirectDebitMandates: {mandates.count()}")
    for mandate in mandates:
        print(f"  - ID: {mandate.id}")
        print(f"    mandate_contract_id: {mandate.mandate_contract_id}")
        print(f"    mct_contract_no: {mandate.mct_contract_no}")
        print(f"    status: {mandate.status}")
else:
    print(f"User not found: {user_id}")
