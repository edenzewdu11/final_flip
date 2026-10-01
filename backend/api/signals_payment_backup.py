"""
Signal handlers for automatic payment data backup.

Automatically creates backup records when payment-related models are created,
updated, or deleted. Supports Telebirr SuperApp, Telebirr Direct Debit, and Onevas.
"""
from django.db.models.signals import post_save, post_delete, pre_delete
from django.dispatch import receiver
from django.contrib.auth.models import User
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)


@receiver(post_save, sender='api.PendingTelebirrMandate')
def backup_pending_telebirr_mandate(sender, instance, created, **kwargs):
    """Backup PendingTelebirrMandate on create and update."""
    from .models_payment_backup import PaymentMandateBackup
    
    try:
        # Create or update backup
        backup, _ = PaymentMandateBackup.objects.update_or_create(
            payment_system='telebirr_superapp',
            source_model='PendingTelebirrMandate',
            source_id=instance.id,
            defaults={
                'user': None,  # PendingTelebirrMandate doesn't have user field
                'phone_number': instance.phone_number,
                'account_name': None,
                'mandate_contract_id': instance.mandate_contract_id,
                'mct_contract_no': instance.mct_contract_no,
                'mandate_id': None,
                'payer_reference_number': None,
                'onevas_subscription_id': None,
                'onevas_transaction_id': None,
                'onevas_phone_number': None,
                'plan_type': instance.plan_type,
                'tier_id': None,
                'subscription_plan_id': None,
                'mandate_template_id': instance.mandate_template_id,
                'mandate_status': instance.status,
                'amount': instance.amount,
                'payment_type': None,
                'frequency': None,
                'prepay_id': instance.prepay_id,
                'merch_order_id': instance.merch_order_id,
                'originator_conversation_id': None,
                'conversation_id': None,
                'product_number': None,
                'application_key': None,
                'original_status': instance.status,
                'full_snapshot': {
                    'mct_contract_no': instance.mct_contract_no,
                    'plan_type': instance.plan_type,
                    'prepay_id': instance.prepay_id,
                    'merch_order_id': instance.merch_order_id,
                    'mandate_template_id': instance.mandate_template_id,
                    'amount': instance.amount,
                    'phone_number': instance.phone_number,
                    'mandate_contract_id': instance.mandate_contract_id,
                    'status': instance.status,
                    'created_at': instance.created_at.isoformat() if instance.created_at else None,
                    'updated_at': instance.updated_at.isoformat() if instance.updated_at else None,
                }
            }
        )
        logger.info(f'[PAYMENT_BACKUP] Backed up PendingTelebirrMandate {instance.mct_contract_no} (created={created})')
    except Exception as e:
        logger.error(f'[PAYMENT_BACKUP] Failed to backup PendingTelebirrMandate {instance.mct_contract_no}: {e}')


@receiver(post_save, sender='api.DirectDebitMandate')
def backup_direct_debit_mandate(sender, instance, created, **kwargs):
    """Backup DirectDebitMandate on create and update."""
    from .models_payment_backup import PaymentMandateBackup
    
    try:
        backup, _ = PaymentMandateBackup.objects.update_or_create(
            payment_system='telebirr_direct_debit',
            source_model='DirectDebitMandate',
            source_id=instance.id,
            defaults={
                'user': instance.user,
                'phone_number': instance.payer_msisdn,
                'account_name': instance.payer_account_name,
                'mandate_contract_id': None,
                'mct_contract_no': None,
                'mandate_id': instance.mandate_id,
                'payer_reference_number': instance.payer_reference_number,
                'onevas_subscription_id': None,
                'onevas_transaction_id': None,
                'onevas_phone_number': None,
                'plan_type': None,
                'tier_id': instance.tier.id if instance.tier else None,
                'subscription_plan_id': instance.subscription_plan.id if instance.subscription_plan else None,
                'mandate_template_id': None,
                'mandate_status': instance.status,
                'amount': None,
                'payment_type': instance.payment_type,
                'frequency': instance.frequency,
                'prepay_id': None,
                'merch_order_id': None,
                'originator_conversation_id': instance.originator_conversation_id,
                'conversation_id': instance.conversation_id,
                'product_number': None,
                'application_key': None,
                'original_status': instance.status,
                'full_snapshot': {
                    'mandate_id': instance.mandate_id,
                    'payer_msisdn': instance.payer_msisdn,
                    'payer_reference_number': instance.payer_reference_number,
                    'payer_account_name': instance.payer_account_name,
                    'status': instance.status,
                    'payment_type': instance.payment_type,
                    'frequency': instance.frequency,
                    'first_payment_date': instance.first_payment_date.isoformat() if instance.first_payment_date else None,
                    'expiry_date': instance.expiry_date.isoformat() if instance.expiry_date else None,
                    'originator_conversation_id': instance.originator_conversation_id,
                    'conversation_id': instance.conversation_id,
                    'tier_id': str(instance.tier.id) if instance.tier else None,
                    'subscription_plan_id': str(instance.subscription_plan.id) if instance.subscription_plan else None,
                    'created_at': instance.created_at.isoformat() if instance.created_at else None,
                    'updated_at': instance.updated_at.isoformat() if instance.updated_at else None,
                    'activated_at': instance.activated_at.isoformat() if instance.activated_at else None,
                    'cancelled_at': instance.cancelled_at.isoformat() if instance.cancelled_at else None,
                }
            }
        )
        logger.info(f'[PAYMENT_BACKUP] Backed up DirectDebitMandate {instance.mandate_id or instance.id} (created={created})')
    except Exception as e:
        logger.error(f'[PAYMENT_BACKUP] Failed to backup DirectDebitMandate {instance.mandate_id or instance.id}: {e}')


@receiver(post_save, sender='api.DirectDebitTransaction')
def backup_direct_debit_transaction(sender, instance, created, **kwargs):
    """Backup DirectDebitTransaction on create and update."""
    from .models_payment_backup import PaymentTransactionBackup
    
    try:
        backup, _ = PaymentTransactionBackup.objects.update_or_create(
            payment_system='telebirr_direct_debit',
            source_model='DirectDebitTransaction',
            source_id=instance.id,
            defaults={
                'user': instance.mandate.user if instance.mandate else None,
                'phone_number': instance.mandate.payer_msisdn if instance.mandate else None,
                'transaction_id': instance.telebirr_transaction_id,
                'amount': instance.amount,
                'currency': instance.currency,
                'status': instance.status,
                'mandate_id': instance.mandate.mandate_id if instance.mandate else None,
                'mandate_contract_id': None,
                'mct_contract_no': None,
                'subscription_id': instance.mandate.subscription_plan.id if instance.mandate and instance.mandate.subscription_plan else None,
                'subscription_payment_id': instance.subscription_payment.id if instance.subscription_payment else None,
                'telebirr_transaction_id': instance.telebirr_transaction_id,
                'originator_conversation_id': instance.originator_conversation_id,
                'conversation_id': instance.conversation_id,
                'onevas_transaction_id': None,
                'product_number': None,
                'error_message': instance.error_message,
                'retry_count': instance.retry_count,
                'full_snapshot': {
                    'amount': str(instance.amount),
                    'currency': instance.currency,
                    'status': instance.status,
                    'telebirr_transaction_id': instance.telebirr_transaction_id,
                    'originator_conversation_id': instance.originator_conversation_id,
                    'conversation_id': instance.conversation_id,
                    'mandate_id': instance.mandate.mandate_id if instance.mandate else None,
                    'error_message': instance.error_message,
                    'retry_count': instance.retry_count,
                    'created_at': instance.created_at.isoformat() if instance.created_at else None,
                    'updated_at': instance.updated_at.isoformat() if instance.updated_at else None,
                    'completed_at': instance.completed_at.isoformat() if instance.completed_at else None,
                }
            }
        )
        logger.info(f'[PAYMENT_BACKUP] Backed up DirectDebitTransaction {instance.id} (created={created})')
    except Exception as e:
        logger.error(f'[PAYMENT_BACKUP] Failed to backup DirectDebitTransaction {instance.id}: {e}')


@receiver(post_save, sender='api.SubscriptionPlan')
def backup_subscription_plan(sender, instance, created, **kwargs):
    """Backup SubscriptionPlan when mandate/onevas fields change."""
    from .models_payment_backup import PaymentMandateBackup
    
    # Only backup if this has Telebirr or Onevas data
    if not (instance.mandate_contract_id or instance.mct_contract_no or instance.onevas_subscription_id):
        return
    
    try:
        # Determine payment system
        if instance.payment_method == 'telebirr':
            payment_system = 'telebirr_superapp'
        elif instance.payment_method == 'onevas':
            payment_system = 'onevas'
        else:
            return  # Skip other payment methods
        
        backup, _ = PaymentMandateBackup.objects.update_or_create(
            payment_system=payment_system,
            source_model='SubscriptionPlan',
            source_id=instance.id,
            defaults={
                'user': instance.user,
                'phone_number': instance.telebirr_phone_number if instance.payment_method == 'telebirr' else instance.onevas_phone_number,
                'account_name': None,
                'mandate_contract_id': instance.mandate_contract_id,
                'mct_contract_no': instance.mct_contract_no,
                'mandate_id': None,
                'payer_reference_number': None,
                'onevas_subscription_id': instance.onevas_subscription_id,
                'onevas_transaction_id': instance.onevas_transaction_id,
                'onevas_phone_number': instance.onevas_phone_number,
                'plan_type': instance.duration_type,
                'tier_id': instance.tier.id if instance.tier else None,
                'subscription_plan_id': instance.id,
                'mandate_template_id': instance.tier.mandate_template_id if instance.tier else None,
                'mandate_status': instance.mandate_status,
                'amount': str(instance.tier.price_etb) if instance.tier else None,
                'payment_type': instance.payment_method,
                'frequency': None,
                'prepay_id': None,
                'merch_order_id': None,
                'originator_conversation_id': None,
                'conversation_id': None,
                'product_number': instance.tier.product_id if instance.tier else None,
                'application_key': instance.tier.application_key if instance.tier else None,
                'original_status': instance.status,
                'full_snapshot': {
                    'user_id': str(instance.user.id) if instance.user else None,
                    'tier_id': str(instance.tier.id) if instance.tier else None,
                    'status': instance.status,
                    'payment_method': instance.payment_method,
                    'duration_type': instance.duration_type,
                    'mandate_contract_id': instance.mandate_contract_id,
                    'mct_contract_no': instance.mct_contract_no,
                    'mandate_status': instance.mandate_status,
                    'telebirr_phone_number': instance.telebirr_phone_number,
                    'onevas_subscription_id': instance.onevas_subscription_id,
                    'onevas_phone_number': instance.onevas_phone_number,
                    'onevas_transaction_id': instance.onevas_transaction_id,
                    'start_date': instance.start_date.isoformat() if instance.start_date else None,
                    'end_date': instance.end_date.isoformat() if instance.end_date else None,
                    'auto_renew': instance.auto_renew,
                    'created_at': instance.created_at.isoformat() if instance.created_at else None,
                    'updated_at': instance.updated_at.isoformat() if instance.updated_at else None,
                }
            }
        )
        logger.info(f'[PAYMENT_BACKUP] Backed up SubscriptionPlan {instance.id} (payment_method={instance.payment_method})')
    except Exception as e:
        logger.error(f'[PAYMENT_BACKUP] Failed to backup SubscriptionPlan {instance.id}: {e}')


@receiver(post_save, sender='api.OnevasChargingTransaction')
def backup_onevas_charging_transaction(sender, instance, created, **kwargs):
    """Backup OnevasChargingTransaction on create and update."""
    from .models_payment_backup import PaymentTransactionBackup
    
    try:
        backup, _ = PaymentTransactionBackup.objects.update_or_create(
            payment_system='onevas',
            source_model='OnevasChargingTransaction',
            source_id=instance.id,
            defaults={
                'user': instance.user,
                'phone_number': instance.phone_number,
                'transaction_id': instance.transaction_id,
                'amount': instance.amount_etb,
                'currency': 'ETB',
                'status': instance.status,
                'mandate_id': None,
                'mandate_contract_id': None,
                'mct_contract_no': None,
                'subscription_id': None,
                'subscription_payment_id': None,
                'telebirr_transaction_id': None,
                'originator_conversation_id': None,
                'conversation_id': None,
                'onevas_transaction_id': instance.transaction_id,
                'product_number': instance.product_number,
                'error_message': instance.error_message,
                'retry_count': instance.retry_count,
                'full_snapshot': {
                    'user_id': str(instance.user.id) if instance.user else None,
                    'phone_number': instance.phone_number,
                    'product_number': instance.product_number,
                    'application_key': instance.application_key,
                    'amount_etb': str(instance.amount_etb),
                    'status': instance.status,
                    'transaction_id': instance.transaction_id,
                    'response_status': instance.response_status,
                    'error_message': instance.error_message,
                    'retry_count': instance.retry_count,
                    'webhook_received': instance.webhook_received,
                    'created_at': instance.created_at.isoformat() if instance.created_at else None,
                    'updated_at': instance.updated_at.isoformat() if instance.updated_at else None,
                }
            }
        )
        logger.info(f'[PAYMENT_BACKUP] Backed up OnevasChargingTransaction {instance.id} (created={created})')
    except Exception as e:
        logger.error(f'[PAYMENT_BACKUP] Failed to backup OnevasChargingTransaction {instance.id}: {e}')


@receiver(post_save, sender='api.OnevasWebhookLog')
def backup_onevas_webhook_log(sender, instance, created, **kwargs):
    """Backup OnevasWebhookLog on create."""
    from .models_payment_backup import PaymentTransactionBackup
    
    try:
        backup, _ = PaymentTransactionBackup.objects.update_or_create(
            payment_system='onevas',
            source_model='OnevasWebhookLog',
            source_id=instance.id,
            defaults={
                'user': None,
                'phone_number': None,
                'transaction_id': None,
                'amount': 0,
                'currency': 'ETB',
                'status': 'completed' if instance.processed else 'pending',
                'mandate_id': None,
                'mandate_contract_id': None,
                'mct_contract_no': None,
                'subscription_id': None,
                'subscription_payment_id': None,
                'telebirr_transaction_id': None,
                'originator_conversation_id': None,
                'conversation_id': None,
                'onevas_transaction_id': None,
                'product_number': None,
                'error_message': instance.error_message,
                'retry_count': instance.retry_count,
                'full_snapshot': {
                    'webhook_type': instance.webhook_type,
                    'payload': instance.payload,
                    'response_status': instance.response_status,
                    'response_body': instance.response_body,
                    'processed': instance.processed,
                    'error_message': instance.error_message,
                    'retry_count': instance.retry_count,
                    'created_at': instance.created_at.isoformat() if instance.created_at else None,
                }
            }
        )
        logger.info(f'[PAYMENT_BACKUP] Backed up OnevasWebhookLog {instance.id} (created={created})')
    except Exception as e:
        logger.error(f'[PAYMENT_BACKUP] Failed to backup OnevasWebhookLog {instance.id}: {e}')
