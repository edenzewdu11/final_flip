"""
Django admin interface for payment backup models.
"""
from django.contrib import admin
from django.utils.html import format_html
from django.utils.timezone import now
from .models_payment_backup import PaymentMandateBackup, PaymentTransactionBackup


@admin.register(PaymentMandateBackup)
class PaymentMandateBackupAdmin(admin.ModelAdmin):
    """Admin interface for PaymentMandateBackup."""
    
    list_display = [
        'id', 'payment_system', 'source_model', 'phone_number', 
        'mandate_contract_id', 'mct_contract_no', 'mandate_id',
        'original_status', 'created_at', 'expires_at', 'is_expired_display'
    ]
    list_filter = [
        'payment_system', 'source_model', 'mandate_status', 
        'plan_type', 'created_at', 'expires_at'
    ]
    search_fields = [
        'phone_number', 'mandate_contract_id', 'mct_contract_no', 
        'mandate_id', 'user__username', 'onevas_subscription_id'
    ]
    readonly_fields = [
        'id', 'payment_system', 'source_model', 'source_id', 
        'created_at', 'expires_at', 'is_expired_display', 'full_snapshot'
    ]
    fieldsets = (
        ('Source Information', {
            'fields': ('payment_system', 'source_model', 'source_id')
        }),
        ('User Information', {
            'fields': ('user', 'phone_number', 'account_name')
        }),
        ('Telebirr SuperApp Identifiers', {
            'fields': ('mandate_contract_id', 'mct_contract_no', 'prepay_id', 'merch_order_id')
        }),
        ('Telebirr Direct Debit Identifiers', {
            'fields': ('mandate_id', 'payer_reference_number')
        }),
        ('Onevas Identifiers', {
            'fields': ('onevas_subscription_id', 'onevas_transaction_id', 'onevas_phone_number', 'product_number', 'application_key')
        }),
        ('Plan Information', {
            'fields': ('plan_type', 'tier_id', 'subscription_plan_id')
        }),
        ('Mandate Details', {
            'fields': ('mandate_template_id', 'mandate_status', 'amount', 'payment_type', 'frequency')
        }),
        ('Telebirr Tracking', {
            'fields': ('originator_conversation_id', 'conversation_id')
        }),
        ('Status', {
            'fields': ('original_status', 'created_at', 'expires_at', 'is_expired_display')
        }),
        ('Full Snapshot', {
            'fields': ('full_snapshot',),
            'classes': ('collapse',)
        }),
    )
    date_hierarchy = 'created_at'
    ordering = ['-created_at']
    
    def is_expired_display(self, obj):
        """Display whether the backup has expired."""
        if obj.is_expired():
            return format_html('<span style="color: red;">Expired</span>')
        return format_html('<span style="color: green;">Active</span>')
    is_expired_display.short_description = 'Status'
    
    def has_add_permission(self, request):
        """Disable adding backups manually (they should be created via signals)."""
        return False
    
    def has_change_permission(self, request, obj=None):
        """Disable editing backups (they should be read-only)."""
        return False
    
    def has_delete_permission(self, request, obj=None):
        """Allow deletion of expired backups."""
        if obj and obj.is_expired():
            return True
        return False


@admin.register(PaymentTransactionBackup)
class PaymentTransactionBackupAdmin(admin.ModelAdmin):
    """Admin interface for PaymentTransactionBackup."""
    
    list_display = [
        'id', 'payment_system', 'source_model', 'phone_number',
        'transaction_id', 'amount', 'currency', 'status',
        'created_at', 'expires_at', 'is_expired_display'
    ]
    list_filter = [
        'payment_system', 'source_model', 'status', 
        'currency', 'created_at', 'expires_at'
    ]
    search_fields = [
        'phone_number', 'transaction_id', 'telebirr_transaction_id',
        'onevas_transaction_id', 'user__username'
    ]
    readonly_fields = [
        'id', 'payment_system', 'source_model', 'source_id',
        'created_at', 'expires_at', 'is_expired_display', 'full_snapshot'
    ]
    fieldsets = (
        ('Source Information', {
            'fields': ('payment_system', 'source_model', 'source_id')
        }),
        ('User Information', {
            'fields': ('user', 'phone_number')
        }),
        ('Transaction Details', {
            'fields': ('transaction_id', 'amount', 'currency', 'status')
        }),
        ('Mandate Reference', {
            'fields': ('mandate_id', 'mandate_contract_id', 'mct_contract_no')
        }),
        ('Subscription Reference', {
            'fields': ('subscription_id', 'subscription_payment_id')
        }),
        ('Telebirr Tracking', {
            'fields': ('telebirr_transaction_id', 'originator_conversation_id', 'conversation_id')
        }),
        ('Onevas Tracking', {
            'fields': ('onevas_transaction_id', 'product_number')
        }),
        ('Additional Information', {
            'fields': ('error_message', 'retry_count')
        }),
        ('Status', {
            'fields': ('created_at', 'expires_at', 'is_expired_display')
        }),
        ('Full Snapshot', {
            'fields': ('full_snapshot',),
            'classes': ('collapse',)
        }),
    )
    date_hierarchy = 'created_at'
    ordering = ['-created_at']
    
    def is_expired_display(self, obj):
        """Display whether the backup has expired."""
        if obj.is_expired():
            return format_html('<span style="color: red;">Expired</span>')
        return format_html('<span style="color: green;">Active</span>')
    is_expired_display.short_description = 'Status'
    
    def has_add_permission(self, request):
        """Disable adding backups manually (they should be created via signals)."""
        return False
    
    def has_change_permission(self, request, obj=None):
        """Disable editing backups (they should be read-only)."""
        return False
    
    def has_delete_permission(self, request, obj=None):
        """Allow deletion of expired backups."""
        if obj and obj.is_expired():
            return True
        return False
