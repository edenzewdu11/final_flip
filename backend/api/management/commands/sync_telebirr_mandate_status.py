from django.core.management.base import BaseCommand
from api.models_subscription import SubscriptionPlan
from api.services.telebirr_mandate_service import TelebirrMandateService


class Command(BaseCommand):
    help = 'Sync Telebirr mandate status with local database to prevent inconsistencies'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be changed without actually changing anything',
        )
        parser.add_argument(
            '--mandate-id',
            type=str,
            help='Only sync a specific mandate_contract_id',
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry_run', False)
        mandate_id = options.get('mandate_id')

        self.stdout.write('=' * 80)
        self.stdout.write('SYNCING TELEBIRR MANDATE STATUS WITH DATABASE')
        self.stdout.write('=' * 80)

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN MODE - No changes will be made'))

        service = TelebirrMandateService()

        # Get subscriptions to sync
        queryset = SubscriptionPlan.objects.filter(
            mandate_contract_id__isnull=False
        ).exclude(mandate_contract_id='')

        if mandate_id:
            queryset = queryset.filter(mandate_contract_id=mandate_id)
            self.stdout.write(f'Filtering by mandate_contract_id: {mandate_id}')

        total = queryset.count()
        self.stdout.write(f'Total subscriptions to check: {total}')

        if total == 0:
            self.stdout.write(self.style.WARNING('No subscriptions found to sync'))
            return

        updated_count = 0
        error_count = 0

        for sub in queryset:
            self.stdout.write(f'\n--- Subscription ID: {sub.id} ---')
            self.stdout.write(f'User: {sub.user.username if sub.user else "None"}')
            self.stdout.write(f'Phone: {sub.telebirr_phone_number}')
            self.stdout.write(f'Mandate Contract ID: {sub.mandate_contract_id}')
            self.stdout.write(f'DB Status: {sub.mandate_status}')

            try:
                # Query Telebirr for mandate status
                result = service.query_mandate(mandate_contract_id=sub.mandate_contract_id)

                if result.get('result') == 'SUCCESS':
                    biz_content = result.get('biz_content', {})
                    telebirr_status = biz_content.get('status', 'UNKNOWN')
                    self.stdout.write(f'Telebirr Status: {telebirr_status}')

                    # Map Telebirr status to DB status
                    status_map = {
                        'ACTIVE': 'active',
                        'CANCELLED': 'cancelled',
                        'EXPIRED': 'expired',
                        'PENDING': 'pending',
                    }
                    expected_db_status = status_map.get(telebirr_status, telebirr_status.lower())

                    # Check if status matches
                    if sub.mandate_status != expected_db_status:
                        self.stdout.write(
                            self.style.WARNING(
                                f'STATUS MISMATCH: DB={sub.mandate_status}, Telebirr={telebirr_status}'
                            )
                        )

                        if not dry_run:
                            sub.mandate_status = expected_db_status
                            sub.save()
                            self.stdout.write(
                                self.style.SUCCESS(
                                    f'Updated mandate_status to: {expected_db_status}'
                                )
                            )
                            updated_count += 1
                        else:
                            self.stdout.write(
                                self.style.WARNING(
                                    f'Would update mandate_status to: {expected_db_status}'
                                )
                            )
                    else:
                        self.stdout.write(self.style.SUCCESS('Status matches - no action needed'))
                else:
                    error_msg = result.get('msg', result.get('errorMsg', 'Unknown error'))
                    error_code = result.get('code', result.get('errorCode', 'Unknown'))
                    self.stdout.write(
                        self.style.ERROR(
                            f'Telebirr Error: {error_msg} (Code: {error_code})'
                        )
                    )
                    error_count += 1

            except Exception as e:
                self.stdout.write(self.style.ERROR(f'Error checking Telebirr: {e}'))
                error_count += 1

        # Summary
        self.stdout.write('\n' + '=' * 80)
        self.stdout.write('SUMMARY')
        self.stdout.write('=' * 80)
        self.stdout.write(f'Total checked: {total}')
        self.stdout.write(f'Updated: {updated_count}')
        self.stdout.write(f'Errors: {error_count}')

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN - No changes were made'))
        else:
            self.stdout.write(self.style.SUCCESS('Sync completed'))
