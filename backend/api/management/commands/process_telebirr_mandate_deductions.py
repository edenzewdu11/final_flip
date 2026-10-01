from django.core.management.base import BaseCommand
from django.utils import timezone
from django.conf import settings
from django.db import models
from api.models_subscription import SubscriptionPlan, SubscriptionTier
from api.services.telebirr_mandate_service import telebirr_mandate_service
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Process Telebirr mandate deductions for due subscriptions (daily/weekly/monthly)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Run without actually processing deductions (for testing)',
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry_run', False)
        
        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN MODE - No actual deductions will be processed'))
        
        now = timezone.now()
        
        # Find active Telebirr mandate subscriptions that are due for renewal
        # Subscriptions are due if:
        # - They have auto_renew enabled
        # - They have a valid mandate (mct_contract_no and mandate_contract_id)
        # - Their next_renewal_date is in the past or null (for first-time processing)
        # - Their status is active
        
        due_subscriptions = SubscriptionPlan.objects.filter(
            payment_method='telebirr',
            status='active',
            auto_renew=True,
            mandate_contract_id__isnull=False,
            mct_contract_no__isnull=False,
        ).filter(
            # Either no next_renewal_date set (first time) or next_renewal_date has passed
            models.Q(next_renewal_date__isnull=True) | models.Q(next_renewal_date__lte=now)
        )
        
        self.stdout.write(f'Found {due_subscriptions.count()} subscriptions due for renewal')
        
        processed_count = 0
        success_count = 0
        failed_count = 0
        
        for subscription in due_subscriptions:
            try:
                self.stdout.write(f'\nProcessing subscription {subscription.id} for user {subscription.user.username}')
                
                # Get the tier to determine amount
                tier = subscription.tier
                if not tier:
                    self.stdout.write(self.style.ERROR(f'  No tier found for subscription {subscription.id}'))
                    failed_count += 1
                    continue
                
                # Calculate amount in cents (Telebirr expects integer)
                amount_cents = int(tier.price_etb * 100)
                
                # Determine if this is the first deduction or a renewal
                is_first_deduction = subscription.next_renewal_date is None
                
                if dry_run:
                    self.stdout.write(f'  [DRY RUN] Would deduct {tier.price_etb} ETB for {tier.name} plan')
                    processed_count += 1
                    continue
                
                # Call disburse API
                result = telebirr_mandate_service.create_disburse_order(
                    mct_contract_no=subscription.mct_contract_no,
                    amount=amount_cents,
                    title=f'{tier.name} subscription renewal',
                )
                
                if result.get('result') == 'SUCCESS':
                    # Update subscription dates
                    if is_first_deduction:
                        # First deduction - set initial end_date and next_renewal_date
                        subscription.start_date = now
                        if tier.duration_days:
                            subscription.end_date = now + timezone.timedelta(days=tier.duration_days)
                            subscription.next_renewal_date = now + timezone.timedelta(days=tier.duration_days)
                    else:
                        # Renewal - extend end_date and next_renewal_date
                        if tier.duration_days:
                            subscription.end_date = now + timezone.timedelta(days=tier.duration_days)
                            subscription.next_renewal_date = now + timezone.timedelta(days=tier.duration_days)
                    
                    subscription.save()
                    
                    self.stdout.write(self.style.SUCCESS(f'  SUCCESS: Deducted {tier.price_etb} ETB'))
                    success_count += 1
                else:
                    self.stdout.write(self.style.ERROR(f'  FAILED: {result.get("msg", "Unknown error")}'))
                    failed_count += 1
                
                processed_count += 1
                
            except Exception as e:
                logger.error(f'Error processing subscription {subscription.id}: {e}')
                self.stdout.write(self.style.ERROR(f'  ERROR: {str(e)}'))
                failed_count += 1
                processed_count += 1
        
        self.stdout.write(f'\n--- Summary ---')
        self.stdout.write(f'Total processed: {processed_count}')
        self.stdout.write(self.style.SUCCESS(f'Success: {success_count}'))
        self.stdout.write(self.style.ERROR(f'Failed: {failed_count}'))
        
        if dry_run:
            self.stdout.write(self.style.WARNING('(Dry run - no actual deductions made)'))
