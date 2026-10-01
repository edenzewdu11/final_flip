from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.conf import settings
from django.core.exceptions import ValidationError
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from django.contrib.auth.models import User
import logging

from .models_subscription import (
    SubscriptionTier, SubscriptionPlan as UserSubscription, SubscriptionPayment, SubscriptionHistory,
    OnevasWebhookLog, PromoCode, UserPromoUsage, SubscriptionFeatureUsage,
    ExpiredSubscriptionAction, TrialPopupLog, SubscriptionCoinTransaction as CoinTransaction, AdminRole, SubscriptionReport
)
from .models import UserProfile
from .models_direct_debit import DirectDebitMandate
from .telebirr_service import telebirr_service
from .services.telebirr_mandate_service import telebirr_mandate_service
from .telebirr_direct_debit_service import telebirr_direct_debit_service
import requests
import json
import uuid
import time
from datetime import timedelta

logger = logging.getLogger(__name__)

# Onevas SMS Configuration
ONEVAS_SMS_URL = "https://onevas.et/api/partnerSms/send"
ONEVAS_APPLICATION_KEY = settings.ONEVAS_APPLICATION_KEY if hasattr(settings, 'ONEVAS_APPLICATION_KEY') else "YOUR_APPLICATION_KEY"
ONEVAS_PRODUCT_NUMBER = settings.ONEVAS_PRODUCT_NUMBER if hasattr(settings, 'ONEVAS_PRODUCT_NUMBER') else "YOUR_PRODUCT_NUMBER"

# Onevas Product Configuration (SPID, Service ID, Product ID, Application Key)
ONEVAS_PRODUCTS = {
    'daily': {
        'spid': '300263',
        'service_id': '30026300007331',
        'product_id': '10000302850',
        'application_key': 'UPJG5ZM3X6C9LLDSKKCME4MA86UQRKWV'
    },
    'weekly': {
        'spid': '300263',
        'service_id': '30026300007332',
        'product_id': '10000302851',
        'application_key': 'I6QEX9W5D341NN50QPB0KQ9HW6DH99TQ'
    },
    'monthly': {
        'spid': '300263',
        'service_id': '30026300007333',
        'product_id': '10000302852',
        'application_key': '0Y72TFLJP4ZAQ127K0O43IJSD9QAPTWQ'
    },
    'ondemand': {
        'spid': '300263',
        'service_id': '30026300007334',
        'product_id': '10000302853',
        'application_key': '4CROFBT0EGCM1OK8R88EQBTEZOMI3138'
    }
}

# App Links (placeholders - update with actual URLs)
# WEB_APP_LINK = "https://uat.flipstar.et?subscription_tp=true"
WEB_APP_LINK = "https://uat.flipstar.et"
MOBILE_APP_LINK = "https://play.google.com/store/apps/details?id=com.postworq.mobile"

# Helper function to mask phone number (show first 9 digits, mask last 4)
def mask_phone_number(phone):
    if not phone or len(phone) < 4:
        return phone
    return phone[:9] + '****'


class UserSubscriptionStatusView(APIView):
    """Check user subscription status"""
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """Get current user's subscription status"""
        try:
            from django.utils import timezone
            from django.core.cache import cache
            from .models import Subscription

            print(f'[SUBSCRIPTION STATUS] Checking subscription for user: {request.user.username} (ID: {request.user.id})')

            # Check if frontend should clear pending mandate
            cache_key = f'clear_mandate_{request.user.id}'
            clear_pending_mandate = cache.get(cache_key, False)
            if clear_pending_mandate:
                print(f'[SUBSCRIPTION STATUS] Clear pending mandate flag set for user {request.user.id}')
                # Clear the flag after reading
                cache.delete(cache_key)

            # First check new UserSubscription model - include grace_period
            active_subscription = UserSubscription.objects.filter(
                user=request.user,
                status='active',
                end_date__gt=timezone.now()
            ).first()

            # Check for grace period subscription
            grace_subscription = UserSubscription.objects.filter(
                user=request.user,
                status='grace_period'
            ).first()

            # Auto-expire grace period if expired
            if grace_subscription and not grace_subscription.is_in_grace:
                print(f'[SUBSCRIPTION STATUS] Grace period expired for subscription {grace_subscription.id}, marking as expired')
                grace_subscription.status = 'expired'
                grace_subscription.save()
                grace_subscription = None

            print(f'[SUBSCRIPTION STATUS] UserSubscription active found: {active_subscription is not None}')
            if active_subscription:
                print(f'[SUBSCRIPTION STATUS] UserSubscription: ID={active_subscription.id}, status={active_subscription.status}, end_date={active_subscription.end_date}')

            if active_subscription:
                return Response({
                    'has_subscription': True,
                    'subscription': {
                        'id': str(active_subscription.id),
                        'tier': {
                            'id': str(active_subscription.tier.id) if active_subscription.tier else None,
                            'name': active_subscription.tier.name if active_subscription.tier else None,
                            'duration_type': active_subscription.tier.duration_type if active_subscription.tier else None,
                            'price_etb': float(active_subscription.tier.price_etb) if active_subscription.tier else 0,
                        },
                        'status': active_subscription.status,
                        'start_date': active_subscription.start_date.isoformat(),
                        'end_date': active_subscription.end_date.isoformat() if active_subscription.end_date else None,
                        'auto_renew': active_subscription.auto_renew,
                        'grace_period': False,
                    },
                    'clear_pending_mandate': clear_pending_mandate
                })

            # Return grace period info if in grace
            if grace_subscription:
                print(f'[SUBSCRIPTION STATUS] UserSubscription in grace period: ID={grace_subscription.id}, grace_expires_at={grace_subscription.grace_expires_at}')
                return Response({
                    'has_subscription': True,
                    'subscription': {
                        'id': str(grace_subscription.id),
                        'tier': {
                            'id': str(grace_subscription.tier.id) if grace_subscription.tier else None,
                            'name': grace_subscription.tier.name if grace_subscription.tier else None,
                            'duration_type': grace_subscription.tier.duration_type if grace_subscription.tier else None,
                            'price_etb': float(grace_subscription.tier.price_etb) if grace_subscription.tier else 0,
                        },
                        'status': grace_subscription.status,
                        'start_date': grace_subscription.start_date.isoformat(),
                        'end_date': grace_subscription.end_date.isoformat() if grace_subscription.end_date else None,
                        'auto_renew': grace_subscription.auto_renew,
                        'grace_period': True,
                        'grace_expires_at': grace_subscription.grace_expires_at.isoformat() if grace_subscription.grace_expires_at else None,
                    },
                    'clear_pending_mandate': clear_pending_mandate
                })
            
            # Fallback to old Subscription model
            old_subscription = Subscription.objects.filter(
                user=request.user,
                expires_at__gt=timezone.now()
            ).first()
            
            print(f'[SUBSCRIPTION STATUS] Old Subscription active found: {old_subscription is not None}')
            if old_subscription:
                print(f'[SUBSCRIPTION STATUS] Old Subscription: ID={old_subscription.id}, plan={old_subscription.plan}, expires_at={old_subscription.expires_at}')
            
            if old_subscription:
                return Response({
                    'has_subscription': True,
                    'subscription': {
                        'id': str(old_subscription.id),
                        'tier': {
                            'id': None,
                            'name': old_subscription.plan,
                            'duration_type': None,
                            'price_etb': 0,
                        },
                        'status': 'active',
                        'start_date': old_subscription.started_at.isoformat() if old_subscription.started_at else None,
                        'end_date': old_subscription.expires_at.isoformat() if old_subscription.expires_at else None,
                        'auto_renew': False,
                    },
                    'clear_pending_mandate': clear_pending_mandate
                })
            
            # No active subscription found - check for any subscriptions
            any_subscription = UserSubscription.objects.filter(user=request.user)
            any_old_subscription = Subscription.objects.filter(user=request.user)
            
            print(f'[SUBSCRIPTION STATUS] Any UserSubscription count: {any_subscription.count()}')
            print(f'[SUBSCRIPTION STATUS] Any old Subscription count: {any_old_subscription.count()}')
            
            if any_subscription.exists():
                for sub in any_subscription:
                    print(f'[SUBSCRIPTION STATUS] UserSubscription: status={sub.status}, end_date={sub.end_date}')
            
            if any_old_subscription.exists():
                for sub in any_old_subscription:
                    print(f'[SUBSCRIPTION STATUS] Old Subscription: plan={sub.plan}, expires_at={sub.expires_at}')
            
            return Response({
                'has_subscription': False,
                'subscription': None,
                'has_had_subscription': any_subscription.exists() or any_old_subscription.exists(),
                'message': 'No active subscription found',
                'clear_pending_mandate': clear_pending_mandate
            }, status=status.HTTP_200_OK)
        
        except Exception as e:
            print(f'[SUBSCRIPTION STATUS] Error: {e}')
            import traceback
            traceback.print_exc()
            return Response({
                'error': str(e),
                'has_subscription': False
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class OnevasWebhookView(APIView):
    """Handle Onevas webhook notifications"""
    permission_classes = [AllowAny]
    
    def handle_stop_command(self, phone_number, stop_keyword='STOP'):
        """Handle STOP command for subscription cancellation"""
        print(f"[SUBSCRIPTION DEBUG] {stop_keyword} command received for phone: {phone_number}")

        # Map STOP keywords to tier duration types
        stop_keyword_mapping = {
            'STOP': 'daily',
            'STOP1': 'daily',
            'STOP2': 'weekly',
            'STOP3': 'monthly'
        }
        target_duration_type = stop_keyword_mapping.get(stop_keyword, None)
        print(f"[SUBSCRIPTION DEBUG] Target duration type for {stop_keyword}: {target_duration_type}")

        # Build phone variants so lookups match regardless of stored format
        phone_variants = set()
        if phone_number:
            raw = phone_number.replace('+', '').strip()
            phone_variants.update({phone_number, raw})
            if raw.startswith('251'):
                phone_variants.add('0' + raw[3:])
                phone_variants.add('+' + raw)
            elif raw.startswith('0'):
                phone_variants.add('251' + raw[1:])
                phone_variants.add('+251' + raw[1:])
        phone_variants = [p for p in phone_variants if p]
        print(f"[SUBSCRIPTION DEBUG] Phone variants: {phone_variants}")

        # First try to find registered user - improved mapping logic
        user = None
        try:
            profile = UserProfile.objects.filter(phone_number__in=phone_variants).first()
            if profile:
                user = profile.user
                print(f"[SUBSCRIPTION DEBUG] Found registered user: {user.username}")
        except:
            pass

        if not user:
            # Try to find user via existing subscriptions with this phone number
            existing_subscription = UserSubscription.objects.filter(
                Q(onevas_phone_number__in=phone_variants) | Q(telebirr_phone_number__in=phone_variants)
            ).first()
            if existing_subscription and existing_subscription.user:
                user = existing_subscription.user
                print(f"[SUBSCRIPTION DEBUG] Found user via existing subscription: {user.username}")
                # Update UserProfile phone_number if not set
                if not user.profile.phone_number:
                    user.profile.phone_number = phone_number
                    user.profile.save()
                    print(f"[SUBSCRIPTION DEBUG] Updated UserProfile phone_number for {user.username}")
            else:
                print(f"[SUBSCRIPTION DEBUG] User not registered, checking for SMS-first subscription")

        # Find active subscriptions (either by user or by phone number for SMS-first)
        subscriptions = []
        if user:
            print(f"[SUBSCRIPTION DEBUG] Checking subscriptions for user: {user.username}")
            all_user_subs = UserSubscription.objects.filter(user=user)
            print(f"[SUBSCRIPTION DEBUG] Total subscriptions for user: {all_user_subs.count()}")
            for sub in all_user_subs:
                print(f"[SUBSCRIPTION DEBUG]   - ID: {sub.id}, Status: {sub.status}, Duration: {sub.duration_type}, Tier: {sub.tier.name if sub.tier else 'None'}")

            if target_duration_type:
                # Find ALL active subscriptions with this duration type
                subscriptions = list(UserSubscription.objects.filter(
                    user=user,
                    status='active',
                    tier__duration_type=target_duration_type
                ))
                print(f"[SUBSCRIPTION DEBUG] Looking for ALL active subscriptions with duration_type={target_duration_type}: Found {len(subscriptions)}")
            else:
                # No specific duration type, find ALL active subscriptions
                subscriptions = list(UserSubscription.objects.filter(
                    user=user,
                    status='active'
                ))
                print(f"[SUBSCRIPTION DEBUG] Looking for ALL active subscriptions: Found {len(subscriptions)}")
        else:
            # Check for SMS-first subscription (user not registered yet)
            print(f"[SUBSCRIPTION DEBUG] Checking SMS-first subscriptions for phone: {phone_number}")
            if target_duration_type:
                subscriptions = list(UserSubscription.objects.filter(
                    onevas_phone_number__in=phone_variants,
                    status='active',
                    subscription_source='sms',
                    tier__duration_type=target_duration_type
                ))
                print(f"[SUBSCRIPTION DEBUG] SMS-first subscriptions with duration_type={target_duration_type}: Found {len(subscriptions)}")
            else:
                subscriptions = list(UserSubscription.objects.filter(
                    onevas_phone_number__in=phone_variants,
                    status='active',
                    subscription_source='sms'
                ))
                print(f"[SUBSCRIPTION DEBUG] All SMS-first active subscriptions: Found {len(subscriptions)}")

        if not subscriptions:
            # No active subscriptions
            print(f"[SUBSCRIPTION DEBUG] No active subscriptions found for phone: {phone_number}")
            no_sub_message = "You don't have an active subscription to cancel."
            print(f"[SUBSCRIPTION DEBUG] Sending no-subscription SMS to {phone_number}")
            sms_sent = self.send_sms(phone_number, no_sub_message)
            print(f"[SUBSCRIPTION DEBUG] No-subscription SMS sent: {sms_sent}")
            return Response({'status': 'no_active_subscription', 'message': 'No active subscription found'})

        # Cancel ALL matching subscriptions
        cancelled_count = 0
        for subscription in subscriptions:
            print(f"[SUBSCRIPTION DEBUG] Cancelling subscription: ID {subscription.id}, Tier: {subscription.tier.name}, Status: {subscription.status}")
            subscription.cancel(reason='User cancelled via STOP SMS')
            
            # Finding #20: Invalidate user PIN on subscription cancellation for security
            # This prevents credential reuse after subscription gap
            if user:
                user.set_unusable_password()
                user.save()
                print(f"[SUBSCRIPTION DEBUG] Invalidated PIN for user {user.username} on subscription cancellation")
            
            # Record history
            SubscriptionHistory.objects.create(
                user=user,
                subscription=subscription,
                tier=subscription.tier,
                action='cancelled',
                reason='User cancelled via STOP SMS',
                metadata={'method': 'stop_command', 'sms_subscription': user is None, 'pin_invalidated': True}
            )
            cancelled_count += 1

        print(f"[SUBSCRIPTION DEBUG] Cancelled {cancelled_count} subscription(s) successfully")

        # Send SMS confirmation
        # Use the tier from the first cancelled subscription for the SMS
        if subscriptions and subscriptions[0].tier:
            tier = subscriptions[0].tier
            # Map duration type to resubscribe keyword and stop keyword
            resubscribe_keywords = {
                'daily': '1',
                'weekly': '2',
                'monthly': '3',
                'ondemand': '4'
            }
            stop_keywords = {
                'daily': 'STOP1',
                'weekly': 'STOP2',
                'monthly': 'STOP3',
                'ondemand': 'STOP'
            }
            resubscribe_keyword = resubscribe_keywords.get(tier.duration_type, '1')
            cancel_keyword = stop_keywords.get(tier.duration_type, 'STOP')
            
            # Map tier duration type to service name and resubscribe keyword for message
            service_names = {
                'daily': 'Daily',
                'weekly': 'Weekly',
                'monthly': 'Monthly',
                'ondemand': 'On-Demand'
            }
            service_name = service_names.get(tier.duration_type, tier.name)
            
            # Map duration type to the correct resubscribe keyword for the message
            resubscribe_keyword_map = {
                'daily': '1',
                'weekly': '2',
                'monthly': '3',
                'ondemand': '4'
            }
            message_keyword = resubscribe_keyword_map.get(tier.duration_type, '1')
            cancellation_message = f"You have successfully unsubscribed from the {service_name} service. To subscribe again, send {message_keyword} to {tier.short_code}."
            print(f"[SUBSCRIPTION DEBUG] Sending cancellation SMS to {phone_number}")
            sms_sent = self.send_sms(phone_number, cancellation_message, tier.duration_type)
            print(f"[SUBSCRIPTION DEBUG] Cancellation SMS sent: {sms_sent}")
        else:
            print(f"[SUBSCRIPTION DEBUG] WARNING: subscription.tier is None, cannot send SMS with tier info")
            cancellation_message = f"You have successfully unsubscribed from the Flipstar service."
            print(f"[SUBSCRIPTION DEBUG] Sending generic cancellation SMS to {phone_number}")
            sms_sent = self.send_sms(phone_number, cancellation_message, None)
            print(f"[SUBSCRIPTION DEBUG] Cancellation SMS sent: {sms_sent}")

        return Response({'status': 'success', 'message': f'{cancelled_count} subscription(s) cancelled via STOP command'})
    
    def send_sms(self, phone_number, text, tier_type=None):
        """Send SMS using Onevas API with tier-specific application key"""
        try:
            # Get application key for the specific tier, or use default
            app_key = ONEVAS_APPLICATION_KEY
            if tier_type and tier_type in ONEVAS_PRODUCTS:
                app_key = ONEVAS_PRODUCTS[tier_type]['application_key']

            # Get product number from configuration
            product_number = ONEVAS_PRODUCT_NUMBER
            if tier_type and tier_type in ONEVAS_PRODUCTS:
                product_number = ONEVAS_PRODUCTS[tier_type]['product_id']

            payload = {
                "phone_number": phone_number,
                "application_key": app_key,
                "text": text,
                "product_number": product_number
            }
            print(f"[SMS DEBUG] Sending SMS - phone: {phone_number}, tier_type: {tier_type}, app_key: {app_key[:10]}..., product_number: {product_number}")
            print(f"[SMS DEBUG] SMS text: {text}")
            print(f"[SMS DEBUG] SMS text length: {len(text)}")
            print(f"[SMS DEBUG] Full payload: {payload}")
            response = requests.post(ONEVAS_SMS_URL, json=payload, timeout=10)
            print(f"[SMS DEBUG] Response status: {response.status_code}, response body: {response.text}")
            return response.status_code == 200
        except Exception as e:
            print(f"Failed to send SMS: {e}")
            return False
    
    def post(self, request, webhook_type):
        """Handle subscription, unsubscription, renewal, and stop webhooks"""
        try:
            payload = request.data
            print(f"[SUBSCRIPTION DEBUG] Webhook received - type: {webhook_type}")
            print(f"[SUBSCRIPTION DEBUG] Webhook payload: {payload}")
            
            # Log the webhook
            log = OnevasWebhookLog.objects.create(
                webhook_type=webhook_type,
                payload=payload
            )
            print(f"[SUBSCRIPTION DEBUG] Webhook log created: ID {log.id}")
            
            if webhook_type == 'subscription':
                print(f"[SUBSCRIPTION DEBUG] Routing to handle_subscription")
                response = self.handle_subscription(payload, log)
            elif webhook_type == 'unsubscription':
                print(f"[SUBSCRIPTION DEBUG] Routing to handle_unsubscription")
                response = self.handle_unsubscription(payload, log)
            elif webhook_type == 'renewal':
                print(f"[SUBSCRIPTION DEBUG] Routing to handle_renewal")
                response = self.handle_renewal(payload, log)
            elif webhook_type == 'stop':
                phone_number = payload.get('phone_number')
                product_number = payload.get('product_number', '').upper()
                print(f"[SUBSCRIPTION DEBUG] STOP webhook - phone: {phone_number}, product: {product_number}")
                print(f"[SUBSCRIPTION DEBUG] Full STOP payload: {payload}")

                # Extract keyword from params array if present
                params = payload.get('params', [])
                stop_keyword = 'STOP'  # Default
                for param in params:
                    if param.get('name') == 'keyword':
                        stop_keyword = param.get('value', 'STOP').upper()
                        break

                # If no keyword in params, try to determine from product_number
                if stop_keyword == 'STOP' and product_number:
                    product_to_keyword = {
                        '10000302850': 'STOP1',  # Daily
                        '10000302851': 'STOP2',  # Weekly
                        '10000302852': 'STOP3',  # Monthly
                        '10000302853': 'STOP'   # OnDemand
                    }
                    stop_keyword = product_to_keyword.get(product_number, 'STOP')
                    print(f"[SUBSCRIPTION DEBUG] Determined keyword from product_number: {stop_keyword}")

                print(f"[SUBSCRIPTION DEBUG] Routing to handle_stop_command for {phone_number} with keyword: {stop_keyword}")
                response = self.handle_stop_command(phone_number, stop_keyword)
            else:
                print(f"[SUBSCRIPTION DEBUG] Invalid webhook type: {webhook_type}")
                response = Response({'error': 'Invalid webhook type'}, status=400)
            
            log.response_status = response.status_code
            log.response_body = response.data if hasattr(response, 'data') else {}
            log.processed = True
            log.save()
            print(f"[SUBSCRIPTION DEBUG] Webhook processed - status: {response.status_code}")
            
            return response
            
        except Exception as e:
            return Response({'error': str(e)}, status=500)
    
    def handle_subscription(self, payload, log):
        """Handle subscription notification from Onevas"""
        phone_number = payload.get('phone_number')
        product_number = payload.get('product_number', '').upper()  # Convert to uppercase
        password = payload.get('password', '').upper()  # SMS code might be in password field

        print(f"[SUBSCRIPTION DEBUG] Received subscription webhook - phone: {phone_number}, product: {product_number}, password: {password}")
        print(f"[SUBSCRIPTION DEBUG] Full payload: {payload}")

        # Extract keyword from params array if present
        params = payload.get('params', [])
        keyword_from_params = None
        for param in params:
            if param.get('name') == 'keyword':
                keyword_from_params = param.get('value', '').upper()
                break
        if keyword_from_params:
            print(f"[SUBSCRIPTION DEBUG] Keyword from params: {keyword_from_params}")

        # Build phone variants so lookups match regardless of stored format.
        # Onevas/airtime SMS may arrive as '251911...' while Telebirr/SuperApp
        # stores the phone as '0911...' (or vice versa). Matching only one form
        # let a Telebirr subscriber also subscribe via airtime (duplicate sub).
        phone_variants = set()
        if phone_number:
            raw = phone_number.replace('+', '').strip()
            phone_variants.update({phone_number, raw})
            if raw.startswith('251'):
                phone_variants.add('0' + raw[3:])
                phone_variants.add('+' + raw)
            elif raw.startswith('0'):
                phone_variants.add('251' + raw[1:])
                phone_variants.add('+251' + raw[1:])
        phone_variants = [p for p in phone_variants if p]

        # Find user by phone number - improved mapping logic
        user = None
        user_exists = False
        profile = UserProfile.objects.filter(phone_number__in=phone_variants).first()
        if profile:
            user = profile.user
            user_exists = True
            print(f"[SUBSCRIPTION DEBUG] User found by phone_number: {user.username}")
        else:
            # Try to find user by any existing subscription with this phone
            # (airtime OR telebirr), so all payment methods are considered.
            existing_subscription = UserSubscription.objects.filter(
                Q(onevas_phone_number__in=phone_variants) | Q(telebirr_phone_number__in=phone_variants)
            ).first()
            if existing_subscription and existing_subscription.user:
                user = existing_subscription.user
                user_exists = True
                print(f"[SUBSCRIPTION DEBUG] User found via existing subscription: {user.username}")
                # Update UserProfile phone_number if not set
                if not user.profile.phone_number:
                    user.profile.phone_number = phone_number
                    user.profile.save()
                    print(f"[SUBSCRIPTION DEBUG] Updated UserProfile phone_number for {user.username}")
            else:
                print(f"[SUBSCRIPTION DEBUG] User not found for phone: {phone_number}")

        # Find tier by product number or SMS code
        tier = None
        if product_number:
            try:
                tier = SubscriptionTier.objects.get(product_id=product_number)
                print(f"[SUBSCRIPTION DEBUG] Tier found by product_number: {tier.name} (ID: {tier.id})")
            except SubscriptionTier.DoesNotExist:
                print(f"[SUBSCRIPTION DEBUG] Tier not found for product: {product_number}")

        # If no tier found by product_number, try using SMS code from params (Ok1, Ok2, Ok3, Ok4) or password (A, B, C, D)
        if not tier:
            sms_code = (keyword_from_params or password or '').upper()
            sms_code_mapping = {
                '1': 'daily',
                '2': 'weekly',
                '3': 'monthly',
                '4': 'ondemand',
            }
            duration_type = sms_code_mapping.get(sms_code)
            if duration_type:
                try:
                    tier = SubscriptionTier.objects.get(duration_type=duration_type, is_active=True)
                    print(f"[SUBSCRIPTION DEBUG] Tier found by SMS code {sms_code}: {tier.name} (ID: {tier.id})")
                except SubscriptionTier.DoesNotExist:
                    print(f"[SUBSCRIPTION DEBUG] No active tier found for duration type: {duration_type}")

        if not tier:
            print(f"[SUBSCRIPTION DEBUG] Tier not found - product_number: {product_number}, password: {password}, keyword from params: {keyword_from_params}")
            return Response({'error': 'Tier not found. Please check product_number or SMS code.'}, status=404)

        # Check if there is ANY active subscription for this customer, across
        # every payment method (airtime/onevas, telebirr, superapp) and every
        # phone-number format. This prevents a customer who already subscribed
        # via Telebirr/SuperApp from also subscribing via airtime (and vice
        # versa). Matched by phone number on either phone field, plus the user
        # account when we managed to resolve one.
        active_filter = (
            Q(onevas_phone_number__in=phone_variants) |
            Q(telebirr_phone_number__in=phone_variants)
        )
        if user_exists and user:
            active_filter = active_filter | Q(user=user)

        existing_active_sub = UserSubscription.objects.filter(
            active_filter,
            status='active',
            end_date__gt=timezone.now()
        ).first()

        if existing_active_sub:
            print(f"[SUBSCRIPTION DEBUG] Customer already has active subscription: {existing_active_sub.id}, payment_method: {existing_active_sub.payment_method}")
            # Send SMS informing the customer they already have an active subscription
            existing_tier = existing_active_sub.tier
            stop_keywords = {
                'daily': 'STOP1',
                'weekly': 'STOP2',
                'monthly': 'STOP3',
                'ondemand': 'STOP'
            }
            stop_keyword = stop_keywords.get(existing_tier.duration_type, 'STOP')
            error_message = f"Dear customer, you already have an active {existing_tier.name} subscription. Please cancel your current subscription by sending {stop_keyword} to {existing_tier.short_code} before subscribing to a new plan."
            self.send_sms(phone_number, error_message, existing_tier.duration_type)
            return Response({
                'status': 'error',
                'message': 'Customer already has an active subscription',
                'existing_subscription': {
                    'tier': existing_tier.name,
                    'payment_method': existing_active_sub.payment_method,
                    'end_date': existing_active_sub.end_date.isoformat() if existing_active_sub.end_date else None
                }
            }, status=400)

        # If user is not registered, create active subscription (SMS-first flow)
        if not user_exists:
            print(f"[SUBSCRIPTION DEBUG] Creating SMS-first subscription (user not registered)")
            
            # Check if there's already an SMS-first subscription of the same duration type for this phone
            existing_sms_sub = UserSubscription.objects.filter(
                onevas_phone_number=phone_number,
                status='active',
                subscription_source='sms',
                duration_type=tier.duration_type
            ).first()
            
            if existing_sms_sub:
                print(f"[SUBSCRIPTION DEBUG] Found existing SMS-first subscription of same type, renewing it...")
                # Renew existing subscription
                existing_sms_sub.tier = tier
                existing_sms_sub.duration_type = tier.duration_type
                existing_sms_sub.activate()
                
                from .services.otp_service import OTPService
                otp_code = OTPService.generate_otp()
                existing_sms_sub.setup_otp = otp_code
                existing_sms_sub.setup_otp_expires_at = timezone.now() + timedelta(minutes=30)  # 30-minute expiration
                existing_sms_sub.save()
                
    
                SubscriptionPayment.objects.create(
                    subscription=existing_sms_sub,
                    user=None,
                    amount=tier.price_etb,
                    payment_method='onevas',
                    duration_type=tier.duration_type,
                    period_start=existing_sms_sub.start_date,
                    period_end=existing_sms_sub.end_date or timezone.now() + timedelta(days=tier.duration_days or 30),
                    status='completed'
                )
                
                # Record history
                SubscriptionHistory.objects.create(
                    user=None,
                    subscription=existing_sms_sub,
                    tier=tier,
                    action='renewed',
                    reason='SMS-first subscription renewed via Onevas',
                    metadata={'webhook_payload': payload, 'sms_subscription': True}
                )
                
                # Send success SMS
                stop_keywords = {
                    'daily': 'STOP1',
                    'weekly': 'STOP2',
                    'monthly': 'STOP3',
                    'ondemand': 'STOP'
                }
                stop_keyword = stop_keywords.get(tier.duration_type, 'STOP')
                price_periods = {
                    'daily': 'day',
                    'weekly': 'week',
                    'monthly': 'month',
                    'ondemand': 'use'
                }
                price_period = price_periods.get(tier.duration_type, 'day')

                # SECURITY: Generate token instead of exposing phone in URL
                token = existing_sms_sub.generate_subscription_token(expires_hours=24)
                success_message = f"Dear valued customer, you have successfully subscribed to the {tier.name} Flipstar service, effective from {existing_sms_sub.start_date.strftime('%Y-%m-%d %H:%M')}. You have 1 day remaining in your complimentary free trial. After your free trial concludes, the subscription price will be {tier.price_etb} ETB per {price_period}. To access your premium service, please click on {WEB_APP_LINK}?subscription_tp=true&token={token} and enter your OTP: {otp_code}. To cancel your subscription at any time, please send {stop_keyword} to {tier.short_code}."
                print(f"[SUBSCRIPTION DEBUG] Sending renewal SMS to {phone_number} with OTP: {otp_code}")
                self.send_sms(phone_number, success_message, tier.duration_type)
                print(f"[SUBSCRIPTION DEBUG] SMS-first subscription renewed successfully")
                return Response({'status': 'success', 'message': 'SMS-first subscription renewed'})
            
            # Check for other SMS-first subscriptions of different duration types and cancel them
            other_sms_subs = UserSubscription.objects.filter(
                onevas_phone_number=phone_number,
                status='active',
                subscription_source='sms'
            ).exclude(duration_type=tier.duration_type)
            
            if other_sms_subs.exists():
                print(f"[SUBSCRIPTION DEBUG] Found {other_sms_subs.count()} other SMS-first subscription(s) of different types, cancelling them...")
                for sub in other_sms_subs:
                    sub.cancel(reason='Cancelled due to new SMS-first subscription of different duration type')
                    SubscriptionHistory.objects.create(
                        user=None,
                        subscription=sub,
                        tier=sub.tier,
                        action='cancelled',
                        reason='Cancelled due to new SMS-first subscription of different duration type',
                        metadata={'new_duration_type': tier.duration_type, 'sms_subscription': True}
                    )
                    print(f"[SUBSCRIPTION DEBUG] Cancelled SMS-first subscription ID {sub.id} (duration_type={sub.duration_type})")
            
            # Generate OTP for user to set up their account
            from .services.otp_service import OTPService
            otp_code = OTPService.generate_otp()
            print(f"[SUBSCRIPTION DEBUG] Generated OTP for account setup: {otp_code}")
            
            # Create active subscription linked to phone number (user can log in without OTP)
            try:
                with transaction.atomic():
                    print(f"[SUBSCRIPTION DEBUG] Starting transaction to create SMS-first subscription...")
                    
                    # Calculate end date
                    base_duration_days = tier.duration_days or 30
                    total_duration_days = base_duration_days
                    
                    subscription = UserSubscription.objects.create(
                        user=None,  # No user yet - will be linked when they register
                        tier=tier,
                        duration_type=tier.duration_type,
                        onevas_phone_number=phone_number,
                        onevas_subscription_id=str(uuid.uuid4()),
                        status='active',  # Active immediately, not pending
                        start_date=timezone.now(),
                        end_date=timezone.now() + timedelta(days=total_duration_days),
                        subscription_source='sms',  # Track that this came from SMS
                        setup_otp=otp_code,  # Store OTP for account setup
                        setup_otp_expires_at=timezone.now() + timedelta(minutes=30),  # 30-minute expiration
                    )
                    print(f"[SUBSCRIPTION DEBUG] Subscription created: ID {subscription.id}, status: {subscription.status}")
                    
                    # Verify the subscription was actually saved
                    saved_subscription = UserSubscription.objects.get(id=subscription.id)
                    print(f"[SUBSCRIPTION DEBUG] Verified subscription in database: ID {saved_subscription.id}, status: {saved_subscription.status}")
                    
                    # Record payment
                    payment = SubscriptionPayment.objects.create(
                        subscription=subscription,
                        user=None,
                        amount=tier.price_etb,
                        payment_method='onevas',
                        duration_type=tier.duration_type,
                        period_start=subscription.start_date,
                        period_end=subscription.end_date,
                        status='completed'
                    )
                    print(f"[SUBSCRIPTION DEBUG] Payment recorded: {tier.price_etb} ETB, payment ID: {payment.id}")
                    
                    # Record history
                    history = SubscriptionHistory.objects.create(
                        user=None,
                        subscription=subscription,
                        tier=tier,
                        action='created',
                        reason='Subscription created via Onevas SMS (active, user not registered yet)',
                        metadata={'webhook_payload': payload, 'sms_subscription': True}
                    )
                    print(f"[SUBSCRIPTION DEBUG] History recorded: action=created, history ID: {history.id}")
                    print(f"[SUBSCRIPTION DEBUG] Transaction committed successfully")
            except Exception as e:
                print(f"[SUBSCRIPTION DEBUG] ERROR during transaction: {str(e)}")
                import traceback
                print(f"[SUBSCRIPTION DEBUG] Traceback: {traceback.format_exc()}")
                return Response({'error': f'Failed to create subscription: {str(e)}'}, status=500)
            
            # Send success SMS with registration info (no OTP needed)
            stop_keywords = {
                'daily': 'STOP1',
                'weekly': 'STOP2',
                'monthly': 'STOP3',
                'ondemand': 'STOP'
            }
            stop_keyword = stop_keywords.get(tier.duration_type, 'STOP')
            # Determine price period based on tier
            price_periods = {
                'daily': 'day',
                'weekly': 'week',
                'monthly': 'month',
                'ondemand': 'use'
            }
            price_period = price_periods.get(tier.duration_type, 'day')
            
            trial_message = f"The subscription price is {tier.price_etb} ETB per {price_period}."
            
            # SECURITY: Generate token instead of exposing phone in URL
            token = subscription.generate_subscription_token(expires_hours=24)
            success_message = f"Dear valued customer, you have successfully subscribed to the {tier.name} Flipstar service, effective from {subscription.start_date.strftime('%Y-%m-%d %H:%M')}. {trial_message} To access your premium service, please click on {WEB_APP_LINK}?subscription_tp=true&token={token} and enter your OTP: {otp_code}. To cancel your subscription at any time, please send {stop_keyword} to {tier.short_code}."
            print(f"[SUBSCRIPTION DEBUG] Sending success SMS to {phone_number} with OTP: {otp_code}")
            self.send_sms(phone_number, success_message, tier.duration_type)
            print(f"[SUBSCRIPTION DEBUG] SMS-first subscription completed successfully")
            return Response({'status': 'success', 'message': 'Active subscription created via SMS, user can log in without OTP'})
        
        # User exists - proceed with subscription
        print(f"[SUBSCRIPTION DEBUG] User exists, proceeding with subscription for {user.username}")
        
        # Cancel any other active subscriptions of different duration types to prevent conflicts
        other_active_subs = UserSubscription.objects.filter(
            user=user,
            status='active'
        ).exclude(duration_type=tier.duration_type)
        
        if other_active_subs.exists():
            print(f"[SUBSCRIPTION DEBUG] Found {other_active_subs.count()} other active subscription(s) of different types, cancelling them...")
            for sub in other_active_subs:
                sub.cancel(reason='Cancelled due to new subscription of different duration type')
                SubscriptionHistory.objects.create(
                    user=user,
                    subscription=sub,
                    tier=sub.tier,
                    action='cancelled',
                    reason='Cancelled due to new subscription of different duration type',
                    metadata={'new_duration_type': tier.duration_type}
                )
                print(f"[SUBSCRIPTION DEBUG] Cancelled subscription ID {sub.id} (duration_type={sub.duration_type})")
        
        # Check if user already has active subscription of the SAME duration type
        active_sub = UserSubscription.objects.filter(
            user=user,
            status='active',
            duration_type=tier.duration_type
        ).first()

        print(f"[SUBSCRIPTION DEBUG] Active subscription check for duration_type={tier.duration_type}: {'Found' if active_sub else 'Not found'}")
        if active_sub:
            print(f"[SUBSCRIPTION DEBUG] Found active subscription of same type, renewing...")
            
            # Finding #20: Check if user's PIN was invalidated (unusable password)
            # If so, they need to set a new PIN after resubscription
            pin_invalidated = not user.has_usable_password()
            if pin_invalidated:
                print(f"[SUBSCRIPTION DEBUG] User's PIN was invalidated, will require new PIN setup")
            
            # Generate OTP for login
            from .services.otp_service import OTPService
            otp_code = OTPService.generate_otp()
            print(f"[SUBSCRIPTION DEBUG] Generated OTP for renewal: {otp_code}")
            
            # Update existing subscription
            active_sub.tier = tier
            active_sub.duration_type = tier.duration_type
            active_sub.setup_otp = otp_code  # Store OTP for login
            active_sub.setup_otp_expires_at = timezone.now() + timedelta(minutes=30)  # 30-minute expiration
            active_sub.activate()
            
            # Record history
            SubscriptionHistory.objects.create(
                user=user,
                subscription=active_sub,
                tier=tier,
                action='renewed',
                reason='Subscription renewed via Onevas',
                metadata={'webhook_payload': payload, 'pin_invalidated': pin_invalidated}
            )
            
            # Create payment record
            SubscriptionPayment.objects.create(
                subscription=active_sub,
                user=user,
                amount=tier.price_etb,
                payment_method='onevas',
                duration_type=tier.duration_type,
                period_start=active_sub.start_date,
                period_end=active_sub.end_date or timezone.now() + timedelta(days=tier.duration_days or 30),
                status='completed'
            )
            
            # Update user trial status
            profile.is_trial_user = False
            profile.save()

            # Send SMS with registration link and OTP for SMS subscriptions
            stop_keywords = {
                'daily': 'STOP1',
                'weekly': 'STOP2',
                'monthly': 'STOP3',
                'ondemand': 'STOP'
            }
            stop_keyword = stop_keywords.get(tier.duration_type, 'STOP')
            price_periods = {
                'daily': 'day',
                'weekly': 'week',
                'monthly': 'month',
                'ondemand': 'use'
            }
            price_period = price_periods.get(tier.duration_type, 'day')
            # SECURITY: Generate token instead of exposing phone in URL
            token = active_sub.generate_subscription_token(expires_hours=24)
            renewal_message = f"Dear valued customer, you have successfully subscribed to the {tier.name} Flipstar service, effective from {active_sub.start_date.strftime('%Y-%m-%d %H:%M')}. The subscription price is {tier.price_etb} ETB per {price_period}. To access your premium service, please click on {WEB_APP_LINK}?subscription_tp=true&token={token}&existing_user=true and enter your OTP: {otp_code}. To cancel your subscription at any time, please send {stop_keyword} to {tier.short_code}."
            print(f"[SUBSCRIPTION DEBUG] Sending renewal SMS with OTP to {phone_number}")
            sms_result = self.send_sms(phone_number, renewal_message, tier.duration_type)
            print(f"[SUBSCRIPTION DEBUG] Renewal SMS sent: {sms_result}")

            return Response({'status': 'success', 'message': 'Subscription renewed'})
        
        else:
            print(f"[SUBSCRIPTION DEBUG] No active subscription found, creating new subscription")
            # Generate OTP for login
            from .services.otp_service import OTPService
            otp_code = OTPService.generate_otp()
            print(f"[SUBSCRIPTION DEBUG] Generated OTP for new subscription: {otp_code}")
            
            # Create new subscription
            try:
                with transaction.atomic():
                    # Calculate end date
                    base_duration_days = tier.duration_days or 30
                    total_duration_days = base_duration_days
                    
                    subscription = UserSubscription.objects.create(
                        user=user,
                        tier=tier,
                        duration_type=tier.duration_type,
                        onevas_phone_number=phone_number,
                        onevas_subscription_id=str(uuid.uuid4()),
                        status='pending',
                        subscription_source='app',
                        end_date=timezone.now() + timedelta(days=total_duration_days),
                        next_renewal_date=timezone.now() + timedelta(days=total_duration_days),  # Set next renewal date
                        setup_otp=otp_code,  # Set OTP for account login
                        setup_otp_expires_at=timezone.now() + timedelta(minutes=30),  # 30-minute expiration
                        payment_method='onevas'  # Onevas webhook always uses onevas payment method
                    )
                    print(f"[SUBSCRIPTION DEBUG] New subscription created: ID {subscription.id}, setup_otp: {subscription.setup_otp}")
                
                subscription.activate()
                
                # Record history
                SubscriptionHistory.objects.create(
                    user=user,
                    subscription=subscription,
                    tier=tier,
                    action='created',
                    reason='Subscription created via Onevas',
                    metadata={'webhook_payload': payload}
                )
                
                # Create payment record
                SubscriptionPayment.objects.create(
                    subscription=subscription,
                    user=user,
                    amount=tier.price_etb,
                    payment_method='onevas',
                    duration_type=tier.duration_type,
                    period_start=subscription.start_date,
                    period_end=subscription.end_date or timezone.now() + timedelta(days=tier.duration_days or 30),
                    status='completed'
                )
                
                # Update user trial status
                user.profile.is_trial_user = False
                user.profile.save()

                # Send SMS with registration link and OTP for SMS subscriptions
                stop_keywords = {
                    'daily': 'STOP1',
                    'weekly': 'STOP2',
                    'monthly': 'STOP3',
                    'ondemand': 'STOP'
                }
                stop_keyword = stop_keywords.get(tier.duration_type, 'STOP')
                price_periods = {
                    'daily': 'day',
                    'weekly': 'week',
                    'monthly': 'month',
                    'ondemand': 'use'
                }
                price_period = price_periods.get(tier.duration_type, 'day')
                # SECURITY: Generate token instead of exposing phone in URL
                token = subscription.generate_subscription_token(expires_hours=24)
                confirmation_message = f"Dear valued customer, you have successfully subscribed to the {tier.name} Flipstar service, effective from {subscription.start_date.strftime('%Y-%m-%d %H:%M')}. The subscription price is {tier.price_etb} ETB per {price_period}. To access your premium service, please click on {WEB_APP_LINK}?subscription_tp=true&token={token}&existing_user=true and enter your OTP: {otp_code}. To cancel your subscription at any time, please send {stop_keyword} to {tier.short_code}."
                print(f"[SUBSCRIPTION DEBUG] Sending confirmation SMS with OTP to {phone_number}")
                sms_result = self.send_sms(phone_number, confirmation_message, tier.duration_type)
                print(f"[SUBSCRIPTION DEBUG] Confirmation SMS sent: {sms_result}")

                return Response({'status': 'success', 'message': 'Subscription created'})

            except Exception as e:
                print(f"[SUBSCRIPTION DEBUG] Error creating new subscription: {str(e)}")
                import traceback
                print(f"[SUBSCRIPTION DEBUG] Traceback: {traceback.format_exc()}")
                return Response({'error': str(e)}, status=500)
    
    def handle_unsubscription(self, payload, log):
        """Handle unsubscription notification from Onevas"""
        phone_number = payload.get('phone_number')
        product_number = payload.get('product_number')
        
        # Find user by phone number
        try:
            profile = UserProfile.objects.get(phone_number=phone_number)
            user = profile.user
        except UserProfile.DoesNotExist:
            return Response({'error': 'User not found'}, status=404)
        
        # Find active subscription
        subscription = UserSubscription.objects.filter(
            user=user,
            status='active'
        ).first()
        
        if not subscription:
            return Response({'error': 'No active subscription found'}, status=404)
        
        # Cancel subscription
        subscription.cancel(reason='User unsubscribed via Onevas (STOP message)')
        
        # Record history
        SubscriptionHistory.objects.create(
            user=user,
            subscription=subscription,
            tier=subscription.tier,
            action='cancelled',
            reason='User unsubscribed via Onevas',
            metadata={'webhook_payload': payload}
        )
        
        # Send SMS confirmation
        cancellation_message = f"Your {subscription.tier.name} subscription has been cancelled. Thank you for using our service!"
        self.send_sms(phone_number, cancellation_message, subscription.tier.duration_type)
        
        return Response({'status': 'success', 'message': 'Subscription cancelled'})
    
    def handle_renewal(self, payload, log):
        """Handle renewal notification from Onevas - supports SMS-first subscriptions without users"""
        phone_number = payload.get('phone_number')
        next_renewal_date = payload.get('nextRenewalDate')
        product_number = payload.get('product_number')
        success = payload.get('success', True)  # Default to success if not specified
        balance = payload.get('balance')
        error_message = payload.get('error_message', '')
        
        # Try to find user by phone number first (registered users)
        user = None
        try:
            profile = UserProfile.objects.get(phone_number=phone_number)
            user = profile.user
        except UserProfile.DoesNotExist:
            # No user found - this is an SMS-first subscription
            user = None
        
        # Find active subscription - either by user or by phone number (SMS-first)
        if user:
            subscription = UserSubscription.objects.filter(
                user=user,
                status='active'
            ).first()
        else:
            # SMS-first subscription - find by phone number
            subscription = UserSubscription.objects.filter(
                onevas_phone_number=phone_number,
                status='active'
            ).first()
        
        if not subscription:
            return Response({'error': 'No active subscription found'}, status=404)
        
        from datetime import datetime
        from django.utils import timezone
        
        if success:
            try:
                # Renewal succeeded - reset subscription end date from current time
                now = timezone.now()
                old_end_date = subscription.end_date
                
                # Calculate new end date based on tier duration
                if subscription.tier and subscription.tier.duration_days:
                    new_end_date = now + timedelta(days=subscription.tier.duration_days)
                else:
                    # Fallback: use next_renewal_date from payload if tier duration not available
                    if next_renewal_date:
                        try:
                            new_end_date = datetime.strptime(next_renewal_date, '%Y-%m-%d')
                            if timezone.is_naive(new_end_date):
                                new_end_date = timezone.make_aware(new_end_date)
                        except:
                            new_end_date = now + timedelta(days=7)  # Default to 7 days
                    else:
                        new_end_date = now + timedelta(days=7)  # Default to 7 days
                
                subscription.start_date = now
                subscription.end_date = new_end_date
                subscription.next_renewal_date = new_end_date
                
                # Clear grace period if subscription was in grace
                if subscription.status == 'grace_period' or subscription.grace_expires_at:
                    subscription.clear_grace()
                
                subscription.status = 'active'
                subscription.save()
                
                # Create SubscriptionPayment record for revenue tracking
                from .models_subscription import SubscriptionPayment
                SubscriptionPayment.objects.create(
                    subscription=subscription,
                    user=user if user else None,  # Allow null for SMS-first subscriptions
                    amount=subscription.tier.price_etb if subscription.tier else 0,
                    currency='ETB',
                    status='completed',
                    payment_method='onevas',
                    duration_type=subscription.duration_type,
                    period_start=old_end_date if old_end_date else timezone.now(),
                    period_end=new_end_date,
                    metadata={
                        'webhook_payload': payload,
                        'balance': balance,
                        'renewal': True,
                        'onevas_transaction_id': payload.get('transaction_id'),
                        'sms_first': not user  # Flag for SMS-first renewals
                    }
                )
                
                # Log successful renewal
                if user:
                    SubscriptionHistory.objects.create(
                        user=user,
                        subscription=subscription,
                        tier=subscription.tier,
                        action='renewed',
                        reason='Subscription renewed via Onevas',
                        metadata={
                            'webhook_payload': payload,
                            'balance': balance,
                            'next_renewal_date': next_renewal_date
                        }
                    )
                
                return Response({'status': 'success', 'message': 'Subscription renewed successfully'})
            except ValueError as e:
                return Response({'error': f'Invalid date format: {str(e)}'}, status=400)
        else:
            # Renewal failed - check if due to insufficient balance
            error_lower = (error_message or '').lower()
            is_insufficient_balance = 'insufficient' in error_lower and 'balance' in error_lower
            
            if is_insufficient_balance:
                # Enter grace period instead of immediately expiring
                subscription.enter_grace()
                
                # Log grace period entry only if user exists
                if user:
                    SubscriptionHistory.objects.create(
                        user=user,
                        subscription=subscription,
                        tier=subscription.tier,
                        action='entered_grace_period',
                        reason='Renewal failed due to insufficient balance - entered grace period',
                        metadata={
                            'webhook_payload': payload,
                            'balance': balance,
                            'error_message': error_message,
                            'grace_expires_at': subscription.grace_expires_at.isoformat() if subscription.grace_expires_at else None
                        }
                    )
                
                return Response({'status': 'grace_period', 'message': 'Renewal failed due to insufficient balance - entered grace period'})
            else:
                # Other errors - mark as expired
                subscription.status = 'expired'
                subscription.end_date = timezone.now()
                subscription.save()
                
                # Log failed renewal only if user exists
                if user:
                    SubscriptionHistory.objects.create(
                        user=user,
                        subscription=subscription,
                        tier=subscription.tier,
                        action='renewal_failed',
                        reason=f'Renewal failed: {error_message or "Unknown error"}',
                        metadata={
                            'webhook_payload': payload,
                            'balance': balance,
                            'error_message': error_message
                        }
                    )
                
                return Response({'status': 'failed', 'message': 'Renewal failed, subscription marked as expired'})
        
        return Response({'status': 'success', 'message': 'Renewal processed'})


class SubscriptionTierViewSet(viewsets.ModelViewSet):
    """Manage subscription tiers"""
    permission_classes = [IsAuthenticated]
    
    queryset = SubscriptionTier.objects.filter(is_active=True)
    serializer_class = None  # Add serializer later
    
    def get_queryset(self):
        # Only staff can manage (create/update/delete) subscription tiers.
        # Regular users must still be able to view active tiers (see `active`
        # action below), so this restriction only applies to the default
        # list/retrieve/write actions of this ModelViewSet.
        if not self.request.user.is_staff:
            return SubscriptionTier.objects.none()
        return super().get_queryset().order_by('sort_order', 'price_etb')
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def active(self, request):
        """Get all active tiers (visible to any user, including unauthenticated)"""
        tiers = SubscriptionTier.objects.filter(is_active=True).order_by('sort_order', 'price_etb')
        data = [{
            'id': str(tier.id),
            'name': tier.name,
            'slug': tier.slug,
            'description': tier.description,
            'duration_type': tier.duration_type,
            'duration_days': tier.duration_days,
            'price_etb': float(tier.price_etb),
            'price_coins': tier.price_coins,
            'onevas_code': tier.onevas_code,
            'short_code': tier.short_code,
            'features': tier.features,
            'privileges': tier.privileges,
            'apple_product_id': tier.apple_product_id,
        } for tier in tiers]
        return Response(data)


class SubscriptionViewSet(viewsets.ModelViewSet):
    """Manage user subscriptions"""
    permission_classes = [IsAuthenticated]

    queryset = UserSubscription.objects.all()
    serializer_class = None  # Add serializer later

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)

    def list(self, request):
        """Get user's current subscription"""
        subscription = self.get_queryset().filter(status='active').first()

        # Check for grace period subscription
        grace_subscription = self.get_queryset().filter(status='grace_period').first()

        # Auto-expire grace period if expired
        if grace_subscription and not grace_subscription.is_in_grace:
            print(f'[SUBSCRIPTION VIEWSET] Grace period expired for subscription {grace_subscription.id}, marking as expired')
            grace_subscription.status = 'expired'
            grace_subscription.save()
            grace_subscription = None

        print(f'[SUBSCRIPTION VIEWSET] User: {request.user.username} (ID: {request.user.id})')
        print(f'[SUBSCRIPTION VIEWSET] Active subscription found: {subscription is not None}')
        if subscription:
            print(f'[SUBSCRIPTION VIEWSET] Subscription: ID={subscription.id}, status={subscription.status}, payment_method={subscription.payment_method}')
        print(f'[SUBSCRIPTION VIEWSET] Grace subscription found: {grace_subscription is not None}')

        if not subscription and not grace_subscription:
            # Check if user is in trial
            profile = request.user.profile
            if profile.is_trial_user and profile.trial_end_date and profile.trial_end_date > timezone.now():
                return Response({
                    'status': 'trial',
                    'trial_end_date': profile.trial_end_date.isoformat(),
                    'days_remaining': (profile.trial_end_date - timezone.now()).days
                })
            else:
                return Response({'status': 'no_subscription'})

        # Use grace subscription if no active subscription
        sub = subscription or grace_subscription

        data = {
            'id': str(sub.id),
            'tier': {
                'name': sub.tier.name,
                'duration_type': sub.tier.duration_type,
                'price_etb': float(sub.tier.price_etb),
                'privileges': sub.tier.privileges,
            },
            'status': sub.status,
            'start_date': sub.start_date.isoformat(),
            'end_date': sub.end_date.isoformat() if sub.end_date else None,
            'next_renewal_date': sub.next_renewal_date.isoformat() if sub.next_renewal_date else None,
            'auto_renew': sub.auto_renew,
            'grace_period': sub.status == 'grace_period',
            'grace_expires_at': sub.grace_expires_at.isoformat() if sub.grace_expires_at else None,
            'payment_method': sub.payment_method,
            'mandate_contract_id': sub.mandate_contract_id,
        }
        return Response(data)
    
    @action(detail=False, methods=['post'])
    def subscribe(self, request):
        """Initiate subscription request"""
        tier_id = request.data.get('tier_id')
        payment_method = request.data.get('payment_method', 'onevas')  # onevas, telebirr, coins
        
        try:
            tier = SubscriptionTier.objects.get(id=tier_id, is_active=True)
        except SubscriptionTier.DoesNotExist:
            return Response({'error': 'Invalid tier'}, status=400)
        
        user = request.user
        profile = user.profile

        # Check if user already has active subscription with ANY payment method
        # This prevents multiple active subscriptions across airtime, telebirr, and superapp
        active_sub = UserSubscription.objects.filter(
            user=user,
            status='active',
            end_date__gt=timezone.now()
        ).first()

        if active_sub:
            existing_tier = active_sub.tier
            return Response({
                'error': f'You already have an active {existing_tier.name} subscription via {active_sub.payment_method}. Please cancel your current subscription before subscribing to a new plan.',
                'existing_subscription': {
                    'tier': existing_tier.name,
                    'payment_method': active_sub.payment_method,
                    'end_date': active_sub.end_date.isoformat() if active_sub.end_date else None
                }
            }, status=400)
        
        if payment_method == 'onevas':
            # Send Onevas charging request
            response = self.send_onevas_charge(user, tier)
            return response
        
        elif payment_method == 'coins':
            # Check coin balance
            if not tier.price_coins:
                return Response({'error': 'This tier cannot be purchased with coins'}, status=400)
            
            if profile.coins < tier.price_coins:
                return Response({'error': 'Insufficient coins'}, status=400)
            
            # Deduct coins and activate subscription
            with transaction.atomic():
                # Create coin transaction
                CoinTransaction.objects.create(
                    user=user,
                    transaction_type='subscription',
                    amount=-tier.price_coins,
                    balance_after=profile.coins - tier.price_coins,
                    description=f'Subscription: {tier.name}',
                    reference_id=str(tier.id),
                    reference_type='subscription'
                )
                
                # Update profile
                profile.coins -= tier.price_coins
                profile.coins_spent_total += tier.price_coins
                profile.is_trial_user = False
                profile.save()
                
                # Create subscription
                subscription = UserSubscription.objects.create(
                    user=user,
                    tier=tier,
                    duration_type=tier.duration_type,
                    status='pending'
                )
                subscription.activate()
                
                # Record history
                SubscriptionHistory.objects.create(
                    user=user,
                    subscription=subscription,
                    tier=tier,
                    action='created',
                    reason='Purchased with coins',
                    metadata={'payment_method': 'coins', 'amount': tier.price_coins}
                )
                
                # Create payment record
                SubscriptionPayment.objects.create(
                    subscription=subscription,
                    user=user,
                    amount=tier.price_etb,
                    payment_method='coins',
                    duration_type=tier.duration_type,
                    period_start=subscription.start_date,
                    period_end=subscription.end_date or timezone.now() + timedelta(days=tier.duration_days or 30),
                    status='completed'
                )
            
            return Response({'status': 'success', 'message': 'Subscription activated'})
        
        elif payment_method == 'telebirr':
            # Initiate Telebirr payment
            response = self.initiate_telebirr_payment(user, tier)
            return response
        
        else:
            return Response({'error': 'Invalid payment method'}, status=400)
    
    def send_onevas_charge(self, user, tier):
        """DISABLED: Ethio Telecom SIM cards are only accessible for SMS OTP purposes.
        Onevas charging has been disabled to ensure phone numbers are used solely for OTP verification."""
        return Response(
            {'error': 'Onevas charging is disabled. Ethio Telecom SIM cards are only accessible for SMS OTP verification.'},
            status=status.HTTP_403_FORBIDDEN
        )
    
    def initiate_telebirr_payment(self, user, tier):
        """Create a Telebirr H5 (InApp) prepaid order for a subscription tier."""
        try:
            response = telebirr_service.create_order(
                title=f'Subscription: {tier.name}',
                amount='{:.2f}'.format(float(tier.price_etb)),
                trade_type='InApp',
            )

            if response.get('success'):
                merch_order_id = response.get('merch_order_id')
                # Create pending payment record keyed by merch_order_id.
                payment = SubscriptionPayment.objects.create(
                    user=user,
                    subscription=None,  # Will be linked after payment success
                    amount=tier.price_etb,
                    currency='ETB',
                    status='pending',
                    payment_method='telebirr',
                    onevas_transaction_id=merch_order_id,
                    period_start=timezone.now(),
                    period_end=timezone.now() + timedelta(days=tier.duration_days or 30),
                )

                return Response({
                    'status': 'pending',
                    'message': 'Order created. Call js_fun_start_pay with raw_request.',
                    'raw_request': response.get('raw_request'),
                    'merch_order_id': merch_order_id,
                    'prepay_id': response.get('prepay_id'),
                    'payment_id': str(payment.id),
                })
            else:
                return Response({'error': response.get('error', 'Payment initiation failed')}, status=400)

        except Exception as e:
            return Response({'error': str(e)}, status=500)
    
    @action(detail=False, methods=['post'])
    def unsubscribe(self, request):
        """Cancel subscription"""
        subscription = self.get_queryset().filter(status='active').first()
        
        if not subscription:
            return Response({'error': 'No active subscription'}, status=400)
        
        reason = request.data.get('reason', 'User requested cancellation')
        subscription.cancel(reason=reason)
        
        # Record history
        SubscriptionHistory.objects.create(
            user=request.user,
            subscription=subscription,
            tier=subscription.tier,
            action='cancelled',
            reason=reason
        )
        
        return Response({'status': 'success', 'message': 'Subscription cancelled'})
    
    @action(detail=False, methods=['get'])
    def history(self, request):
        """Get subscription history"""
        history = SubscriptionHistory.objects.filter(user=request.user).order_by('-created_at')
        
        data = [{
            'action': item.action,
            'tier_name': item.tier.name if item.tier else None,
            'reason': item.reason,
            'created_at': item.created_at.isoformat(),
        } for item in history]
        
        return Response(data)


class TrialPopupViewSet(viewsets.ModelViewSet):
    """Track trial popup interactions"""
    permission_classes = [IsAuthenticated]
    
    queryset = TrialPopupLog.objects.all()
    serializer_class = None
    
    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)
    
    def create(self, request):
        """Log popup interaction"""
        trigger_action = request.data.get('trigger_action')
        trigger_screen = request.data.get('trigger_screen')
        user_action = request.data.get('user_action')
        
        # Update user profile
        profile = request.user.profile
        profile.trial_interaction_count += 1
        if user_action:
            profile.trial_popup_shown_count += 1
        profile.save()
        
        # Log the popup
        TrialPopupLog.objects.create(
            user=request.user,
            trigger_action=trigger_action,
            trigger_screen=trigger_screen,
            user_action=user_action
        )
        
        return Response({'status': 'success'})


class CoinTransactionViewSet(viewsets.ModelViewSet):
    """Manage coin transactions"""
    permission_classes = [IsAuthenticated]
    
    queryset = CoinTransaction.objects.all()
    serializer_class = None
    
    def get_queryset(self):
        return self.queryset.filter(user=self.request.user).order_by('-created_at')
    
    def list(self, request):
        """Get user's coin transactions"""
        transactions = self.get_queryset()
        
        data = [{
            'id': str(t.id),
            'transaction_type': t.transaction_type,
            'amount': t.amount,
            'balance_after': t.balance_after,
            'description': t.description,
            'created_at': t.created_at.isoformat(),
        } for t in transactions]
        
        return Response(data)
    
    @action(detail=False, methods=['post'])
    def purchase(self, request):
        """Purchase coins via Telebirr or airtime"""
        amount = request.data.get('amount')  # ETB amount
        payment_method = request.data.get('payment_method', 'telebirr')
        
        # Coin conversion: 10 ETB = 100 coins (1 ETB = 10 coins)
        coins = int(amount * 10)
        
        if payment_method == 'telebirr':
            # Initiate Telebirr payment
            from .telebirr_service import TelebirrService
            
            try:
                telebirr = TelebirrService()
                response = telebirr.create_payment(
                    amount=float(amount),
                    phone_number=request.user.profile.phone_number,
                    description=f'Purchase {coins} coins'
                )
                
                if response.get('success'):
                    return Response({
                        'status': 'pending',
                        'message': f'Purchasing {coins} coins via Telebirr',
                        'payment_url': response.get('payment_url'),
                        'coins': coins
                    })
                else:
                    return Response({'error': response.get('error', 'Payment failed')}, status=500)
            
            except Exception as e:
                return Response({'error': str(e)}, status=500)
        
        else:
            return Response({'error': 'Invalid payment method'}, status=400)


class AdminSubscriptionViewSet(viewsets.ModelViewSet):
    """Admin subscription management"""
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        # Check admin permissions
        if not self.request.user.is_staff and not self.request.user.is_superuser:
            return UserSubscription.objects.none()
        
        return UserSubscription.objects.all()
    
    def _type_filter(self, request):
        """Build queryset filters from ?type= query param.

        type=ondemand     -> only OnDemand tiers
        type=subscription -> only recurring tiers (daily/weekly/monthly)
        (none)            -> no filter
        Returns dict with `sub_filter` (for UserSubscription / SubscriptionPayment via subscription__) and `tier_filter` (for SubscriptionTier).
        """
        t = (request.query_params.get('type') or '').lower()
        if t == 'ondemand':
            return {
                'sub_filter': {'tier__duration_type': 'ondemand'},
                'pay_filter': {'subscription__tier__duration_type': 'ondemand'},
                'tier_filter': {'duration_type': 'ondemand'},
            }
        if t == 'subscription':
            recurring = ['daily', 'weekly', 'monthly']
            return {
                'sub_filter': {'tier__duration_type__in': recurring},
                'pay_filter': {'subscription__tier__duration_type__in': recurring},
                'tier_filter': {'duration_type__in': recurring},
            }
        return {'sub_filter': {}, 'pay_filter': {}, 'tier_filter': {}}

    @action(detail=False, methods=['get'])
    def analytics(self, request):
        """Get subscription analytics. Optional ?type=subscription|ondemand to scope."""
        if not self._is_admin(request):
            return Response({'error': 'Unauthorized'}, status=403)

        f = self._type_filter(request)

        sub_qs = UserSubscription.objects.filter(**f['sub_filter'])
        pay_qs = SubscriptionPayment.objects.filter(status='completed', **f['pay_filter'])

        total_subscriptions = sub_qs.count()
        active_subscriptions = sub_qs.filter(status='active').count()
        expired_subscriptions = sub_qs.filter(status='expired').count()

        # Revenue calculation
        total_revenue = sum(p.amount for p in pay_qs)

        # Trial users (only meaningful for the subscription view)
        if not f['tier_filter'] or f['tier_filter'].get('duration_type') != 'ondemand':
            trial_users = UserProfile.objects.filter(is_trial_user=True).count()
        else:
            trial_users = 0

        # Tier distribution
        tier_distribution = {}
        for tier in SubscriptionTier.objects.filter(**f['tier_filter']):
            count = sub_qs.filter(tier=tier, status='active').count()
            tier_distribution[tier.name] = count

        data = {
            'total_subscriptions': total_subscriptions,
            'active_subscriptions': active_subscriptions,
            'expired_subscriptions': expired_subscriptions,
            'total_revenue': float(total_revenue),
            'trial_users': trial_users,
            'tier_distribution': tier_distribution,
        }

        return Response(data)
    
    @action(detail=False, methods=['get'])
    def charging_analytics(self, request):
        """Get real-time charging analytics. Optional ?type=subscription|ondemand."""
        if not self._is_admin(request):
            return Response({'error': 'Unauthorized'}, status=403)
        
        from django.db.models import Sum, Count
        from datetime import datetime, timedelta

        f = self._type_filter(request)
        sub_filter = f['sub_filter']
        pay_filter = f['pay_filter']

        # Get time ranges
        today = timezone.now().date()
        week_ago = today - timedelta(days=7)
        month_ago = today - timedelta(days=30)

        # Active subscriptions by tier
        active_by_tier = UserSubscription.objects.filter(
            status='active', **sub_filter
        ).values('tier__name').annotate(
            count=Count('id'),
            total_revenue=Sum('tier__price_etb')
        ).order_by('-total_revenue')

        # Today's revenue
        today_payments = SubscriptionPayment.objects.filter(
            status='completed',
            period_start__date=today,
            **pay_filter,
        ).aggregate(
            total=Sum('amount'),
            count=Count('id')
        )

        # This week's revenue
        week_payments = SubscriptionPayment.objects.filter(
            status='completed',
            period_start__date__gte=week_ago,
            **pay_filter,
        ).aggregate(
            total=Sum('amount'),
            count=Count('id')
        )

        # This month's revenue
        month_payments = SubscriptionPayment.objects.filter(
            status='completed',
            period_start__date__gte=month_ago,
            **pay_filter,
        ).aggregate(
            total=Sum('amount'),
            count=Count('id')
        )

        # Cancellations this month (scoped by tier filter when provided)
        cancel_qs = SubscriptionHistory.objects.filter(
            action='cancelled',
            created_at__date__gte=month_ago,
        )
        if sub_filter:
            # SubscriptionHistory has its own tier FK
            tier_only = {k.replace('tier__', 'tier__'): v for k, v in sub_filter.items()}
            cancel_qs = cancel_qs.filter(**tier_only)
        month_cancellations = cancel_qs.count()

        # Expected monthly recurring revenue (MRR)
        active_subs = UserSubscription.objects.filter(status='active', **sub_filter)
        mrr = sum([sub.tier.price_etb for sub in active_subs if sub.tier])

        # Recent transactions
        recent_transactions = SubscriptionPayment.objects.filter(
            status='completed', **pay_filter,
        ).order_by('-created_at')[:20]
        
        recent_data = []
        for tx in recent_transactions:
            sub = tx.subscription
            tier = sub.tier if sub else None
            user_obj = (sub.user if sub and sub.user else tx.user) if hasattr(tx, 'user') else (sub.user if sub else None)
            phone = ''
            if sub and getattr(sub, 'onevas_phone_number', None):
                phone = mask_phone_number(sub.onevas_phone_number)
            elif user_obj and hasattr(user_obj, 'profile') and getattr(user_obj.profile, 'phone_number', None):
                phone = mask_phone_number(user_obj.profile.phone_number)

            recent_data.append({
                'id': str(tx.id),
                'amount': float(tx.amount),
                'currency': tx.currency,
                'payment_method': tx.payment_method,
                'tier': tier.name if tier else 'N/A',
                'duration_type': tx.duration_type or (tier.duration_type if tier else ''),
                'duration_days': tier.duration_days if tier else None,
                'user': user_obj.username if user_obj else 'N/A',
                'user_id': user_obj.id if user_obj else None,
                'email': user_obj.email if user_obj else '',
                'phone': phone,
                'period_start': tx.period_start.strftime('%Y-%m-%d %H:%M') if tx.period_start else '',
                'period_end': tx.period_end.strftime('%Y-%m-%d %H:%M') if tx.period_end else '',
                'date': tx.created_at.strftime('%Y-%m-%d %H:%M') if tx.created_at else (tx.period_start.strftime('%Y-%m-%d %H:%M') if tx.period_start else 'N/A'),
                'status': tx.status,
            })
        
        return Response({
            'active_subscriptions': {
                'total': active_subs.count(),
                'by_tier': list(active_by_tier),
                'mrr': float(mrr)
            },
            'revenue': {
                'today': {
                    'total': float(today_payments['total'] or 0),
                    'count': today_payments['count'] or 0
                },
                'week': {
                    'total': float(week_payments['total'] or 0),
                    'count': week_payments['count'] or 0
                },
                'month': {
                    'total': float(month_payments['total'] or 0),
                    'count': month_payments['count'] or 0
                }
            },
            'cancellations': {
                'month_count': month_cancellations
            },
            'recent_transactions': recent_data
        })
    
    @action(detail=False, methods=['get'])
    def revenue(self, request):
        """Get revenue reports"""
        if not self._is_admin(request):
            return Response({'error': 'Unauthorized'}, status=403)
        
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        
        payments = SubscriptionPayment.objects.filter(status='completed')
        
        if date_from:
            from datetime import datetime
            payments = payments.filter(created_at__gte=datetime.fromisoformat(date_from))
        if date_to:
            from datetime import datetime
            payments = payments.filter(created_at__lte=datetime.fromisoformat(date_to))
        
        revenue_by_tier = {}
        for payment in payments:
            tier_name = payment.subscription.tier.name if payment.subscription.tier else 'Unknown'
            revenue_by_tier[tier_name] = revenue_by_tier.get(tier_name, 0) + float(payment.amount)
        
        data = {
            'total_revenue': sum(float(p.amount) for p in payments),
            'revenue_by_tier': revenue_by_tier,
            'payment_count': payments.count(),
        }
        
        return Response(data)
    
    def _is_admin(self, request):
        """Check if user has admin permissions"""
        return request.user.is_staff or request.user.is_superuser


# ============================================================================
# COMMENTED OUT: Mandate-based recurring subscription flow
# Replaced by one-time subscription flow (mimics coin purchase)
# ============================================================================

# @api_view(['POST'])
# @permission_classes([AllowAny])  # Telebirr calls this without authentication
# def telebirr_disburse_callback(request):
#     """
#     Handle the Telebirr disbursement notification callback for subscription payments.
#     This receives notifications when recurring deductions are processed.
#     Also handles mandate creation callbacks from SuperApp.
#     """
#     logger.info('=' * 80)
#     logger.info('TELEBIRR DISBURSE CALLBACK - REQUEST RECEIVED')
#     logger.info('=' * 80)
#     logger.info(f'Request method: {request.method}')
#     logger.info(f'Request URL: {request.build_absolute_uri()}')
#     logger.info(f'Request headers: {dict(request.headers)}')
#     logger.info(f'Query params: {dict(request.GET)}')
#     logger.info(f'Request body: {request.body}')
#     logger.info(f'Request data: {request.data}')
#     logger.info(f'All request.data keys: {list(request.data.keys())}')
#     for key, value in request.data.items():
#         logger.info(f'  {key}: {value}')
#     
#     # Check if this is a mandate creation callback (has mandate_contract_id or mct_contract_no)
#     mandate_contract_id = request.data.get('mandate_contract_id')
#     mct_contract_no = request.data.get('mct_contract_no') or request.data.get('merch_contract_no')
#     
#     if mandate_contract_id or mct_contract_no:
#         logger.info('[TELEBIRR DISBURSE CALLBACK] This is a mandate creation callback')
#         logger.info(f'[TELEBIRR DISBURSE CALLBACK] mandate_contract_id: {mandate_contract_id}')
#         logger.info(f'[TELEBIRR DISBURSE CALLBACK] mct_contract_no: {mct_contract_no}')
#         
#         # Handle mandate creation callback
#         if mct_contract_no:
#             try:
#                 subscription = UserSubscription.objects.filter(mct_contract_no=mct_contract_no).first()
#                 if subscription:
#                     if mandate_contract_id:
#                         subscription.mandate_contract_id = mandate_contract_id
#                         subscription.save()
#                         logger.info(f'[TELEBIRR DISBURSE CALLBACK] Updated subscription {subscription.id} with mandate_contract_id: {mandate_contract_id}')
#                     else:
#                         logger.warning(f'[TELEBIRR DISBURSE CALLBACK] mandate_contract_id not provided in callback')
#                 else:
#                     logger.warning(f'[TELEBIRR DISBURSE CALLBACK] No subscription found for mct_contract_no: {mct_contract_no}')
#             except Exception as e:
#                 logger.error(f'[TELEBIRR DISBURSE CALLBACK] Error updating subscription: {e}')
#                 logger.exception('[TELEBIRR DISBURSE CALLBACK] Full traceback')
#         
#         return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'mandate callback processed'})
#     
#     # Verify signature using the same logic as regular payment callback
#     notify = telebirr_service.verify_notify(request.data)
#     
#     if not notify.get('verified'):
#         # IMPORTANT: Always acknowledge receipt with HTTP 200 so Telebirr registers
#         # the callback as "accepted" and does not keep retrying / flag the endpoint.
#         # We intentionally DO NOT process the payment when the signature is invalid.
#         # The signed record can still be reconciled later via queryOrder.
#         logger.warning(
#             'TELEBIRR DISBURSE CALLBACK - Invalid signature; acknowledging receipt '
#             'but NOT processing. merch_order_id=%s',
#             request.data.get('merch_order_id')
#         )
#         return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'received (signature not verified)'})
#     
#     merch_order_id = notify.get('merch_order_id')
#     trade_status = notify.get('trade_status')
#     payment_order_id = notify.get('payment_order_id')
#     total_amount = notify.get('total_amount')
#     callback_mct_contract_no = notify.get('mct_contract_no')
#
#     logger.info(f'TELEBIRR DISBURSE CALLBACK - merch_order_id: {merch_order_id}, trade_status: {trade_status}, mct_contract_no: {callback_mct_contract_no}')
#
#     # Find the subscription associated with this disbursement
#     try:
#         # First try to find by mct_contract_no from callback (preferred for Telebirr mandate flow)
#         if callback_mct_contract_no:
#             subscription = UserSubscription.objects.filter(mct_contract_no=callback_mct_contract_no).first()
#         else:
#             # Fallback: try to find by merch_order_id via old DirectDebitMandate path
#             subscription = UserSubscription.objects.filter(
#                 mct_contract_no__in=DirectDebitMandate.objects.filter(
#                     originator_conversation_id=merch_order_id
#                 ).values_list('mct_contract_no', flat=True)
#             ).first()
#         
#         if not subscription:
#             logger.warning(f'TELEBIRR DISBURSE CALLBACK - No subscription found for merch_order_id: {merch_order_id}')
#             return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'no subscription found'})
#         
#         logger.info(f'TELEBIRR DISBURSE CALLBACK - Found subscription: {subscription.id}')
#         
#         # Update subscription based on disbursement status
#         if trade_status == 'Completed':
#             # Successful disbursement - extend subscription
#             logger.info(f'TELEBIRR DISBURSE CALLBACK - Disbursement successful, extending subscription')
#             # Update next renewal date based on plan frequency
#             now = timezone.now()
#             if subscription.tier.frequency == 'daily':
#                 subscription.next_renewal_date = now + timedelta(days=1)
#             elif subscription.tier.frequency == 'weekly':
#                 subscription.next_renewal_date = now + timedelta(weeks=1)
#             elif subscription.tier.frequency == 'monthly':
#                 subscription.next_renewal_date = now + timedelta(days=30)
#
#             subscription.save(update_fields=['next_renewal_date'])
#             logger.info(f'TELEBIRR DISBURSE CALLBACK - Subscription extended to {subscription.next_renewal_date}')
#
#             # Send SMS notification for successful renewal
#             try:
#                 from .services.superapp_sms_service import superapp_sms_service
#                 phone_number = subscription.telebirr_phone_number
#                 if not phone_number and subscription.user and subscription.user.profile:
#                     phone_number = subscription.user.profile.phone_number
#
#                 if phone_number:
#                     superapp_sms_service.send_subscription_renewal(
#                         phone_number=phone_number,
#                         plan_name=subscription.tier.name if subscription.tier else 'Subscription',
#                         amount=total_amount or subscription.tier.price_etb if subscription.tier else 0,
#                         duration_type=subscription.duration_type,
#                         next_renewal_date=subscription.next_renewal_date
#                     )
#                     logger.info(f'TELEBIRR DISBURSE CALLBACK - Renewal SMS sent to {phone_number}')
#             except Exception as e:
#                 logger.warning(f'TELEBIRR DISBURSE CALLBACK - Failed to send renewal SMS: {e}')
#                 # Non-fatal: subscription already renewed
#
#         elif trade_status in ['Failure', 'Expired']:
#             # Failed disbursement - mark subscription as inactive/grace period
#             logger.warning(f'TELEBIRR DISBURSE CALLBACK - Disbursement failed: {trade_status}')
#             subscription.mandate_status = 'failed'
#             subscription.save(update_fields=['mandate_status'])
#
#             # Send SMS notification for failed renewal
#             try:
#                 from .services.superapp_sms_service import superapp_sms_service
#                 phone_number = subscription.telebirr_phone_number
#                 if not phone_number and subscription.user and subscription.user.profile:
#                     phone_number = subscription.user.profile.phone_number
#
#                 if phone_number:
#                     superapp_sms_service.send_renewal_failed(
#                         phone_number=phone_number,
#                         plan_name=subscription.tier.name if subscription.tier else 'Subscription',
#                         amount=total_amount or subscription.tier.price_etb if subscription.tier else 0,
#                         duration_type=subscription.duration_type
#                     )
#                     logger.info(f'TELEBIRR DISBURSE CALLBACK - Renewal failed SMS sent to {phone_number}')
#             except Exception as e:
#                 logger.warning(f'TELEBIRR DISBURSE CALLBACK - Failed to send renewal failed SMS: {e}')
#                 # Non-fatal: subscription already marked as failed
#
#         else:
#             logger.info(f'TELEBIRR DISBURSE CALLBACK - Disbursement status: {trade_status} (no action needed)')
#         
#         return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'success'})
#         
#     except Exception as e:
#         logger.error(f'TELEBIRR DISBURSE CALLBACK - Error: {str(e)}')
#         logger.exception('TELEBIRR DISBURSE CALLBACK - Full traceback')
#         return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'error processed'})


# ---------------------------------------------------------------------------
# COMMENTED OUT: Telebirr Mandate Subscription (SuperApp)
# Replaced by one-time subscription flow (mimics coin purchase)
# ---------------------------------------------------------------------------

# @api_view(['POST'])
# @permission_classes([AllowAny])
# def telebirr_save_mandate(request):
#     """
#     Save mandate contract details after user signs contract in SuperApp.
#     Request body: {
#         mct_contract_no: string,
#         mandate_contract_id: string (optional, can be null),
#         plan_type: 'daily'|'weekly'|'monthly',
#         phone_number: string
#     }
#     """
#     logger.info('=' * 80)
#     logger.info('[TELEBIRR_MANDATE] SAVE MANDATE - REQUEST RECEIVED')
#     logger.info('=' * 80)
#     logger.info(f'Authenticated: {request.user.is_authenticated}')
#     if request.user.is_authenticated:
#         logger.info(f'User: {request.user.username} (ID: {request.user.id})')
#     logger.info(f'Request data: {request.data}')
#     
#     data = request.data
#     mct_contract_no = data.get('mct_contract_no')
#     mandate_contract_id = data.get('mandate_contract_id')
#     plan_type = data.get('plan_type')
#     phone_number = data.get('phone_number')
#     
#     logger.info(f'[TELEBIRR_MANDATE] Extracted parameters:')
#     logger.info(f'  - mct_contract_no: {mct_contract_no}')
#     logger.info(f'  - mandate_contract_id: {mandate_contract_id}')
#     logger.info(f'  - plan_type: {plan_type}')
#     logger.info(f'  - phone_number: {phone_number}')
#     
#     if not all([mct_contract_no, plan_type, phone_number]):
#         logger.warning('[TELEBIRR_MANDATE] Missing required parameters')
#         return Response({'error': 'mct_contract_no, plan_type, and phone_number are required'},
#                         status=status.HTTP_400_BAD_REQUEST)
#     
#     try:
#         # Clean phone number (remove +251 prefix if present)
#         cleaned_phone = phone_number.replace('+', '').strip()
#         if cleaned_phone.startswith('251'):
#             cleaned_phone = '0' + cleaned_phone[3:]
#         
#         logger.info(f'[TELEBIRR_MANDATE] Cleaned phone number: {cleaned_phone}')
#         
#         # Build phone variants so lookups match regardless of stored format.
#         # Telebirr auth stores the profile phone in international form
#         # (e.g. '251911528271') while we normalize the incoming value to local
#         # form ('0911528271'). Matching only one form attached the subscription
#         # to a different/new user, leaving the real user with no active sub.
#         phone_variants = {cleaned_phone, phone_number, phone_number.replace('+', '').strip()}
#         if cleaned_phone.startswith('0'):
#             phone_variants.add('251' + cleaned_phone[1:])
#             phone_variants.add('+251' + cleaned_phone[1:])
#         phone_variants = [p for p in phone_variants if p]
#
#         from django.contrib.auth.models import User
#         from .models import UserProfile
#
#         # Prefer the authenticated user. The save request is made with the
#         # logged-in user's token, so the subscription MUST attach to them.
#         user = request.user if getattr(request.user, 'is_authenticated', False) else None
#
#         try:
#             if user:
#                 logger.info(f'[TELEBIRR_MANDATE] Using authenticated user: {user.username} (ID: {user.id})')
#                 # Ensure the profile carries a phone for future lookups.
#                 profile, _ = UserProfile.objects.get_or_create(
#                     user=user, defaults={'phone_number': cleaned_phone}
#                 )
#                 if not profile.phone_number:
#                     profile.phone_number = cleaned_phone
#                     profile.save()
#             else:
#                 # Unauthenticated fallback: find existing user by any phone form.
#                 profile = UserProfile.objects.filter(phone_number__in=phone_variants).first()
#                 if profile:
#                     user = profile.user
#                     # Ensure phone number is set correctly
#                     if not profile.phone_number:
#                         profile.phone_number = cleaned_phone
#                         profile.save()
#                     logger.info(f'[TELEBIRR_MANDATE] Found existing user by phone: {user.username} (ID: {user.id})')
#                 else:
#                     username = f'telebirr_{cleaned_phone}'
#                     user = User.objects.filter(username=username).first()
#                     if user:
#                         profile, created = UserProfile.objects.get_or_create(
#                             user=user, defaults={'phone_number': cleaned_phone}
#                         )
#                         if not created and not profile.phone_number:
#                             profile.phone_number = cleaned_phone
#                             profile.save()
#                         logger.info(f'[TELEBIRR_MANDATE] Found existing user by username: {user.username} (ID: {user.id})')
#                     else:
#                         user = User.objects.create_user(username=username, password=None)
#                         profile, created = UserProfile.objects.get_or_create(
#                             user=user, defaults={'phone_number': cleaned_phone}
#                         )
#                         if not created or not profile.phone_number:
#                             profile.phone_number = cleaned_phone
#                             profile.save()
#                         logger.info(f'[TELEBIRR_MANDATE] Created new user: {user.username} (ID: {user.id})')
#         except Exception as e:
#             logger.error(f'[TELEBIRR_MANDATE] Error finding/creating user: {e}')
#             logger.exception('[TELEBIRR_MANDATE] Full traceback')
#             return Response({'error': f'Failed to find or create user: {str(e)}'},
#                             status=status.HTTP_500_INTERNAL_SERVER_ERROR)
#         
#         # Find the subscription tier based on plan type
#         logger.info(f'[TELEBIRR_MANDATE] Looking up tier for plan_type: {plan_type}')
#         tier = SubscriptionTier.objects.filter(duration_type=plan_type, is_active=True).first()
#         if not tier:
#             logger.error(f'[TELEBIRR_MANDATE] No active tier found for plan_type: {plan_type}')
#             return Response({'error': f'No active subscription tier found for plan type: {plan_type}'},
#                             status=status.HTTP_400_BAD_REQUEST)
#         
#         logger.info(f'[TELEBIRR_MANDATE] Found tier: {tier.name} (ID: {tier.id}, price: {tier.price_etb} ETB)')
#
#         # Check if the customer already has an active subscription with ANY
#         # payment method. Match by the user account AND by phone number on
#         # either phone field (in every format), so an airtime SMS-first
#         # subscription that is not yet linked to a user (user=None) still
#         # blocks a duplicate Telebirr/SuperApp subscription.
#         # Check for existing active subscription (will handle after Telebirr mandate verification)
#         active_filter = (
#             Q(user=user) |
#             Q(onevas_phone_number__in=phone_variants) |
#             Q(telebirr_phone_number__in=phone_variants)
#         )
#         existing_active_subscription = UserSubscription.objects.filter(
#             active_filter,
#             status='active',
#             end_date__gt=timezone.now()
#         ).first()
#         
#         # Also query Telebirr for any existing mandates (in case user was deleted from DB)
#         # This prevents "mandate contract already exist" error from Telebirr SuperApp
#         # Note: Telebirr query API does NOT support phone_number parameter per documentation
#         # We query all mandates for the merchant and filter by our stored mct_contract_no
#         mandate_contract_id = None
#         mandate_status = None
#         try:
#             from .services.telebirr_mandate_service import TelebirrMandateService
#             mandate_service = TelebirrMandateService()
#             # Retry the query with exponential backoff: right after SuperApp signing, Telebirr
#             # may not have persisted the mandate yet (propagation delay can take up to 3 minutes).
#             max_attempts = 12  # 12 attempts * 5 seconds = 60 seconds total
#             query_result = {}
#             for attempt in range(1, max_attempts + 1):
#                 logger.info(f'[TELEBIRR_MANDATE] Query attempt {attempt}/{max_attempts} for mct_contract_no: {mct_contract_no}')
#                 query_result = mandate_service.query_mandate(mct_contract_no=mct_contract_no)
#                 if query_result.get('result') == 'SUCCESS':
#                     break
#                 err_code = query_result.get('code') or query_result.get('errorCode')
#                 logger.warning(f'[TELEBIRR_MANDATE] Query attempt {attempt} returned result={query_result.get("result")} code={err_code}')
#                 
#                 # 60330006 = "Mandate contract info not found" — this is TEMPORARY.
#                 # Telebirr takes up to 30-60s to register the mandate after signing.
#                 # Do NOT break here; let the retry loop continue waiting.
#                 
#                 if attempt < max_attempts:
#                     time.sleep(5)
#             
#             # Capture the mandate_contract_id for our mct_contract_no from the query response
#             if query_result.get('result') == 'SUCCESS':
#                 biz_content = query_result.get('biz_content', {})
#                 
#                 # Response may return a single mandate (flat) or a list of mandates
#                 if biz_content.get('mandate_contract_id'):
#                     mandate_contract_id = biz_content.get('mandate_contract_id')
#                     mandate_status = biz_content.get('status', '').upper()
#                     logger.info(f'[TELEBIRR_MANDATE] Retrieved mandate_contract_id (flat): {mandate_contract_id}, status: {mandate_status}')
#                 else:
#                     mandates = biz_content.get('mandates', [])
#                     for mandate in mandates:
#                         if mandate.get('merch_contract_no') == mct_contract_no and mandate.get('mandate_contract_id'):
#                             mandate_contract_id = mandate.get('mandate_contract_id')
#                             mandate_status = mandate.get('status', '').upper()
#                             logger.info(f'[TELEBIRR_MANDATE] Matched mandate_contract_id for mct_contract_no {mct_contract_no}: {mandate_contract_id}, status: {mandate_status}')
#                             break
#                     else:
#                         logger.warning(f'[TELEBIRR_MANDATE] No mandate matched mct_contract_no {mct_contract_no} in query response')
#             else:
#                 err_code = query_result.get('code') or query_result.get('errorCode')
#                 logger.warning(f'[TELEBIRR_MANDATE] Current mct_contract_no {mct_contract_no} not found (code={err_code}), trying previous records...')
#
#                 # FALLBACK: The mandate may exist under a DIFFERENT mct_contract_no from a
#                 # prior preorder attempt. This happens when the SuperApp reports "mandate
#                 # already exists" — meaning the user already signed a mandate for this
#                 # template, but with a previous mct_contract_no that we generated earlier.
#                 from .models_subscription import PendingTelebirrMandate as PendingMandate
#                 candidate_mcts = set()
#
#                 # Gather old mct_contract_no values from PendingTelebirrMandate
#                 # Filter by phone to prevent cross-user mandate matching
#                 pending_phone_filter = Q(plan_type=plan_type)
#                 if phone_variants:
#                     pending_phone_filter &= Q(phone_number__in=phone_variants)
#                 pending_qs = PendingMandate.objects.filter(
#                     pending_phone_filter,
#                 ).exclude(
#                     mct_contract_no=mct_contract_no
#                 ).order_by('-created_at').values_list('mct_contract_no', flat=True)[:20]
#                 candidate_mcts.update(pending_qs)
#
#                 # Also gather from existing SubscriptionPlan records for this user/phone
#                 sub_qs = UserSubscription.objects.filter(
#                     Q(user=user) | Q(telebirr_phone_number__in=phone_variants),
#                     mct_contract_no__isnull=False,
#                 ).exclude(
#                     mct_contract_no=mct_contract_no
#                 ).values_list('mct_contract_no', flat=True)
#                 candidate_mcts.update(sub_qs)
#
#                 logger.info(f'[TELEBIRR_MANDATE] Found {len(candidate_mcts)} candidate previous mct_contract_nos to try')
#
#                 for old_mct in candidate_mcts:
#                     try:
#                         old_result = mandate_service.query_mandate(mct_contract_no=old_mct)
#                         if old_result.get('result') == 'SUCCESS':
#                             biz = old_result.get('biz_content', {})
#                             cid = biz.get('mandate_contract_id')
#                             cstatus = (biz.get('status') or '').upper()
#                             if cid and cstatus == 'ACTIVE':
#                                 mandate_contract_id = cid
#                                 mandate_status = cstatus
#                                 mct_contract_no = old_mct
#                                 logger.info(f'[TELEBIRR_MANDATE] FOUND existing ACTIVE mandate via old mct={old_mct}: id={cid}')
#                                 break
#                             else:
#                                 logger.info(f'[TELEBIRR_MANDATE] Old mct={old_mct} status={cstatus}, skipping')
#                     except Exception as e:
#                         logger.warning(f'[TELEBIRR_MANDATE] Failed to query old mct={old_mct}: {e}')
#
#                 if not mandate_contract_id:
#                     if err_code == '60330006':
#                         logger.warning(f'[TELEBIRR_MANDATE] Mandate not found after fallback search - allowing retry')
#                         return Response({
#                             'success': False,
#                             'error': f'Mandate contract not found on Telebirr yet (error code: {err_code}). Still registering...',
#                             'retry_later': True,
#                             'err_code': err_code
#                         }, status=status.HTTP_200_OK)
#                     logger.warning(f'[TELEBIRR_MANDATE] Telebirr query failed: {query_result.get("msg", "Unknown error")}')
#         except Exception as e:
#             logger.error(f'[TELEBIRR_MANDATE] Failed to query existing mandate on Telebirr: {e}')
#             return Response({
#                 'error': 'Failed to query Telebirr mandate API. Cannot proceed without mandate_contract_id.',
#                 'details': str(e)
#             }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
#         
#         # Require mandate_contract_id to create subscription
#         if not mandate_contract_id:
#             # Check if the error was "Mandate contract info not found" - this can be temporary
#             # Telebirr may still be registering the mandate after signing callback returns success
#             if query_result.get('code') == '60330006' or query_result.get('errorCode') == '60330006':
#                 logger.warning(f'[TELEBIRR_MANDATE] Mandate contract not found yet (error 60330006), may still be registering - allowing retry')
#                 return Response({
#                     'success': False,
#                     'error': 'Mandate contract not found on Telebirr yet. Still registering...',
#                     'mct_contract_no': mct_contract_no,
#                     'retry_later': True
#                 }, status=status.HTTP_200_OK)
#             
#             logger.warning(f'[TELEBIRR_MANDATE] mandate_contract_id not available yet - Telebirr may still be registering the mandate')
#             # Return 200 with success=False so frontend can continue polling
#             return Response({
#                 'success': False,
#                 'error': 'mandate_contract_id is required but could not be retrieved from Telebirr yet',
#                 'mct_contract_no': mct_contract_no,
#                 'retry_later': True
#             }, status=status.HTTP_200_OK)
#         
#         # Check mandate status - only proceed if ACTIVE
#         if mandate_status and mandate_status != 'ACTIVE':
#             logger.error(f'[TELEBIRR_MANDATE] Mandate status is {mandate_status}, not ACTIVE. Cannot create subscription.')
#             return Response({
#                 'success': False,
#                 'error': f'Mandate status is {mandate_status}. Cannot create subscription with a non-active mandate.',
#                 'mandate_status': mandate_status,
#                 'mandate_contract_id': mandate_contract_id,
#                 'mct_contract_no': mct_contract_no
#             }, status=status.HTTP_400_BAD_REQUEST)
#         
#         # If user has an existing active subscription, auto-cancel it now that we have a valid new mandate
#         if existing_active_subscription:
#             logger.info(f'[TELEBIRR_MANDATE] Auto-cancelling existing active subscription: {existing_active_subscription.id}')
#             existing_tier = existing_active_subscription.tier
#             
#             # Cancel the existing subscription
#             existing_active_subscription.cancel(reason='Auto-cancelled for new Telebirr mandate subscription')
#             
#             # Record subscription history
#             SubscriptionHistory.objects.create(
#                 user=user,
#                 subscription=existing_active_subscription,
#                 tier=existing_tier,
#                 action='cancelled',
#                 reason='Auto-cancelled for new Telebirr mandate subscription'
#             )
#             
#             logger.info(f'[TELEBIRR_MANDATE] Auto-cancelled existing subscription {existing_active_subscription.id}')
#             
#             # Send SMS informing user about the cancellation
#             from .services.superapp_sms_service import superapp_sms_service
#             cancellation_message = f"Your {existing_tier.name} subscription has been cancelled. A new subscription is being activated."
#             superapp_sms_service._send_sms(cleaned_phone, cancellation_message, existing_tier.duration_type)
#             
#             # If the existing subscription was Telebirr with a mandate, try to cancel the mandate too
#             if existing_active_subscription.payment_method == 'telebirr' and existing_active_subscription.mandate_contract_id:
#                 try:
#                     from .services.telebirr_mandate_service import TelebirrMandateService
#                     mandate_service = TelebirrMandateService()
#                     cancel_result = mandate_service.cancel_mandate(
#                         mandate_contract_id=existing_active_subscription.mandate_contract_id
#                     )
#                     if cancel_result.get('result') == 'SUCCESS':
#                         logger.info(f'[TELEBIRR_MANDATE] Cancelled old mandate {existing_active_subscription.mandate_contract_id}')
#                     else:
#                         logger.warning(f'[TELEBIRR_MANDATE] Failed to cancel old mandate: {cancel_result}')
#                 except Exception as e:
#                     logger.error(f'[TELEBIRR_MANDATE] Error cancelling old mandate: {e}')
#         
#         # Create a new subscription (always treat as brand new)
#         logger.info(f'[TELEBIRR_MANDATE] Creating new subscription for user: {user.username}')
#         
#         # DUPLICATE CHECK: Prevent creating multiple subs for the same mandate
#         existing_for_mandate = UserSubscription.objects.filter(
#             mandate_contract_id=mandate_contract_id,
#             status='active'
#         ).first()
#         if existing_for_mandate:
#             logger.info(f'[TELEBIRR_MANDATE] Subscription already exists for mandate {mandate_contract_id}, returning existing')
#             # Mark pending as completed
#             try:
#                 from .models import PendingTelebirrMandate
#                 PendingTelebirrMandate.objects.filter(mct_contract_no=mct_contract_no).update(
#                     status='completed', mandate_contract_id=mandate_contract_id)
#             except Exception:
#                 pass
#             return Response({
#                 'success': True,
#                 'subscription_id': str(existing_for_mandate.id),
#                 'mandate_contract_id': mandate_contract_id,
#                 'plan_type': existing_for_mandate.duration_type,
#                 'status': 'active',
#                 'end_date': existing_for_mandate.end_date.isoformat() if existing_for_mandate.end_date else None,
#             })
#         
#         # Calculate end_date and next_renewal_date based on tier duration
#         now = timezone.now()
#         end_date = now + timezone.timedelta(days=tier.duration_days) if tier.duration_days else None
#         next_renewal_date = end_date
#         logger.info(f'[TELEBIRR_MANDATE] end_date={end_date}, next_renewal_date={next_renewal_date}')
#         
#         # Create new subscription
#         subscription = UserSubscription.objects.create(
#             user=user,
#             tier=tier,
#             payment_method='telebirr',
#             duration_type=plan_type,
#             status='active',
#             mandate_contract_id=mandate_contract_id,
#             mct_contract_no=mct_contract_no,
#             mandate_status='active',
#             telebirr_phone_number=cleaned_phone,
#             auto_renew=True,
#             start_date=now,
#             end_date=end_date,
#             next_renewal_date=next_renewal_date,
#         )
#         
#         logger.info(f'[TELEBIRR_MANDATE] Created new subscription (ID: {subscription.id})')
#
#         # Send SMS notification for successful subscription
#         try:
#             from .services.superapp_sms_service import superapp_sms_service
#             superapp_sms_service.send_subscription_success(
#                 phone_number=cleaned_phone,
#                 plan_name=tier.name,
#                 amount=tier.price_etb,
#                 duration_type=plan_type,
#                 next_renewal_date=next_renewal_date
#             )
#             logger.info(f'[TELEBIRR_MANDATE] SMS notification sent to {cleaned_phone}')
#         except Exception as e:
#             logger.warning(f'[TELEBIRR_MANDATE] Failed to send SMS notification: {e}')
#             # Non-fatal: subscription already saved
#
#         logger.info(f'[TELEBIRR_MANDATE] Mandate saved successfully:')
#         logger.info(f'  - mct_contract_no: {mct_contract_no}')
#         logger.info(f'  - mandate_contract_id: {mandate_contract_id}')
#         logger.info(f'  - plan_type: {plan_type}')
#         logger.info(f'  - user: {user.username}')
#         logger.info(f'  - subscription_id: {subscription.id}')
#         logger.info(f'  - tier: {tier.name}')
#         logger.info(f'  - status: {subscription.status}')
#         logger.info(f'  - mandate_status: {subscription.mandate_status}')
#
#         # Mark the pending mandate record as completed
#         from .models import PendingTelebirrMandate
#         try:
#             pending = PendingTelebirrMandate.objects.filter(mct_contract_no=mct_contract_no).first()
#             if pending:
#                 pending.status = 'completed'
#                 pending.mandate_contract_id = mandate_contract_id
#                 pending.phone_number = cleaned_phone
#                 pending.save()
#                 logger.info(f'[TELEBIRR_MANDATE] Marked PendingTelebirrMandate as completed: {mct_contract_no}')
#         except Exception as e:
#             logger.warning(f'[TELEBIRR_MANDATE] Failed to update PendingTelebirrMandate: {e}')
#             # Non-fatal: subscription already saved
#
#         save_response_payload = {
#             'success': True,
#             'message': 'Mandate saved successfully',
#             'mct_contract_no': mct_contract_no,
#             'mandate_contract_id': mandate_contract_id,
#             'subscription_id': str(subscription.id),
#         }
#         logger.info('=' * 80)
#         logger.info(f'[TELEBIRR_MANDATE] SAVE MANDATE - RESPONSE TO CLIENT: {save_response_payload}')
#         logger.info('=' * 80)
#         return Response(save_response_payload)
#     except Exception as e:
#         logger.error(f'[TELEBIRR_MANDATE] Failed to save mandate: {e}')
#         logger.exception('[TELEBIRR_MANDATE] Full traceback')
#         logger.info(f'[TELEBIRR_MANDATE] SAVE MANDATE - ERROR RESPONSE TO CLIENT: {{"error": "{str(e)}"}}')
#         return Response({'error': str(e)},
#                         status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# @api_view(['POST'])
# @permission_classes([IsAuthenticated])
# def telebirr_cancel_mandate(request):
#     """
#     Cancel mandate contract and update subscription status.
#     Request body: {
#         mandate_contract_id: string (optional - will use user's active subscription if not provided)
#     }
#     """
#     logger.info('=' * 80)
#     logger.info('[TELEBIRR_MANDATE] CANCEL MANDATE - REQUEST RECEIVED')
#     logger.info('=' * 80)
#     logger.info(f'User: {request.user.username} (ID: {request.user.id})')
#     logger.info(f'Request data: {request.data}')
#     
#     mandate_contract_id = request.data.get('mandate_contract_id')
#     
#     # If mandate_contract_id not provided, find user's active Telebirr subscription
#     if not mandate_contract_id:
#         logger.info('[TELEBIRR_MANDATE] No mandate_contract_id provided, finding user\'s active Telebirr subscription')
#         subscription = UserSubscription.objects.filter(
#             user=request.user,
#             payment_method='telebirr',
#             status='active'
#         ).first()
#         
#         if not subscription:
#             logger.warning('[TELEBIRR_MANDATE] No active Telebirr subscription found')
#             return Response({'error': 'No active Telebirr subscription found'},
#                             status=status.HTTP_400_BAD_REQUEST)
#         
#         # Check if this is a Direct Debit subscription (has linked DirectDebitMandate)
#         from .models_direct_debit import DirectDebitMandate
#         direct_debit_mandate = DirectDebitMandate.objects.filter(
#             subscription_plan=subscription,
#             status='active'
#         ).first()
#         
#         # Fallback: try to find DirectDebitMandate by user and phone for old subscriptions
#         if not direct_debit_mandate and subscription.user and subscription.telebirr_phone_number:
#             logger.info('[TELEBIRR_MANDATE] No linked DirectDebitMandate, trying to find by user and phone')
#             phone_variants = [subscription.telebirr_phone_number]
#             phone = subscription.telebirr_phone_number.replace('+', '').replace(' ', '')
#             if phone.startswith('251') and len(phone) == 12:
#                 phone_variants.append('0' + phone[3:])
#             elif phone.startswith('0') and len(phone) == 10:
#                 phone_variants.append('251' + phone[1:])
#             
#             direct_debit_mandate = DirectDebitMandate.objects.filter(
#                 user=subscription.user,
#                 payer_msisdn__in=phone_variants,
#                 status='active'
#             ).first()
#             
#             if direct_debit_mandate:
#                 logger.info('[TELEBIRR_MANDATE] Found DirectDebitMandate by user and phone, linking it')
#                 # Link it for future use
#                 direct_debit_mandate.subscription_plan = subscription
#                 direct_debit_mandate.save(update_fields=['subscription_plan'])
#         
#         if direct_debit_mandate:
#             # Use Direct Debit service for Direct Debit subscriptions
#             logger.info('[TELEBIRR_MANDATE] Direct Debit subscription found, using Direct Debit service')
#             mandate_id = direct_debit_mandate.mandate_id
#             payer_msisdn = direct_debit_mandate.payer_msisdn
#             payer_reference_number = direct_debit_mandate.payer_reference_number
#             
#             if not mandate_id:
#                 logger.warning('[TELEBIRR_MANDATE] Direct Debit mandate has no mandate_id')
#                 logger.info('[TELEBIRR_MANDATE] PayerReferenceNumber: %s', payer_reference_number)
#                 logger.info('[TELEBIRR_MANDATE] MSISDN: %s', payer_msisdn)
#
#                 # Try once more to resolve the mandate_id from Telebirr by payer.
#                 try:
#                     from .telebirr_direct_debit_service import telebirr_direct_debit_service
#                     q = telebirr_direct_debit_service.query_mandate_by_payer(
#                         payer_msisdn=payer_msisdn,
#                         mandate_statuses=['03'],
#                         debug=False
#                     )
#                     if q.get('success'):
#                         matched = None
#                         for m in q.get('mandates', []):
#                             if m.get('payer_reference_number') == payer_reference_number:
#                                 matched = m
#                                 break
#                         mandate_id = (matched or {}).get('mandate_id') or q.get('mandate_id')
#                         if mandate_id:
#                             direct_debit_mandate.mandate_id = mandate_id[:18]
#                             direct_debit_mandate.save(update_fields=['mandate_id'])
#                             logger.info('[TELEBIRR_MANDATE] Resolved mandate_id at cancel time: %s', mandate_id)
#                 except Exception as q_err:
#                     logger.warning('[TELEBIRR_MANDATE] Cancel-time mandate_id query failed: %s', str(q_err))
#
#                 # If still no mandate_id: for one-off subscriptions (auto_renew=False)
#                 # there is no recurring mandate to cancel on Telebirr, so cancel locally
#                 # instead of blocking the user. Recurring subs still require the id.
#                 if not mandate_id:
#                     if not subscription.auto_renew:
#                         logger.info('[TELEBIRR_MANDATE] One-off subscription with no mandate_id, cancelling locally')
#                         subscription.status = 'cancelled'
#                         subscription.auto_renew = False
#                         subscription.save()
#                         direct_debit_mandate.cancel()
#                         return Response({'success': True, 'message': 'Subscription cancelled successfully'})
#                     return Response({
#                         'error': 'Mandate ID not found. Please contact support to have your subscription linked manually.',
#                         'details': f'Subscription ID: {subscription.id}, PayerReferenceNumber: {payer_reference_number}'
#                     }, status=status.HTTP_400_BAD_REQUEST)
#             
#             # Cancel using Direct Debit service
#             from .telebirr_direct_debit_service import telebirr_direct_debit_service
#             try:
#                 result = telebirr_direct_debit_service.cancel_mandate(
#                     mandate_id=mandate_id,
#                     payer_msisdn=payer_msisdn
#                 )
#                 
#                 if result.get('success'):
#                     # Update subscription status
#                     subscription.status = 'cancelled'
#                     subscription.save()
#                     direct_debit_mandate.cancel()
#                     
#                     logger.info('[TELEBIRR_MANDATE] Direct Debit mandate cancelled successfully')
#                     return Response({'success': True, 'message': 'Subscription cancelled successfully'})
#                 else:
#                     logger.error(f'[TELEBIRR_MANDATE] Direct Debit cancel failed: {result}')
#                     return Response({'error': f'Failed to cancel mandate: {result.get("error", "Unknown error")}'},
#                                     status=status.HTTP_500_INTERNAL_SERVER_ERROR)
#             except Exception as e:
#                 logger.error(f'[TELEBIRR_MANDATE] Error cancelling Direct Debit mandate: {e}')
#                 logger.exception('[TELEBIRR_MANDATE] Full traceback')
#                 return Response({'error': f'Failed to cancel mandate: {str(e)}'},
#                                 status=status.HTTP_500_INTERNAL_SERVER_ERROR)
#         
#         # SuperApp subscription - use SuperApp mandate service
#         mandate_contract_id = subscription.mandate_contract_id
#         
#         # If subscription has no mandate_contract_id, query Telebirr API to get it
#         if not mandate_contract_id:
#             logger.warning('[TELEBIRR_MANDATE] Subscription has no mandate_contract_id, querying Telebirr API')
#             from .services.telebirr_mandate_service import TelebirrMandateService
#             mandate_service = TelebirrMandateService()
#             
#             try:
#                 # Query mandate details using mct_contract_no
#                 mandate_details = mandate_service.query_mandate(mct_contract_no=subscription.mct_contract_no)
#                 logger.info(f'[TELEBIRR_MANDATE] Query mandate response: {mandate_details}')
#                 
#                 # Extract mandate_contract_id from response
#                 if mandate_details and mandate_details.get('result') == 'SUCCESS':
#                     biz_content = mandate_details.get('biz_content', {})
#                     mandate_contract_id = biz_content.get('mandate_contract_id')
#                     logger.info(f'[TELEBIRR_MANDATE] Retrieved mandate_contract_id from Telebirr: {mandate_contract_id}')
#                     
#                     # Update subscription with the mandate_contract_id
#                     subscription.mandate_contract_id = mandate_contract_id
#                     subscription.save()
#                 else:
#                     logger.error(f'[TELEBIRR_MANDATE] Failed to query mandate: {mandate_details}')
#                     return Response({'error': f'Failed to query mandate from Telebirr. Telebirr API returned: {mandate_details.get("msg", "Unknown error")}'},
#                                     status=status.HTTP_500_INTERNAL_SERVER_ERROR)
#             except Exception as e:
#                 logger.error(f'[TELEBIRR_MANDATE] Error querying mandate: {e}')
#                 logger.exception('[TELEBIRR_MANDATE] Full traceback')
#                 return Response({'error': f'Telebirr API query failed: {str(e)}. Cannot cancel subscription without mandate_contract_id.'},
#                                 status=status.HTTP_500_INTERNAL_SERVER_ERROR)
#         logger.info(f'[TELEBIRR_MANDATE] Found mandate_contract_id from subscription: {mandate_contract_id}')
#     else:
#         logger.info(f'[TELEBIRR_MANDATE] mandate_contract_id provided: {mandate_contract_id}')
#     
#     if not mandate_contract_id:
#         logger.error('[TELEBIRR_MANDATE] Missing mandate_contract_id - cannot cancel without Telebirr API')
#         return Response({'error': 'Cannot cancel subscription: mandate_contract_id not available. Telebirr API query failed.'},
#                         status=status.HTTP_500_INTERNAL_SERVER_ERROR)
#     
#     # Get user's phone number
#     profile = getattr(request.user, 'profile', None)
#     phone_number = profile.phone_number if profile else None
#     
#     # Try to get phone number from subscription if not in profile
#     if not phone_number:
#         subscription = UserSubscription.objects.filter(
#             user=request.user,
#             payment_method='telebirr'
#         ).first()
#         if subscription and subscription.telebirr_phone_number:
#             phone_number = subscription.telebirr_phone_number
#     
#     logger.info(f'[TELEBIRR_MANDATE] User phone number: {phone_number}')
#     
#     if not phone_number:
#         logger.error('[TELEBIRR_MANDATE] User phone number not found')
#         return Response({'error': 'User phone number not found'},
#                         status=status.HTTP_400_BAD_REQUEST)
#     
#     try:
#         logger.info(f'[TELEBIRR_MANDATE] Calling cancel_mandate service')
#         result = telebirr_mandate_service.cancel_mandate(
#             mandate_contract_id=mandate_contract_id,
#             initiator_phone=phone_number,
#             reason='User cancelled subscription'
#         )
#         
#         logger.info(f'[TELEBIRR_MANDATE] Cancel mandate result: {result}')
#         
#         if result.get('result') == 'SUCCESS':
#             logger.info(f'[TELEBIRR_MANDATE] Mandate cancelled successfully: {mandate_contract_id}')
#             
#             # Update ALL active subscriptions with this mandate
#             subscriptions = UserSubscription.objects.filter(
#                 user=request.user,
#                 payment_method='telebirr',
#                 mandate_contract_id=mandate_contract_id,
#                 status='active'
#             )
#             
#             cancelled_count = 0
#             last_subscription = None
#             for subscription in subscriptions:
#                 subscription.status = 'cancelled'
#                 subscription.auto_renew = False
#                 subscription.cancelled_at = timezone.now()
#                 subscription.cancellation_reason = 'User cancelled via subscription page'
#                 subscription.save()
#                 cancelled_count += 1
#                 last_subscription = subscription
#                 logger.info(f'[TELEBIRR_MANDATE] Updated subscription {subscription.id} to cancelled')
#
#             if last_subscription:
#                 # Send SMS notification for cancellation (once)
#                 try:
#                     from .services.superapp_sms_service import superapp_sms_service
#                     superapp_sms_service.send_subscription_cancellation(
#                         phone_number=phone_number,
#                         plan_name=last_subscription.tier.name if last_subscription.tier else 'Subscription',
#                         duration_type=last_subscription.duration_type
#                     )
#                     logger.info(f'[TELEBIRR_MANDATE] Cancellation SMS sent to {phone_number}')
#                 except Exception as e:
#                     logger.warning(f'[TELEBIRR_MANDATE] Failed to send cancellation SMS: {e}')
#                     # Non-fatal: subscription already cancelled
#
#             logger.info(f'[TELEBIRR_MANDATE] Total subscriptions cancelled: {cancelled_count}')
#             return Response({
#                 'success': True,
#                 'message': 'Mandate cancelled successfully'
#             })
#         else:
#             # Check if the error is "mandate status is not ACTIVE" - this means it's already cancelled on Telebirr
#             # In this case, we should still cancel the local subscription to keep database in sync
#             if result.get('code') == '60330013':
#                 logger.warning(f'[TELEBIRR_MANDATE] Mandate already inactive on Telebirr (code 60330013). Cancelling local subscription(s).')
#                 
#                 # Cancel ALL active subscriptions with this mandate
#                 subscriptions = UserSubscription.objects.filter(
#                     user=request.user,
#                     payment_method='telebirr',
#                     mandate_contract_id=mandate_contract_id,
#                     status='active'
#                 )
#                 
#                 cancelled_count = 0
#                 last_subscription = None
#                 for subscription in subscriptions:
#                     subscription.status = 'cancelled'
#                     subscription.auto_renew = False
#                     subscription.cancelled_at = timezone.now()
#                     subscription.cancellation_reason = 'User cancelled via subscription page (mandate already inactive on Telebirr)'
#                     subscription.save()
#                     cancelled_count += 1
#                     last_subscription = subscription
#                     logger.info(f'[TELEBIRR_MANDATE] Updated subscription {subscription.id} to cancelled (mandate was already inactive)')
#
#                 if last_subscription:
#                     # Send SMS notification for cancellation (once)
#                     try:
#                         from .services.superapp_sms_service import superapp_sms_service
#                         superapp_sms_service.send_subscription_cancellation(
#                             phone_number=phone_number,
#                             plan_name=last_subscription.tier.name if last_subscription.tier else 'Subscription',
#                             duration_type=last_subscription.duration_type
#                         )
#                         logger.info(f'[TELEBIRR_MANDATE] Cancellation SMS sent to {phone_number}')
#                     except Exception as e:
#                         logger.warning(f'[TELEBIRR_MANDATE] Failed to send cancellation SMS: {e}')
#
#                 logger.info(f'[TELEBIRR_MANDATE] Total subscriptions cancelled: {cancelled_count}')
#                 return Response({
#                     'success': True,
#                     'message': 'Subscription cancelled (mandate was already inactive on Telebirr)'
#                 })
#             
#             logger.error(f'[TELEBIRR_MANDATE] Failed to cancel mandate: {result.get("msg")}')
#             return Response({'error': result.get('msg', 'Failed to cancel mandate')},
#                             status=status.HTTP_400_BAD_REQUEST)
#     except Exception as e:
#         logger.error(f'[TELEBIRR_MANDATE] Cancel mandate error: {e}')
#         logger.exception('[TELEBIRR_MANDATE] Full traceback')
#         return Response({'error': str(e)},
#                         status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# @api_view(['POST'])
# @permission_classes([AllowAny])
# def telebirr_mandate_callback(request):
#     """
#     Webhook endpoint for Telebirr mandate creation callbacks.
#     Telebirr sends this when a mandate is successfully created.
#     """
#     logger.info('=' * 80)
#     logger.info('[TELEBIRR_MANDATE CALLBACK] Request received')
#     logger.info(f'[TELEBIRR_MANDATE CALLBACK] Request method: {request.method}')
#     logger.info(f'[TELEBIRR_MANDATE CALLBACK] Request URL: {request.build_absolute_uri()}')
#     logger.info(f'[TELEBIRR_MANDATE CALLBACK] Request headers: {dict(request.headers)}')
#     # Avoid request.body here: DRF/middleware may have already consumed the stream,
#     # which raises RawPostDataException. request.data is safe (cached by DRF).
#     logger.info(f'[TELEBIRR_MANDATE CALLBACK] Request data: {request.data}')
#     logger.info(f'[TELEBIRR_MANDATE CALLBACK] Query params: {dict(request.GET)}')
#     logger.info('=' * 80)
#     
#     try:
#         # Extract all possible fields from Telebirr callback
#         mandate_contract_id = request.data.get('mandate_contract_id')
#         mct_contract_no = request.data.get('mct_contract_no') or request.data.get('merch_contract_no')
#         result = request.data.get('result')
#         code = request.data.get('code')
#         msg = request.data.get('msg')
#         sign = request.data.get('sign')
#         nonce_str = request.data.get('nonce_str')
#         sign_type = request.data.get('sign_type')
#         biz_content = request.data.get('biz_content', {})
#         
#         logger.info(f'[TELEBIRR_MANDATE CALLBACK] Telebirr response fields:')
#         logger.info(f'  - mandate_contract_id: {mandate_contract_id}')
#         logger.info(f'  - mct_contract_no: {mct_contract_no}')
#         logger.info(f'  - result: {result}')
#         logger.info(f'  - code: {code}')
#         logger.info(f'  - msg: {msg}')
#         logger.info(f'  - sign: {sign[:50] if sign else None}...' if sign else '  - sign: None')
#         logger.info(f'  - nonce_str: {nonce_str}')
#         logger.info(f'  - sign_type: {sign_type}')
#         logger.info(f'  - biz_content: {biz_content}')
#         
#         if result == 'SUCCESS' or result == 'success':
#             # Find the subscription by mct_contract_no
#             subscription = UserSubscription.objects.filter(
#                 mct_contract_no=mct_contract_no,
#                 payment_method='telebirr'
#             ).first()
#             
#             if subscription:
#                 # Update subscription with mandate_contract_id
#                 subscription.mandate_contract_id = mandate_contract_id
#                 subscription.mandate_status = 'active'
#                 subscription.save()
#                 logger.info(f'[TELEBIRR_MANDATE CALLBACK] Updated subscription {subscription.id} with mandate_contract_id: {mandate_contract_id}')
#             else:
#                 logger.warning(f'[TELEBIRR_MANDATE CALLBACK] No subscription found for mct_contract_no: {mct_contract_no}')
#         else:
#             logger.warning(f'[TELEBIRR_MANDATE CALLBACK] Mandate creation failed or result not SUCCESS: {result}')
#         
#         return Response({'success': True})
#     
#     except Exception as e:
#         logger.error(f'[TELEBIRR_MANDATE CALLBACK] Error processing callback: {e}')
#         logger.exception('[TELEBIRR_MANDATE CALLBACK] Full traceback')
#         return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# @api_view(['POST'])
# @permission_classes([IsAuthenticated])
# def telebirr_mandate_complete(request):
#     """
#     Handle completion of mandate signing from SuperApp.
#     Frontend calls SuperApp directly with merchant URL scheme, then sends the result here.
#     Request body: {
#         mct_contract_no: string,
#         mandate_contract_id: string (optional, will be queried if not provided),
#         plan_type: 'daily' | 'weekly' | 'monthly'
#     }
#     """
#     logger.info('=' * 80)
#     logger.info('[TELEBIRR_MANDATE] MANDATE SIGNING COMPLETE - REQUEST RECEIVED')
#     logger.info('=' * 80)
#     logger.info(f'User: {request.user.username} (ID: {request.user.id})')
#     logger.info(f'Request method: {request.method}')
#     logger.info(f'Request headers: {dict(request.headers)}')
#     logger.info(f'Request data: {request.data}')
#     # Note: Cannot access request.body after request.data is read
#     
#     mct_contract_no = request.data.get('mct_contract_no')
#     mandate_contract_id = request.data.get('mandate_contract_id')
#     plan_type = request.data.get('plan_type')
#     
#     logger.info(f'[TELEBIRR_MANDATE] Extracted parameters:')
#     logger.info(f'  - mct_contract_no: {mct_contract_no}')
#     logger.info(f'  - mandate_contract_id: {mandate_contract_id}')
#     logger.info(f'  - plan_type: {plan_type}')
#     
#     if not all([mct_contract_no, plan_type]):
#         logger.warning('[TELEBIRR_MANDATE] Missing required parameters')
#         return Response({'error': 'mct_contract_no and plan_type are required'},
#                         status=status.HTTP_400_BAD_REQUEST)
#     
#     try:
#         # If mandate_contract_id not provided, query it using mct_contract_no
#         if not mandate_contract_id:
#             logger.info(f'[TELEBIRR_MANDATE] Querying mandate details for mct_contract_no: {mct_contract_no}')
#             query_result = telebirr_mandate_service.query_mandate(mct_contract_no=mct_contract_no)
#             
#             if query_result.get('result') == 'SUCCESS':
#                 biz_content = query_result.get('biz_content', {})
#                 mandates = biz_content.get('mandates', [])
#                 
#                 if mandates:
#                     mandate = mandates[0]
#                     mandate_contract_id = mandate.get('mandate_contract_id')
#                     logger.info(f'[TELEBIRR_MANDATE] Found mandate_contract_id: {mandate_contract_id}')
#                 else:
#                     logger.error(f'[TELEBIRR_MANDATE] No mandate found for mct_contract_no: {mct_contract_no}')
#                     return Response({
#                         'error': 'Mandate not found',
#                         'message': 'No mandate found for the given mct_contract_no'
#                     }, status=status.HTTP_404_NOT_FOUND)
#             else:
#                 logger.error(f'[TELEBIRR_MANDATE] Query mandate failed: {query_result.get("msg")}')
#                 return Response({
#                     'error': 'Failed to query mandate',
#                     'message': query_result.get('msg', 'Unknown error')
#                 }, status=status.HTTP_400_BAD_REQUEST)
#         
#         # Get plan duration based on plan_type
#         plan_durations = {
#             'daily': 1,
#             'weekly': 7,
#             'monthly': 30
#         }
#         duration_days = plan_durations.get(plan_type, 30)
#         
#         # Calculate expiry date
#         from datetime import datetime, timedelta
#         expiry_date = datetime.now() + timedelta(days=duration_days)
#         
#         # Update or create user subscription
#         from api.models import UserSubscription
#         user_subscription, created = UserSubscription.objects.update_or_create(
#             user=request.user,
#             defaults={
#                 'plan_type': plan_type,
#                 'expires_at': expiry_date,
#                 'mandate_contract_id': mandate_contract_id,
#                 'mct_contract_no': mct_contract_no,
#                 'is_active': True
#             }
#         )
#         
#         action = 'Created' if created else 'Updated'
#         logger.info(f'[TELEBIRR_MANDATE] {action} user subscription successfully')
#         logger.info(f'  - plan_type: {plan_type}')
#         logger.info(f'  - expires_at: {expiry_date}')
#         logger.info(f'  - mandate_contract_id: {mandate_contract_id}')
#         logger.info(f'  - mct_contract_no: {mct_contract_no}')
#         
#         return Response({
#             'success': True,
#             'message': 'Mandate signing completed successfully',
#             'mandate_contract_id': mandate_contract_id,
#             'mct_contract_no': mct_contract_no,
#             'plan_type': plan_type,
#             'expires_at': expiry_date.isoformat()
#         })
#         
#     except Exception as e:
#         logger.error(f'[TELEBIRR_MANDATE] Mandate completion error: {e}')
#         logger.exception('[TELEBIRR_MANDATE] Full traceback')
#         return Response({
#             'error': 'Failed to complete mandate signing',
#             'message': str(e)
#         }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# @api_view(['POST'])
# @permission_classes([AllowAny])
# def telebirr_mandate_preorder(request):
#     """
#     Create a Telebirr preOrder with mandate_data so the mandate becomes
#     queryable. Returns a signed raw_request for the SuperApp js_fun_start_pay.
#
#     Request body: { plan_type: 'daily'|'weekly'|'monthly' }
#     Returns: { success, raw_request, mct_contract_no, prepay_id, merch_order_id }
#     """
#     logger.info('=' * 80)
#     logger.info('[TELEBIRR_MANDATE] PREORDER - REQUEST RECEIVED')
#     logger.info('=' * 80)
#     logger.info(f'Request data: {request.data}')
#
#     plan_type = request.data.get('plan_type')
#     mct_contract_no = request.data.get('mct_contract_no')
#     phone_number = request.data.get('phone_number')
#     if not plan_type:
#         return Response({'error': 'plan_type is required'}, status=status.HTTP_400_BAD_REQUEST)
#
#     # ==========================================================================
#     # DIAGNOSTIC: Log the user's existing subscription + mandate state BEFORE
#     # creating a new preorder. This helps determine whether a duplicate/active
#     # mandate on Telebirr's side is causing js_fun_start_pay to fail with -1.
#     # ==========================================================================
#     logger.info('-' * 80)
#     logger.info('[TELEBIRR_MANDATE][DIAG] PRE-PREORDER DUPLICATION CHECK')
#     logger.info('-' * 80)
#     diag_phone = None
#     try:
#         logger.info(f'[TELEBIRR_MANDATE][DIAG] request.user.is_authenticated={request.user.is_authenticated}')
#         if request.user and request.user.is_authenticated:
#             logger.info(f'[TELEBIRR_MANDATE][DIAG] User: {request.user.username} (ID: {request.user.id})')
#             # Resolve the user's phone number (used to query Telebirr mandates)
#             try:
#                 from .models import UserProfile
#                 _profile = UserProfile.objects.filter(user=request.user).first()
#                 if _profile and _profile.phone_number:
#                     diag_phone = _profile.phone_number
#                     logger.info(f'[TELEBIRR_MANDATE][DIAG] Profile phone_number: {diag_phone}')
#                 else:
#                     logger.info('[TELEBIRR_MANDATE][DIAG] No phone_number on UserProfile')
#             except Exception as _e:
#                 logger.warning(f'[TELEBIRR_MANDATE][DIAG] Could not read UserProfile: {_e}')
#
#             # Log ALL subscriptions for this user (any status) with mandate fields
#             _all_subs = UserSubscription.objects.filter(user=request.user).order_by('-created_at')
#             logger.info(f'[TELEBIRR_MANDATE][DIAG] Total UserSubscriptions for user: {_all_subs.count()}')
#             for _s in _all_subs:
#                 logger.info(
#                     f'[TELEBIRR_MANDATE][DIAG]   sub_id={_s.id} status={_s.status} '
#                     f'payment_method={_s.payment_method} duration_type={_s.duration_type} '
#                     f'mandate_status={_s.mandate_status} '
#                     f'mandate_contract_id={_s.mandate_contract_id} '
#                     f'mct_contract_no={_s.mct_contract_no} '
#                     f'telebirr_phone={_s.telebirr_phone_number} '
#                     f'end_date={_s.end_date}'
#                 )
#             # Highlight any ACTIVE telebirr subscription (would indicate a live mandate)
#             _active_telebirr = _all_subs.filter(payment_method='telebirr', status='active')
#             logger.info(
#                 f'[TELEBIRR_MANDATE][DIAG] ACTIVE telebirr subscriptions in DB: '
#                 f'{_active_telebirr.count()}'
#             )
#             for _s in _active_telebirr:
#                 logger.info(
#                     f'[TELEBIRR_MANDATE][DIAG]   >>> ACTIVE mandate_contract_id={_s.mandate_contract_id} '
#                     f'mct_contract_no={_s.mct_contract_no}'
#                 )
#         else:
#             logger.info('[TELEBIRR_MANDATE][DIAG] Request is unauthenticated; skipping per-user DB check')
#     except Exception as _e:
#         logger.warning(f'[TELEBIRR_MANDATE][DIAG] DB diagnostic failed: {_e}')
#
#     # Query Telebirr directly for ALL mandates registered for this merchant, so
#     # we can see if an old (un-cancelled) mandate is still ACTIVE on their side
#     # for this customer. An active mandate is the prime suspect for the -1 fail.
#     try:
#         from .services.telebirr_mandate_service import TelebirrMandateService
#         _svc = TelebirrMandateService()
#         _q = _svc.query_mandate()
#         logger.info(f'[TELEBIRR_MANDATE][DIAG] Telebirr query_mandate result={_q.get("result")} '
#                     f'code={_q.get("code") or _q.get("errorCode")} '
#                     f'msg={_q.get("msg") or _q.get("errorMsg")}')
#         _biz = _q.get('biz_content', {}) if isinstance(_q, dict) else {}
#         _mandates = _biz.get('mandates') or ([] if not _biz.get('mandate_contract_id') else [_biz])
#         logger.info(f'[TELEBIRR_MANDATE][DIAG] Telebirr returned {len(_mandates)} mandate(s) for merchant')
#         for _m in _mandates:
#             logger.info(
#                 f'[TELEBIRR_MANDATE][DIAG]   telebirr mandate: '
#                 f'mandate_contract_id={_m.get("mandate_contract_id")} '
#                 f'merch_contract_no={_m.get("merch_contract_no")} '
#                 f'status={_m.get("status") or _m.get("mandate_status")} '
#                 f'msisdn={_m.get("msisdn") or _m.get("identifier")}'
#             )
#     except Exception as _e:
#         logger.warning(f'[TELEBIRR_MANDATE][DIAG] Telebirr mandate query failed: {_e}')
#     logger.info('-' * 80)
#     logger.info('[TELEBIRR_MANDATE][DIAG] END PRE-PREORDER DUPLICATION CHECK')
#     logger.info('-' * 80)
#
#     # Look up the tier for amount and template id
#     tier = SubscriptionTier.objects.filter(duration_type=plan_type, is_active=True).first()
#     if not tier:
#         logger.error(f'[TELEBIRR_MANDATE] No active tier found for plan_type: {plan_type}')
#         return Response({'error': f'No active subscription tier found for plan type: {plan_type}'},
#                         status=status.HTTP_400_BAD_REQUEST)
#
#     try:
#         from .services.telebirr_mandate_service import TelebirrMandateService
#         mandate_service = TelebirrMandateService()
#
#         mandate_template_id = mandate_service.mandate_templates.get(plan_type)
#         if not mandate_template_id:
#             return Response({'error': f'No mandate template configured for plan type: {plan_type}'},
#                             status=status.HTTP_400_BAD_REQUEST)
#
#         # PRE-CLEANUP: Cancel any mandates that would block new signing.
#         # Telebirr blocks new mandate signing if ANY mandate (ACTIVE or CANCELLED)
#         # exists for the same template + phone. We must cancel them first.
#         try:
#             from .models_subscription import PendingTelebirrMandate as PendingMandate
#
#             # 1) Cancel expired-but-active subscriptions' mandates for this plan_type
#             expired_subs = UserSubscription.objects.filter(
#                 payment_method='telebirr',
#                 duration_type=plan_type,
#                 status='active',
#                 end_date__lt=timezone.now(),
#                 mandate_contract_id__isnull=False,
#             )
#             for esub in expired_subs:
#                 logger.info(f'[TELEBIRR_MANDATE] PRE-CLEANUP: Found expired sub {esub.id} '
#                             f'mandate={esub.mandate_contract_id} phone={esub.telebirr_phone_number}')
#                 try:
#                     q = mandate_service.query_mandate(mandate_contract_id=esub.mandate_contract_id)
#                     t_status = (q.get('biz_content', {}).get('status') or '').upper()
#                     if t_status == 'ACTIVE':
#                         initiator = esub.telebirr_phone_number or phone_number or '0000000000'
#                         cr = mandate_service.cancel_mandate(
#                             mandate_contract_id=esub.mandate_contract_id,
#                             initiator_phone=initiator,
#                             reason='Auto-cancel expired subscription mandate'
#                         )
#                         logger.info(f'[TELEBIRR_MANDATE] PRE-CLEANUP: Cancelled expired ACTIVE mandate '
#                                     f'{esub.mandate_contract_id}: {cr.get("msg")}')
#                     else:
#                         logger.info(f'[TELEBIRR_MANDATE] PRE-CLEANUP: Mandate {esub.mandate_contract_id} '
#                                     f'already {t_status} on Telebirr')
#                 except Exception as ce:
#                     logger.warning(f'[TELEBIRR_MANDATE] PRE-CLEANUP: Error handling expired mandate '
#                                    f'{esub.mandate_contract_id}: {ce}')
#                 # Update DB regardless
#                 esub.status = 'cancelled'
#                 esub.mandate_status = 'cancelled'
#                 esub.save(update_fields=['status', 'mandate_status'])
#
#             # 2) Also check recent pending (uncompleted) mandates for stale CANCELLED ones
#             old_pending = PendingMandate.objects.filter(
#                 plan_type=plan_type,
#             ).exclude(status='completed').order_by('-created_at').values_list('mct_contract_no', flat=True)[:5]
#             for old_mct in old_pending:
#                 try:
#                     old_result = mandate_service.query_mandate(mct_contract_no=old_mct)
#                     if old_result.get('result') == 'SUCCESS':
#                         biz = old_result.get('biz_content', {})
#                         old_cid = biz.get('mandate_contract_id')
#                         old_status = (biz.get('status') or '').upper()
#                         if old_cid and old_status in ('CANCELLED', 'ACTIVE'):
#                             initiator = phone_number or '0000000000'
#                             logger.info(f'[TELEBIRR_MANDATE] PRE-CLEANUP: Cancelling {old_status} mandate '
#                                         f'{old_cid} (mct={old_mct})')
#                             try:
#                                 cr = mandate_service.cancel_mandate(
#                                     mandate_contract_id=old_cid,
#                                     initiator_phone=initiator,
#                                     reason='Pre-cleanup for re-subscription'
#                                 )
#                                 logger.info(f'[TELEBIRR_MANDATE] PRE-CLEANUP result: {cr}')
#                             except Exception as ce:
#                                 logger.warning(f'[TELEBIRR_MANDATE] PRE-CLEANUP cancel failed: {ce}')
#                             PendingMandate.objects.filter(mct_contract_no=old_mct).update(status='failed')
#                 except Exception as qe:
#                     logger.debug(f'[TELEBIRR_MANDATE] PRE-CLEANUP query skip mct={old_mct}: {qe}')
#         except Exception as pe:
#             logger.warning(f'[TELEBIRR_MANDATE] PRE-CLEANUP error: {pe}')
#
#         # Use frontend-provided mct_contract_no if available, otherwise generate one
#         if not mct_contract_no:
#             mct_contract_no = mandate_service.generate_mct_contract_no()
#             logger.info(f'[TELEBIRR_MANDATE] Generated new mct_contract_no: {mct_contract_no}')
#         else:
#             logger.info(f'[TELEBIRR_MANDATE] Using frontend-provided mct_contract_no: {mct_contract_no}')
#
#         amount = '{:.2f}'.format(float(tier.price_etb))
#         title = 'processing'
#
#         logger.info(f'[TELEBIRR_MANDATE] Preorder params: mct_contract_no={mct_contract_no}, '
#                     f'template={mandate_template_id}, amount={amount}')
#
#         logger.info('[TELEBIRR_MANDATE] >>> REQUEST to Telebirr create_mandate_preorder: '
#                     f'mct_contract_no={mct_contract_no}, template={mandate_template_id}, amount={amount}, title={title}')
#         result = mandate_service.create_mandate_preorder(
#             mct_contract_no=mct_contract_no,
#             mandate_template_id=mandate_template_id,
#             amount=amount,
#             title=title,
#         )
#         logger.info(f'[TELEBIRR_MANDATE] <<< RESPONSE from Telebirr create_mandate_preorder: {result}')
#
#         if result.get('result') != 'SUCCESS' or not result.get('biz_content', {}).get('prepay_id'):
#             logger.error(f'[TELEBIRR_MANDATE] Preorder failed: {result.get("msg") or result.get("errorMsg")}')
#             return Response({
#                 'error': 'Failed to create mandate preorder with Telebirr',
#                 'details': result.get('msg') or result.get('errorMsg'),
#                 'code': result.get('code') or result.get('errorCode'),
#             }, status=status.HTTP_400_BAD_REQUEST)
#
#         prepay_id = result['biz_content']['prepay_id']
#         merch_order_id = result['biz_content'].get('merch_order_id')
#         raw_request = mandate_service.create_raw_request(prepay_id)
#
#         # Persist the pending mandate record for recovery in case of client drop
#         from .models import PendingTelebirrMandate
#         try:
#             # Normalize phone to 0-prefixed local format for consistency
#             pending_phone = phone_number
#             if pending_phone:
#                 pending_phone = pending_phone.lstrip('+').replace(' ', '')
#                 if pending_phone.startswith('251'):
#                     pending_phone = '0' + pending_phone[3:]
#                 elif not pending_phone.startswith('0'):
#                     pending_phone = '0' + pending_phone
#             PendingTelebirrMandate.objects.create(
#                 mct_contract_no=mct_contract_no,
#                 plan_type=plan_type,
#                 prepay_id=prepay_id,
#                 merch_order_id=merch_order_id,
#                 mandate_template_id=mandate_template_id,
#                 amount=amount,
#                 phone_number=pending_phone,
#                 status='pending',
#             )
#             logger.info(f'[TELEBIRR_MANDATE] Created PendingTelebirrMandate record: {mct_contract_no}')
#         except Exception as e:
#             logger.warning(f'[TELEBIRR_MANDATE] Failed to create PendingTelebirrMandate record: {e}')
#             # Non-fatal: continue without persistence
#
#         response_payload = {
#             'success': True,
#             'raw_request': raw_request,
#             'mct_contract_no': mct_contract_no,
#             'prepay_id': prepay_id,
#             'merch_order_id': result['biz_content'].get('merch_order_id'),
#             'plan_type': plan_type,
#         }
#         logger.info(f'[TELEBIRR_MANDATE] PREORDER - RESPONSE TO CLIENT: '
#                     f'success=True, mct_contract_no={mct_contract_no}, prepay_id={prepay_id}, '
#                     f'merch_order_id={response_payload["merch_order_id"]}, raw_request_len={len(raw_request or "")}')
#         return Response(response_payload)
#     except Exception as e:
#         logger.error(f'[TELEBIRR_MANDATE] Preorder error: {e}')
#         logger.exception('[TELEBIRR_MANDATE] Full traceback')
#         return Response({'error': 'Failed to create mandate preorder', 'details': str(e)},
#                         status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# @permission_classes([IsAuthenticated])
# def telebirr_disburse(request):
#     """
#     Create disburse order for password-free deduction.
#     Request body: {
#         mct_contract_no: string,
#         amount: number,
#         title: string
#     }
#     """
#     logger.info('=' * 80)
#     logger.info('[TELEBIRR_MANDATE] CREATE DISBURSE ORDER - REQUEST RECEIVED')
#     logger.info('=' * 80)
#     logger.info(f'User: {request.user.username} (ID: {request.user.id})')
#     logger.info(f'Request data: {request.data}')
#     
#     mct_contract_no = request.data.get('mct_contract_no')
#     amount = request.data.get('amount')
#     title = request.data.get('title', 'Subscription payment')
#     
#     logger.info(f'[TELEBIRR_MANDATE] Extracted parameters:')
#     logger.info(f'  - mct_contract_no: {mct_contract_no}')
#     logger.info(f'  - amount: {amount}')
#     logger.info(f'  - title: {title}')
#     
#     if not all([mct_contract_no, amount]):
#         logger.warning('[TELEBIRR_MANDATE] Missing required parameters')
#         return Response({'error': 'mct_contract_no and amount are required'},
#                         status=status.HTTP_400_BAD_REQUEST)
#     
#     try:
#         logger.info(f'[TELEBIRR_MANDATE] Calling create_disburse_order service')
#         result = telebirr_mandate_service.create_disburse_order(
#             mct_contract_no=mct_contract_no,
#             amount=amount,
#             title=title
#         )
#         
#         logger.info(f'[TELEBIRR_MANDATE] Disburse order result: {result}')
#
#         if result.get('result') == 'SUCCESS':
#             logger.info(f'[TELEBIRR_MANDATE] Disburse order created successfully')
#             logger.info(f'  - payment_order_id: {result.get("biz_content", {}).get("payment_order_id")}')
#             logger.info(f'  - merch_order_id: {result.get("biz_content", {}).get("merch_order_id")}')
#             return Response({
#                 'success': True,
#                 'message': 'Disburse order created successfully',
#                 'payment_order_id': result.get('biz_content', {}).get('payment_order_id'),
#                 'merch_order_id': result.get('biz_content', {}).get('merch_order_id'),
#             })
#         else:
#             logger.error(f'[TELEBIRR_MANDATE] Failed to create disburse order: {result.get("msg")}')
#             return Response({'error': result.get('msg', 'Failed to create disburse order')},
#                             status=status.HTTP_400_BAD_REQUEST)
#     except Exception as e:
#         logger.error(f'[TELEBIRR_MANDATE] Disburse order error: {e}')
#         logger.exception('[TELEBIRR_MANDATE] Full traceback')
#         return Response({'error': str(e)},
#                         status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ============================================================================
# One-Time Subscription Flow (mimics coin purchase)
# ============================================================================

@api_view(['POST'])
@permission_classes([AllowAny])
def telebirr_one_time_initiate(request):
    """
    Initiate a one-time Telebirr payment for subscription (no recurring mandate).
    Mimics the coin purchase flow.
    
    Request body: {
        plan_type: 'daily' | 'weekly' | 'monthly',
        phone_number: string (required for unauthenticated users)
    }
    Returns: {
        raw_request: string (signed for SuperApp js_fun_start_pay),
        merch_order_id: string
    }
    """
    logger.info('=' * 80)
    logger.info('[TELEBIRR ONE-TIME] INITIATE - REQUEST RECEIVED')
    logger.info('=' * 80)
    logger.info(f'User: {request.user.username if request.user.is_authenticated else "Anonymous"} (ID: {request.user.id if request.user.is_authenticated else "N/A"})')
    logger.info(f'Request data: {request.data}')
    
    plan_type = request.data.get('plan_type')
    phone_number = request.data.get('phone_number')
    
    if not plan_type:
        logger.warning('[TELEBIRR ONE-TIME] Missing plan_type')
        return Response({'error': 'plan_type is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Look up the subscription tier
    tier = SubscriptionTier.objects.filter(duration_type=plan_type, is_active=True).first()
    if not tier:
        logger.error(f'[TELEBIRR ONE-TIME] No active tier found for plan_type: {plan_type}')
        return Response({'error': f'No active subscription tier found for plan type: {plan_type}'},
                        status=status.HTTP_400_BAD_REQUEST)
    
    logger.info(f'[TELEBIRR ONE-TIME] Found tier: {tier.name} (ID: {tier.id}, price: {tier.price_etb} ETB)')
    
    # For unauthenticated users, phone_number is required
    if not request.user.is_authenticated and not phone_number:
        logger.error('[TELEBIRR ONE-TIME] Unauthenticated request missing phone_number')
        return Response({'error': 'phone_number is required for unauthenticated users'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        # Generate unique merch_order_id (alphanumeric only - Telebirr requirement)
        # For authenticated users, use user ID; for anonymous, use phone hash
        if request.user.is_authenticated:
            user_id = str(request.user.id)
        else:
            # Use last 8 digits of phone number for uniqueness
            user_id = phone_number[-8:] if phone_number else 'ANON'
        merch_order_id = f'SUB{timezone.now().strftime("%Y%m%d%H%M%S")}{user_id}'
        
        # Create Telebirr H5 prepaid order (same as coin purchase)
        amount = '{:.2f}'.format(float(tier.price_etb))
        title = f'{tier.name} Subscription'
        
        logger.info(f'[TELEBIRR ONE-TIME] Creating Telebirr order: merch_order_id={merch_order_id}, amount={amount}')
        
        # Use default notify_url from settings (same as coin flow for reliability)
        result = telebirr_service.create_order_ondemand(
            merch_order_id=merch_order_id,
            amount=amount,
            title=title,
        )
        
        if not result.get('success'):
            logger.error(f'[TELEBIRR ONE-TIME] Failed to create Telebirr order: {result}')
            return Response({'error': 'Failed to create Telebirr order', 'details': result.get('error')},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
        raw_request = result.get('raw_request')
        prepay_id = result.get('prepay_id')
        
        logger.info(f'[TELEBIRR ONE-TIME] Telebirr order created: prepay_id={prepay_id}')
        
        # Calculate end_date based on tier duration
        now = timezone.now()
        end_date = now + timezone.timedelta(days=tier.duration_days) if tier.duration_days else None
        
        # Check for existing active subscription to prevent duplicate/overlapping purchases.
        # For authenticated users, check by request.user directly. For unauthenticated
        # (new SuperApp) users, look up any account already linked to this phone number
        # (e.g. from a previous subscription) via phone number variants, same as telebirr_auth.
        existing_active = None
        if request.user.is_authenticated:
            existing_active = UserSubscription.objects.filter(
                user=request.user,
                status='active',
                end_date__gt=timezone.now()
            ).first()
        elif phone_number:
            cleaned_phone = ''.join(filter(str.isdigit, phone_number))
            phone_variants = {cleaned_phone}
            if cleaned_phone.startswith('251'):
                phone_variants.add('0' + cleaned_phone[3:])
            elif cleaned_phone.startswith('0'):
                phone_variants.add('251' + cleaned_phone[1:])

            existing_profile = UserProfile.objects.filter(phone_number__in=phone_variants).first()
            if existing_profile:
                existing_active = UserSubscription.objects.filter(
                    user=existing_profile.user,
                    status='active',
                    end_date__gt=timezone.now()
                ).first()

        if existing_active:
            logger.warning(f'[TELEBIRR ONE-TIME] Phone/user already has active subscription: {existing_active.id} (tier: {existing_active.tier.name})')
            return Response({
                'error': 'You already have an active subscription. Please cancel it first or wait for it to expire.',
                'existing_subscription': {
                    'id': existing_active.id,
                    'tier': existing_active.tier.name,
                    'end_date': existing_active.end_date.isoformat() if existing_active.end_date else None
                }
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Create new pending subscription
        # For unauthenticated users, user will be None and set in webhook after payment
        subscription = UserSubscription.objects.create(
            user=request.user if request.user.is_authenticated else None,
            tier=tier,
            payment_method='telebirr',
            duration_type=plan_type,
            status='pending',
            payment_reference=merch_order_id,  # Track payment by merch_order_id
            telebirr_phone_number=phone_number if not request.user.is_authenticated else (request.user.profile.phone_number if request.user.profile else None),
            auto_renew=False,  # One-time only, no recurring
            start_date=now,
            end_date=end_date,
        )
        
        logger.info(f'[TELEBIRR ONE-TIME] Created pending subscription (ID: {subscription.id})')
        
        response_payload = {
            'success': True,
            'raw_request': raw_request,
            'merch_order_id': merch_order_id,
            'prepay_id': prepay_id,
            'plan_type': plan_type,
        }
        logger.info(f'[TELEBIRR ONE-TIME] Response to client: merch_order_id={merch_order_id}')
        return Response(response_payload)
        
    except Exception as e:
        logger.error(f'[TELEBIRR ONE-TIME] Initiate error: {e}')
        logger.exception('[TELEBIRR ONE-TIME] Full traceback')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([AllowAny])
def telebirr_one_time_callback(request):
    """
    Handle Telebirr async payment notification for one-time subscription.
    Mimics the coin purchase callback.
    
    Request body: Telebirr notify data (signed)
    """
    logger.info('=' * 80)
    logger.info('[TELEBIRR ONE-TIME] CALLBACK - REQUEST RECEIVED')
    logger.info('=' * 80)
    logger.info(f'Request data: {request.data}')
    
    try:
        # Verify signature (same as coin purchase)
        notify = telebirr_service.verify_notify(request.data)
        
        if not notify.get('verified'):
            logger.warning('[TELEBIRR ONE-TIME] Invalid signature; acknowledging receipt but NOT processing')
            return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'received (signature not verified)'})
        
        merch_order_id = notify.get('merch_order_id')
        trade_status = notify.get('trade_status')
        payment_order_id = notify.get('payment_order_id')
        total_amount = notify.get('total_amount')
        
        logger.info(f'[TELEBIRR ONE-TIME] merch_order_id: {merch_order_id}, trade_status: {trade_status}')
        
        # Find pending subscription by payment_reference
        subscription = UserSubscription.objects.filter(
            payment_reference=merch_order_id,
            status='pending'
        ).first()
        
        if not subscription:
            logger.warning(f'[TELEBIRR ONE-TIME] No pending subscription found for merch_order_id: {merch_order_id}')
            return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'no subscription found'})
        
        logger.info(f'[TELEBIRR ONE-TIME] Found subscription: {subscription.id}')
        
        if trade_status == 'Completed' or trade_status == 'SUCCESS':
            # Payment successful - activate subscription
            logger.info(f'[TELEBIRR ONE-TIME] Payment successful, activating subscription')
            
            # For new users (subscription.user is None), create user account
            if not subscription.user:
                logger.info(f'[TELEBIRR ONE-TIME] New user detected, creating account for phone: {subscription.telebirr_phone_number}')
                
                from django.contrib.auth import get_user_model
                from .views import _normalize_ethiopian_phone
                User = get_user_model()
                
                phone_number = subscription.telebirr_phone_number
                if not phone_number:
                    logger.error('[TELEBIRR ONE-TIME] Cannot create user: no phone number on subscription')
                    return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'payment received but user creation failed'})
                
                # Normalize phone number
                normalized_phone = _normalize_ethiopian_phone(phone_number)
                if normalized_phone:
                    phone_number = normalized_phone
                
                # Generate username from phone number
                username = f'telebirr_{phone_number}'
                
                # Check if user already exists (race condition check)
                existing_user = User.objects.filter(username=username).first()
                if existing_user:
                    logger.info(f'[TELEBIRR ONE-TIME] User already exists: {username}, linking subscription')
                    subscription.user = existing_user
                else:
                    # Create new user
                    new_user = User.objects.create_user(
                        username=username,
                        phone_number=phone_number,
                        password=None  # No password for Telebirr users
                    )
                    logger.info(f'[TELEBIRR ONE-TIME] Created new user: {username} (ID: {new_user.id})')
                    subscription.user = new_user
                
                subscription.save()
            
            subscription.status = 'active'
            subscription.payment_order_id = payment_order_id
            subscription.save()
            
            # Record subscription history
            SubscriptionHistory.objects.create(
                user=subscription.user,
                subscription=subscription,
                tier=subscription.tier,
                action='activated',
                reason='One-time Telebirr payment completed'
            )
            
            logger.info(f'[TELEBIRR ONE-TIME] Subscription activated: {subscription.id}')
            
            # Send SMS notification (one-time, no recurring language)
            try:
                from .services.superapp_sms_service import superapp_sms_service
                phone_number = subscription.telebirr_phone_number
                if not phone_number and subscription.user and subscription.user.profile:
                    phone_number = subscription.user.profile.phone_number
                
                if phone_number:
                    superapp_sms_service.send_subscription_success(
                        phone_number=phone_number,
                        plan_name=subscription.tier.name,
                        amount=subscription.tier.price_etb,
                        duration_type=subscription.duration_type,
                        end_date=subscription.end_date  # End date for one-time payment
                    )
                    logger.info(f'[TELEBIRR ONE-TIME] SMS notification sent to {phone_number}')
            except Exception as e:
                logger.warning(f'[TELEBIRR ONE-TIME] Failed to send SMS: {e}')
                # Non-fatal: subscription already activated
        else:
            # Payment failed
            logger.warning(f'[TELEBIRR ONE-TIME] Payment failed: {trade_status}')
            subscription.status = 'failed'
            subscription.save()
        
        return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'success'})
        
    except Exception as e:
        logger.error(f'[TELEBIRR ONE-TIME] Callback error: {e}')
        logger.exception('[TELEBIRR ONE-TIME] Full traceback')
        return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'error processed'})


@api_view(['GET'])
@permission_classes([AllowAny])
def telebirr_one_time_query(request):
    """
    Query subscription status by merch_order_id.
    Used by frontend to poll payment status.

    AllowAny: new SuperApp users have no auth token until AFTER payment
    succeeds and the webhook creates their account. The merch_order_id
    itself is a unique, unguessable-enough token generated by us, so we
    look the subscription up by that alone when the request is
    unauthenticated. If authenticated, we still scope to request.user for
    safety.
    
    Query params: merch_order_id
    Returns: {
        status: 'pending' | 'active' | 'failed',
        subscription_id: string,
        end_date: string (ISO format)
    }
    """
    logger.info('=' * 80)
    logger.info('[TELEBIRR ONE-TIME] QUERY - REQUEST RECEIVED')
    logger.info('=' * 80)
    logger.info(f'User: {request.user.username if request.user.is_authenticated else "Anonymous"} (ID: {request.user.id if request.user.is_authenticated else "N/A"})')
    logger.info(f'Query params: {dict(request.GET)}')
    
    merch_order_id = request.GET.get('merch_order_id')
    
    if not merch_order_id:
        logger.warning('[TELEBIRR ONE-TIME] Missing merch_order_id')
        return Response({'error': 'merch_order_id is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        if request.user.is_authenticated:
            subscription = UserSubscription.objects.filter(
                user=request.user,
                payment_reference=merch_order_id
            ).first()
        else:
            subscription = UserSubscription.objects.filter(
                payment_reference=merch_order_id
            ).first()
        
        if not subscription:
            logger.warning(f'[TELEBIRR ONE-TIME] No subscription found for merch_order_id: {merch_order_id}')
            return Response({'error': 'Subscription not found'}, status=status.HTTP_404_NOT_FOUND)
        
        logger.info(f'[TELEBIRR ONE-TIME] Found subscription: {subscription.id}, status: {subscription.status}')

        # SELF-HEALING: If still pending, the async webhook may have been
        # delayed, dropped, or never delivered (network issue on Telebirr's
        # side, notify_url unreachable, etc). Actively ask Telebirr for the
        # real order status instead of waiting forever on the webhook.
        if subscription.status == 'pending':
            logger.info(f'[TELEBIRR ONE-TIME] Status still pending, actively querying Telebirr for order: {merch_order_id}')
            try:
                query_result = telebirr_service.query_order(merch_order_id)
                logger.info(f'[TELEBIRR ONE-TIME] Telebirr queryOrder result: {query_result}')

                if query_result.get('success') and query_result.get('is_paid'):
                    logger.info(f'[TELEBIRR ONE-TIME] Telebirr confirms PAID - self-activating subscription {subscription.id}')
                    subscription.status = 'active'
                    subscription.payment_order_id = query_result.get('payment_order_id')
                    subscription.save()

                    SubscriptionHistory.objects.create(
                        user=subscription.user,
                        subscription=subscription,
                        tier=subscription.tier,
                        action='activated',
                        reason='Self-healed via active queryOrder (webhook was delayed/missing)'
                    )

                    try:
                        from .services.superapp_sms_service import superapp_sms_service
                        phone_number = subscription.telebirr_phone_number or (
                            subscription.user.profile.phone_number if subscription.user and subscription.user.profile else None
                        )
                        if phone_number:
                            superapp_sms_service.send_subscription_success(
                                phone_number=phone_number,
                                plan_name=subscription.tier.name,
                                amount=subscription.tier.price_etb,
                                duration_type=subscription.duration_type,
                                end_date=subscription.end_date
                            )
                    except Exception as sms_err:
                        logger.warning(f'[TELEBIRR ONE-TIME] Self-heal SMS failed (non-fatal): {sms_err}')
                elif query_result.get('success') and query_result.get('order_status') in ('PAY_FAILED', 'CLOSED', 'CANCELLED'):
                    logger.info(f'[TELEBIRR ONE-TIME] Telebirr confirms order failed/closed - marking subscription {subscription.id} as failed')
                    subscription.status = 'failed'
                    subscription.save()
                else:
                    logger.info(f'[TELEBIRR ONE-TIME] Telebirr order still not paid, leaving subscription pending')
            except Exception as query_err:
                logger.warning(f'[TELEBIRR ONE-TIME] Active queryOrder check failed (non-fatal, leaving pending): {query_err}')
        
        response_payload = {
            'status': subscription.status,
            'subscription_id': str(subscription.id),
            'end_date': subscription.end_date.isoformat() if subscription.end_date else None,
            'plan_type': subscription.duration_type,
        }
        return Response(response_payload)
        
    except Exception as e:
        logger.error(f'[TELEBIRR ONE-TIME] Query error: {e}')
        logger.exception('[TELEBIRR ONE-TIME] Full traceback')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([AllowAny])
def check_superapp_subscription(request):
    """
    Check if a phone number has an active SuperApp (Telebirr) subscription.
    Used for SuperApp users to log in to web app.
    """
    phone = request.data.get('phone', '').strip()
    logger.info(f'[SUPERAPP LOGIN] check_superapp_subscription called with phone: {phone}')
    if not phone:
        return Response({'error': 'Phone number is required'}, status=status.HTTP_400_BAD_REQUEST)

    # Normalize phone number
    from .views import _normalize_ethiopian_phone
    normalized_phone = _normalize_ethiopian_phone(phone)
    logger.info(f'[SUPERAPP LOGIN] Normalized phone: {normalized_phone}')
    if not normalized_phone:
        return Response({'error': 'Invalid Ethiopian phone number'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Check for active Telebirr subscription with this phone number
        # Try both normalized (with +251) and raw format (09XXXXXXXX)
        subscription = UserSubscription.objects.filter(
            telebirr_phone_number__in=[normalized_phone, phone],
            payment_method='telebirr',
            status='active',
            end_date__gt=timezone.now()
        ).first()

        logger.info(f'[SUPERAPP LOGIN] Subscription query result: {subscription}')
        if subscription:
            logger.info(f'[SUPERAPP LOGIN] Found active subscription: {subscription.id}, user: {subscription.user}')
            # Return user info if exists
            user_exists = subscription.user is not None
            # Get tier-specific Onevas configuration
            tier_type = subscription.tier.duration_type if subscription.tier else None
            onevas_config = ONEVAS_PRODUCTS.get(tier_type, {})
            return Response({
                'has_active_subscription': True,
                'user_exists': user_exists,
                'subscription_id': str(subscription.id),
                'tier_name': subscription.tier.name if subscription.tier else None,
                'tier_type': tier_type,
                'end_date': subscription.end_date.isoformat() if subscription.end_date else None,
                'application_key': onevas_config.get('application_key'),
                'product_number': onevas_config.get('product_id')
            }, status=status.HTTP_200_OK)
        else:
            # Try to find any subscription with this phone to debug
            all_subscriptions = UserSubscription.objects.filter(
                telebirr_phone_number__icontains=phone.replace('+', '').replace(' ', '')
            )
            similar_subs = list(all_subscriptions.values_list('telebirr_phone_number', 'status', 'payment_method'))
            logger.info(f'[SUPERAPP LOGIN] No active subscription found. All subscriptions with similar phone: {similar_subs}')
            return Response({
                'has_active_subscription': False,
                'user_exists': False
            }, status=status.HTTP_200_OK)

    except Exception as e:
        logger.error(f'[SUPERAPP LOGIN] Error checking subscription: {e}')
        return Response({'error': 'Failed to check subscription status'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([AllowAny])
def validate_subscription_token(request):
    """
    Validate subscription token and return phone number for frontend.
    SECURITY: This allows the frontend to get the phone number from a secure token
    instead of exposing the phone number directly in the URL.
    """
    token = request.data.get('token', '').strip()
    if not token:
        return Response({'error': 'Token is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Find subscription with valid token
        subscription = UserSubscription.objects.filter(
            subscription_token=token,
            status='active'
        ).first()

        if not subscription:
            return Response({'error': 'Invalid or expired token'}, status=status.HTTP_400_BAD_REQUEST)

        # Check if token is expired
        if subscription.subscription_token_expires_at and timezone.now() > subscription.subscription_token_expires_at:
            return Response({'error': 'Token has expired'}, status=status.HTTP_400_BAD_REQUEST)

        # Return phone number and subscription info
        # Use telebirr_phone_number for Telebirr subscriptions, fallback to onevas_phone_number
        phone = subscription.telebirr_phone_number or subscription.onevas_phone_number
        return Response({
            'phone': phone,
            'existing_user': subscription.user is not None,
            'subscription_id': str(subscription.id)
        }, status=status.HTTP_200_OK)

    except Exception as e:
        logger.error(f'[SUBSCRIPTION TOKEN] Error validating token: {str(e)}')
        return Response({'error': 'An error occurred'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([AllowAny])
def telebirr_ussd_subscription_status(request):
    """
    Public status check for a USSD Push subscription payment, keyed by
    originator_conversation_id (a random ID only known to the browser that
    initiated the payment). Used by the frontend to poll payment/subscription
    activation for ANONYMOUS (phone-only) users, since the authenticated
    /subscriptions/ endpoint cannot be used before login.

    Query Params:
        originator_conversation_id: str (required)

    Returns:
    {
        "found": true,
        "status": "pending" | "completed" | "failed",
        "subscription_status": "pending" | "active" | null,
        "is_new_user": true/false/null,
        "phone_number": "251XXXXXXXXX" or null
    }
    """
    originator_conversation_id = request.query_params.get('originator_conversation_id')
    logger.info(f'[USSD SUBSCRIPTION STATUS] Poll request for originator_conversation_id={originator_conversation_id}')

    if not originator_conversation_id:
        logger.warning('[USSD SUBSCRIPTION STATUS] Missing originator_conversation_id in request')
        return Response({'error': 'originator_conversation_id is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        payment = SubscriptionPayment.objects.get(
            onevas_transaction_id=originator_conversation_id,
            payment_method='telebirr',
        )
    except SubscriptionPayment.DoesNotExist:
        logger.warning(f'[USSD SUBSCRIPTION STATUS] No payment found for originator_conversation_id={originator_conversation_id}')
        return Response({'found': False, 'status': 'pending', 'subscription_status': None, 'is_new_user': None, 'phone_number': None})

    subscription_status = payment.subscription.status if payment.subscription else None
    is_new_user = payment.metadata.get('is_new_user') if payment.metadata else None
    phone_number = payment.metadata.get('phone_number') if payment.metadata else (payment.user.profile.phone_number if payment.user and hasattr(payment.user, 'profile') else None)

    logger.info(f'[USSD SUBSCRIPTION STATUS] payment_id={payment.id}, payment_status={payment.status}, subscription_status={subscription_status}, is_new_user={is_new_user}, has_user={payment.user is not None}')

    return Response({
        'found': True,
        'status': payment.status,
        'subscription_status': subscription_status,
        'is_new_user': is_new_user,
        'phone_number': phone_number,
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def telebirr_ussd_subscription_initiate(request):
    """
    Initiate USSD Push payment for subscription using BuyGoodsForCustomer.
    
    Request Body:
    {
        "tier_id": "uuid-of-tier",
        "phone_number": "251XXXXXXXXX" (optional if authenticated)
    }
    
    Returns:
    {
        "success": true,
        "originator_conversation_id": "S_X20260804...",
        "conversation_id": "AG_20260804_...",
        "message": "Accept the service request successfully."
    }
    """
    logger.info('[USSD SUBSCRIPTION] ========== INITIATE REQUEST START ==========')
    logger.info(f'[USSD SUBSCRIPTION] Authenticated user: {request.user.username if request.user.is_authenticated else "Anonymous"}')
    logger.info(f'[USSD SUBSCRIPTION] Request data: {request.data}')
    
    tier_id = request.data.get('tier_id')
    phone_number = request.data.get('phone_number')
    verification_session_id = request.data.get('verification_session_id')
    
    if not tier_id:
        logger.error('[USSD SUBSCRIPTION] Missing tier_id in request')
        return Response({'error': 'tier_id is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        tier = SubscriptionTier.objects.get(id=tier_id, is_active=True)
        logger.info(f'[USSD SUBSCRIPTION] Tier found: {tier.name} ({tier.slug}) - {tier.price_etb} ETB - {tier.duration_days} days')
    except SubscriptionTier.DoesNotExist:
        logger.error(f'[USSD SUBSCRIPTION] Tier not found or inactive: tier_id={tier_id}')
        return Response({'error': 'Tier not found or inactive'}, status=status.HTTP_404_NOT_FOUND)
    
    # Get phone number - from request body if provided, otherwise from authenticated user
    if phone_number:
        logger.info(f'[USSD SUBSCRIPTION] Phone number from request body: {phone_number}')
    elif request.user.is_authenticated:
        try:
            profile = request.user.profile
            phone_number = profile.phone_number
            logger.info(f'[USSD SUBSCRIPTION] User phone number from profile: {phone_number}')
        except UserProfile.DoesNotExist:
            logger.error(f'[USSD SUBSCRIPTION] User profile not found for user: {request.user.username}')
            return Response(
                {'error': 'User profile not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    else:
        logger.error('[USSD SUBSCRIPTION] Phone number not provided and user not authenticated')
        return Response(
            {'error': 'Phone number is required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    if not phone_number:
        logger.error('[USSD SUBSCRIPTION] Phone number not found')
        return Response(
            {'error': 'Phone number not found'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Normalize phone number to 251 format
    from .views import _normalize_ethiopian_phone
    normalized_phone = _normalize_ethiopian_phone(phone_number)
    if normalized_phone:
        phone_number = normalized_phone
        logger.info(f'[USSD SUBSCRIPTION] Normalized phone number: {phone_number}')
    else:
        logger.warning(f'[USSD SUBSCRIPTION] Could not normalize phone number: {phone_number}')
    
    # Calculate amount (convert to cents for Telebirr)
    amount_cents = int(float(tier.price_etb) * 100)
    amount = '{:.2f}'.format(float(tier.price_etb))
    logger.info(f'[USSD SUBSCRIPTION] Payment amount: {amount} ETB ({amount_cents} cents)')
    
    # Initiate USSD Push payment
    from django.conf import settings
    subscription_webhook_url = getattr(settings, 'TELEBIRR_SUBSCRIPTION_USSD_RESULT_URL', 'http://uat.flipstar.et:6082/api/webhooks/telebirrSubscriptionUssd/')
    logger.info(f'[USSD SUBSCRIPTION] Calling Telebirr Direct Debit Service with phone={phone_number}, amount={amount}, webhook={subscription_webhook_url}')
    result = telebirr_direct_debit_service.initiate_ussd_push_payment(
        amount=amount,
        phone_number=phone_number,
        coins=0,  # Not applicable for subscriptions
        result_url=subscription_webhook_url  # Use subscription-specific webhook
    )
    logger.info(f'[USSD SUBSCRIPTION] Telebirr service response: success={result.get("success")}, originator_conversation_id={result.get("originator_conversation_id")}, conversation_id={result.get("conversation_id")}')
    
    if not result.get('success'):
        logger.error(f'[USSD SUBSCRIPTION] Telebirr service failed: {result.get("error")}')
        logger.error(f'[USSD SUBSCRIPTION] Full Telebirr response: {result}')
        return Response({
            'error': result.get('error', 'USSD Push payment initiation failed'),
            'details': result
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    # Create pending subscription (will be activated in webhook)
    # For unauthenticated users, user will be None and will be set in webhook
    start_date = timezone.now()
    end_date = start_date + timedelta(days=tier.duration_days or 30)
    
    user_for_subscription = request.user if request.user.is_authenticated else None
    subscription = UserSubscription.objects.create(
        user=user_for_subscription,
        tier=tier,
        status='pending',
        duration_type=tier.duration_type,
        start_date=start_date,
        end_date=end_date,
        payment_method='telebirr',
        auto_renew=False,  # USSD is one-time payment
    )
    logger.info(f'[USSD SUBSCRIPTION] Pending subscription created: subscription_id={subscription.id}, user={user_for_subscription.username if user_for_subscription else "None"}')
    
    # Create pending subscription payment record linked to the subscription
    # Store phone number in metadata for unauthenticated users to match in webhook
    payment_metadata = {}
    if not user_for_subscription:
        payment_metadata['phone_number'] = phone_number
    if verification_session_id:
        payment_metadata['verification_session_id'] = verification_session_id
    
    payment = SubscriptionPayment.objects.create(
        user=user_for_subscription,
        subscription=subscription,
        amount=tier.price_etb,
        currency='ETB',
        status='pending',
        payment_method='telebirr',
        onevas_transaction_id=result.get('originator_conversation_id'),
        duration_type=tier.duration_type,
        period_start=start_date,
        period_end=end_date,
        metadata=payment_metadata,
    )
    logger.info(f'[USSD SUBSCRIPTION] Payment record created: payment_id={payment.id}, originator_conversation_id={result.get("originator_conversation_id")}')
    
    response_data = {
        'success': True,
        'originator_conversation_id': result.get('originator_conversation_id'),
        'conversation_id': result.get('conversation_id'),
        'message': result.get('message'),
        'tier': {
            'id': str(tier.id),
            'name': tier.name,
            'slug': tier.slug,
            'price_etb': str(tier.price_etb),
            'duration_days': tier.duration_days,
        },
        'payment_id': str(payment.id),
    }
    logger.info(f'[USSD SUBSCRIPTION] ========== INITIATE RESPONSE TO CLIENT: {response_data} ==========')
    logger.info('[USSD SUBSCRIPTION] ========== INITIATE REQUEST END ==========')
    
    return Response(response_data)


@api_view(['POST'])
@permission_classes([AllowAny])  # Telebirr calls this without authentication
def telebirr_ussd_subscription_webhook(request):
    """
    Handle USSD Push payment result webhook from Telebirr for subscriptions.
    
    Receives SOAP Result envelope with payment completion status.
    Activates subscription on successful payment.
    """
    import xml.etree.ElementTree as ET
    
    logger.info('[USSD SUBSCRIPTION WEBHOOK] ========== CALLBACK START ==========')
    
    # NOTE: Telebirr's SOAP client (Axis2) POSTs with Content-Type: text/xml.
    # Use the raw body instead to avoid DRF parser negotiation issues.
    raw_body = request.body or b''
    logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Received callback. Content-Type: {request.META.get('CONTENT_TYPE')}, Body: {raw_body[:2000]}")
    
    try:
        # Parse SOAP XML
        root = ET.fromstring(raw_body)
        
        # Extract result data using namespace
        namespaces = {
            'soapenv': 'http://schemas.xmlsoap.org/soap/envelope/',
            'api': 'http://cps.huawei.com/cpsinterface/api_resultmgr',
            'res': 'http://cps.huawei.com/cpsinterface/result'
        }
        
        # Extract header fields
        header = root.find('.//res:Header', namespaces)
        originator_conversation_id = header.find('res:OriginatorConversationID', namespaces).text if header is not None else None
        conversation_id = header.find('res:ConversationID', namespaces).text if header is not None else None
        
        # Extract body fields
        body = root.find('.//res:Body', namespaces)
        result_type = body.find('res:ResultType', namespaces).text if body is not None else None
        result_code = body.find('res:ResultCode', namespaces).text if body is not None else None
        result_desc = body.find('res:ResultDesc', namespaces).text if body is not None else None
        
        # Extract transaction ID
        transaction_id = None
        transaction_result = body.find('res:TransactionResult', namespaces)
        if transaction_result is not None:
            transaction_id_elem = transaction_result.find('res:TransactionID', namespaces)
            if transaction_id_elem is not None:
                transaction_id = transaction_id_elem.text
        
        logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Parsed result: originator={originator_conversation_id}, conversation={conversation_id}, result_code={result_code}, result_type={result_type}, transaction_id={transaction_id}, result_desc={result_desc}")
        
        # Determine success
        is_success = result_code == '0' and result_type == '0'
        
        if not is_success:
            logger.warning(f"[USSD SUBSCRIPTION WEBHOOK] Payment failed: {result_desc}")
            # Mark pending payment as failed
            updated_count = SubscriptionPayment.objects.filter(
                onevas_transaction_id=originator_conversation_id,
                payment_method='telebirr',
                status='pending',
            ).update(status='failed')
            logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Marked {updated_count} payment(s) as failed")
            logger.info('[USSD SUBSCRIPTION WEBHOOK] ========== CALLBACK END (FAILED) ==========')
            return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'received'})
        
        # Activate subscription on success
        try:
            payment = SubscriptionPayment.objects.get(
                onevas_transaction_id=originator_conversation_id,
                payment_method='telebirr',
                status='pending',
            )
            logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Payment found: payment_id={payment.id}, user={payment.user.username if payment.user else None}, amount={payment.amount}")
        except SubscriptionPayment.DoesNotExist:
            logger.warning(f"[USSD SUBSCRIPTION WEBHOOK] No pending payment found for originator_conversation_id={originator_conversation_id}")
            logger.info('[USSD SUBSCRIPTION WEBHOOK] ========== CALLBACK END (NOT FOUND) ==========')
            return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'payment not found'})
        
        user = payment.user
        amount = payment.amount
        
        # Handle unauthenticated users - find or create user by phone number
        is_new_user = False
        if not user and payment.metadata and payment.metadata.get('phone_number'):
            phone_number = payment.metadata.get('phone_number')
            logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Payment has no user, phone_number={phone_number}. Finding/creating user.")
            from django.contrib.auth import get_user_model
            User = get_user_model()
            
            # Normalize phone number
            from .views import _normalize_ethiopian_phone
            normalized_phone = _normalize_ethiopian_phone(phone_number)
            if normalized_phone:
                phone_number = normalized_phone
            
            # Try to find existing user by phone number
            try:
                profile = UserProfile.objects.get(phone_number=phone_number)
                user = profile.user
                logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Found existing user: {user.username} (ID: {user.id})")
                # Update payment with the found user
                payment.user = user
                # Update metadata to indicate existing user
                payment.metadata['is_new_user'] = False
                payment.save()
            except UserProfile.DoesNotExist:
                # Create new user and profile
                logger.info(f"[USSD SUBSCRIPTION WEBHOOK] No existing user found, creating new user for phone: {phone_number}")
                username = f"user_{phone_number[-8:]}"  # Use last 8 digits of phone as username
                user = User.objects.create_user(username=username, password=None)  # No password initially
                user.phone_number = phone_number
                user.save()
                
                # Create profile
                UserProfile.objects.create(
                    user=user,
                    phone_number=phone_number,
                )
                logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Created new user: {user.username} (ID: {user.id})")
                is_new_user = True
                
                # Update payment with the new user
                payment.user = user
                # Update metadata to indicate new user
                payment.metadata['is_new_user'] = True
                payment.save()
        elif user:
            # Existing authenticated user
            payment.metadata['is_new_user'] = False
            payment.save()
        
        if not user:
            logger.error(f"[USSD SUBSCRIPTION WEBHOOK] No user found and no phone number to create user")
            payment.status = 'failed'
            payment.save()
            logger.info('[USSD SUBSCRIPTION WEBHOOK] ========== CALLBACK END (NO USER) ==========')
            return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'no user found'})
        
        logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Activating subscription for user {user.username} (ID: {user.id}) for payment {originator_conversation_id}")
        
        # Find the tier based on amount
        tier = None
        for possible_tier in SubscriptionTier.objects.filter(is_active=True):
            if float(possible_tier.price_etb) == float(amount):
                tier = possible_tier
                break
        
        if not tier:
            logger.error(f"[USSD SUBSCRIPTION WEBHOOK] No tier found for amount {amount}")
            payment.status = 'failed'
            payment.save()
            logger.info('[USSD SUBSCRIPTION WEBHOOK] ========== CALLBACK END (TIER NOT FOUND) ==========')
            return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'tier not found'})
        
        logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Tier matched: {tier.name} ({tier.slug}) - {tier.duration_days} days")
        
        # Use the pending subscription created during initiation
        subscription = payment.subscription
        if subscription and subscription.status == 'pending':
            logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Activating pending subscription: subscription_id={subscription.id}")
            subscription.status = 'active'
            subscription.tier = tier
            subscription.duration_type = tier.duration_type
            subscription.payment_method = 'telebirr'
            # Update user if subscription was created without one
            if not subscription.user:
                subscription.user = user
            subscription.save()
            logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Pending subscription activated: subscription_id={subscription.id}")
        else:
            # Fallback: Check if user has an existing active subscription
            existing_subscription = UserSubscription.objects.filter(
                user=user,
                status='active'
            ).first()
            
            if existing_subscription:
                # Renew existing subscription - reset end date from current time
                logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Existing subscription found: subscription_id={existing_subscription.id}, current_end={existing_subscription.end_date}")
                now = timezone.now()
                existing_subscription.start_date = now
                if tier.duration_days:
                    existing_subscription.end_date = now + timedelta(days=tier.duration_days)
                    logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Renewing subscription: end date reset to {tier.duration_days} days from now")
                
                existing_subscription.tier = tier
                existing_subscription.duration_type = tier.duration_type
                existing_subscription.payment_method = 'telebirr'
                existing_subscription.save()
                
                subscription = existing_subscription
                logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Extended existing subscription {subscription.id}, new end date: {subscription.end_date}")
            else:
                # Create new subscription (fallback)
                logger.info(f"[USSD SUBSCRIPTION WEBHOOK] No pending or existing subscription, creating new one")
                now = timezone.now()
                start_date = now
                end_date = now + timedelta(days=tier.duration_days) if tier.duration_days else None
                subscription = UserSubscription.objects.create(
                    user=user,
                    tier=tier,
                    status='active',
                    duration_type=tier.duration_type,
                    start_date=start_date,
                    end_date=end_date,
                    payment_method='telebirr',
                    auto_renew=False,  # USSD is one-time payment
                )
                logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Created new subscription {subscription.id}")
        
        # Update payment record
        payment.subscription = subscription
        payment.status = 'completed'
        payment.save()
        logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Payment record updated: payment_id={payment.id}, status=completed, subscription_id={subscription.id}")
        
        # Create subscription history
        history = SubscriptionHistory.objects.create(
            user=user,
            subscription=subscription,
            tier=tier,
            action='created',
            reason=f'USSD Push payment: {tier.name} subscription'
        )
        logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Subscription history created: history_id={history.id}")
        
        logger.info(f"[USSD SUBSCRIPTION WEBHOOK] ========== CALLBACK SUCCESS: Subscription activated for user {user.username} ==========")
        
        # Send OTP to user for login after subscription
        try:
            from .services.otp_service import OTPService
            from decouple import config
            
            # Get phone number from user profile
            try:
                profile = user.profile
                phone_number = profile.phone_number
            except UserProfile.DoesNotExist:
                phone_number = None
            
            if phone_number:
                # Use default Onevas keys for subscription OTP
                application_key = config('ONEVAS_APPLICATION_KEY', default='UPJG5ZM3X6C9LLDSKKCME4MA86UQRKWV')
                product_number = '10000302850'
                
                logger.info(f"[USSD SUBSCRIPTION WEBHOOK] Sending login OTP to {phone_number} for subscription activation")
                success, message = OTPService.send_otp(phone_number, application_key, product_number, action='subscription_login', request=None)
                logger.info(f"[USSD SUBSCRIPTION WEBHOOK] OTP sent - success: {success}, message: {message}")
            else:
                logger.warning(f"[USSD SUBSCRIPTION WEBHOOK] No phone number found for user {user.username}, skipping OTP")
        except Exception as otp_error:
            logger.error(f"[USSD SUBSCRIPTION WEBHOOK] Error sending OTP: {otp_error}", exc_info=True)
        
        logger.info('[USSD SUBSCRIPTION WEBHOOK] ========== CALLBACK END ==========')
        
        return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'subscription activated'})
        
    except Exception as e:
        logger.error(f"[USSD SUBSCRIPTION WEBHOOK] Error processing webhook: {e}")
        logger.exception('[USSD SUBSCRIPTION WEBHOOK] Full traceback')
        logger.info('[USSD SUBSCRIPTION WEBHOOK] ========== CALLBACK END (ERROR) ==========')
        return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'error processed'})


# ---------------------------------------------------------------------------
# Apple In-App Purchase (StoreKit) - Subscription Receipt Verification
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def apple_verify_subscription(request):
    """
    Verify an Apple StoreKit receipt for an auto-renewable subscription tier
    and activate/renew the user's subscription.

    Request Body:
    {
        "tier_id": 3,
        "receipt_data": "<base64 receipt from react-native-iap>",
        "product_id": "com.flipstar.sub.monthly"   # Apple product ID, for cross-check
    }

    Returns:
    {
        "success": true,
        "subscription": { ... }
    }
    """
    from . import apple_iap_service
    from .models_wallet import AppleIAPTransaction

    tier_id = request.data.get('tier_id')
    receipt_data = request.data.get('receipt_data')
    apple_product_id = request.data.get('product_id')

    if not tier_id or not receipt_data:
        return Response({'error': 'tier_id and receipt_data are required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        tier = SubscriptionTier.objects.get(id=tier_id, is_active=True)
    except SubscriptionTier.DoesNotExist:
        return Response({'error': 'Subscription tier not found or inactive'}, status=status.HTTP_404_NOT_FOUND)

    expected_product_id = apple_product_id or tier.apple_product_id
    if not expected_product_id:
        return Response({'error': 'This tier has no Apple product ID configured'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        verified = apple_iap_service.verify_receipt(receipt_data)
        txn = apple_iap_service.extract_latest_transaction(verified, expected_product_id=expected_product_id)
    except apple_iap_service.AppleIAPError as e:
        logger.warning(f"[APPLE IAP] Subscription receipt verification failed: {e}")
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    transaction_id = txn.get('transaction_id')
    if not transaction_id:
        return Response({'error': 'Receipt is missing a transaction_id'}, status=status.HTTP_400_BAD_REQUEST)

    user = request.user

    # Idempotency: never reactivate/duplicate off the same Apple transaction.
    existing = AppleIAPTransaction.objects.filter(transaction_id=transaction_id).first()
    if existing:
        subscription = UserSubscription.objects.filter(user=user, status='active').first()
        return Response({
            'success': True,
            'already_processed': True,
            'subscription': {
                'id': subscription.id if subscription else None,
                'status': subscription.status if subscription else None,
                'tier': subscription.tier.name if subscription and subscription.tier else None,
            },
        })

    now = timezone.now()
    expires_date_ms = txn.get('expires_date_ms')
    end_date = None
    if expires_date_ms:
        end_date = timezone.datetime.fromtimestamp(int(expires_date_ms) / 1000, tz=timezone.utc)
    elif tier.duration_days:
        end_date = now + timedelta(days=tier.duration_days)

    subscription = UserSubscription.objects.filter(user=user, status='active').first()
    if subscription:
        subscription.tier = tier
        subscription.duration_type = tier.duration_type
        subscription.payment_method = 'apple'
        subscription.status = 'active'
        subscription.start_date = subscription.start_date or now
        subscription.end_date = end_date
        subscription.auto_renew = True
        subscription.save()
    else:
        subscription = UserSubscription.objects.create(
            user=user,
            tier=tier,
            status='active',
            duration_type=tier.duration_type,
            start_date=now,
            end_date=end_date,
            payment_method='apple',
            auto_renew=True,
        )

    SubscriptionPayment.objects.create(
        subscription=subscription,
        user=user,
        amount=tier.price_etb,
        status='completed',
        payment_method='apple',
        onevas_transaction_id=transaction_id,
        duration_type=tier.duration_type,
        period_start=subscription.start_date or now,
        period_end=end_date or (now + timedelta(days=tier.duration_days or 30)),
    )

    SubscriptionHistory.objects.create(
        user=user,
        subscription=subscription,
        tier=tier,
        action='created',
        reason=f'Apple In-App Purchase: {tier.name} subscription'
    )

    AppleIAPTransaction.objects.create(
        user=user,
        product_type='subscription',
        apple_product_id=expected_product_id,
        transaction_id=transaction_id,
        original_transaction_id=txn.get('original_transaction_id'),
        reference_id=str(tier.id),
        raw_receipt_response=txn,
    )

    logger.info(f"[APPLE IAP] Activated subscription {tier.name} for {user.username}")

    return Response({
        'success': True,
        'subscription': {
            'id': subscription.id,
            'status': subscription.status,
            'tier': tier.name,
            'end_date': subscription.end_date,
        },
    })
