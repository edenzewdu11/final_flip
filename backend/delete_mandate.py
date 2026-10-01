import os
import django
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models_direct_debit import DirectDebitMandate

def delete_mandate_by_phone(phone_number):
    """Delete mandate for a specific phone number"""
    mandates = DirectDebitMandate.objects.filter(payer_msisdn=phone_number)
    count = mandates.count()
    if count > 0:
        print(f"Found {count} mandate(s) for phone {phone_number}")
        for mandate in mandates:
            print(f"  - ID: {mandate.id}, Status: {mandate.status}, mct_contract_no: {mandate.mct_contract_no}")
        mandates.delete()
        print(f"✅ Deleted {count} mandate(s)")
    else:
        print(f"No mandates found for phone {phone_number}")

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        phone = sys.argv[1]
    else:
        phone = "0900000099"
    delete_mandate_by_phone(phone)
