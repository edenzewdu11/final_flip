from django.core.management.base import BaseCommand
from django.db import transaction
from django.contrib.auth.models import User
from api.models import UserProfile
from api.models_subscription import SubscriptionPlan, PendingTelebirrMandate
from api.services.telebirr_mandate_service import TelebirrMandateService


class Command(BaseCommand):
    help = 'Fully cleanse all data for a phone number from DB and Telebirr (DESTRUCTIVE)'

    def add_arguments(self, parser):
        parser.add_argument('phone_number', type=str, help='Phone number to cleanse (e.g., 0929989434)')
        parser.add_argument('--force', action='store_true', help='Skip confirmation prompt')

    def handle(self, *args, **options):
        phone_number = options['phone_number']
        force = options['force']

        # Build all phone number variants
        phone_variants = set()
        phone_variants.add(phone_number)
        phone_variants.add(phone_number.replace('+', '').strip())
        if phone_number.startswith('0'):
            phone_variants.add('251' + phone_number[1:])
            phone_variants.add('+251' + phone_number[1:])
        elif phone_number.startswith('251'):
            phone_variants.add('0' + phone_number[3:])
            phone_variants.add('+251' + phone_number[3:])
        elif phone_number.startswith('+251'):
            phone_variants.add('0' + phone_number[4:])
            phone_variants.add('251' + phone_number[4:])

        self.stdout.write('=' * 80)
        self.stdout.write(f'CLEANSE PHONE: {phone_number}')
        self.stdout.write(f'Phone variants: {sorted(phone_variants)}')
        self.stdout.write('=' * 80)

        # Find user by phone
        user = None
        try:
            profile = UserProfile.objects.filter(phone_number__in=phone_variants).first()
            if profile:
                user = profile.user
                self.stdout.write(f'Found user: {user.username} (ID: {user.id})')
        except Exception as e:
            self.stdout.write(self.style.WARNING(f'Could not find user by phone: {e}'))

        # Find all SubscriptionPlan records
        subscriptions = SubscriptionPlan.objects.filter(
            telebirr_phone_number__in=phone_variants
        ) | SubscriptionPlan.objects.filter(
            onevas_phone_number__in=phone_variants
        )
        self.stdout.write(f'\nFound {subscriptions.count()} subscription record(s)')
        for sub in subscriptions:
            self.stdout.write(f'  - ID: {sub.id}, user: {sub.user.username if sub.user else "None"}, '
                            f'status: {sub.status}, payment: {sub.payment_method}, '
                            f'mandate_id: {sub.mandate_contract_id}')

        # Find all PendingTelebirrMandate records
        pending_mandates = PendingTelebirrMandate.objects.filter(
            phone_number__in=phone_variants
        )
        self.stdout.write(f'\nFound {pending_mandates.count()} pending mandate record(s)')
        for pm in pending_mandates:
            self.stdout.write(f'  - mct: {pm.mct_contract_no}, status: {pm.status}, '
                            f'mandate_id: {pm.mandate_contract_id}')

        # Collect all mandate_contract_ids to cancel on Telebirr
        mandate_ids_to_cancel = set()
        for sub in subscriptions:
            if sub.mandate_contract_id:
                mandate_ids_to_cancel.add(sub.mandate_contract_id)
        for pm in pending_mandates:
            if pm.mandate_contract_id:
                mandate_ids_to_cancel.add(pm.mandate_contract_id)

        self.stdout.write(f'\n{len(mandate_ids_to_cancel)} unique mandate(s) to cancel on Telebirr')
        for mid in mandate_ids_to_cancel:
            self.stdout.write(f'  - {mid}')

        # Summary
        self.stdout.write('\n' + '=' * 80)
        self.stdout.write('SUMMARY OF DELETIONS:')
        self.stdout.write(f'  - User: {user.username if user else "None"}')
        self.stdout.write(f'  - Subscription records: {subscriptions.count()}')
        self.stdout.write(f'  - Pending mandate records: {pending_mandates.count()}')
        self.stdout.write(f'  - Telebirr mandates to cancel: {len(mandate_ids_to_cancel)}')
        self.stdout.write('=' * 80)

        # Confirmation
        if not force:
            response = input('\nPROCEED WITH FULL CLEANSE? This is DESTRUCTIVE. Type "yes" to confirm: ')
            if response.lower() != 'yes':
                self.stdout.write(self.style.WARNING('Cleanse cancelled'))
                return

        # Execute cleanse
        self.stdout.write('\nExecuting cleanse...')

        # 1. Cancel Telebirr mandates
        cancelled_count = 0
        failed_cancel_count = 0
        if mandate_ids_to_cancel:
            mandate_service = TelebirrMandateService()
            initiator = phone_number.replace('+', '').strip()
            if initiator.startswith('0'):
                initiator = '251' + initiator[1:]

            for mid in mandate_ids_to_cancel:
                self.stdout.write(f'  Cancelling mandate {mid} on Telebirr...')
                try:
                    result = mandate_service.cancel_mandate(
                        mandate_contract_id=mid,
                        initiator_phone=initiator,
                        reason='Account cleanse - full deletion'
                    )
                    if result.get('result') == 'SUCCESS':
                        self.stdout.write(self.style.SUCCESS(f'    Cancelled successfully'))
                        cancelled_count += 1
                    else:
                        self.stdout.write(self.style.WARNING(f'    Cancel failed: {result.get("msg", "Unknown")}'))
                        failed_cancel_count += 1
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f'    Cancel error: {e}'))
                    failed_cancel_count += 1

        # 2. Delete all records in a transaction
        with transaction.atomic():
            # Delete pending mandates
            pm_deleted = pending_mandates.delete()[0]
            self.stdout.write(f'  Deleted {pm_deleted} pending mandate record(s)')

            # Delete subscriptions
            sub_deleted = subscriptions.delete()[0]
            self.stdout.write(f'  Deleted {sub_deleted} subscription record(s)')

            # Delete user and profile using raw SQL to bypass cascade issues
            if user:
                user_id = user.id
                username = user.username
                try:
                    from django.db import connection
                    with connection.cursor() as cursor:
                        # Delete profile first
                        cursor.execute('DELETE FROM api_userprofile WHERE user_id = %s', [user_id])
                        # Delete user
                        cursor.execute('DELETE FROM auth_user WHERE id = %s', [user_id])
                    self.stdout.write(f'  Deleted user {username} (ID: {user_id}) via raw SQL')
                except Exception as e:
                    self.stdout.write(self.style.WARNING(f'  Failed to delete user {username} (ID: {user_id}): {e}'))
                    self.stdout.write(self.style.WARNING('  User deletion failed, but other records were deleted'))

        # Final report
        self.stdout.write('\n' + '=' * 80)
        self.stdout.write(self.style.SUCCESS('CLEANSE COMPLETE'))
        self.stdout.write(f'  Telebirr mandates cancelled: {cancelled_count}')
        if failed_cancel_count > 0:
            self.stdout.write(self.style.WARNING(f'  Telebirr cancel failures: {failed_cancel_count}'))
        self.stdout.write(f'  DB records deleted: {pm_deleted + sub_deleted + (1 if user else 0)}')
        self.stdout.write('=' * 80)
