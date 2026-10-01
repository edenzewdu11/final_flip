#!/usr/bin/env python
"""
Debug script to see full Telebirr B2C SOAP response
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.telebirr_direct_debit_service import telebirr_direct_debit_service
from decimal import Decimal

print("=" * 80)
print("DEBUGGING B2C PAYMENT - FULL RESPONSE")
print("=" * 80)

# Make the same request as the shell script
result = telebirr_direct_debit_service.initiate_b2c_payment(
    receiver_msisdn='251975979406',
    amount=Decimal('100.00'),
    currency='ETB',
    reason_type='Pay for Individual B2C_VDF_Demo',
    remark='Test B2C payment from Django shell',
    reference_data={},
    initiator_type='org_operator',
    debug=True
)

print("\n" + "=" * 80)
print("RESULT:")
print("=" * 80)
print(f"Success: {result.get('success')}")
print(f"Error: {result.get('error')}")
if result.get('response_text'):
    print(f"Response Text: {result.get('response_text')}")
