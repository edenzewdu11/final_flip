#!/usr/bin/env python
"""
Comprehensive script to check all mandates for a phone number across all tables
and identify discrepancies between Telebirr status and database status.
Usage: python check_and_cancel_all_mandates.py <phone_number> [--cancel]
"""
import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from api.models_direct_debit import DirectDebitMandate
from api.models_subscription import SubscriptionPlan, PendingTelebirrMandate
from api.models_contest import UserSubscription
from api.models import UserProfile
from api.services.telebirr_mandate_service import TelebirrMandateService
from django.contrib.auth import get_user_model

User = get_user_model()

def clean_phone_number(phone_number):
    """Clean and normalize phone number"""
    cleaned = phone_number.replace('+', '').replace(' ', '')
    if not cleaned.startswith('0'):
        if cleaned.startswith('251'):
            cleaned = '0' + cleaned[3:]
    return cleaned

def get_phone_variants(phone_number):
    """Get all possible phone number variants"""
    cleaned = clean_phone_number(phone_number)
    return {
        cleaned,
        cleaned.replace('0', '251', 1),
        '251' + cleaned[1:],
        cleaned[1:],  # without leading 0
    }

def find_user_by_phone(phone_number):
    """Find user by phone number"""
    cleaned = clean_phone_number(phone_number)
    
    # Try finding by username (telebirr_{phone})
    user = User.objects.filter(username=f'telebirr_{cleaned}').first()
    if user:
        return user
    
    # Try finding by profile phone
    profile = UserProfile.objects.filter(phone_number=cleaned).first()
    if profile:
        return profile.user
    
    return None

def check_direct_debit_mandates(phone_number):
    """Check DirectDebitMandate table"""
    print(f"\n{'='*80}")
    print("CHECKING DIRECT DEBIT MANDATES")
    print(f"{'='*80}")
    
    phone_variants = get_phone_variants(phone_number)
    mandates = DirectDebitMandate.objects.filter(payer_msisdn__in=phone_variants)
    
    print(f"Found {mandates.count()} mandate(s) in DirectDebitMandate table")
    
    results = []
    for mandate in mandates:
        print(f"\n  - ID: {mandate.id}")
        print(f"    User: {mandate.user.username if mandate.user else 'None'}")
        print(f"    Phone: {mandate.payer_msisdn}")
        print(f"    Mandate ID: {mandate.mandate_id}")
        print(f"    Status: {mandate.status}")
        print(f"    Payment Type: {mandate.payment_type}")
        print(f"    Created: {mandate.created_at}")
        print(f"    Subscription Plan: {mandate.subscription_plan.id if mandate.subscription_plan else 'None'}")
        results.append({
            'table': 'DirectDebitMandate',
            'id': str(mandate.id),
            'mandate_id': mandate.mandate_id,
            'status': mandate.status,
            'phone': mandate.payer_msisdn,
            'user': mandate.user.username if mandate.user else None
        })
    
    return results

def check_subscription_plans(phone_number):
    """Check SubscriptionPlan table for Telebirr mandates"""
    print(f"\n{'='*80}")
    print("CHECKING SUBSCRIPTION PLANS (TELEBIRR)")
    print(f"{'='*80}")
    
    user = find_user_by_phone(phone_number)
    if not user:
        print("No user found for this phone number")
        return []
    
    phone_variants = get_phone_variants(phone_number)
    
    # Check by user
    subscriptions = SubscriptionPlan.objects.filter(
        user=user,
        payment_method='telebirr'
    )
    
    # Also check by telebirr_phone_number field
    subscriptions |= SubscriptionPlan.objects.filter(
        telebirr_phone_number__in=phone_variants,
        payment_method='telebirr'
    )
    
    print(f"Found {subscriptions.count()} Telebirr subscription(s)")
    
    results = []
    for sub in subscriptions:
        print(f"\n  - ID: {sub.id}")
        print(f"    User: {sub.user.username if sub.user else 'None'}")
        print(f"    Phone: {sub.telebirr_phone_number}")
        print(f"    Mandate Contract ID: {sub.mandate_contract_id}")
        print(f"    MCT Contract No: {sub.mct_contract_no}")
        print(f"    Mandate Status: {sub.mandate_status}")
        print(f"    Subscription Status: {sub.status}")
        print(f"    Created: {sub.created_at}")
        results.append({
            'table': 'SubscriptionPlan',
            'id': str(sub.id),
            'mandate_contract_id': sub.mandate_contract_id,
            'mct_contract_no': sub.mct_contract_no,
            'mandate_status': sub.mandate_status,
            'subscription_status': sub.status,
            'phone': sub.telebirr_phone_number,
            'user': sub.user.username if sub.user else None
        })
    
    return results

def check_pending_mandates(phone_number):
    """Check PendingTelebirrMandate table"""
    print(f"\n{'='*80}")
    print("CHECKING PENDING TELEBIRR MANDATES")
    print(f"{'='*80}")
    
    phone_variants = get_phone_variants(phone_number)
    pending = PendingTelebirrMandate.objects.filter(phone_number__in=phone_variants)
    
    print(f"Found {pending.count()} pending mandate(s)")
    
    results = []
    for mandate in pending:
        print(f"\n  - ID: {mandate.id}")
        print(f"    Phone: {mandate.phone_number}")
        print(f"    MCT Contract No: {mandate.mct_contract_no}")
        print(f"    Mandate Contract ID: {mandate.mandate_contract_id}")
        print(f"    Status: {mandate.status}")
        print(f"    Plan Type: {mandate.plan_type}")
        print(f"    Created: {mandate.created_at}")
        results.append({
            'table': 'PendingTelebirrMandate',
            'id': str(mandate.id),
            'mct_contract_no': mandate.mct_contract_no,
            'mandate_contract_id': mandate.mandate_contract_id,
            'status': mandate.status,
            'phone': mandate.phone_number
        })
    
    return results

def check_user_subscriptions(phone_number):
    """Check UserSubscription (contest) table"""
    print(f"\n{'='*80}")
    print("CHECKING USER SUBSCRIPTIONS (CONTEST)")
    print(f"{'='*80}")
    
    user = find_user_by_phone(phone_number)
    if not user:
        print("No user found for this phone number")
        return []
    
    try:
        user_sub = UserSubscription.objects.filter(user=user).first()
        if user_sub:
            print(f"  - User: {user_sub.user.username}")
            print(f"    Tier: {user_sub.tier}")
            print(f"    Payment Method: {user_sub.payment_method}")
            print(f"    Mandate: {user_sub.mandate.id if user_sub.mandate else 'None'}")
            if user_sub.mandate:
                print(f"      Mandate ID: {user_sub.mandate.mandate_id}")
                print(f"      Mandate Status: {user_sub.mandate.status}")
            return [{
                'table': 'UserSubscription',
                'user': user_sub.user.username,
                'tier': user_sub.tier,
                'payment_method': user_sub.payment_method,
                'mandate_id': user_sub.mandate.mandate_id if user_sub.mandate else None,
                'mandate_status': user_sub.mandate.status if user_sub.mandate else None
            }]
        else:
            print("No UserSubscription found")
            return []
    except Exception as e:
        print(f"Error checking UserSubscription: {e}")
        return []

def query_telebirr_mandates(phone_number, pending_mandates=None):
    """Query Telebirr API for all mandates using MCT contract numbers from pending mandates"""
    print(f"\n{'='*80}")
    print("QUERYING TELEBIRR API FOR ALL MANDATES")
    print(f"{'='*80}")
    
    mandate_service = TelebirrMandateService()
    matching_mandates = []
    
    # If we have pending mandates with MCT contract numbers, query each one
    if pending_mandates:
        print(f"Querying Telebirr for {len(pending_mandates)} MCT contract numbers...")
        
        for pending in pending_mandates:
            mct_contract_no = pending.get('mct_contract_no')
            mandate_contract_id = pending.get('mandate_contract_id')
            
            print(f"\n  Querying MCT: {mct_contract_no}")
            
            try:
                # Query using MCT contract number
                result = mandate_service.query_mandate(mct_contract_no=mct_contract_no)
                
                if result.get('result') == 'SUCCESS':
                    biz_content = result.get('biz_content', {})
                    mandates = biz_content.get('mandates', [])
                    
                    # Also check if response has a single mandate
                    if not mandates and biz_content.get('mandate_contract_id'):
                        mandates = [biz_content]
                    
                    for mandate in mandates:
                        mandate_phone = mandate.get('identifier') or mandate.get('phone_number') or ''
                        status = mandate.get('status') or mandate.get('mandate_status')
                        
                        print(f"    ✓ Found mandate: {mandate.get('mandate_contract_id')}")
                        print(f"      Status: {status}")
                        print(f"      Phone: {mandate_phone}")
                        
                        matching_mandates.append(mandate)
                else:
                    print(f"    ✗ Query failed: {result.get('msg') or result.get('errorMsg')}")
                    
            except Exception as e:
                print(f"    ✗ Error querying MCT {mct_contract_no}: {e}")
    else:
        # Try querying all mandates for merchant (without specific parameters)
        try:
            result = mandate_service.query_mandate()
            
            if result.get('result') == 'SUCCESS':
                biz_content = result.get('biz_content', {})
                mandates = biz_content.get('mandates', [])
                
                # Also check if response has a single mandate
                if not mandates and biz_content.get('mandate_contract_id'):
                    mandates = [biz_content]
                
                print(f"Found {len(mandates)} total mandate(s) on Telebirr")
                
                # Filter for our phone number
                phone_variants = get_phone_variants(phone_number)
                
                for mandate in mandates:
                    mandate_phone = mandate.get('identifier') or mandate.get('phone_number') or ''
                    if mandate_phone in phone_variants:
                        matching_mandates.append(mandate)
                        print(f"\n  - Mandate Contract ID: {mandate.get('mandate_contract_id')}")
                        print(f"    MCT Contract No: {mandate.get('merch_contract_no')}")
                        print(f"    Phone: {mandate_phone}")
                        print(f"    Status: {mandate.get('status') or mandate.get('mandate_status')}")
            else:
                print(f"Query failed: {result.get('msg') or result.get('errorMsg')}")
                
        except Exception as e:
            print(f"Error querying Telebirr: {e}")
            import traceback
            traceback.print_exc()
    
    print(f"\nTotal matching mandates for phone {phone_number}: {len(matching_mandates)}")
    return matching_mandates

def identify_discrepancies(db_mandates, telebirr_mandates):
    """Identify mandates cancelled on Telebirr but active in database"""
    print(f"\n{'='*80}")
    print("IDENTIFYING DISCREPANCIES")
    print(f"{'='*80}")
    
    # Create a set of Telebirr mandate IDs and their statuses
    telebirr_status = {}
    for tm in telebirr_mandates:
        mandate_id = tm.get('mandate_contract_id')
        status = tm.get('status') or tm.get('mandate_status')
        telebirr_status[mandate_id] = status
    
    discrepancies = []
    
    for db_m in db_mandates:
        mandate_id = db_m.get('mandate_id') or db_m.get('mandate_contract_id')
        db_status = db_m.get('status') or db_m.get('subscription_status') or db_m.get('mandate_status')
        
        if mandate_id and mandate_id in telebirr_status:
            telebirr_stat = telebirr_status[mandate_id]
            
            # Check if cancelled on Telebirr but active/completed in DB
            if telebirr_stat in ['CANCELLED', 'cancelled', 'CANCEL'] and db_status in ['active', 'ACTIVE', 'completed', 'COMPLETED']:
                discrepancies.append({
                    'db_record': db_m,
                    'telebirr_status': telebirr_stat,
                    'db_status': db_status,
                    'mandate_id': mandate_id
                })
                print(f"\n⚠️  DISCREPANCY FOUND:")
                print(f"    Mandate ID: {mandate_id}")
                print(f"    Table: {db_m['table']}")
                print(f"    Telebirr Status: {telebirr_stat}")
                print(f"    DB Status: {db_status}")
        elif mandate_id and mandate_id not in telebirr_status:
            # Mandate exists in DB but not on Telebirr
            if db_status in ['active', 'ACTIVE', 'completed', 'COMPLETED']:
                discrepancies.append({
                    'db_record': db_m,
                    'telebirr_status': 'NOT_FOUND',
                    'db_status': db_status,
                    'mandate_id': mandate_id
                })
                print(f"\n⚠️  DISCREPANCY FOUND:")
                print(f"    Mandate ID: {mandate_id}")
                print(f"    Table: {db_m['table']}")
                print(f"    Telebirr Status: NOT FOUND")
                print(f"    DB Status: {db_status}")
    
    if not discrepancies:
        print("No discrepancies found")
    
    return discrepancies

def cancel_all_db_mandates(phone_number, force=False):
    """Cancel all mandates in database for the phone number"""
    print(f"\n{'='*80}")
    print("CANCELLING ALL DATABASE MANDATES")
    print(f"{'='*80}")
    
    phone_variants = get_phone_variants(phone_number)
    cancelled_count = 0
    
    # Cancel DirectDebitMandates
    dd_mandates = DirectDebitMandate.objects.filter(
        payer_msisdn__in=phone_variants,
        status__in=['active', 'pending_active', 'pending_created']
    )
    print(f"\nCancelling {dd_mandates.count()} DirectDebitMandate(s)")
    for mandate in dd_mandates:
        mandate.cancel()
        print(f"  - Cancelled mandate {mandate.id}")
        cancelled_count += 1
    
    # Cancel SubscriptionPlans
    user = find_user_by_phone(phone_number)
    if user:
        subscriptions = SubscriptionPlan.objects.filter(
            user=user,
            payment_method='telebirr',
            status__in=['active', 'pending']
        )
        print(f"\nCancelling {subscriptions.count()} SubscriptionPlan(s)")
        for sub in subscriptions:
            sub.cancel(reason='Bulk cancellation via script')
            print(f"  - Cancelled subscription {sub.id}")
            cancelled_count += 1
    
    # Mark PendingTelebirrMandates as failed (both pending and completed since they're cancelled on Telebirr)
    pending = PendingTelebirrMandate.objects.filter(
        phone_number__in=phone_variants,
        status__in=['pending', 'completed']
    )
    print(f"\nMarking {pending.count()} PendingTelebirrMandate(s) as failed")
    for mandate in pending:
        mandate.status = 'failed'
        mandate.save()
        print(f"  - Failed pending mandate {mandate.id} (was: {mandate.status})")
        cancelled_count += 1
    
    print(f"\n{'='*80}")
    print(f"TOTAL CANCELLED: {cancelled_count}")
    print(f"{'='*80}")
    
    return cancelled_count

def main():
    if len(sys.argv) < 2:
        print("Usage: python check_and_cancel_all_mandates.py <phone_number> [--cancel]")
        print("Example: python check_and_cancel_all_mandates.py 0929989434")
        print("Example: python check_and_cancel_all_mandates.py 0929989434 --cancel")
        sys.exit(1)
    
    phone_number = sys.argv[1]
    should_cancel = '--cancel' in sys.argv
    
    print(f"{'='*80}")
    print(f"COMPREHENSIVE MANDATE CHECK FOR: {phone_number}")
    print(f"{'='*80}")
    
    # Check all database tables
    dd_mandates = check_direct_debit_mandates(phone_number)
    sub_plans = check_subscription_plans(phone_number)
    pending_mandates = check_pending_mandates(phone_number)
    user_subs = check_user_subscriptions(phone_number)
    
    # Combine all database mandates
    all_db_mandates = dd_mandates + sub_plans + pending_mandates + user_subs
    
    # Query Telebirr using MCT contract numbers from pending mandates
    telebirr_mandates = query_telebirr_mandates(phone_number, pending_mandates)
    
    # Identify discrepancies
    discrepancies = identify_discrepancies(all_db_mandates, telebirr_mandates)
    
    # Summary
    print(f"\n{'='*80}")
    print("SUMMARY")
    print(f"{'='*80}")
    print(f"Total database records: {len(all_db_mandates)}")
    print(f"Total Telebirr mandates: {len(telebirr_mandates)}")
    print(f"Discrepancies found: {len(discrepancies)}")
    
    if should_cancel:
        if discrepancies or all_db_mandates:
            print(f"\n⚠️  YOU ARE ABOUT TO CANCEL ALL MANDATES IN DATABASE")
            confirm = input("Type 'yes' to confirm: ").strip().lower()
            if confirm == 'yes':
                cancel_all_db_mandates(phone_number)
            else:
                print("Operation cancelled")
        else:
            print("No mandates to cancel")
    else:
        print("\nTo cancel all database mandates, run with --cancel flag")

if __name__ == '__main__':
    main()
