from django.core.management.base import BaseCommand
from api.models_subscription import SubscriptionPlan
from api.services.telebirr_mandate_service import TelebirrMandateService


class Command(BaseCommand):
    help = 'Sync mandate_status with Telebirr for a specific phone number'

    def add_arguments(self, parser):
        parser.add_argument(
            '--phone',
            type=str,
            required=True,
            help='Phone number to sync (e.g., 0929989434)',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be changed without actually changing',
        )

    def handle(self, *args, **options):
        phone = options.get('phone')
        dry_run = options.get('dry_run')

        self.stdout.write('=' * 80)
        self.stdout.write('SYNCING MANDATE STATUS WITH TELEBIRR')
        self.stdout.write('=' * 80)
        self.stdout.write(f'Phone: {phone}')
        self.stdout.write(f'Dry run: {dry_run}')
        self.stdout.write('=' * 80)

        # Normalize phone number
        if phone.startswith('0'):
            normalized_phone = '251' + phone[1:]
        else:
            normalized_phone = phone

        # Get subscriptions for this phone
        subscriptions = SubscriptionPlan.objects.filter(
            telebirr_phone_number__in=[phone, normalized_phone],
            mandate_status='active'
        )

        self.stdout.write(f'\nFound {subscriptions.count()} subscriptions with mandate_status=active')

        if not subscriptions:
            self.stdout.write('No subscriptions to sync')
            return

        service = TelebirrMandateService()
        updated_count = 0

        for sub in subscriptions:
            self.stdout.write(f'\n--- Subscription {sub.id} ---')
            self.stdout.write(f'mct_contract_no: {sub.mct_contract_no}')
            self.stdout.write(f'mandate_contract_id: {sub.mandate_contract_id}')
            self.stdout.write(f'Current mandate_status: {sub.mandate_status}')

            if not sub.mct_contract_no:
                self.stdout.write(self.style.WARNING('No mct_contract_no, skipping'))
                continue

            # Query Telebirr
            try:
                result = service.query_mandate(mct_contract_no=sub.mct_contract_no)
                
                if result.get('result') == 'SUCCESS':
                    biz_content = result.get('biz_content', {})
                    telebirr_status = biz_content.get('status') or biz_content.get('mandate_status')
                    self.stdout.write(f'Telebirr status: {telebirr_status}')

                    # Normalize status
                    if telebirr_status and telebirr_status.upper() == 'CANCELLED':
                        telebirr_status = 'cancelled'
                    elif telebirr_status and telebirr_status.upper() == 'ACTIVE':
                        telebirr_status = 'active'

                    # Check if sync needed
                    if telebirr_status and telebirr_status != sub.mandate_status:
                        self.stdout.write(self.style.WARNING(f'Status mismatch! DB: {sub.mandate_status}, Telebirr: {telebirr_status}'))
                        
                        if not dry_run:
                            sub.mandate_status = telebirr_status
                            sub.save(update_fields=['mandate_status'])
                            self.stdout.write(self.style.SUCCESS(f'Updated mandate_status to {telebirr_status}'))
                            updated_count += 1
                        else:
                            self.stdout.write(f'[DRY RUN] Would update mandate_status to {telebirr_status}')
                    else:
                        self.stdout.write('Status already in sync')
                else:
                    error_msg = result.get('msg') or result.get('errorMsg')
                    error_code = result.get('code') or result.get('errorCode')
                    self.stdout.write(self.style.ERROR(f'Telebirr query failed: {error_msg} (code: {error_code})'))
                    
                    # If mandate not found on Telebirr, mark as cancelled
                    if error_code == '60330006' or 'not found' in error_msg.lower():
                        self.stdout.write(self.style.WARNING('Mandate not found on Telebirr, marking as cancelled'))
                        if not dry_run:
                            sub.mandate_status = 'cancelled'
                            sub.save(update_fields=['mandate_status'])
                            self.stdout.write(self.style.SUCCESS('Updated mandate_status to cancelled'))
                            updated_count += 1
                        else:
                            self.stdout.write('[DRY RUN] Would update mandate_status to cancelled')

            except Exception as e:
                self.stdout.write(self.style.ERROR(f'Error querying Telebirr: {e}'))

        self.stdout.write('\n' + '=' * 80)
        self.stdout.write(f'Total subscriptions checked: {subscriptions.count()}')
        self.stdout.write(f'Total updated: {updated_count}')
        self.stdout.write('=' * 80)
