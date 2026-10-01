"""
Payment System Backup Models

Archives all payment mandate/subscription data from Telebirr Super App,
Telebirr Direct Debit, and Onevas with automatic cleanup after retention period.
"""
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from django.conf import settings
import uuid


# WHY: Read-only archival snapshot of mandate/subscription records from all payment systems
# (Telebirr SuperApp, Telebirr Direct Debit, Onevas) for emergency recovery/audit; auto-
# deleted after PAYMENT_BACKUP_RETENTION_DAYS.
# RELATES TO: User. Logically mirrors PendingTelebirrMandate, SubscriptionPlan,
# DirectDebitMandate, OnevasChargingTransaction (via source_model/source_id, not FK).
class PaymentMandateBackup(models.Model):
    """
    Archives payment mandate/subscription data from all payment systems.
    
    This is a read-only archival table for emergency recovery and audit purposes.
    Records are automatically deleted after PAYMENT_BACKUP_RETENTION_DAYS.
    """
    
    PAYMENT_SYSTEM_CHOICES = [
        ('telebirr_superapp', 'Telebirr SuperApp'),
        ('telebirr_direct_debit', 'Telebirr Direct Debit'),
        ('onevas', 'Onevas'),
    ]
    
    SOURCE_MODEL_CHOICES = [
        ('PendingTelebirrMandate', 'Pending Telebirr Mandate'),
        ('SubscriptionPlan', 'Subscription Plan'),
        ('DirectDebitMandate', 'Direct Debit Mandate'),
        ('OnevasChargingTransaction', 'Onevas Charging Transaction'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Source tracking
    payment_system = models.CharField(max_length=30, choices=PAYMENT_SYSTEM_CHOICES, db_index=True)
    source_model = models.CharField(max_length=50, choices=SOURCE_MODEL_CHOICES, db_index=True)
    source_id = models.UUIDField(db_index=True, help_text='Original record ID')
    
    # User info
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='payment_mandate_backups', db_index=True)
    phone_number = models.CharField(max_length=20, blank=True, null=True, db_index=True)
    account_name = models.CharField(max_length=100, blank=True, null=True)
    
    # Telebirr SuperApp identifiers
    mandate_contract_id = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    mct_contract_no = models.CharField(max_length=32, blank=True, null=True, db_index=True)
    
    # Telebirr Direct Debit identifiers
    mandate_id = models.CharField(max_length=18, blank=True, null=True, db_index=True)
    payer_reference_number = models.CharField(max_length=100, blank=True, null=True)
    
    # Onevas identifiers
    onevas_subscription_id = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    onevas_transaction_id = models.CharField(max_length=100, blank=True, null=True)
    onevas_phone_number = models.CharField(max_length=20, blank=True, null=True)
    
    # Plan/subscription info
    plan_type = models.CharField(max_length=20, blank=True, null=True, help_text='daily/weekly/monthly')
    tier_id = models.UUIDField(null=True, blank=True)
    subscription_plan_id = models.UUIDField(null=True, blank=True, db_index=True)
    
    # Mandate details
    mandate_template_id = models.CharField(max_length=20, blank=True, null=True)
    mandate_status = models.CharField(max_length=20, blank=True, null=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    payment_type = models.CharField(max_length=20, blank=True, null=True)
    frequency = models.CharField(max_length=2, blank=True, null=True)
    
    # Telebirr tracking
    prepay_id = models.CharField(max_length=100, blank=True, null=True)
    merch_order_id = models.CharField(max_length=64, blank=True, null=True)
    originator_conversation_id = models.CharField(max_length=100, blank=True, null=True)
    conversation_id = models.CharField(max_length=100, blank=True, null=True)
    
    # Onevas tracking
    product_number = models.CharField(max_length=50, blank=True, null=True)
    application_key = models.CharField(max_length=100, blank=True, null=True)
    
    # Status
    original_status = models.CharField(max_length=50, blank=True, null=True)
    
    # Full data snapshot
    full_snapshot = models.JSONField(default=dict, blank=True, help_text='Complete original record data')
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    expires_at = models.DateTimeField(db_index=True, help_text='When this backup record should be deleted')
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['payment_system', '-created_at']),
            models.Index(fields=['source_model', 'source_id']),
            models.Index(fields=['expires_at']),
        ]
        verbose_name = 'Payment Mandate Backup'
        verbose_name_plural = 'Payment Mandate Backups'
    
    def __str__(self):
        return f"{self.payment_system} - {self.source_model} - {self.phone_number or 'No Phone'}"
    
    def save(self, *args, **kwargs):
        # Set expires_at if not provided
        if not self.expires_at:
            retention_days = getattr(settings, 'PAYMENT_BACKUP_RETENTION_DAYS', 15)
            self.expires_at = timezone.now() + timezone.timedelta(days=retention_days)
        super().save(*args, **kwargs)
    
    def is_expired(self):
        """Check if this backup record has expired"""
        return timezone.now() > self.expires_at


# WHY: Read-only archival snapshot of individual payment transactions from all payment
# systems, for emergency recovery/audit; auto-deleted after PAYMENT_BACKUP_RETENTION_DAYS.
# RELATES TO: User. Logically mirrors DirectDebitTransaction, OnevasChargingTransaction,
# SubscriptionPayment (via source_model/source_id, not FK).
class PaymentTransactionBackup(models.Model):
    """
    Archives payment transaction data from all payment systems.
    
    This is a read-only archival table for emergency recovery and audit purposes.
    Records are automatically deleted after PAYMENT_BACKUP_RETENTION_DAYS.
    """
    
    PAYMENT_SYSTEM_CHOICES = [
        ('telebirr_direct_debit', 'Telebirr Direct Debit'),
        ('onevas', 'Onevas'),
        ('telebirr_superapp', 'Telebirr SuperApp'),
    ]
    
    SOURCE_MODEL_CHOICES = [
        ('DirectDebitTransaction', 'Direct Debit Transaction'),
        ('OnevasChargingTransaction', 'Onevas Charging Transaction'),
        ('SubscriptionPayment', 'Subscription Payment'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Source tracking
    payment_system = models.CharField(max_length=30, choices=PAYMENT_SYSTEM_CHOICES, db_index=True)
    source_model = models.CharField(max_length=50, choices=SOURCE_MODEL_CHOICES, db_index=True)
    source_id = models.UUIDField(db_index=True, help_text='Original record ID')
    
    # User info
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='payment_transaction_backups', db_index=True)
    phone_number = models.CharField(max_length=20, blank=True, null=True, db_index=True)
    
    # Transaction details
    transaction_id = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3, default='ETB')
    status = models.CharField(max_length=20, blank=True, null=True)
    
    # Mandate reference
    mandate_id = models.CharField(max_length=100, blank=True, null=True)
    mandate_contract_id = models.CharField(max_length=100, blank=True, null=True)
    mct_contract_no = models.CharField(max_length=32, blank=True, null=True)
    
    # Subscription reference
    subscription_id = models.UUIDField(null=True, blank=True)
    subscription_payment_id = models.UUIDField(null=True, blank=True)
    
    # Telebirr tracking
    telebirr_transaction_id = models.CharField(max_length=100, blank=True, null=True)
    originator_conversation_id = models.CharField(max_length=100, blank=True, null=True)
    conversation_id = models.CharField(max_length=100, blank=True, null=True)
    
    # Onevas tracking
    onevas_transaction_id = models.CharField(max_length=100, blank=True, null=True)
    product_number = models.CharField(max_length=50, blank=True, null=True)
    
    # Additional data
    error_message = models.TextField(blank=True, null=True)
    retry_count = models.IntegerField(default=0)
    
    # Full data snapshot
    full_snapshot = models.JSONField(default=dict, blank=True, help_text='Complete original record data')
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    expires_at = models.DateTimeField(db_index=True, help_text='When this backup record should be deleted')
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['payment_system', '-created_at']),
            models.Index(fields=['source_model', 'source_id']),
            models.Index(fields=['expires_at']),
            models.Index(fields=['status', '-created_at']),
        ]
        verbose_name = 'Payment Transaction Backup'
        verbose_name_plural = 'Payment Transaction Backups'
    
    def __str__(self):
        return f"{self.payment_system} - {self.amount} {self.currency} - {self.status or 'No Status'}"
    
    def save(self, *args, **kwargs):
        # Set expires_at if not provided
        if not self.expires_at:
            retention_days = getattr(settings, 'PAYMENT_BACKUP_RETENTION_DAYS', 15)
            self.expires_at = timezone.now() + timezone.timedelta(days=retention_days)
        super().save(*args, **kwargs)
    
    def is_expired(self):
        """Check if this backup record has expired"""
        return timezone.now() > self.expires_at
