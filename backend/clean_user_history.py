import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth.models import User
from api.models import UserProfile
from api.models_subscription import SubscriptionPlan, SubscriptionPayment, SubscriptionHistory
from api.models_contest import UserSubscription
from api.models_direct_debit import DirectDebitMandate
from api.services.telebirr_mandate_service import TelebirrMandateService
from django.db import connection

def clean_user_history(phone_number):
    """
    Clean all history for a phone number across the entire platform.
    This includes:
    - User account
    - Subscriptions (Onevas and Telebirr)
    - Mandates
    - Payments
    - History records
    - Profile data
    """
    print(f"{'='*80}")
    print(f"CLEANING HISTORY FOR PHONE: {phone_number}")
    print(f"{'='*80}")
    
    # Clean phone number variants
    cleaned_phone = phone_number.replace('+', '').strip()
    if cleaned_phone.startswith('251'):
        cleaned_phone = '0' + cleaned_phone[3:]
    
    phone_variants = {cleaned_phone, phone_number, phone_number.replace('+', '').strip()}
    if cleaned_phone.startswith('0'):
        phone_variants.add('251' + cleaned_phone[1:])
        phone_variants.add('+251' + cleaned_phone[1:])
    phone_variants = [p for p in phone_variants if p]
    
    print(f"Phone variants to search: {phone_variants}")
    
    # Find user by phone number
    user = None
    profile = UserProfile.objects.filter(phone_number__in=phone_variants).first()
    if profile:
        user = profile.user
        print(f"Found user: {user.username} (ID: {user.id})")
    else:
        # Try to find by username pattern
        username = f'telebirr_{cleaned_phone}'
        user = User.objects.filter(username=username).first()
        if user:
            print(f"Found user by username: {user.username} (ID: {user.id})")
            try:
                profile = user.profile
            except:
                profile = None
                print(f"  Note: User has no profile (may have been deleted previously)")
        else:
            print(f"No user found for phone: {phone_number}")
            return
    
    # 1. Cancel Telebirr mandates
    print(f"\n{'='*80}")
    print("STEP 1: CANCELLING TELEBIRR MANDATES")
    print(f"{'='*80}")
    
    telebirr_subscriptions = SubscriptionPlan.objects.filter(
        user=user,
        payment_method='telebirr',
        mandate_contract_id__isnull=False
    )
    
    mandate_service = TelebirrMandateService()
    
    for sub in telebirr_subscriptions:
        print(f"Found Telebirr subscription: {sub.id}, mandate_contract_id: {sub.mandate_contract_id}")
        if sub.mandate_contract_id:
            try:
                result = mandate_service.cancel_mandate(
                    mandate_contract_id=sub.mandate_contract_id,
                    initiator_phone=cleaned_phone,
                    reason='Account cleanup'
                )
                print(f"  ✓ Cancelled mandate with Telebirr: {result}")
            except Exception as e:
                print(f"  ✗ Failed to cancel mandate: {e}")
    
    # 2. Delete DirectDebitMandate records
    print(f"\n{'='*80}")
    print("STEP 2: DELETING DIRECT DEBIT MANDATES")
    print(f"{'='*80}")
    
    dd_mandates = DirectDebitMandate.objects.filter(payer_msisdn__in=phone_variants)
    dd_count = dd_mandates.count()
    print(f"Found {dd_count} DirectDebitMandate records")
    dd_mandates.delete()
    print(f"  ✓ Deleted {dd_count} DirectDebitMandate records")
    
    # 3. Delete subscription payments
    print(f"\n{'='*80}")
    print("STEP 3: DELETING SUBSCRIPTION PAYMENTS")
    print(f"{'='*80}")
    
    payments = SubscriptionPayment.objects.filter(user=user)
    payment_count = payments.count()
    print(f"Found {payment_count} payment records")
    payments.delete()
    print(f"  ✓ Deleted {payment_count} payment records")
    
    # 4. Delete subscription history
    print(f"\n{'='*80}")
    print("STEP 4: DELETING SUBSCRIPTION HISTORY")
    print(f"{'='*80}")
    
    history = SubscriptionHistory.objects.filter(user=user)
    history_count = history.count()
    print(f"Found {history_count} history records")
    history.delete()
    print(f"  ✓ Deleted {history_count} history records")
    
    # 5. Delete SubscriptionPlan records (main subscriptions)
    print(f"\n{'='*80}")
    print("STEP 5: DELETING SUBSCRIPTION PLAN RECORDS")
    print(f"{'='*80}")
    
    subscriptions = SubscriptionPlan.objects.filter(user=user)
    sub_count = subscriptions.count()
    print(f"Found {sub_count} subscription plan records")
    for sub in subscriptions:
        print(f"  - Subscription {sub.id}: {sub.tier.name if sub.tier else 'No Tier'} ({sub.payment_method})")
    subscriptions.delete()
    print(f"  ✓ Deleted {sub_count} subscription plan records")
    
    # 6. Delete contest subscriptions
    print(f"\n{'='*80}")
    print("STEP 6: DELETING CONTEST SUBSCRIPTIONS")
    print(f"{'='*80}")
    
    contest_subs = UserSubscription.objects.filter(user=user)
    contest_count = contest_subs.count()
    print(f"Found {contest_count} contest subscription records")
    contest_subs.delete()
    print(f"  ✓ Deleted {contest_count} contest subscription records")
    
    # 7. Delete user profile
    print(f"\n{'='*80}")
    print("STEP 7: DELETING USER PROFILE")
    print(f"{'='*80}")
    
    if profile:
        print(f"Deleting profile for user: {user.username}")
        profile.delete()
        print(f"  ✓ Deleted user profile")
    else:
        print(f"  No profile found for user (already deleted or never existed)")
    
    # 8. Delete user account using raw SQL to bypass foreign key constraints
    print(f"\n{'='*80}")
    print("STEP 8: DELETING USER ACCOUNT AND ALL DEPENDENCIES")
    print(f"{'='*80}")
    
    print(f"Deleting all user data using raw SQL to bypass foreign key constraints")
    cursor = connection.cursor()
    
    try:
        # Delete in specific order to handle foreign key dependencies
        # Order matters: delete dependent records before parent records
        
        # Delete votes (depends on reels)
        cursor.execute("DELETE FROM api_vote WHERE user_id = %s", [user.id])
        deleted = cursor.rowcount
        if deleted > 0:
            print(f"  ✓ Deleted {deleted} records from api_vote")
        
        # Delete notifications (depends on comments, reels, etc.)
        cursor.execute("DELETE FROM api_notification WHERE recipient_id = %s OR sender_id = %s", [user.id, user.id])
        deleted = cursor.rowcount
        if deleted > 0:
            print(f"  ✓ Deleted {deleted} records from api_notification")
        
        # Delete moderation actions (depends on reports)
        cursor.execute("DELETE FROM api_moderationaction WHERE moderator_id = %s", [user.id])
        deleted = cursor.rowcount
        if deleted > 0:
            print(f"  ✓ Deleted {deleted} records from api_moderationaction (moderator)")
        
        # Delete reports (after moderation actions deleted)
        cursor.execute("DELETE FROM api_report WHERE reported_by_id = %s OR reported_user_id = %s", [user.id, user.id])
        deleted = cursor.rowcount
        if deleted > 0:
            print(f"  ✓ Deleted {deleted} records from api_report")
        
        # Delete comments (after notifications deleted)
        cursor.execute("DELETE FROM api_comment WHERE user_id = %s", [user.id])
        deleted = cursor.rowcount
        if deleted > 0:
            print(f"  ✓ Deleted {deleted} records from api_comment")
        
        # Delete reels (after votes and notifications deleted)
        cursor.execute("DELETE FROM api_reel WHERE user_id = %s", [user.id])
        deleted = cursor.rowcount
        if deleted > 0:
            print(f"  ✓ Deleted {deleted} records from api_reel")
        
        # Delete remaining records in any order
        tables_to_delete = [
            ('api_subscription', 'user_id'),
            ('api_notificationpreference', 'user_id'),
            ('api_campaignentry', 'user_id'),
            ('api_campaignnotification', 'user_id'),
            ('user_coin_balances', 'user_id'),
            ('coin_transactions', 'recipient_id'),
            ('coin_transactions', 'user_id'),
            ('api_postscore', 'user_id'),
            ('api_usercampaignstats', 'user_id'),
            ('api_leaderboardentry', 'user_id'),
            ('api_gamificationactivity', 'user_id'),
            ('api_conversation_participants', 'user_id'),
            ('api_message', 'sender_id'),
            ('api_messageread', 'user_id'),
            ('api_usergiftstats', 'user_id'),
            ('api_gifttransaction', 'recipient_id'),
            ('api_gifttransaction', 'sender_id'),
            ('api_giftcombo', 'user_id'),
            ('api_adminrole', 'user_id'),
            ('authtoken_token', 'user_id'),
            ('coin_purchase_transactions', 'user_id'),
            ('help_requests', 'user_id'),
            ('support_requests', 'user_id'),
            ('api_crmprizewinner', 'user_id'),
            ('api_consenthistory', 'user_id'),
            ('api_userconsent', 'user_id'),
            ('api_notinterested', 'user_id'),
        ]
        
        for table, column in tables_to_delete:
            try:
                cursor.execute(f"DELETE FROM {table} WHERE {column} = %s", [user.id])
                deleted = cursor.rowcount
                if deleted > 0:
                    print(f"  ✓ Deleted {deleted} records from {table}.{column}")
            except Exception as e:
                print(f"  ✗ Failed to delete from {table}.{column}: {e}")
        
        # Finally delete the user
        cursor.execute("DELETE FROM auth_user WHERE id = %s", [user.id])
        print(f"  ✓ Deleted user account: {user.username}")
        
        connection.commit()
        print(f"  ✓ All user data deleted successfully")
        
    except Exception as e:
        connection.rollback()
        print(f"  ✗ Failed to delete user account: {e}")
        print(f"  Note: Most user data has been cleaned but some records may remain")
    finally:
        cursor.close()
    
    print(f"\n{'='*80}")
    print("CLEANUP COMPLETE")
    print(f"{'='*80}")
    print(f"All history for phone {phone_number} has been removed from the platform.")

if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1:
        phone_number = sys.argv[1].strip()
        if phone_number:
            if len(sys.argv) > 2 and sys.argv[2] == '--yes':
                clean_user_history(phone_number)
            else:
                print(f"Are you sure you want to delete ALL history for {phone_number}? (yes/no): ", end='', flush=True)
                confirm = sys.stdin.readline().strip().lower()
                if confirm == 'yes':
                    clean_user_history(phone_number)
                else:
                    print("Operation cancelled.")
        else:
            print("No phone number provided.")
    else:
        phone_number = input("Enter phone number to clean (e.g., 0911528271): ").strip()
        if phone_number:
            confirm = input(f"Are you sure you want to delete ALL history for {phone_number}? (yes/no): ").strip().lower()
            if confirm == 'yes':
                clean_user_history(phone_number)
            else:
                print("Operation cancelled.")
        else:
            print("No phone number provided.")
