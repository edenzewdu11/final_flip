import os
import django
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth.models import User
from api.models_direct_debit import DirectDebitMandate
from api.models_contest import UserSubscription, CoinTransaction
from api.models_subscription import SubscriptionPlan, SubscriptionPayment, SubscriptionHistory
from api.models import Subscription

def clear_user_mandate_data(username):
    """Clear all mandate and subscription data for a user"""
    
    # Find user
    try:
        user = User.objects.get(username=username)
        print(f"Found user: {user.username} (ID: {user.id})")
    except User.DoesNotExist:
        print(f"User {username} not found")
        return
    
    # Delete DirectDebitMandate records
    mandates = DirectDebitMandate.objects.filter(payer_msisdn__endswith=username.replace('telebirr_', ''))
    mandate_count = mandates.count()
    if mandate_count > 0:
        print(f"Found {mandate_count} DirectDebitMandate record(s)")
        for mandate in mandates:
            print(f"  - ID: {mandate.id}, Status: {mandate.status}, mct_contract_no: {mandate.mct_contract_no}")
        mandates.delete()
        print(f"✅ Deleted {mandate_count} DirectDebitMandate record(s)")
    else:
        print("No DirectDebitMandate records found")
    
    # Delete UserSubscription records
    subscriptions = UserSubscription.objects.filter(user=user)
    sub_count = subscriptions.count()
    if sub_count > 0:
        print(f"Found {sub_count} UserSubscription record(s)")
        for sub in subscriptions:
            print(f"  - ID: {sub.id}, Status: {sub.status}, mct_contract_no: {sub.mct_contract_no}, mandate_contract_id: {sub.mandate_contract_id}")
        subscriptions.delete()
        print(f"✅ Deleted {sub_count} UserSubscription record(s)")
    else:
        print("No UserSubscription records found")
    
    # Delete SubscriptionPlan records
    plans = SubscriptionPlan.objects.filter(user=user)
    plan_count = plans.count()
    if plan_count > 0:
        print(f"Found {plan_count} SubscriptionPlan record(s)")
        plans.delete()
        print(f"✅ Deleted {plan_count} SubscriptionPlan record(s)")
    else:
        print("No SubscriptionPlan records found")
    
    # Delete SubscriptionPayment records
    payments = SubscriptionPayment.objects.filter(user=user)
    payment_count = payments.count()
    if payment_count > 0:
        print(f"Found {payment_count} SubscriptionPayment record(s)")
        payments.delete()
        print(f"✅ Deleted {payment_count} SubscriptionPayment record(s)")
    else:
        print("No SubscriptionPayment records found")
    
    # Delete SubscriptionHistory records
    history = SubscriptionHistory.objects.filter(user=user)
    history_count = history.count()
    if history_count > 0:
        print(f"Found {history_count} SubscriptionHistory record(s)")
        history.delete()
        print(f"✅ Deleted {history_count} SubscriptionHistory record(s)")
    else:
        print("No SubscriptionHistory records found")
    
    # Delete CoinTransaction records
    coins = CoinTransaction.objects.filter(user=user)
    coin_count = coins.count()
    if coin_count > 0:
        print(f"Found {coin_count} CoinTransaction record(s)")
        coins.delete()
        print(f"✅ Deleted {coin_count} CoinTransaction record(s)")
    else:
        print("No CoinTransaction records found")
    
    # Delete old Subscription records
    old_subs = Subscription.objects.filter(user=user)
    old_sub_count = old_subs.count()
    if old_sub_count > 0:
        print(f"Found {old_sub_count} old Subscription record(s)")
        old_subs.delete()
        print(f"✅ Deleted {old_sub_count} old Subscription record(s)")
    else:
        print("No old Subscription records found")
    
    # Delete user (this will cascade to profile and other related models)
    try:
        user.delete()
        print(f"✅ User {username} deleted")
    except Exception as e:
        print(f"❌ Error deleting user: {e}")
        print("Trying to delete user using raw SQL with CASCADE...")
        from django.db import connection
        with connection.cursor() as cursor:
            # Disable foreign key checks temporarily
            cursor.execute("SET session_replication_role = replica")
            # Delete user directly - this will cascade to all related tables
            cursor.execute("DELETE FROM auth_user WHERE id = %s", [user.id])
            # Re-enable foreign key checks
            cursor.execute("SET session_replication_role = DEFAULT")
            print(f"✅ User {username} deleted via raw SQL with CASCADE")
    
    print(f"\n✅ All data cleared for user {username}")

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        username = sys.argv[1]
    else:
        username = "telebirr_0900000099"
    clear_user_mandate_data(username)
