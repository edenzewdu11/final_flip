import os
import django
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models_subscription import SubscriptionPlan
from api.services.telebirr_mandate_service import telebirr_mandate_service

# Find Telebirr subscriptions with mct_contract_no but missing mandate_contract_id
subscriptions = SubscriptionPlan.objects.filter(
    payment_method='telebirr',
    mct_contract_no__isnull=False,
    mandate_contract_id__isnull=True
)

print(f"Found {subscriptions.count()} Telebirr subscriptions with mct_contract_no but missing mandate_contract_id")

for sub in subscriptions:
    print(f"\nProcessing subscription {sub.id} for user {sub.user.username}")
    print(f"  mct_contract_no: {sub.mct_contract_no}")
    
    try:
        # Query Telebirr for mandate details
        result = telebirr_mandate_service.query_mandate(mct_contract_no=sub.mct_contract_no)
        
        # Extract mandate_contract_id from response
        if result and 'mandate_contract_id' in result:
            mandate_contract_id = result['mandate_contract_id']
            print(f"  Found mandate_contract_id: {mandate_contract_id}")
            
            # Update subscription
            sub.mandate_contract_id = mandate_contract_id
            sub.save()
            print(f"  ✓ Updated subscription {sub.id}")
        else:
            print(f"  ✗ No mandate_contract_id in response: {result}")
    except Exception as e:
        print(f"  ✗ Error querying mandate: {e}")

print("\n✅ Done!")
