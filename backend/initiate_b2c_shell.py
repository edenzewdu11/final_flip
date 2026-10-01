#!/usr/bin/env python
"""
Django shell script to initiate B2C payment

Usage in Django shell:
    from backend.initiate_b2c_shell import initiate_b2c_payment
    result = initiate_b2c_payment(
        payer_username='your_username',
        receiver_msisdn='251911234567',
        amount=100.00,
        reason_type='Pay for Individual B2C_VDF_Demo',
        remark='Test payment'
    )
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from api.models_direct_debit import B2CPaymentTransaction
from api.telebirr_direct_debit_service import telebirr_direct_debit_service

User = get_user_model()

def initiate_b2c_payment(payer_username, receiver_msisdn, amount, currency='ETB', 
                       reason_type=None, remark='', reference_data=None):
    """
    Initiate B2C payment in Django shell
    
    Args:
        payer_username: Username of the user initiating the payment
        receiver_msisdn: Phone number of the receiver (format: 251911234567)
        amount: Payment amount (float or decimal)
        currency: Currency code (default: 'ETB')
        reason_type: Reason for payment (optional, uses default if not provided)
        remark: Additional remark (optional)
        reference_data: Additional reference data dict (optional)
    
    Returns:
        dict: {
            'success': bool,
            'transaction_id': str,
            'originator_conversation_id': str,
            'conversation_id': str,
            'message': str,
            'error': str (if failed)
        }
    """
    try:
        # Get payer user
        payer = User.objects.get(username=payer_username)
        print(f"Payer: {payer.username} (ID: {payer.id})")
        
        # Convert amount to decimal
        from decimal import Decimal
        amount_decimal = Decimal(str(amount))
        
        # Set default reason type if not provided
        if not reason_type:
            reason_type = telebirr_direct_debit_service.b2c_reason_type
        
        print(f"Initiating B2C payment:")
        print(f"  Receiver: {receiver_msisdn}")
        print(f"  Amount: {amount_decimal} {currency}")
        print(f"  Reason: {reason_type}")
        
        # Call Telebirr service to initiate B2C payment (with debug enabled)
        result = telebirr_direct_debit_service.initiate_b2c_payment(
            receiver_msisdn=receiver_msisdn,
            amount=amount_decimal,
            currency=currency,
            reason_type=reason_type,
            remark=remark,
            reference_data=reference_data or {},
            initiator_type='org_operator',
            debug=True  # Enable debug to see SOAP envelope
        )
        
        if not result.get('success'):
            print(f"❌ B2C payment initiation failed: {result.get('error')}")
            return {
                'success': False,
                'error': result.get('error', 'B2C payment initiation failed')
            }
        
        # Create B2C payment transaction record
        transaction = B2CPaymentTransaction.objects.create(
            payer=payer,
            receiver_msisdn=receiver_msisdn,
            amount=amount_decimal,
            currency=currency,
            reason_type=reason_type,
            remark=remark,
            reference_data=reference_data or {},
            originator_conversation_id=result.get('originator_conversation_id'),
            conversation_id=result.get('conversation_id'),
            status='pending'
        )
        
        print(f"✅ B2C payment initiated successfully")
        print(f"  Transaction ID: {transaction.id}")
        print(f"  Originator Conversation ID: {result.get('originator_conversation_id')}")
        print(f"  Conversation ID: {result.get('conversation_id')}")
        
        return {
            'success': True,
            'transaction_id': str(transaction.id),
            'originator_conversation_id': result.get('originator_conversation_id'),
            'conversation_id': result.get('conversation_id'),
            'message': 'B2C payment initiated successfully'
        }
        
    except User.DoesNotExist:
        print(f"❌ User not found: {payer_username}")
        return {
            'success': False,
            'error': f'User not found: {payer_username}'
        }
    except Exception as e:
        print(f"❌ Error initiating B2C payment: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }


# Example usage (commented out)
if __name__ == '__main__':
    # Example: initiate a test B2C payment
    result = initiate_b2c_payment(
        payer_username='Fits',  # Replace with actual username
        receiver_msisdn='251975979406',  # Replace with actual phone number
        amount=1000.00,
        reason_type='Pay for Individual B2C_VDF_Demo',
        remark='Test B2C payment from Django shell'
    )
    print(f"\nResult: {result}")
