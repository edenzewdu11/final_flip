"""
Telebirr Direct Debit API Views

API endpoints for direct debit mandate management:
- Create mandate
- Activate mandate
- Cancel mandate
- List user mandates
- Webhook for async results
"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth.models import User
from django.utils import timezone
from django.db.models import Q
from datetime import datetime, timedelta
from decimal import Decimal

import logging
import re

from .models_direct_debit import DirectDebitMandate, DirectDebitTransaction, B2CPaymentTransaction
from .models_subscription import SubscriptionTier, SubscriptionPlan, SubscriptionPayment
from .telebirr_direct_debit_service import telebirr_direct_debit_service

logger = logging.getLogger(__name__)


def _parse_telebirr_soap_result(raw_body):
    """Extract the fields we care about from a Telebirr SOAP Result envelope.

    Telebirr sends ``Content-Type: text/xml`` with an ``<api:Result>`` SOAP
    envelope. DRF's ``request.data`` cannot parse this so we operate on the
    raw bytes/string with regex (the schema is fixed and small).
    """
    if isinstance(raw_body, (bytes, bytearray)):
        try:
            raw_body = raw_body.decode('utf-8', errors='replace')
        except Exception:
            raw_body = str(raw_body)
    text = raw_body or ''

    def _find(tag):
        m = re.search(
            r'<(?:[a-zA-Z]+:)?{0}>([^<]*)</(?:[a-zA-Z]+:)?{0}>'.format(tag),
            text,
        )
        return m.group(1).strip() if m else None

    return {
        'ResultType': _find('ResultType'),
        'ResultCode': _find('ResultCode'),
        'ResultDesc': _find('ResultDesc'),
        'ConversationID': _find('ConversationID'),
        'OriginatorConversationID': _find('OriginatorConversationID'),
        'TransactionID': _find('TransactionID'),
        'MandateID': _find('MandateID'),
    }


# ============================================================================
# OLD RECURRING SUBSCRIPTION VIEW - DISABLED
# Replaced by the one-off (manual renewal) flow: create_one_off_subscription.
# Kept here (as an inert string block) for reference only. Nothing calls it.
# ============================================================================
_OLD_create_direct_debit_mandate = '''
@api_view(['POST'])
@permission_classes([AllowAny])
def create_direct_debit_mandate(request):
    """
    Create a direct debit mandate for subscription payment

    Request Body:
    {
        "tier_id": "uuid",
        "payer_msisdn": "251911234567",
        "frequency": "05"  // 02=Daily, 03=Weekly, 05=Monthly
    }
    """
    logger.info("=" * 80)
    logger.info("DIRECT DEBIT MANDATE CREATE - REQUEST RECEIVED")
    logger.info("=" * 80)
    logger.info(f"User: {request.user.username if request.user.is_authenticated else 'Anonymous'}")
    logger.info(f"User authenticated: {request.user.is_authenticated}")
    logger.info(f"Request data: {request.data}")
    logger.info(f"Request headers: {dict(request.headers)}")
    logger.info(f"Request URL: {request.build_absolute_uri()}")
    logger.info(f"Request method: {request.method}")
    logger.info(f"Client IP: {request.META.get('REMOTE_ADDR')}")
    logger.info("-" * 80)

    try:
        # Allow unauthenticated users for subscription flow
        user = request.user if request.user.is_authenticated else None
        tier_id = request.data.get('tier_id')
        payer_msisdn = request.data.get('payer_msisdn')
        frequency = request.data.get('frequency')

        logger.info(f"Extracted parameters - tier_id: {tier_id}, payer_msisdn: {payer_msisdn}, frequency: {frequency}")

        # Validate required fields
        if not all([tier_id, payer_msisdn, frequency]):
            logger.error("Missing required fields")
            return Response(
                {'error': 'tier_id, payer_msisdn, and frequency are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Normalize phone number to 251 format
        from .views import _normalize_ethiopian_phone
        normalized_phone = _normalize_ethiopian_phone(payer_msisdn)
        if normalized_phone:
            payer_msisdn = normalized_phone
            logger.info(f"Normalized phone number: {payer_msisdn}")
        else:
            logger.warning(f"Could not normalize phone number: {payer_msisdn}")

        # Check for existing active mandate to prevent duplicate subscriptions
        from .models_direct_debit import DirectDebitMandate
        existing_mandate = None
        if user and user.is_authenticated:
            existing_mandate = DirectDebitMandate.objects.filter(
                user=user,
                status='active'
            ).first()
        if not existing_mandate:
            existing_mandate = DirectDebitMandate.objects.filter(
                payer_msisdn=payer_msisdn,
                status='active'
            ).first()
        
        if existing_mandate:
            logger.warning(f"Active mandate already exists for {payer_msisdn}: {existing_mandate.id}")
            return Response(
                {
                    'error': 'You already have an active subscription mandate. Please cancel it before creating a new one.',
                    'existing_mandate_id': str(existing_mandate.id),
                    'existing_mandate_status': existing_mandate.status
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get subscription tier - try UUID first, then try other fields
        try:
            tier = SubscriptionTier.objects.get(id=tier_id)
            logger.info(f"Found tier: {tier.name}, duration_type: {tier.duration_type}, is_active: {tier.is_active}")
        except (SubscriptionTier.DoesNotExist, ValueError):
            # If UUID lookup fails, try to find by other fields for compatibility
            logger.warning(f"Tier not found with id={tier_id}, trying alternative lookup")
            try:
                # Try to find by onevas_code if tier_id is an integer
                tier = SubscriptionTier.objects.get(onevas_code=str(tier_id))
                logger.info(f"Found tier via onevas_code: {tier.name}, duration_type: {tier.duration_type}, is_active: {tier.is_active}")
            except SubscriptionTier.DoesNotExist:
                # If still not found, try to find by duration_type as fallback
                logger.warning(f"Tier not found with id={tier_id} or onevas_code={tier_id}, trying duration_type lookup")
                # Map common integer IDs to duration types
                duration_type_map = {1: 'daily', 2: 'weekly', 3: 'monthly'}
                duration_type = duration_type_map.get(int(tier_id) if str(tier_id).isdigit() else None)
                if duration_type:
                    tier = SubscriptionTier.objects.filter(duration_type=duration_type, is_active=True).first()
                    if tier:
                        logger.info(f"Found tier via duration_type fallback: {tier.name}, duration_type: {tier.duration_type}, is_active: {tier.is_active}")
                    else:
                        logger.error(f"No active tier found with duration_type={duration_type}")
                        return Response(
                            {'error': f'No active subscription tier found for {duration_type}'},
                            status=status.HTTP_400_BAD_REQUEST
                        )
                else:
                    logger.error(f"Tier not found with id={tier_id} or onevas_code={tier_id}, and no duration_type mapping")
                    return Response(
                        {'error': 'Invalid subscription tier'},
                        status=status.HTTP_400_BAD_REQUEST
                    )

        # Validate frequency matches tier duration
        frequency_map = {
            'daily': '02',
            'weekly': '03',
            'monthly': '05',
        }
        logger.info(f"Frequency map: {frequency_map}")
        logger.info(f"Tier duration_type: {tier.duration_type}")
        if tier.duration_type not in frequency_map:
            logger.error(f"Tier duration_type {tier.duration_type} not in frequency_map")
            return Response(
                {'error': 'This tier does not support direct debit (only tier-based subscriptions)'},
                status=status.HTTP_400_BAD_REQUEST
            )
        expected_frequency = frequency_map[tier.duration_type]
        logger.info(f"Expected frequency: {expected_frequency}, Provided frequency: {frequency}")
        if frequency != expected_frequency:
            logger.error(f"Frequency mismatch: expected {expected_frequency}, got {frequency}")
            return Response(
                {'error': f'Frequency must be {expected_frequency} for {tier.duration_type} tier'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Generate payer reference number
        user_id = user.id if user else 0
        payer_reference_number = f"FLP{user_id}{int(timezone.now().timestamp())}"
        
        # Calculate dates
        first_payment_date = timezone.now().date()
        expiry_date = first_payment_date + timedelta(days=365)  # 1 year expiry

        logger.info(f"Calling Telebirr service with parameters:")
        logger.info(f"  - payer_msisdn: {payer_msisdn}")
        logger.info(f"  - payer_reference_number: {payer_reference_number}")
        logger.info(f"  - frequency: {frequency}")
        logger.info(f"  - first_payment_date: {first_payment_date.strftime('%Y%m%d')}")
        logger.info(f"  - expiry_date: {expiry_date.strftime('%Y%m%d')}")
        logger.info(f"  - TELEBIRR_RESULT_URL: {telebirr_direct_debit_service.result_url}")

        # Call Telebirr service to create mandate
        result = telebirr_direct_debit_service.create_mandate(
            payer_msisdn=payer_msisdn,
            payer_reference_number=payer_reference_number,
            frequency=frequency,
            first_payment_date=first_payment_date.strftime('%Y%m%d'),
            expiry_date=expiry_date.strftime('%Y%m%d'),
        )

        logger.info(f"Telebirr service response: {result}")

        if not result.get('success'):
            logger.error(f"Telebirr mandate creation failed: {result.get('error')}")
            return Response(
                {'error': result.get('error', 'Mandate creation failed')},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        # Create mandate record. The synchronous Telebirr response is only an
        # acceptance ack; the real result (with the Telebirr-generated
        # MandateID) arrives later on the webhook. Until then, the mandate
        # stays in `pending_created` and cannot be activated/cancelled/debited.
        mandate = DirectDebitMandate.objects.create(
            user=user,
            tier=tier,
            payer_msisdn=payer_msisdn,
            payer_reference_number=payer_reference_number,
            payee_identifier_value=getattr(tier, 'short_code', '9286'),
            frequency=frequency,
            first_payment_date=first_payment_date,
            expiry_date=expiry_date,
            agreed_tc=True,
            originator_conversation_id=result.get('originator_conversation_id'),
            conversation_id=result.get('conversation_id'),
            status='pending_created'
        )

        logger.info(f"Mandate record created in database:")
        logger.info(f"  - mandate_id: {mandate.id}")
        logger.info(f"  - payer_reference_number: {payer_reference_number}")
        logger.info(f"  - status: {mandate.status}")
        logger.info(f"  - originator_conversation_id: {result.get('originator_conversation_id')}")
        logger.info(f"  - conversation_id: {result.get('conversation_id')}")

        response_data = {
            'success': True,
            'mandate_id': str(mandate.id),
            'payer_reference_number': payer_reference_number,
            'status': mandate.status,
            'message': 'Mandate created successfully. Please activate it to complete subscription.',
            'originator_conversation_id': result.get('originator_conversation_id')
        }

        logger.info(f"Returning response: {response_data}")
        logger.info("=" * 80)
        logger.info("DIRECT DEBIT MANDATE CREATE - SUCCESS")
        logger.info("=" * 80)

        return Response(response_data, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        logger.error("=" * 80)
        logger.error("DIRECT DEBIT MANDATE CREATE - EXCEPTION")
        logger.error("=" * 80)
        logger.error(f"Exception: {str(e)}")
        logger.exception("Full traceback:")
        logger.error("=" * 80)
        return Response(
            {'error': f'Failed to create mandate: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
'''
# ============================================================================
# END OLD RECURRING SUBSCRIPTION VIEW
# ============================================================================


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def activate_direct_debit_mandate(request):
    """
    Activate a direct debit mandate
    
    Request Body:
    {
        "mandate_id": "uuid",
        "payer_account_name": "John Doe"  // optional
    }
    """
    try:
        user = request.user
        mandate_id = request.data.get('mandate_id')
        payer_account_name = request.data.get('payer_account_name', '')
        
        # Validate required fields
        if not mandate_id:
            return Response(
                {'error': 'mandate_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get mandate
        try:
            mandate = DirectDebitMandate.objects.get(id=mandate_id, user=user)
        except DirectDebitMandate.DoesNotExist:
            return Response(
                {'error': 'Mandate not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Check mandate status
        if mandate.status != 'pending_active':
            return Response(
                {'error': f'Mandate is in {mandate.status} status, cannot activate'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Telebirr requires the real MandateID (max 18 bytes) generated by
        # the Mobile Money system and delivered via the async result webhook.
        # Substituting payer_reference_number here would be rejected.
        if not mandate.mandate_id:
            return Response(
                {'error': 'Mandate is not yet ready for activation. Telebirr has not returned the MandateID. Please retry shortly.'},
                status=status.HTTP_409_CONFLICT
            )

        # Call Telebirr service to activate mandate
        result = telebirr_direct_debit_service.activate_mandate(
            mandate_id=mandate.mandate_id,
            payer_msisdn=mandate.payer_msisdn,
            agreed_tc=True,
            payer_account_name=payer_account_name
        )
        
        if not result.get('success'):
            mandate.mark_failed(result.get('error'))
            return Response(
                {'error': result.get('error', 'Mandate activation failed')},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        # Update mandate
        mandate.payer_account_name = payer_account_name
        mandate.originator_conversation_id = result.get('originator_conversation_id')
        mandate.conversation_id = result.get('conversation_id')
        mandate.activate()

        # Create subscription plan from the tier persisted at mandate creation
        # time. (Previously this read mandate.subscription_plan.tier which is
        # always None at activation, so subscriptions were never created.)
        subscription_plan = None
        tier = mandate.tier
        if tier:
            subscription_plan = SubscriptionPlan.objects.create(
                user=user,
                tier=tier,
                status='active',
                duration_type=tier.duration_type,
                start_date=timezone.now(),
                end_date=timezone.now() + timedelta(days=tier.duration_days) if tier.duration_days else None,
                next_renewal_date=timezone.now() + timedelta(days=tier.duration_days) if tier.duration_days else None,
                auto_renew=True,
                payment_method='telebirr_direct_debit'
            )
            
            # Link mandate to subscription
            mandate.subscription_plan = subscription_plan
            mandate.save()
            
            # Create initial payment record
            SubscriptionPayment.objects.create(
                subscription=subscription_plan,
                user=user,
                amount=tier.price_etb,
                currency='ETB',
                status='pending',
                payment_method='telebirr_direct_debit',
                duration_type=tier.duration_type,
                period_start=timezone.now(),
                period_end=subscription_plan.end_date or timezone.now() + timedelta(days=30)
            )
        
        return Response({
            'success': True,
            'mandate_id': str(mandate.id),
            'status': mandate.status,
            'subscription_id': str(subscription_plan.id) if subscription_plan else None,
            'message': 'Mandate activated successfully. Subscription created.'
        })
        
    except Exception as e:
        return Response(
            {'error': f'Failed to activate mandate: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cancel_direct_debit_mandate(request):
    """
    Cancel a direct debit mandate
    
    Request Body:
    {
        "mandate_id": "uuid"
    }
    """
    try:
        user = request.user
        mandate_id = request.data.get('mandate_id')
        
        # Validate required fields
        if not mandate_id:
            return Response(
                {'error': 'mandate_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get mandate
        try:
            mandate = DirectDebitMandate.objects.get(id=mandate_id, user=user)
        except DirectDebitMandate.DoesNotExist:
            return Response(
                {'error': 'Mandate not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Check if mandate is active
        if not mandate.is_active():
            return Response(
                {'error': f'Mandate is {mandate.status}, cannot cancel'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not mandate.mandate_id:
            return Response(
                {'error': 'Mandate has no Telebirr MandateID yet, cannot cancel.'},
                status=status.HTTP_409_CONFLICT
            )

        # Call Telebirr service to cancel mandate
        result = telebirr_direct_debit_service.cancel_mandate(
            mandate_id=mandate.mandate_id,
            payer_msisdn=mandate.payer_msisdn
        )
        
        if not result.get('success'):
            return Response(
                {'error': result.get('error', 'Mandate cancellation failed')},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        # Update mandate
        mandate.cancel()
        
        # Cancel linked subscription auto-renewal
        if mandate.subscription_plan:
            mandate.subscription_plan.auto_renew = False
            mandate.subscription_plan.save()
        
        return Response({
            'success': True,
            'mandate_id': str(mandate.id),
            'status': mandate.status,
            'message': 'Mandate cancelled successfully. Auto-renewal disabled.'
        })
        
    except Exception as e:
        return Response(
            {'error': f'Failed to cancel mandate: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_user_mandates(request):
    """
    List all mandates for the authenticated user
    """
    try:
        user = request.user
        mandates = DirectDebitMandate.objects.filter(user=user).order_by('-created_at')
        
        mandate_data = []
        for mandate in mandates:
            mandate_data.append({
                'id': str(mandate.id),
                'mandate_id': mandate.mandate_id,
                'payer_msisdn': mandate.payer_msisdn,
                'status': mandate.status,
                'frequency': mandate.frequency,
                'first_payment_date': mandate.first_payment_date,
                'expiry_date': mandate.expiry_date,
                'subscription_plan_id': str(mandate.subscription_plan.id) if mandate.subscription_plan else None,
                'created_at': mandate.created_at,
                'is_active': mandate.is_active(),
            })
        
        return Response({
            'success': True,
            'mandates': mandate_data
        })
        
    except Exception as e:
        return Response(
            {'error': f'Failed to list mandates: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['POST'])
@permission_classes([AllowAny])  # Telebirr calls this webhook
def telebirr_direct_debit_webhook(request):
    """Webhook endpoint for Telebirr async Result envelopes.

    Telebirr POSTs a SOAP Result envelope (``Content-Type: text/xml``). The
    previous version read ``request.data`` (JSON-only) which silently 400'd
    every real callback. We now parse the raw XML body and correlate by
    ``OriginatorConversationID``. We always return HTTP 200 so Telebirr
    does not retry-storm us; processing errors are logged.
    """
    raw_body = request.body or b''
    logger.info('=' * 80)
    logger.info('TELEBIRR WEBHOOK - REQUEST RECEIVED')
    logger.info('=' * 80)
    logger.info('Content-Type: %s', request.META.get('CONTENT_TYPE'))
    logger.info('Body Length: %d bytes', len(raw_body))
    logger.info('Raw Body (first 4000 chars): %s', raw_body[:4000])
    logger.info('-' * 80)

    try:
        # XML first (real Telebirr); JSON fallback for manual tests.
        parsed = _parse_telebirr_soap_result(raw_body)
        # Only try JSON fallback if content type is JSON (avoid UnsupportedMediaType for XML)
        if not parsed.get('OriginatorConversationID') and request.content_type == 'application/json':
            tx = request.data.get('TransactionResult') or {}
            parsed = {
                'ResultType': request.data.get('ResultType'),
                'ResultCode': request.data.get('ResultCode'),
                'ResultDesc': request.data.get('ResultDesc'),
                'ConversationID': request.data.get('ConversationID'),
                'OriginatorConversationID': request.data.get('OriginatorConversationID'),
                'TransactionID': tx.get('TransactionID') if isinstance(tx, dict) else request.data.get('TransactionID'),
                'MandateID': request.data.get('MandateID'),
            }

        logger.info('TELEBIRR WEBHOOK - PARSED DATA')
        logger.info('Parsed: %s', parsed)
        logger.info('-' * 80)

        originator_conversation_id = parsed.get('OriginatorConversationID')
        result_code = parsed.get('ResultCode')
        result_type = parsed.get('ResultType')
        result_desc = parsed.get('ResultDesc') or ''
        # Telebirr returns the new MandateID either in <MandateID> or, for
        # InitTrans, the transaction id in <TransactionID>.
        new_mandate_id = parsed.get('MandateID') or parsed.get('TransactionID')

        logger.info('TELEBIRR WEBHOOK - KEY FIELDS')
        logger.info('OriginatorConversationID: %s', originator_conversation_id)
        logger.info('ResultCode: %s', result_code)
        logger.info('ResultType: %s', result_type)
        logger.info('ResultDesc: %s', result_desc)
        logger.info('MandateID: %s', new_mandate_id)
        logger.info('-' * 80)

        if not originator_conversation_id:
            logger.warning('TELEBIRR WEBHOOK - ERROR: No OriginatorConversationID found, ignoring')
            return Response({'success': True})

        logger.info('TELEBIRR WEBHOOK - LOOKING UP MANDATE')
        mandate = DirectDebitMandate.objects.filter(
            originator_conversation_id=originator_conversation_id
        ).first()

        # If not found, try looking up by debit_conversation_id (for transaction result webhooks)
        if not mandate:
            mandate = DirectDebitMandate.objects.filter(
                debit_conversation_id=originator_conversation_id
            ).first()
            if mandate:
                logger.info('TELEBIRR WEBHOOK - FOUND MANDATE BY DEBIT CONVERSATION ID')
                # For transaction result webhooks, the TransactionID is the mandate ID
                if new_mandate_id and not mandate.mandate_id:
                    logger.info('TELEBIRR WEBHOOK - SAVING MANDATE ID FROM TRANSACTION RESULT: %s', new_mandate_id)
                    mandate.mandate_id = new_mandate_id[:18]
                    mandate.save(update_fields=['mandate_id'])

        if not mandate:
            logger.warning('TELEBIRR WEBHOOK - ERROR: No mandate matched OriginatorConversationID=%s', originator_conversation_id)
            return Response({'success': True})

        logger.info('TELEBIRR WEBHOOK - MANDATE FOUND')
        logger.info('Mandate ID: %s', mandate.id)
        logger.info('Mandate Status: %s', mandate.status)
        logger.info('Mandate Payment Type: %s', mandate.payment_type)
        logger.info('Mandate User: %s', mandate.user.username if mandate.user else 'None (anonymous)')
        logger.info('Mandate Payer MSISDN: %s', mandate.payer_msisdn)
        logger.info('-' * 80)

        is_success = result_code == '0' and (result_type == '0' or result_type is None)
        logger.info('TELEBIRR WEBHOOK - SUCCESS CHECK: %s', is_success)

        if is_success:
            logger.info('TELEBIRR WEBHOOK - PROCESSING SUCCESS RESPONSE')
            # Persist the real MandateID as soon as we get it (max 18 bytes).
            if new_mandate_id and not mandate.mandate_id:
                logger.info('TELEBIRR WEBHOOK - UPDATING MANDATE ID: %s', new_mandate_id)
                mandate.mandate_id = new_mandate_id[:18]
                mandate.save(update_fields=['mandate_id'])
            elif not new_mandate_id and not mandate.mandate_id:
                # For one-off payments, the TransactionID from the transaction result webhook
                # is the mandate ID. Don't query here - wait for the transaction result webhook.
                # For recurring mandates, query Telebirr for MandateID if not provided in webhook
                if mandate.payment_type == 'recurring':
                    # For recurring mandates, query Telebirr for MandateID if not provided in webhook
                    logger.info('TELEBIRR WEBHOOK - RECURRING MANDATE: QUERYING MANDATEID')
                    from .telebirr_direct_debit_service import telebirr_direct_debit_service
                    query_result = telebirr_direct_debit_service.query_mandate_by_payer(
                        payer_msisdn=mandate.payer_msisdn,
                        mandate_statuses=['03'],  # 03 = Active status
                        debug=False
                    )
                    if query_result.get('success'):
                        mandates = query_result.get('mandates', [])
                        if mandates:
                            matched_mandate = None
                            for m in mandates:
                                if m.get('payer_reference_number') == mandate.payer_reference_number:
                                    matched_mandate = m
                                    break
                            
                            if matched_mandate:
                                logger.info('TELEBIRR WEBHOOK - RETRIEVED MANDATEID FROM QUERY: %s (matched by PayerReferenceNumber: %s)', 
                                           matched_mandate['mandate_id'], mandate.payer_reference_number)
                                mandate.mandate_id = matched_mandate['mandate_id'][:18]
                                mandate.save(update_fields=['mandate_id'])
                            else:
                                # Fallback to first mandate if no match
                                logger.warning('TELEBIRR WEBHOOK - NO MATCH FOUND FOR PayerReferenceNumber: %s, using first mandate', 
                                             mandate.payer_reference_number)
                                if query_result.get('mandate_id'):
                                    logger.info('TELEBIRR WEBHOOK - RETRIEVED MANDATEID FROM QUERY: %s (fallback)', query_result['mandate_id'])
                                    mandate.mandate_id = query_result['mandate_id'][:18]
                                    mandate.save(update_fields=['mandate_id'])
                        elif query_result.get('mandate_id'):
                            # Single mandate returned
                            logger.info('TELEBIRR WEBHOOK - RETRIEVED MANDATEID FROM QUERY: %s', query_result['mandate_id'])
                            mandate.mandate_id = query_result['mandate_id'][:18]
                            mandate.save(update_fields=['mandate_id'])
                        else:
                            logger.warning('TELEBIRR WEBHOOK - FAILED TO RETRIEVE MANDATEID FROM QUERY')
                    else:
                        logger.warning('TELEBIRR WEBHOOK - FAILED TO RETRIEVE MANDATEID FROM QUERY')

            # Handle one-off payments (coin purchases)
            if mandate.payment_type == 'one_off':
                logger.info('TELEBIRR WEBHOOK - ONE-OFF PAYMENT DETECTED')
                logger.info('TELEBIRR WEBHOOK - MANDATE ID: %s', mandate.id)
                logger.info('TELEBIRR WEBHOOK - PAYER REFERENCE: %s', mandate.payer_reference_number)
                logger.info('TELEBIRR WEBHOOK - USER: %s', mandate.user.username if mandate.user else 'None')

                # Check if this is the transaction result webhook (has TransactionID)
                # If yes, add coins now that payment is confirmed successful
                if new_mandate_id and mandate.status == 'pending_created':
                    logger.info('TELEBIRR WEBHOOK - TRANSACTION RESULT WEBHOOK, ADDING COINS NOW')
                    purchase_type = (mandate.metadata or {}).get('purchase_type', 'coins')
                    
                    if purchase_type == 'coins':
                        from .models_contest import UserCoinBalance
                        try:
                            if not mandate.user:
                                logger.error('TELEBIRR WEBHOOK - ERROR: Mandate has no user, cannot add coins')
                            else:
                                profile = mandate.user.profile
                                coins_to_add = mandate.metadata.get('coins', 100)
                                logger.info('TELEBIRR WEBHOOK - ADDING COINS TO USER')
                                logger.info('TELEBIRR WEBHOOK - USER: %s', mandate.user.username)
                                logger.info('TELEBIRR WEBHOOK - COINS TO ADD: %s', coins_to_add)

                                coin_balance, _ = UserCoinBalance.objects.get_or_create(
                                    user=mandate.user,
                                    defaults={'balance': 0, 'earned_balance': 0, 'purchased_balance': 0}
                                )
                                logger.info('TELEBIRR WEBHOOK - CURRENT BALANCE BEFORE: %s', coin_balance.balance)

                                coin_balance.add_purchased(
                                    coins_to_add,
                                    transaction_type='purchase',
                                    payment_method='telebirr',
                                    description=f'One-off payment {mandate.id}'
                                )
                                logger.info('TELEBIRR WEBHOOK - CURRENT BALANCE AFTER: %s', coin_balance.balance)

                                profile.coins = coin_balance.balance
                                profile.save(update_fields=['coins'])
                                logger.info('TELEBIRR WEBHOOK - COINS ADDED SUCCESSFULLY')

                                # Mark mandate as active
                                mandate.status = 'active'
                                mandate.save(update_fields=['status'])
                                logger.info('TELEBIRR WEBHOOK - MANDATE MARKED AS ACTIVE')
                        except UserProfile.DoesNotExist:
                            logger.error('TELEBIRR WEBHOOK - ERROR: UserProfile not found for user %s', mandate.user.username if mandate.user else 'None')
                            mandate.mark_failed('UserProfile not found')
                    elif purchase_type == 'subscription':
                        # Create subscription now that payment is confirmed successful
                        logger.info('TELEBIRR WEBHOOK - TRANSACTION RESULT WEBHOOK, CREATING SUBSCRIPTION NOW')
                        try:
                            from .models import UserProfile as _UP
                            from .models_subscription import SubscriptionPlan
                            from django.db.models import Q

                            # IDEMPOTENCY GUARD
                            if mandate.subscription_plan_id:
                                logger.info('TELEBIRR WEBHOOK - SUBSCRIPTION ALREADY EXISTS FOR MANDATE %s, SKIPPING DUPLICATE', mandate.id)
                                mandate.status = 'active'
                                mandate.save(update_fields=['status'])
                            else:
                                phone = mandate.payer_msisdn

                                # Determine the target user
                                target_user = mandate.user
                                is_new_user = False
                                if not target_user:
                                    logger.info('TELEBIRR WEBHOOK - ANONYMOUS SUBSCRIPTION MANDATE, RESOLVING USER BY PHONE: %s', phone)
                                    phone_variants = [phone]
                                    if phone.startswith('251') and len(phone) == 12:
                                        phone_variants += ['0' + phone[3:], '+' + phone]
                                    elif phone.startswith('0') and len(phone) == 10:
                                        phone_variants += ['251' + phone[1:], '+251' + phone[1:]]
                                    _profile = _UP.objects.filter(Q(phone_number__in=phone_variants)).first()
                                    if _profile:
                                        target_user = _profile.user
                                        mandate.user = target_user
                                        mandate.save(update_fields=['user'])
                                        logger.info('TELEBIRR WEBHOOK - FOUND EXISTING USER BY PHONE: %s', target_user.username)
                                    else:
                                        is_new_user = True
                                        logger.info('TELEBIRR WEBHOOK - BRAND-NEW PHONE, WILL SEND OTP + SETUP LINK (no user created)')

                                tier = mandate.tier
                                meta = mandate.metadata or {}
                                duration_days = meta.get('duration_days') or (tier.duration_days if tier else None)
                                duration_type = (tier.duration_type if tier else meta.get('duration_type', 'daily'))
                                now = timezone.now()
                                end_date = now + timedelta(days=duration_days) if duration_days else None

                                logger.info('TELEBIRR WEBHOOK - CREATING ONE-OFF SUBSCRIPTION')
                                logger.info('TELEBIRR WEBHOOK - USER: %s', target_user.username if target_user else '(new, pending setup)')
                                logger.info('TELEBIRR WEBHOOK - DURATION_TYPE: %s, DURATION_DAYS: %s', duration_type, duration_days)
                                logger.info('TELEBIRR WEBHOOK - END_DATE: %s', end_date)

                                # Expire existing active plans only when we have a known user
                                if target_user:
                                    SubscriptionPlan.objects.filter(
                                        user=target_user, status='active'
                                    ).update(status='expired')

                                subscription_plan = SubscriptionPlan.objects.create(
                                    user=target_user,
                                    tier=tier,
                                    status='active',
                                    duration_type=duration_type,
                                    start_date=now,
                                    end_date=end_date,
                                    next_renewal_date=None,
                                    auto_renew=False,
                                    payment_method='telebirr',
                                    telebirr_phone_number=phone,
                                    onevas_phone_number=phone,
                                    subscription_source='app',
                                )
                                logger.info('TELEBIRR WEBHOOK - SUBSCRIPTION PLAN CREATED: ID=%s', subscription_plan.id)

                                # Link the subscription to the DirectDebitMandate
                                mandate.subscription_plan = subscription_plan
                                mandate.save(update_fields=['subscription_plan'])
                                logger.info('TELEBIRR WEBHOOK - LINKED SUBSCRIPTION TO MANDATE: %s', mandate.id)

                                # Send OTP SMS for new users
                                if is_new_user:
                                    try:
                                        from .services.otp_service import OTPService
                                        from .views_subscription import OnevasWebhookView

                                        otp_code = OTPService.generate_otp()
                                        subscription_plan.setup_otp = otp_code
                                        subscription_plan.setup_otp_expires_at = now + timedelta(minutes=30)

                                        meta = subscription_plan.metadata or {}
                                        meta['is_new_user'] = is_new_user
                                        subscription_plan.metadata = meta
                                        subscription_plan.save(update_fields=['setup_otp', 'setup_otp_expires_at', 'metadata'])

                                        message = f"You have successfully subscribed. Your OTP is: {otp_code}. Please use this to log in."
                                        sms_ok = OnevasWebhookView().send_sms(phone, message, duration_type)
                                        logger.info('TELEBIRR WEBHOOK - SETUP SMS SENT (ok=%s) TO %s WITH OTP %s', sms_ok, phone, otp_code)
                                    except Exception as sms_err:
                                        logger.exception('TELEBIRR WEBHOOK - FAILED TO SEND SETUP OTP SMS')

                                # Mark mandate as active
                                mandate.status = 'active'
                                mandate.save(update_fields=['status'])
                                logger.info('TELEBIRR WEBHOOK - MANDATE MARKED AS ACTIVE')
                        except Exception as sub_err:
                            logger.exception('TELEBIRR WEBHOOK - ERROR CREATING SUBSCRIPTION')
                            mandate.mark_failed(f'Subscription creation failed: {sub_err}')
                else:
                    # This is the mandate creation webhook - initiate debit
                    # Initiate the actual debit before adding coins
                    from .telebirr_direct_debit_service import telebirr_direct_debit_service
                    amount = mandate.metadata.get('amount', 10)  # Default 10 ETB
                    payer_reference = mandate.payer_reference_number

                    logger.info('TELEBIRR WEBHOOK - INITIATING DEBIT FOR ONE-OFF PAYMENT')
                    logger.info('TELEBIRR WEBHOOK - AMOUNT: %s ETB', amount)
                    logger.info('TELEBIRR WEBHOOK - PAYER REFERENCE: %s', payer_reference)
                    logger.info('TELEBIRR WEBHOOK - MANDATE ID (if available): %s', mandate.mandate_id)

                    debit_result = telebirr_direct_debit_service.initiate_debit(
                        payer_reference_number=payer_reference,
                        amount=amount,
                        currency='ETB',
                        mandate_id=mandate.mandate_id if mandate.mandate_id else None,
                        debug=False
                    )
                
                logger.info('TELEBIRR WEBHOOK - DEBIT RESULT: %s', debit_result)
                
                if debit_result.get('success'):
                    logger.info('TELEBIRR WEBHOOK - DEBIT INITIATED SUCCESSFULLY')
                    logger.info('TELEBIRR WEBHOOK - TRANSACTION ID: %s', debit_result.get('transaction_id'))
                    # Store the debit initiation conversation ID for matching transaction result webhook
                    if debit_result.get('originator_conversation_id'):
                        mandate.debit_conversation_id = debit_result.get('originator_conversation_id')
                        mandate.save(update_fields=['debit_conversation_id'])
                        logger.info('TELEBIRR WEBHOOK - STORED DEBIT CONVERSATION ID: %s', mandate.debit_conversation_id)

                    # IMPORTANT: Do NOT add coins here - wait for transaction result webhook
                    # Coins should only be added when the actual payment is confirmed successful
                    logger.info('TELEBIRR WEBHOOK - DEBIT INITIATED, WAITING FOR TRANSACTION RESULT')
                    logger.info('TELEBIRR WEBHOOK - COINS WILL BE ADDED ON SUCCESSFUL TRANSACTION RESULT')

                    # Determine what this one-off payment is for: coin purchase or
                    # a one-off (non-recurring) subscription.
                    purchase_type = (mandate.metadata or {}).get('purchase_type', 'coins')
                    logger.info('TELEBIRR WEBHOOK - ONE-OFF PURCHASE TYPE: %s', purchase_type)

                    if purchase_type == 'subscription':
                        # ---- ONE-OFF SUBSCRIPTION (manual renewal, NO auto-renew) ----
                        # IMPORTANT: Do NOT create subscription here - wait for transaction result webhook
                        # Subscription should only be activated when the actual payment is confirmed successful
                        logger.info('TELEBIRR WEBHOOK - SUBSCRIPTION PURCHASE, WAITING FOR TRANSACTION RESULT')
                        logger.info('TELEBIRR WEBHOOK - SUBSCRIPTION WILL BE ACTIVATED ON SUCCESSFUL TRANSACTION RESULT')
                    else:
                        # ---- ONE-OFF COIN PURCHASE (existing behaviour) ----
                        # IMPORTANT: Do NOT add coins here - wait for transaction result webhook
                        # Coins should only be added when the actual payment is confirmed successful
                        logger.info('TELEBIRR WEBHOOK - COIN PURCHASE, WAITING FOR TRANSACTION RESULT')
                        logger.info('TELEBIRR WEBHOOK - COINS WILL BE ADDED ON SUCCESSFUL TRANSACTION RESULT')
                else:
                    logger.error('TELEBIRR WEBHOOK - DEBIT INITIATION FAILED')
                    logger.error('TELEBIRR WEBHOOK - ERROR: %s', debit_result.get('error'))
                    logger.error('TELEBIRR WEBHOOK - RESPONSE CODE: %s', debit_result.get('response_code'))
                    mandate.mark_failed(f'Debit initiation failed: {debit_result.get("error")}')
            else:
                logger.info('TELEBIRR WEBHOOK - RECURRING MANDATE DETECTED')
                # Handle recurring mandates
                if not mandate.user:
                    # Look up or create user by phone number
                    logger.info('TELEBIRR WEBHOOK - ANONYMOUS MANDATE, LOOKING UP USER BY PHONE: %s', mandate.payer_msisdn)
                    from .models import UserProfile
                    from django.contrib.auth import get_user_model
                    User = get_user_model()

                    # Try to find user by phone number (check all formats)
                    phone = mandate.payer_msisdn
                    phone_variants = [phone]
                    if phone.startswith('251') and len(phone) == 12:
                        phone_variants.append('0' + phone[3:])       # 0911...
                        phone_variants.append('+' + phone)            # +251911...
                    elif phone.startswith('0') and len(phone) == 10:
                        phone_variants.append('251' + phone[1:])     # 251911...
                        phone_variants.append('+251' + phone[1:])    # +251911...
                    
                    from django.db.models import Q
                    profile = UserProfile.objects.filter(
                        Q(phone_number__in=phone_variants)
                    ).first()
                    if profile:
                        mandate.user = profile.user
                        mandate.save()
                        logger.info('TELEBIRR WEBHOOK - FOUND EXISTING USER BY PHONE: %s', profile.user.username)
                    else:
                        # Create new user with phone number (only if no existing account)
                        logger.info('TELEBIRR WEBHOOK - NO USER FOUND, CREATING NEW USER FOR PHONE: %s', mandate.payer_msisdn)
                        username = f'telebirr_{mandate.payer_msisdn}'
                        import secrets
                        temp_password = secrets.token_urlsafe(16)
                        
                        # Handle duplicate usernames by adding random suffix
                        while User.objects.filter(username=username).exists():
                            random_suffix = secrets.token_hex(4)
                            username = f'telebirr_{mandate.payer_msisdn}_{random_suffix}'
                        
                        new_user = User.objects.create_user(
                            username=username,
                            password=temp_password,
                            is_active=True
                        )
                        UserProfile.objects.get_or_create(
                            user=new_user,
                            defaults={'phone_number': mandate.payer_msisdn}
                        )
                        mandate.user = new_user
                        mandate.save()
                        logger.info('TELEBIRR WEBHOOK - CREATED NEW USER: %s', new_user.username)

                if mandate.status == 'pending_created':
                    # STEP 1 CALLBACK: Create mandate succeeded on Telebirr side
                    # Mandate is now "Pending Active" on Telebirr — we need to query MandateID then activate
                    logger.info('TELEBIRR WEBHOOK - STEP 1: CREATE CALLBACK RECEIVED')
                    
                    # Query Telebirr for MandateID
                    from .telebirr_direct_debit_service import telebirr_direct_debit_service
                    import re
                    telebirr_mandate_id = None
                    
                    logger.info('TELEBIRR WEBHOOK - QUERYING TELEBIRR FOR MANDATE ID (phone: %s)', mandate.payer_msisdn)
                    try:
                        query_result = telebirr_direct_debit_service.query_mandate_by_payer(
                            payer_msisdn=mandate.payer_msisdn,
                            mandate_statuses=['01']  # 01 = Pending Active
                        )
                        if query_result.get('success') and query_result.get('response_text'):
                            response_text = query_result['response_text']
                            logger.info('TELEBIRR WEBHOOK - QUERY RESPONSE: %s', response_text[:1000])
                            mandate_id_match = re.search(r'<(?:com:|res:)?MandateID>([^<]+)</(?:com:|res:)?MandateID>', response_text)
                            if mandate_id_match:
                                telebirr_mandate_id = mandate_id_match.group(1).strip()
                                mandate.mandate_id = telebirr_mandate_id[:18]
                                logger.info('TELEBIRR WEBHOOK - GOT MANDATE ID FROM QUERY: %s', telebirr_mandate_id)
                            else:
                                logger.warning('TELEBIRR WEBHOOK - QUERY SUCCESS BUT NO MANDATE ID FOUND IN RESPONSE')
                        else:
                            logger.warning('TELEBIRR WEBHOOK - QUERY FAILED: %s', query_result.get('error', 'Unknown'))
                    except Exception as query_err:
                        logger.warning('TELEBIRR WEBHOOK - QUERY EXCEPTION: %s', str(query_err))
                    
                    if telebirr_mandate_id:
                        # Call Activate Mandate API
                        logger.info('TELEBIRR WEBHOOK - CALLING ACTIVATE MANDATE API (MandateID: %s)', telebirr_mandate_id)
                        try:
                            activate_result = telebirr_direct_debit_service.activate_mandate(
                                mandate_id=telebirr_mandate_id,
                                payer_msisdn=mandate.payer_msisdn,
                                agreed_tc=True
                            )
                            if activate_result.get('success'):
                                logger.info('TELEBIRR WEBHOOK - ACTIVATE API ACCEPTED: %s', activate_result.get('message'))
                                mandate.status = 'pending_active'
                                mandate.save()
                                logger.info('TELEBIRR WEBHOOK - TRANSITION: pending_created -> pending_active (awaiting activate callback)')
                            else:
                                logger.error('TELEBIRR WEBHOOK - ACTIVATE API FAILED: %s', activate_result.get('error'))
                                # Still save mandate_id and move forward
                                mandate.status = 'pending_active'
                                mandate.save()
                        except Exception as activate_err:
                            logger.error('TELEBIRR WEBHOOK - ACTIVATE EXCEPTION: %s', str(activate_err))
                            mandate.status = 'pending_active'
                            mandate.save()
                    else:
                        # No MandateID from query — still transition to pending_active
                        logger.warning('TELEBIRR WEBHOOK - NO MANDATE ID AVAILABLE, CANNOT CALL ACTIVATE API')
                        mandate.status = 'pending_active'
                        mandate.save()

                elif mandate.status == 'pending_active':
                    # STEP 2 CALLBACK: Activate mandate succeeded on Telebirr side
                    # Mandate is now fully Active — create subscription and enable transactions
                    logger.info('TELEBIRR WEBHOOK - STEP 2: ACTIVATE CALLBACK RECEIVED')
                    mandate.activate()  # sets status='active', activated_at, and saves
                    logger.info('TELEBIRR WEBHOOK - MANDATE FULLY ACTIVATED')

                    # Create subscription plan
                    from .models_subscription import SubscriptionPlan
                    tier = mandate.tier
                    if tier and mandate.user:
                        logger.info('TELEBIRR WEBHOOK - CREATING SUBSCRIPTION PLAN FOR TIER: %s', tier.name)
                        subscription_plan = SubscriptionPlan.objects.create(
                            user=mandate.user,
                            tier=tier,
                            status='active',
                            duration_type=tier.duration_type,
                            start_date=timezone.now(),
                            end_date=timezone.now() + timedelta(days=tier.duration_days) if tier.duration_days else None,
                            next_renewal_date=timezone.now() + timedelta(days=tier.duration_days) if tier.duration_days else None,
                            auto_renew=True,
                            payment_method='telebirr_direct_debit',
                            mandate_contract_id=mandate.mandate_id,
                            telebirr_phone_number=mandate.payer_msisdn
                        )
                        logger.info('TELEBIRR WEBHOOK - SUBSCRIPTION PLAN CREATED: ID=%s', subscription_plan.id)

                        # Initiate first transaction immediately
                        if mandate.mandate_id:
                            logger.info('TELEBIRR WEBHOOK - INITIATING FIRST TRANSACTION (Amount: %s ETB)', tier.price_etb)
                            try:
                                from .telebirr_direct_debit_service import telebirr_direct_debit_service
                                txn_result = telebirr_direct_debit_service.initiate_debit(
                                    payer_reference_number=mandate.payer_reference_number,
                                    amount=str(tier.price_etb),
                                    currency='ETB',
                                    mandate_id=mandate.mandate_id
                                )
                                if txn_result.get('success'):
                                    logger.info('TELEBIRR WEBHOOK - FIRST TRANSACTION INITIATED: %s', txn_result.get('message'))
                                else:
                                    logger.error('TELEBIRR WEBHOOK - FIRST TRANSACTION FAILED: %s', txn_result.get('error'))
                            except Exception as txn_err:
                                logger.error('TELEBIRR WEBHOOK - FIRST TRANSACTION EXCEPTION: %s', str(txn_err))
                        else:
                            logger.warning('TELEBIRR WEBHOOK - NO MANDATE ID, CANNOT INITIATE FIRST TRANSACTION')
                    elif not tier:
                        logger.warning('TELEBIRR WEBHOOK - NO TIER FOUND ON MANDATE, CANNOT CREATE SUBSCRIPTION')
                    elif not mandate.user:
                        logger.warning('TELEBIRR WEBHOOK - NO USER ON MANDATE, CANNOT CREATE SUBSCRIPTION')
                else:
                    logger.info('TELEBIRR WEBHOOK - MANDATE STATUS: %s (no transition needed)', mandate.status)
                    mandate.save()
        else:
            logger.warning('TELEBIRR WEBHOOK - PROCESSING FAILURE RESPONSE')
            logger.warning('TELEBIRR WEBHOOK - FAILURE REASON: %s', result_desc or f'ResultCode={result_code}')
            
            # Rollback coins if they were added prematurely for one-off coin purchases
            if mandate.payment_type == 'one_off' and mandate.status == 'active':
                purchase_type = (mandate.metadata or {}).get('purchase_type', 'coins')
                if purchase_type == 'coins' and mandate.user:
                    logger.warning('TELEBIRR WEBHOOK - ROLLING BACK COINS FOR FAILED TRANSACTION')
                    try:
                        from .models_contest import UserCoinBalance
                        coin_balance = UserCoinBalance.objects.filter(user=mandate.user).first()
                        if coin_balance:
                            coins_to_deduct = mandate.metadata.get('coins', 100)
                            logger.warning('TELEBIRR WEBHOOK - DEDUCTING %s COINS FROM USER %s', coins_to_deduct, mandate.user.username)
                            logger.warning('TELEBIRR WEBHOOK - CURRENT BALANCE BEFORE ROLLBACK: %s', coin_balance.balance)

                            # Deduct the coins that were added
                            coin_balance.spend_coins(coins_to_deduct, 'rollback', description=f'Rollback failed payment {mandate.id}')

                            profile = mandate.user.profile
                            profile.coins = coin_balance.balance
                            profile.save(update_fields=['coins'])
                            logger.warning('TELEBIRR WEBHOOK - BALANCE AFTER ROLLBACK: %s', coin_balance.balance)
                            logger.warning('TELEBIRR WEBHOOK - COINS ROLLED BACK SUCCESSFULLY')
                    except Exception as rollback_err:
                        logger.error('TELEBIRR WEBHOOK - ERROR ROLLING BACK COINS: %s', str(rollback_err))
                        logger.exception('TELEBIRR WEBHOOK - ROLLBACK TRACEBACK')
                elif purchase_type == 'subscription' and mandate.subscription_plan:
                    # Cancel subscription if it was created but payment failed
                    logger.warning('TELEBIRR WEBHOOK - CANCELLING SUBSCRIPTION FOR FAILED TRANSACTION')
                    try:
                        from .models_subscription import SubscriptionPlan
                        subscription_plan = mandate.subscription_plan
                        if subscription_plan and subscription_plan.status == 'active':
                            subscription_plan.status = 'cancelled'
                            subscription_plan.save(update_fields=['status'])
                            logger.warning('TELEBIRR WEBHOOK - SUBSCRIPTION CANCELLED: ID=%s', subscription_plan.id)
                    except Exception as sub_rollback_err:
                        logger.error('TELEBIRR WEBHOOK - ERROR CANCELLING SUBSCRIPTION: %s', str(sub_rollback_err))
                        logger.exception('TELEBIRR WEBHOOK - SUBSCRIPTION ROLLBACK TRACEBACK')
            
            mandate.mark_failed(result_desc or f'ResultCode={result_code}')
            logger.warning('TELEBIRR WEBHOOK - MANDATE MARKED AS FAILED')

        logger.info('TELEBIRR WEBHOOK - PROCESSING COMPLETE')
        logger.info('=' * 80)
        return Response({'success': True})

    except Exception as e:
        logger.error('TELEBIRR WEBHOOK - EXCEPTION: %s', str(e))
        logger.exception('TELEBIRR WEBHOOK - FULL TRACEBACK')
        logger.info('=' * 80)
        # Don't bubble 500s back to Telebirr; just log and ack.
        return Response({'success': True})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def initiate_direct_debit(request):
    """
    Manually initiate a direct debit transaction (for testing or manual renewal)
    
    Request Body:
    {
        "mandate_id": "uuid",
        "amount": 100.00
    }
    """
    try:
        user = request.user
        mandate_id = request.data.get('mandate_id')
        amount = request.data.get('amount')
        
        # Validate required fields
        if not all([mandate_id, amount]):
            return Response(
                {'error': 'mandate_id and amount are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get mandate
        try:
            mandate = DirectDebitMandate.objects.get(id=mandate_id, user=user)
        except DirectDebitMandate.DoesNotExist:
            return Response(
                {'error': 'Mandate not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Check if mandate is active
        if not mandate.is_active():
            return Response(
                {'error': f'Mandate is {mandate.status}, cannot initiate debit'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not mandate.mandate_id:
            return Response(
                {'error': 'Mandate has no Telebirr MandateID yet, cannot initiate debit.'},
                status=status.HTTP_409_CONFLICT
            )

        # Create transaction record
        transaction = DirectDebitTransaction.objects.create(
            mandate=mandate,
            amount=Decimal(str(amount)),
            currency='ETB',
            status='pending'
        )

        # Call Telebirr service to initiate debit
        result = telebirr_direct_debit_service.initiate_debit(
            payer_reference_number=mandate.payer_reference_number,
            amount=amount,
            currency='ETB',
            shortcode=mandate.payee_identifier_value,
            mandate_id=mandate.mandate_id
        )
        
        if not result.get('success'):
            transaction.mark_failed(result.get('error'))
            return Response(
                {'error': result.get('error', 'Direct debit initiation failed')},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        # Update transaction
        transaction.originator_conversation_id = result.get('originator_conversation_id')
        transaction.conversation_id = result.get('conversation_id')
        transaction.telebirr_transaction_id = result.get('transaction_id')
        transaction.save()

        return Response({
            'success': True,
            'transaction_id': str(transaction.id),
            'status': transaction.status,
            'message': 'Direct debit initiated successfully'
        })
        
    except Exception as e:
        return Response(
            {'error': f'Failed to initiate direct debit: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_one_off_coin_purchase(request):
    """
    Create a one-off payment for coin purchasing via Telebirr Direct Debit
    
    Request Body:
    {
        "amount": 10.00,
        "coins": 100
    }
    
    Returns:
    {
        "success": true,
        "mandate_id": "uuid",
        "originator_conversation_id": "S_X20260519...",
        "message": "One-off payment request accepted"
    }
    """
    try:
        user = request.user
        amount = request.data.get('amount')
        coins = request.data.get('coins', 100)
        
        # Validate required fields
        if not amount:
            return Response(
                {'error': 'amount is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get user's phone number from profile
        from .models import UserProfile
        try:
            profile = user.profile
            payer_msisdn = profile.phone_number
            if not payer_msisdn:
                return Response(
                    {'error': 'Phone number not found in profile'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        except UserProfile.DoesNotExist:
            return Response(
                {'error': 'User profile not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Normalize phone number to 251 format
        from .views import _normalize_ethiopian_phone
        normalized_phone = _normalize_ethiopian_phone(payer_msisdn)
        if normalized_phone:
            payer_msisdn = normalized_phone
            logger.info(f"Normalized phone number: {payer_msisdn}")
        else:
            logger.warning(f"Could not normalize phone number: {payer_msisdn}")
        
        # Generate unique payer reference number
        payer_reference_number = f"COIN_{user.id}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        # Call Telebirr service to create one-off payment
        result = telebirr_direct_debit_service.create_one_off_payment(
            payer_msisdn=payer_msisdn,
            payer_reference_number=payer_reference_number,
            frequency='01',
            first_payment_date=datetime.now().date(),
            expiry_date=datetime.now().date()
        )
        
        if not result.get('success'):
            return Response(
                {'error': result.get('error', 'One-off payment request failed')},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        # Create mandate record with payment_type='one_off'
        mandate = DirectDebitMandate.objects.create(
            user=user,
            payer_msisdn=payer_msisdn,
            payer_reference_number=payer_reference_number,
            payee_identifier_type=4,
            payee_identifier_value=telebirr_direct_debit_service.shortcode,
            payee_account_name=telebirr_direct_debit_service.payee_account_name,
            status='pending_created',
            payment_type='one_off',
            frequency='01',
            first_payment_date=datetime.now().date(),
            expiry_date=datetime.now().date(),
            agreed_tc=True,
            originator_conversation_id=result.get('originator_conversation_id'),
            conversation_id=result.get('conversation_id'),
            metadata={
                'coins': coins,
                'amount': amount
            }
        )
        
        return Response({
            'success': True,
            'mandate_id': str(mandate.id),
            'originator_conversation_id': result.get('originator_conversation_id'),
            'conversation_id': result.get('conversation_id'),
            'message': 'One-off payment request accepted successfully. Wait for mandate activation.',
            'coins': coins,
            'amount': amount
        })
        
    except Exception as e:
        return Response(
            {'error': f'Failed to create one-off payment: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['POST'])
@permission_classes([AllowAny])
def create_one_off_subscription(request):
    """
    Create a ONE-OFF (non-recurring) subscription payment via Telebirr Direct Debit.

    The user pays ONCE for the selected period (daily / weekly / monthly). When the
    period ends the subscription simply expires and the user must renew manually by
    triggering this endpoint again (mimics the one-off coin purchase logic, but with
    the tier's respective frequency stored for reference).

    Works for both logged-in and anonymous callers (matching the old recurring flow):
    when anonymous, the user is resolved/created by phone number in the webhook.

    Request Body:
    {
        "tier_id": "uuid",
        "payer_msisdn": "251911234567"   # required if not logged in; else falls back to profile phone
    }

    Returns:
    {
        "success": true,
        "mandate_id": "uuid",
        "originator_conversation_id": "S_X...",
        "message": "One-off subscription payment request accepted"
    }
    """
    try:
        user = request.user if request.user.is_authenticated else None
        tier_id = request.data.get('tier_id')
        payer_msisdn = request.data.get('payer_msisdn')

        if not tier_id:
            return Response(
                {'error': 'tier_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Resolve phone number (request body first, then user profile if logged in)
        from .models import UserProfile
        if not payer_msisdn and user:
            try:
                payer_msisdn = user.profile.phone_number
            except UserProfile.DoesNotExist:
                payer_msisdn = None
        if not payer_msisdn:
            return Response(
                {'error': 'Phone number not found. Please provide payer_msisdn.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Normalize phone number to 251 format
        from .views import _normalize_ethiopian_phone
        normalized_phone = _normalize_ethiopian_phone(payer_msisdn)
        if normalized_phone:
            payer_msisdn = normalized_phone
            logger.info(f"[ONE-OFF SUB] Normalized phone number: {payer_msisdn}")

        # Resolve subscription tier - try UUID first, then fall back to
        # onevas_code / duration_type (mirrors the old recurring view).
        try:
            tier = SubscriptionTier.objects.get(id=tier_id)
            logger.info(f"[ONE-OFF SUB] Found tier by id: {tier.name} ({tier.duration_type})")
        except (SubscriptionTier.DoesNotExist, ValueError):
            logger.warning(f"[ONE-OFF SUB] Tier not found with id={tier_id}, trying alternative lookup")
            try:
                tier = SubscriptionTier.objects.get(onevas_code=str(tier_id))
                logger.info(f"[ONE-OFF SUB] Found tier via onevas_code: {tier.name} ({tier.duration_type})")
            except SubscriptionTier.DoesNotExist:
                duration_type_map = {1: 'daily', 2: 'weekly', 3: 'monthly'}
                duration_type = duration_type_map.get(int(tier_id) if str(tier_id).isdigit() else None)
                if duration_type:
                    tier = SubscriptionTier.objects.filter(duration_type=duration_type, is_active=True).first()
                    if tier:
                        logger.info(f"[ONE-OFF SUB] Found tier via duration_type fallback: {tier.name}")
                    else:
                        return Response(
                            {'error': f'No active subscription tier found for {duration_type}'},
                            status=status.HTTP_400_BAD_REQUEST
                        )
                else:
                    return Response(
                        {'error': 'Invalid subscription tier'},
                        status=status.HTTP_400_BAD_REQUEST
                    )

        # Map duration to Telebirr frequency (stored in metadata for reference)
        frequency_map = {'daily': '02', 'weekly': '03', 'monthly': '05'}
        if tier.duration_type not in frequency_map:
            return Response(
                {'error': 'This tier does not support Telebirr subscription'},
                status=status.HTTP_400_BAD_REQUEST
            )
        intended_frequency = frequency_map[tier.duration_type]

        # Generate unique payer reference number (works for anonymous callers too)
        user_ref = user.id if user else 'ANON'
        payer_reference_number = f"SUB_{user_ref}_{datetime.now().strftime('%Y%m%d%H%M%S')}"

        logger.info("[ONE-OFF SUB] Creating one-off subscription payment")
        logger.info(f"[ONE-OFF SUB]   user={user.username if user else 'anonymous'} tier={tier.name} "
                    f"duration={tier.duration_type} amount={tier.price_etb} phone={payer_msisdn}")

        # Call Telebirr to create a one-off payment (frequency '01' = Once).
        # We charge once now; the intended recurring frequency is only stored
        # in metadata since this is a manual-renewal (non-recurring) flow.
        result = telebirr_direct_debit_service.create_one_off_payment(
            payer_msisdn=payer_msisdn,
            payer_reference_number=payer_reference_number,
            frequency='01',
            first_payment_date=datetime.now().date(),
            expiry_date=datetime.now().date()
        )

        if not result.get('success'):
            return Response(
                {'error': result.get('error', 'Subscription payment request failed')},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        # Create mandate record with payment_type='one_off' and subscription metadata
        mandate = DirectDebitMandate.objects.create(
            user=user,
            tier=tier,
            payer_msisdn=payer_msisdn,
            payer_reference_number=payer_reference_number,
            payee_identifier_type=4,
            payee_identifier_value=telebirr_direct_debit_service.shortcode,
            payee_account_name=telebirr_direct_debit_service.payee_account_name,
            status='pending_created',
            payment_type='one_off',
            frequency='01',
            first_payment_date=datetime.now().date(),
            expiry_date=datetime.now().date(),
            agreed_tc=True,
            originator_conversation_id=result.get('originator_conversation_id'),
            conversation_id=result.get('conversation_id'),
            metadata={
                'purchase_type': 'subscription',
                'tier_id': str(tier.id),
                'duration_type': tier.duration_type,
                'duration_days': tier.duration_days,
                'amount': str(tier.price_etb),
                'frequency': intended_frequency,
            }
        )

        logger.info(f"[ONE-OFF SUB] Mandate created: {mandate.id} (ref={payer_reference_number})")

        return Response({
            'success': True,
            'mandate_id': str(mandate.id),
            'originator_conversation_id': result.get('originator_conversation_id'),
            'conversation_id': result.get('conversation_id'),
            'message': 'One-off subscription payment request accepted. Wait for activation.',
            'tier': tier.name,
            'amount': str(tier.price_etb),
        })

    except Exception as e:
        logger.exception('[ONE-OFF SUB] Failed to create subscription payment')
        return Response(
            {'error': f'Failed to create subscription payment: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([AllowAny])
def check_mandate_status(request):
    """
    Check the status of a one-off payment mandate
    
    Query Parameters:
        mandate_id: The mandate UUID
    
    Returns:
    {
        "success": true,
        "status": "active" | "pending_created" | "failed",
        "coins_added": true | false
    }
    """
    try:
        mandate_id = request.GET.get('mandate_id')
        if not mandate_id:
            return Response(
                {'error': 'mandate_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Look up by mandate UUID (unguessable). If the caller is authenticated,
        # enforce ownership; anonymous subscription flows poll by mandate_id only.
        qs = DirectDebitMandate.objects.filter(id=mandate_id)
        if request.user.is_authenticated:
            qs = qs.filter(Q(user=request.user) | Q(user__isnull=True))
        mandate = qs.first()
        if not mandate:
            return Response(
                {'error': 'Mandate not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        purchase_type = (mandate.metadata or {}).get('purchase_type', 'coins')
        is_completed = mandate.status == 'active' and mandate.payment_type == 'one_off'
        # coins_added kept for backward-compat with coin purchase frontend
        coins_added = is_completed and purchase_type != 'subscription'
        # subscription_active for the one-off subscription frontend
        subscription_active = is_completed and purchase_type == 'subscription'
        
        # Get is_new_user flag from subscription metadata for frontend redirection
        is_new_user = False
        if mandate.subscription_plan and mandate.subscription_plan.metadata:
            is_new_user = mandate.subscription_plan.metadata.get('is_new_user', False)

        return Response({
            'success': True,
            'status': mandate.status,
            'coins_added': coins_added,
            'subscription_active': subscription_active,
            'completed': is_completed,
            'purchase_type': purchase_type,
            'payment_type': mandate.payment_type,
            'is_new_user': is_new_user
        })
        
    except Exception as e:
        return Response(
            {'error': f'Failed to check mandate status: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def initiate_b2c_payment(request):
    """
    Initiate Individual B2C Payment Transaction
    
    Pays individual customers one by one. Used for salaries, relief, 
    allowances, rewards, bonuses, interest payments, etc.
    
    Request Body:
    {
        "receiver_msisdn": "251911234567",
        "amount": 100.00,
        "currency": "ETB",
        "reason_type": "Pay for Individual B2C_VDF_Demo",
        "remark": "Salary payment",
        "reference_data": {"POSDeviceID": "POS234789"},
        "initiator_type": "org_operator"
    }
    
    Returns:
    {
        "success": true,
        "transaction_id": "uuid",
        "originator_conversation_id": "S_X20260519...",
        "conversation_id": "AG_20260519...",
        "message": "B2C payment initiated successfully"
    }
    """
    try:
        user = request.user
        receiver_msisdn = request.data.get('receiver_msisdn')
        amount = request.data.get('amount')
        currency = request.data.get('currency', 'ETB')
        reason_type = request.data.get('reason_type')
        remark = request.data.get('remark', '')
        reference_data = request.data.get('reference_data', {})
        initiator_type = request.data.get('initiator_type', 'org_operator')
        
        # Validate required fields
        if not all([receiver_msisdn, amount]):
            return Response(
                {'error': 'receiver_msisdn and amount are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Set default amount to 1000 ETB if not provided
        if not amount:
            amount = 1000

        # Validate amount
        try:
            amount_decimal = Decimal(str(amount))
            if amount_decimal <= 0:
                return Response(
                    {'error': 'Amount must be greater than 0'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        except (ValueError, TypeError):
            return Response(
                {'error': 'Invalid amount format'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Call Telebirr service to initiate B2C payment
        result = telebirr_direct_debit_service.initiate_b2c_payment(
            receiver_msisdn=receiver_msisdn,
            amount=amount_decimal,
            currency=currency,
            reason_type=reason_type,
            remark=remark,
            reference_data=reference_data,
            initiator_type=initiator_type
        )
        
        if not result.get('success'):
            return Response(
                {'error': result.get('error', 'B2C payment initiation failed')},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        # Create B2C payment transaction record
        transaction = B2CPaymentTransaction.objects.create(
            payer=user,
            receiver_msisdn=receiver_msisdn,
            amount=amount_decimal,
            currency=currency,
            reason_type=reason_type or telebirr_direct_debit_service.b2c_reason_type,
            remark=remark,
            reference_data=reference_data,
            originator_conversation_id=result.get('originator_conversation_id'),
            conversation_id=result.get('conversation_id'),
            status='pending'
        )
        
        return Response({
            'success': True,
            'transaction_id': str(transaction.id),
            'originator_conversation_id': result.get('originator_conversation_id'),
            'conversation_id': result.get('conversation_id'),
            'message': 'B2C payment initiated successfully'
        }, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        return Response(
            {'error': f'Failed to initiate B2C payment: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_b2c_payments(request):
    """
    List B2C payment transactions for the authenticated user
    
    Query params:
    - status: Filter by status (pending, success, failed, timeout)
    """
    try:
        user = request.user
        status_filter = request.query_params.get('status')
        
        transactions = B2CPaymentTransaction.objects.filter(payer=user)
        
        if status_filter:
            transactions = transactions.filter(status=status_filter)
        
        transactions = transactions.order_by('-created_at')
        
        transaction_data = []
        for transaction in transactions:
            transaction_data.append({
                'id': str(transaction.id),
                'receiver_msisdn': transaction.receiver_msisdn,
                'amount': str(transaction.amount),
                'currency': transaction.currency,
                'reason_type': transaction.reason_type,
                'remark': transaction.remark,
                'status': transaction.status,
                'telebirr_transaction_id': transaction.telebirr_transaction_id,
                'created_at': transaction.created_at,
                'completed_at': transaction.completed_at,
            })
        
        return Response({
            'success': True,
            'transactions': transaction_data
        })
        
    except Exception as e:
        return Response(
            {'error': f'Failed to list B2C payments: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def query_mandate_from_telebirr(request):
    """
    Query mandate status directly from Telebirr
    
    Query params:
    - payer_msisdn: Payer phone number (required)
    - mandate_statuses: Optional comma-separated list of mandate status codes (e.g., '03,01')
    """
    try:
        payer_msisdn = request.query_params.get('payer_msisdn')
        mandate_statuses_param = request.query_params.get('mandate_statuses')
        
        if not payer_msisdn:
            return Response(
                {'error': 'payer_msisdn is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Parse mandate statuses if provided
        mandate_statuses = None
        if mandate_statuses_param:
            mandate_statuses = mandate_statuses_param.split(',')
        
        logger.info(f"Querying mandate from Telebirr for payer_msisdn: {payer_msisdn}")
        
        result = telebirr_direct_debit_service.query_mandate_by_payer(
            payer_msisdn=payer_msisdn,
            mandate_statuses=mandate_statuses,
            debug=True
        )
        
        if result.get('success'):
            return Response({
                'success': True,
                'message': result.get('message'),
                'response_code': result.get('response_code'),
                'conversation_id': result.get('conversation_id'),
                'response_text': result.get('response_text')
            })
        else:
            return Response(
                {'error': result.get('error')},
                status=status.HTTP_400_BAD_REQUEST
            )
        
    except Exception as e:
        logger.error(f"Failed to query mandate from Telebirr: {str(e)}")
        return Response(
            {'error': f'Failed to query mandate: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['POST'])
@permission_classes([AllowAny])  # Telebirr calls this webhook
def telebirr_b2c_webhook(request):
    """
    Webhook endpoint for Telebirr B2C payment result callbacks
    
    Telebirr POSTs a SOAP Result envelope (Content-Type: text/xml)
    when a B2C payment is completed.
    """
    raw_body = request.body or b''
    logger.info('=' * 80)
    logger.info('TELEBIRR B2C WEBHOOK - REQUEST RECEIVED')
    logger.info('=' * 80)
    logger.info('Content-Type: %s', request.META.get('CONTENT_TYPE'))
    logger.info('Body Length: %d bytes', len(raw_body))
    logger.info('Raw Body (first 4000 chars): %s', raw_body[:4000])
    logger.info('-' * 80)

    try:
        # Parse SOAP result
        parsed = _parse_telebirr_soap_result(raw_body)
        
        logger.info('TELEBIRR B2C WEBHOOK - PARSED DATA')
        logger.info('Parsed: %s', parsed)
        logger.info('-' * 80)

        originator_conversation_id = parsed.get('OriginatorConversationID')
        result_code = parsed.get('ResultCode')
        result_type = parsed.get('ResultType')
        result_desc = parsed.get('ResultDesc') or ''
        transaction_id = parsed.get('TransactionID')

        logger.info('TELEBIRR B2C WEBHOOK - KEY FIELDS')
        logger.info('OriginatorConversationID: %s', originator_conversation_id)
        logger.info('ResultCode: %s', result_code)
        logger.info('ResultType: %s', result_type)
        logger.info('ResultDesc: %s', result_desc)
        logger.info('TransactionID: %s', transaction_id)
        logger.info('-' * 80)

        if not originator_conversation_id:
            logger.warning('TELEBIRR B2C WEBHOOK - ERROR: No OriginatorConversationID found, ignoring')
            return Response({'success': True})

        logger.info('TELEBIRR B2C WEBHOOK - LOOKING UP TRANSACTION')
        transaction = B2CPaymentTransaction.objects.filter(
            originator_conversation_id=originator_conversation_id
        ).first()

        if not transaction:
            # No B2CPaymentTransaction record (this happens for withdrawal-initiated
            # B2C payouts, which link directly to WithdrawalRequest instead of
            # creating a B2CPaymentTransaction). Try to resolve via WithdrawalRequest.
            logger.info('TELEBIRR B2C WEBHOOK - NO B2CPaymentTransaction MATCHED, TRYING WITHDRAWAL LOOKUP')
            from .models_wallet import WithdrawalRequest
            from .models import UserProfile

            withdrawal = WithdrawalRequest.objects.filter(
                originator_conversation_id=originator_conversation_id
            ).first()

            if not withdrawal:
                logger.warning('TELEBIRR B2C WEBHOOK - ERROR: No transaction or withdrawal matched OriginatorConversationID=%s', originator_conversation_id)
                return Response({'success': True})

            is_success = result_code == '0' and (result_type == '0' or result_type is None)
            logger.info('TELEBIRR B2C WEBHOOK - WITHDRAWAL FOUND: ID=%s, user=%s, status=%s, net_birr=%s',
                       withdrawal.id, withdrawal.user.username, withdrawal.status, withdrawal.net_birr)

            if withdrawal.status not in ('processing',):
                logger.info('TELEBIRR B2C WEBHOOK - WITHDRAWAL #%s STATUS IS %s (not processing), SKIPPING DUPLICATE UPDATE', withdrawal.id, withdrawal.status)
                return Response({'success': True})

            if is_success:
                withdrawal.status = 'completed'
                withdrawal.completed_at = timezone.now()
                withdrawal.payout_reference = transaction_id or ''
                withdrawal.save()
                logger.info('TELEBIRR B2C WEBHOOK - WITHDRAWAL #%s MARKED AS COMPLETED, payout_reference=%s',
                           withdrawal.id, transaction_id)
            else:
                withdrawal.status = 'failed'
                withdrawal.rejection_reason = f'B2C payment failed: {result_desc or f"ResultCode={result_code}"}'
                withdrawal.save()

                # Refund points to user
                user_profile = UserProfile.objects.get(user=withdrawal.user)
                user_profile.points += withdrawal.point_amount
                user_profile.points_withdrawn_total -= withdrawal.point_amount
                user_profile.save()

                logger.info('TELEBIRR B2C WEBHOOK - WITHDRAWAL #%s FAILED, %s POINTS REFUNDED TO USER %s',
                           withdrawal.id, withdrawal.point_amount, withdrawal.user.username)

            logger.info('TELEBIRR B2C WEBHOOK - PROCESSING COMPLETE (VIA WITHDRAWAL FALLBACK)')
            logger.info('=' * 80)
            return Response({'success': True})

        logger.info('TELEBIRR B2C WEBHOOK - TRANSACTION FOUND')
        logger.info('Transaction ID: %s', transaction.id)
        logger.info('Transaction Status: %s', transaction.status)
        logger.info('Transaction Payer: %s', transaction.payer.username)
        logger.info('Transaction Receiver: %s', transaction.receiver_msisdn)
        logger.info('Transaction Amount: %s', transaction.amount)
        logger.info('Transaction Reference Data: %s', transaction.reference_data)
        logger.info('-' * 80)

        is_success = result_code == '0' and (result_type == '0' or result_type is None)
        logger.info('TELEBIRR B2C WEBHOOK - SUCCESS CHECK: %s', is_success)

        if is_success:
            logger.info('TELEBIRR B2C WEBHOOK - PROCESSING SUCCESS RESPONSE')
            transaction.mark_success(transaction_id or '')
            logger.info('TELEBIRR B2C WEBHOOK - TRANSACTION MARKED AS SUCCESS')
            
            # Handle linked withdrawal request
            if transaction.reference_data and 'withdrawal_id' in transaction.reference_data:
                from .models_wallet import WithdrawalRequest
                try:
                    withdrawal = WithdrawalRequest.objects.get(id=transaction.reference_data['withdrawal_id'])
                    logger.info('TELEBIRR B2C WEBHOOK - WITHDRAWAL FOUND: ID=%s, user=%s, status=%s, net_birr=%s',
                               withdrawal.id, withdrawal.user.username, withdrawal.status, withdrawal.net_birr)
                    withdrawal.status = 'completed'
                    withdrawal.completed_at = timezone.now()
                    withdrawal.payout_reference = transaction_id or ''
                    withdrawal.save()
                    logger.info('TELEBIRR B2C WEBHOOK - WITHDRAWAL #%s MARKED AS COMPLETED, payout_reference=%s',
                               withdrawal.id, transaction_id)
                except WithdrawalRequest.DoesNotExist:
                    logger.warning('TELEBIRR B2C WEBHOOK - WITHDRAWAL #%s NOT FOUND', transaction.reference_data['withdrawal_id'])
        else:
            logger.warning('TELEBIRR B2C WEBHOOK - PROCESSING FAILURE RESPONSE')
            logger.warning('TELEBIRR B2C WEBHOOK - FAILURE REASON: %s', result_desc or f'ResultCode={result_code}')
            transaction.mark_failed(result_desc or f'ResultCode={result_code}')
            logger.warning('TELEBIRR B2C WEBHOOK - TRANSACTION MARKED AS FAILED')
            
            # Handle linked withdrawal request - refund points
            if transaction.reference_data and 'withdrawal_id' in transaction.reference_data:
                from .models_wallet import WithdrawalRequest
                from .models import UserProfile
                try:
                    withdrawal = WithdrawalRequest.objects.get(id=transaction.reference_data['withdrawal_id'])
                    logger.info('TELEBIRR B2C WEBHOOK - WITHDRAWAL FOUND FOR REFUND: ID=%s, user=%s, status=%s, point_amount=%s',
                               withdrawal.id, withdrawal.user.username, withdrawal.status, withdrawal.point_amount)
                    withdrawal.status = 'failed'
                    withdrawal.rejection_reason = f'B2C payment failed: {result_desc or f"ResultCode={result_code}"}'
                    withdrawal.save()
                    
                    # Refund points to user
                    user_profile = UserProfile.objects.get(user=withdrawal.user)
                    user_profile.points += withdrawal.point_amount
                    user_profile.points_withdrawn_total -= withdrawal.point_amount
                    user_profile.save()
                    
                    logger.info('TELEBIRR B2C WEBHOOK - WITHDRAWAL #%s FAILED, %s POINTS REFUNDED TO USER %s',
                               withdrawal.id, withdrawal.point_amount, withdrawal.user.username)
                except WithdrawalRequest.DoesNotExist:
                    logger.warning('TELEBIRR B2C WEBHOOK - WITHDRAWAL #%s NOT FOUND', transaction.reference_data['withdrawal_id'])

        logger.info('TELEBIRR B2C WEBHOOK - PROCESSING COMPLETE')
        logger.info('=' * 80)
        return Response({'success': True})

    except Exception as e:
        logger.error('TELEBIRR B2C WEBHOOK - EXCEPTION: %s', str(e))
        logger.exception('TELEBIRR B2C WEBHOOK - FULL TRACEBACK')
        logger.info('=' * 80)
        # Don't bubble 500s back to Telebirr; just log and ack.
        return Response({'success': True})
