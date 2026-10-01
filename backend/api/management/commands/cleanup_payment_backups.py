"""
Django management command to clean up expired payment backup records.

Usage:
    python manage.py cleanup_payment_backups
    python manage.py cleanup_payment_backups --dry-run
    python manage.py cleanup_payment_backups --mandates-only
    python manage.py cleanup_payment_backups --transactions-only
    python manage.py cleanup_payment_backups --older-than 30
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from django.conf import settings
from django.db.models import Q
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Clean up expired payment backup records'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            dest='dry_run',
            help='Show what would be deleted without actually deleting',
        )
        parser.add_argument(
            '--mandates-only',
            action='store_true',
            dest='mandates_only',
            help='Only clean up mandate backups',
        )
        parser.add_argument(
            '--transactions-only',
            action='store_true',
            dest='transactions_only',
            help='Only clean up transaction backups',
        )
        parser.add_argument(
            '--older-than',
            type=int,
            dest='older_than',
            help='Delete records older than X days (overrides default retention)',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            dest='force',
            help='Force deletion without confirmation',
        )

    def handle(self, *args, **options):
        from api.models_payment_backup import PaymentMandateBackup, PaymentTransactionBackup
        
        self.stdout.write(self.style.SUCCESS('Starting payment backup cleanup...'))
        
        # Determine retention days
        if options['older_than']:
            retention_days = options['older_than']
            self.stdout.write(f'Using custom retention: {retention_days} days')
        else:
            retention_days = getattr(settings, 'PAYMENT_BACKUP_RETENTION_DAYS', 15)
            self.stdout.write(f'Using default retention: {retention_days} days')
        
        cutoff_date = timezone.now() - timezone.timedelta(days=retention_days)
        self.stdout.write(f'Deleting records older than: {cutoff_date}')
        
        total_deleted = 0
        
        if not options['transactions_only']:
            # Clean up mandate backups
            mandate_deleted = self.cleanup_backups(
                PaymentMandateBackup, 
                cutoff_date, 
                options['dry_run'], 
                options['force'],
                'mandate'
            )
            total_deleted += mandate_deleted
        
        if not options['mandates_only']:
            # Clean up transaction backups
            transaction_deleted = self.cleanup_backups(
                PaymentTransactionBackup, 
                cutoff_date, 
                options['dry_run'], 
                options['force'],
                'transaction'
            )
            total_deleted += transaction_deleted
        
        if options['dry_run']:
            self.stdout.write(self.style.WARNING(f'DRY RUN: Would delete {total_deleted} records'))
        else:
            self.stdout.write(self.style.SUCCESS(f'Successfully deleted {total_deleted} expired backup records'))

    def cleanup_backups(self, model, cutoff_date, dry_run, force, backup_type):
        """Clean up backups for a specific model."""
        # Find expired records
        expired_queryset = model.objects.filter(expires_at__lt=cutoff_date)
        count = expired_queryset.count()
        
        if count == 0:
            self.stdout.write(f'No expired {backup_type} backups found')
            return 0
        
        self.stdout.write(f'Found {count} expired {backup_type} backup(s)')
        
        if dry_run:
            self.stdout.write(f'Would delete {count} expired {backup_type} backup(s)')
            return count
        
        if not force:
            # Ask for confirmation
            confirm = input(f'Delete {count} expired {backup_type} backup(s)? (yes/no): ')
            if confirm.lower() != 'yes':
                self.stdout.write(self.style.WARNING('Cleanup cancelled'))
                return 0
        
        # Delete expired records
        deleted_count, _ = expired_queryset.delete()
        self.stdout.write(self.style.SUCCESS(f'Deleted {deleted_count} expired {backup_type} backup(s)'))
        
        return deleted_count
