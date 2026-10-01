"""
Models for CRM Gift Integration
Tracks gift packages awarded via Ethio Telecom CRM
"""

from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


# WHY: Maps internal gift packages to Ethio Telecom CRM OfferingIds so admins can configure
# what data/service package a trigger (campaign win, etc.) awards.
# RELATES TO: Reverse-referenced by CRMGiftTransaction.
class CRMGiftPackage(models.Model):
    """Configuration for CRM gift packages (OfferingId mappings)"""
    
    name = models.CharField(max_length=200, help_text="Package name (e.g., '1GB Data Package')")
    offering_id = models.CharField(max_length=50, unique=True, help_text="CRM OfferingId from Ethio Telecom")
    description = models.TextField(blank=True, help_text="Package description")
    
    # Pricing
    charge_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Amount in ETB to charge for this package"
    )
    
    # Eligibility
    min_level = models.IntegerField(default=1, help_text="Minimum user level required")
    min_coins = models.IntegerField(default=0, help_text="Minimum coins required to claim")
    
    # Gamification trigger
    trigger_condition = models.CharField(
        max_length=50,
        choices=[
            ('campaign_win', 'Campaign Win'),
            ('contest_win', 'Contest Win'),
            ('leaderboard_top', 'Leaderboard Top Position'),
            ('manual', 'Manual Award'),
        ],
        default='manual',
        help_text="When this package is awarded"
    )
    
    # Status
    is_active = models.BooleanField(default=True, help_text="Whether this package is available")
    max_awards_per_user = models.IntegerField(
        default=1,
        help_text="Maximum times a user can receive this package (0 = unlimited)"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['name']
        indexes = [
            models.Index(fields=['offering_id']),
            models.Index(fields=['is_active']),
            models.Index(fields=['trigger_condition']),
        ]
    
    def __str__(self):
        return f"{self.name} (OfferingId: {self.offering_id})"


# WHY: Records each attempt to award a CRM gift package to a user via Ethio Telecom's
# PresentServiceGift API, tracking success/failure and CRM response codes.
# RELATES TO: User, CRMGiftPackage. Reverse-referenced by CRMGiftAuditLog.
class CRMGiftTransaction(models.Model):
    """Records when a CRM gift package is awarded to a user"""
    
    # User information
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='crm_gifts')
    phone_number = models.CharField(max_length=20, help_text="Phone number sent to CRM")
    
    # Package information
    package = models.ForeignKey(CRMGiftPackage, on_delete=models.PROTECT, related_name='transactions')
    offering_id = models.CharField(max_length=50, help_text="CRM OfferingId used")
    
    # Transaction details
    transaction_id = models.CharField(max_length=50, unique=True, help_text="CRM TransactionId")
    charge_amount = models.DecimalField(max_digits=10, decimal_places=2, help_text="Amount charged in ETB")
    
    # Status
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('success', 'Success'),
        ('failed', 'Failed'),
        ('timeout', 'Timeout'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    response_message = models.TextField(blank=True, help_text="CRM response message")
    response_code = models.CharField(max_length=10, blank=True, help_text="CRM RetCode")
    
    # Context
    trigger_source = models.CharField(
        max_length=50,
        blank=True,
        help_text="What triggered this gift (e.g., 'campaign_123', 'manual_admin')"
    )
    campaign_id = models.IntegerField(null=True, blank=True, help_text="Related campaign ID if applicable")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True, help_text="When CRM request completed")
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['transaction_id']),
            models.Index(fields=['status']),
            models.Index(fields=['phone_number']),
            models.Index(fields=['offering_id']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.package.name} ({self.status})"
    
    def mark_success(self, response_code, response_message):
        """Mark transaction as successful"""
        self.status = 'success'
        self.response_code = response_code
        self.response_message = response_message
        self.completed_at = timezone.now()
        self.save()
    
    def mark_failed(self, response_code, response_message):
        """Mark transaction as failed"""
        self.status = 'failed'
        self.response_code = response_code
        self.response_message = response_message
        self.completed_at = timezone.now()
        self.save()


# WHY: Audit trail of actions (award/retry/cancel/manual override) performed on a
# CRMGiftTransaction, including who performed them.
# RELATES TO: CRMGiftTransaction, User (performed_by).
class CRMGiftAuditLog(models.Model):
    """Audit log for all CRM gift operations"""
    
    ACTION_CHOICES = [
        ('award', 'Award Package'),
        ('retry', 'Retry Failed'),
        ('cancel', 'Cancel'),
        ('manual', 'Manual Override'),
    ]
    
    transaction = models.ForeignKey(CRMGiftTransaction, on_delete=models.CASCADE, related_name='audit_logs')
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    performed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='crm_audit_actions')
    details = models.TextField(blank=True, help_text="Additional details about the action")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['transaction', '-created_at']),
            models.Index(fields=['action']),
        ]
    
    def __str__(self):
        return f"{self.action} - {self.transaction.transaction_id}"
