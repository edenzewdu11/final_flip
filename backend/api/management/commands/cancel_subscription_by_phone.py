from django.core.management.base import BaseCommand
from django.utils import timezone
from api.models_subscription import SubscriptionPlan
from api.models_direct_debit import DirectDebitMandate
from api.telebirr_direct_debit_service import TelebirrDirectDebitService


class Command(BaseCommand):
    help = 'Cancel all active subscriptions by phone number'

    def add_arguments(self, parser):
        parser.add_argument('phone_number', type=str, help='Phone number to search (e.g., 0911528271)')

    def handle(self, *args, **options):
        phone_number = options['phone_number']
        
        # Normalize phone number (remove leading 0, add 251 if needed)
        normalized_phone = phone_number
        if phone_number.startswith('0'):
            normalized_phone = '251' + phone_number[1:]
        
        self.stdout.write(f"Searching for subscriptions with phone: {phone_number} (normalized: {normalized_phone})")
        
        # Search for subscriptions by phone number (telebirr_phone_number field)
        subscriptions = SubscriptionPlan.objects.filter(
            telebirr_phone_number__in=[phone_number, normalized_phone]
        )
        
        if not subscriptions.exists():
            self.stdout.write(self.style.WARNING(f"No subscriptions found for phone: {phone_number}"))
            return
        
        self.stdout.write(f"Found {subscriptions.count()} subscription(s):")
        
        for sub in subscriptions:
            self.stdout.write(f"\n{'='*60}")
            self.stdout.write(f"ID: {sub.id}")
            self.stdout.write(f"User: {sub.user.username if sub.user else 'No user'}")
            self.stdout.write(f"Status: {sub.status}")
            self.stdout.write(f"Payment Method: {sub.payment_method}")
            self.stdout.write(f"Tier: {sub.tier.name if sub.tier else 'No tier'}")
            self.stdout.write(f"Mandate Contract ID: {sub.mandate_contract_id or 'N/A'}")
            self.stdout.write(f"MCT Contract No: {sub.mct_contract_no or 'N/A'}")
            self.stdout.write(f"Mandate Status: {sub.mandate_status or 'N/A'}")
            self.stdout.write(f"Start Date: {sub.start_date}")
            self.stdout.write(f"End Date: {sub.end_date}")
            self.stdout.write(f"Created: {sub.created_at}")
        
        # Ask for confirmation
        self.stdout.write(f"\n{'='*60}")
        response = input(f"Cancel {subscriptions.count()} subscription(s)? (yes/no): ")
        
        if response.lower() == 'yes':
            # Initialize Telebirr service
            service = TelebirrDirectDebitService()
            
            cancelled_count = 0
            failed_count = 0
            
            for sub in subscriptions:
                self.stdout.write(f"\nCancelling subscription {sub.id}...")
                
                # Skip if already cancelled
                if sub.status == 'cancelled':
                    self.stdout.write(self.style.WARNING(f"  Skipping - already cancelled"))
                    continue
                
                # If subscription has a mandate_contract_id, cancel via Telebirr
                if sub.mandate_contract_id and sub.mandate_status == 'active':
                    self.stdout.write(f"  Cancelling Telebirr mandate {sub.mandate_contract_id}...")
                    
                    # Find the corresponding DirectDebitMandate
                    mandate = DirectDebitMandate.objects.filter(
                        payer_msisdn__in=[phone_number, normalized_phone],
                        status='active'
                    ).first()
                    
                    if mandate:
                        result = service.cancel_mandate(
                            mandate_id=mandate.mandate_id,
                            payer_msisdn=mandate.payer_msisdn
                        )
                        
                        if result.get('success'):
                            self.stdout.write(self.style.SUCCESS(f"  Successfully cancelled via Telebirr"))
                        else:
                            self.stdout.write(self.style.ERROR(f"  Failed to cancel via Telebirr: {result.get('error')}"))
                            failed_count += 1
                    else:
                        self.stdout.write(self.style.WARNING(f"  No DirectDebitMandate found, cancelling subscription locally only"))
                
                # Cancel the subscription locally
                sub.cancel(reason='Cancelled via management command')
                cancelled_count += 1
                self.stdout.write(self.style.SUCCESS(f"  Subscription cancelled locally"))
            
            self.stdout.write(f"\n{'='*60}")
            self.stdout.write(self.style.SUCCESS(f"Cancelled {cancelled_count} subscription(s)"))
            if failed_count > 0:
                self.stdout.write(self.style.WARNING(f"Failed to cancel {failed_count} mandate(s) via Telebirr (subscriptions cancelled locally)"))
        else:
            self.stdout.write(self.style.WARNING("Cancellation cancelled"))
