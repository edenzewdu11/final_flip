"""
Django management command to manually backup existing payment data.

Usage:
    python manage.py backup_payment_data --all
    python manage.py backup_payment_data --telebirr-superapp
    python manage.py backup_payment_data --telebirr-direct-debit
    python manage.py backup_payment_data --onevas
    python manage.py backup_payment_data --model PendingTelebirrMandate
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from django.conf import settings
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Manually backup existing payment data to backup tables'

    def add_arguments(self, parser):
        parser.add_argument(
            '--all',
            action='store_true',
            dest='all',
            help='Backup all payment data from all systems',
        )
        parser.add_argument(
            '--telebirr-superapp',
            action='store_true',
            dest='telebirr_superapp',
            help='Backup Telebirr SuperApp data only',
        )
        parser.add_argument(
            '--telebirr-direct-debit',
            action='store_true',
            dest='telebirr_direct_debit',
            help='Backup Telebirr Direct Debit data only',
        )
        parser.add_argument(
            '--onevas',
            action='store_true',
            dest='onevas',
            help='Backup Onevas data only',
        )
        parser.add_argument(
            '--model',
            type=str,
            dest='model',
            help='Backup specific model (e.g., PendingTelebirrMandate, DirectDebitMandate)',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            dest='dry_run',
            help='Show what would be backed up without actually doing it',
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('Starting payment data backup...'))
        
        retention_days = getattr(settings, 'PAYMENT_BACKUP_RETENTION_DAYS', 15)
        self.stdout.write(f'Retention period: {retention_days} days')
        
        total_backed_up = 0
        
        if options['model']:
            # Backup specific model
            model_name = options['model']
            total_backed_up += self.backup_model(model_name, options['dry_run'])
        elif options['telebirr_superapp']:
            # Backup Telebirr SuperApp
            total_backed_up += self.backup_model('PendingTelebirrMandate', options['dry_run'])
            total_backed_up += self.backup_subscription_plans('telebirr', options['dry_run'])
        elif options['telebirr_direct_debit']:
            # Backup Telebirr Direct Debit
            total_backed_up += self.backup_model('DirectDebitMandate', options['dry_run'])
            total_backed_up += self.backup_model('DirectDebitTransaction', options['dry_run'])
        elif options['onevas']:
            # Backup Onevas
            total_backed_up += self.backup_model('OnevasChargingTransaction', options['dry_run'])
            total_backed_up += self.backup_model('OnevasWebhookLog', options['dry_run'])
            total_backed_up += self.backup_subscription_plans('onevas', options['dry_run'])
        elif options['all']:
            # Backup everything
            self.stdout.write('Backing up all payment data...')
            total_backed_up += self.backup_model('PendingTelebirrMandate', options['dry_run'])
            total_backed_up += self.backup_model('DirectDebitMandate', options['dry_run'])
            total_backed_up += self.backup_model('DirectDebitTransaction', options['dry_run'])
            total_backed_up += self.backup_model('OnevasChargingTransaction', options['dry_run'])
            total_backed_up += self.backup_model('OnevasWebhookLog', options['dry_run'])
            total_backed_up += self.backup_subscription_plans('telebirr', options['dry_run'])
            total_backed_up += self.backup_subscription_plans('onevas', options['dry_run'])
        else:
            self.stdout.write(self.style.WARNING('No backup option specified. Use --help for options.'))
            return
        
        if options['dry_run']:
            self.stdout.write(self.style.WARNING(f'DRY RUN: Would backup {total_backed_up} records'))
        else:
            self.stdout.write(self.style.SUCCESS(f'Successfully backed up {total_backed_up} records'))

    def backup_model(self, model_name, dry_run=False):
        """Backup a specific model."""
        from api.models_payment_backup import PaymentMandateBackup, PaymentTransactionBackup
        
        try:
            # Import the model dynamically
            if model_name == 'PendingTelebirrMandate':
                from api.models_subscription import PendingTelebirrMandate as Model
                backup_model = PaymentMandateBackup
                payment_system = 'telebirr_superapp'
            elif model_name == 'DirectDebitMandate':
                from api.models_direct_debit import DirectDebitMandate as Model
                backup_model = PaymentMandateBackup
                payment_system = 'telebirr_direct_debit'
            elif model_name == 'DirectDebitTransaction':
                from api.models_direct_debit import DirectDebitTransaction as Model
                backup_model = PaymentTransactionBackup
                payment_system = 'telebirr_direct_debit'
            elif model_name == 'OnevasChargingTransaction':
                from api.models_subscription import OnevasChargingTransaction as Model
                backup_model = PaymentTransactionBackup
                payment_system = 'onevas'
            elif model_name == 'OnevasWebhookLog':
                from api.models_subscription import OnevasWebhookLog as Model
                backup_model = PaymentTransactionBackup
                payment_system = 'onevas'
            else:
                self.stdout.write(self.style.ERROR(f'Unknown model: {model_name}'))
                return 0
            
            queryset = Model.objects.all()
            count = queryset.count()
            
            if dry_run:
                self.stdout.write(f'Would backup {count} records from {model_name}')
                return count
            
            self.stdout.write(f'Backing up {count} records from {model_name}...')
            
            backed_up = 0
            for instance in queryset:
                try:
                    # Trigger the signal manually by calling the signal handler
                    # This ensures consistency with automatic backups
                    if model_name == 'PendingTelebirrMandate':
                        from api.signals_payment_backup import backup_pending_telebirr_mandate
                        backup_pending_telebirr_mandate(Model, instance, created=False)
                    elif model_name == 'DirectDebitMandate':
                        from api.signals_payment_backup import backup_direct_debit_mandate
                        backup_direct_debit_mandate(Model, instance, created=False)
                    elif model_name == 'DirectDebitTransaction':
                        from api.signals_payment_backup import backup_direct_debit_transaction
                        backup_direct_debit_transaction(Model, instance, created=False)
                    elif model_name == 'OnevasChargingTransaction':
                        from api.signals_payment_backup import backup_onevas_charging_transaction
                        backup_onevas_charging_transaction(Model, instance, created=False)
                    elif model_name == 'OnevasWebhookLog':
                        from api.signals_payment_backup import backup_onevas_webhook_log
                        backup_onevas_webhook_log(Model, instance, created=False)
                    
                    backed_up += 1
                    if backed_up % 100 == 0:
                        self.stdout.write(f'  Progress: {backed_up}/{count}')
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f'Failed to backup {model_name} {instance.id}: {e}'))
            
            self.stdout.write(self.style.SUCCESS(f'Backed up {backed_up}/{count} records from {model_name}'))
            return backed_up
            
        except ImportError as e:
            self.stdout.write(self.style.ERROR(f'Failed to import model {model_name}: {e}'))
            return 0

    def backup_subscription_plans(self, payment_method, dry_run=False):
        """Backup SubscriptionPlans with specific payment method."""
        from api.models_subscription import SubscriptionPlan
        from api.models_payment_backup import PaymentMandateBackup
        
        queryset = SubscriptionPlan.objects.filter(payment_method=payment_method)
        count = queryset.count()
        
        if dry_run:
            self.stdout.write(f'Would backup {count} SubscriptionPlan records with payment_method={payment_method}')
            return count
        
        self.stdout.write(f'Backing up {count} SubscriptionPlan records with payment_method={payment_method}...')
        
        backed_up = 0
        for instance in queryset:
            try:
                from api.signals_payment_backup import backup_subscription_plan
                backup_subscription_plan(SubscriptionPlan, instance, created=False)
                backed_up += 1
                if backed_up % 100 == 0:
                    self.stdout.write(f'  Progress: {backed_up}/{count}')
            except Exception as e:
                self.stdout.write(self.style.ERROR(f'Failed to backup SubscriptionPlan {instance.id}: {e}'))
        
        self.stdout.write(self.style.SUCCESS(f'Backed up {backed_up}/{count} SubscriptionPlan records'))
        return backed_up
