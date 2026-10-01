"""
Wallet API - User-facing endpoints for the coin economy.

Endpoints:
- GET    /api/wallet/                       Wallet summary (balances + recent transactions)
- GET    /api/wallet/transactions/          Paginated transaction history
- GET    /api/wallet/withdrawal-info/       Withdrawal eligibility + conversion preview
- POST   /api/wallet/withdraw/              Request a withdrawal (coins -> Birr)
- GET    /api/wallet/withdrawals/           User's withdrawal request history
- POST   /api/wallet/withdrawals/<id>/cancel/   Cancel pending withdrawal
- GET    /api/wallet/config/                Public-safe wallet config (rates, thresholds)
- POST   /api/wallet/telebirr/initiate/     Initiate Telebirr payment for coin purchase
- POST   /api/wallet/telebirr-callback/     Telebirr payment callback webhook
- POST   /api/wallet/telebirr/auth/         Telebirr SuperApp auto-login
"""
from decimal import Decimal
import logging

from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny
from rest_framework.response import Response
from rest_framework.authtoken.models import Token

from .models_contest import UserCoinBalance, CoinTransaction, CoinPackage
from .models_wallet import WalletConfig, WithdrawalRequest, AppleIAPTransaction
from . import apple_iap_service
from .models import UserProfile
from .telebirr_service import telebirr_service
from .services.telebirr_mandate_service import telebirr_mandate_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TRANSACTION_DISPLAY = dict(CoinTransaction.TRANSACTION_TYPES)


def _get_or_create_balance(user):
    balance, _ = UserCoinBalance.objects.get_or_create(user=user)
    profile = getattr(user, 'profile', None)

    if profile:
        if profile.coins > balance.balance:
            delta = profile.coins - balance.balance
            balance.purchased_balance += delta
            balance.total_purchased += delta
            balance._sync_balance()
            balance.save(update_fields=['purchased_balance', 'balance', 'total_purchased', 'updated_at'])
        elif profile.coins != balance.balance:
            profile.coins = balance.balance
            profile.save(update_fields=['coins'])

    return balance


def _serialize_transaction(tx):
    # Method-aware display label for purchases
    type_display = TRANSACTION_DISPLAY.get(tx.transaction_type, tx.transaction_type)
    if tx.transaction_type == 'purchase' and tx.payment_method:
        method_label = {
            'airtime': 'Airtime',
            'telebirr': 'Telebirr',
            'coins': 'Coins',
        }.get(tx.payment_method, tx.payment_method.title())
        type_display = f'Coin Purchase ({method_label})'

    # For gifts, show the other party
    other_user = None
    if tx.recipient_id:
        other_user = {
            'id': tx.recipient_id,
            'username': tx.recipient.username,
        }

    # Get post details for gift transactions
    post_details = None
    if tx.reel_id and (tx.transaction_type == 'gift_sent' or tx.transaction_type == 'gift_received'):
        try:
            reel = tx.reel
            if reel:
                post_details = {
                    'id': reel.id,
                    'title': reel.title or '',
                    'description': reel.description or '',
                    'media_url': reel.media.url if reel.media else None,
                }
        except:
            pass

    return {
        'id': tx.id,
        'type': tx.transaction_type,
        'type_display': type_display,
        'coins': tx.coins,
        'is_credit': tx.coins > 0,
        'description': tx.description or '',
        'other_user': other_user,
        'recipient_username': tx.recipient.username if tx.recipient_id else None,
        'reel_id': tx.reel_id,
        'post_details': post_details,
        'payment_method': tx.payment_method or None,
        'payment_reference': tx.payment_reference or None,
        'is_successful': tx.is_successful,
        'created_at': tx.created_at.isoformat(),
    }


def _serialize_withdrawal(w):
    data = {
        'id': w.id,
        'coin_amount': w.coin_amount,
        'point_amount': getattr(w, 'point_amount', 0),
        'gross_birr': str(w.gross_birr),
        'fee_birr': str(w.fee_birr),
        'net_birr': str(w.net_birr),
        'conversion_rate': w.conversion_rate,
        'payout_method': w.payout_method,
        'payout_method_display': dict(WithdrawalRequest.PAYOUT_METHODS).get(w.payout_method, w.payout_method),
        'payout_account': w.payout_account,
        'payout_account_name': w.payout_account_name,
        'status': w.status,
        'status_display': dict(WithdrawalRequest.STATUS_CHOICES).get(w.status, w.status),
        'admin_notes': w.admin_notes if w.status in ('approved', 'completed', 'rejected') else '',
        'rejection_reason': w.rejection_reason,
        'payout_reference': w.payout_reference,
        'created_at': w.created_at.isoformat(),
        'reviewed_at': w.reviewed_at.isoformat() if w.reviewed_at else None,
        'completed_at': w.completed_at.isoformat() if w.completed_at else None,
        'can_cancel': w.can_cancel(),
    }
    
    # Add platform_fee_birr if field exists (for new withdrawals)
    try:
        data['platform_fee_birr'] = str(getattr(w, 'platform_fee_birr', 0))
    except Exception:
        data['platform_fee_birr'] = '0.00'
    
    return data


# ---------------------------------------------------------------------------
# User wallet endpoints
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def wallet_summary(request):
    """Get user's wallet summary: balances, points, totals, recent transactions."""
    balance = _get_or_create_balance(request.user)
    config = WalletConfig.get_config()

    recent_tx = (
        CoinTransaction.objects
        .filter(user=request.user)
        .order_by('-created_at')[:10]
    )

    # Get recent withdrawal requests (defer platform_fee_birr if migration not applied)
    try:
        recent_withdrawals = (
            WithdrawalRequest.objects
            .filter(user=request.user)
            .defer('platform_fee_birr')
            .order_by('-created_at')[:5]
        )
    except Exception:
        # Fallback if defer fails (field might not exist in model yet)
        recent_withdrawals = (
            WithdrawalRequest.objects
            .filter(user=request.user)
            .order_by('-created_at')[:5]
        )

    pending_withdrawals = WithdrawalRequest.objects.filter(
        user=request.user,
        status__in=['pending', 'approved', 'processing']
    ).count()

    return Response({
        'balance': {
            'total': balance.balance,
            'earned': getattr(balance, 'earned_balance', 0),
            'purchased': getattr(balance, 'purchased_balance', 0),
            'telebirr_purchased': getattr(balance, 'telebirr_purchased_balance', 0),
            'airtime_purchased': getattr(balance, 'airtime_purchased_balance', 0),
        },
        'points': {
            'current': getattr(request.user.profile, 'points', 0),
            'earned_total': getattr(request.user.profile, 'points_earned_total', 0),
            'withdrawn_total': getattr(request.user.profile, 'points_withdrawn_total', 0),
        },
        'totals': {
            'lifetime_earned': getattr(balance, 'total_earned', 0),
            'lifetime_spent': getattr(balance, 'total_spent', 0),
            'lifetime_purchased': getattr(balance, 'total_purchased', 0),
            'lifetime_telebirr_purchased': getattr(balance, 'total_telebirr_purchased', 0),
            'lifetime_airtime_purchased': getattr(balance, 'total_airtime_purchased', 0),
            'lifetime_withdrawn': getattr(balance, 'total_withdrawn', 0),
        },
        'withdrawal': {
            'enabled': config.withdrawal_enabled,
            'min_coins': config.withdrawal_min_coins,
            'coins_per_birr': config.coins_per_birr,
            'fee_percent': str(config.withdrawal_fee_percent),
            'eligible': (
                config.withdrawal_enabled
                and getattr(balance, 'earned_balance', 0) >= config.withdrawal_min_coins
            ),
            'pending_requests': pending_withdrawals,
        },
        'currency': 'ETB',
        'recent_transactions': [_serialize_transaction(tx) for tx in recent_tx],
        'recent_withdrawals': [_serialize_withdrawal(w) for w in recent_withdrawals],
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def wallet_transactions(request):
    """Paginated transaction history. Query params: ?type=&page=&page_size="""
    qs = CoinTransaction.objects.filter(user=request.user).order_by('-created_at')

    tx_type = request.query_params.get('type')
    if tx_type:
        qs = qs.filter(transaction_type=tx_type)

    direction = request.query_params.get('direction')  # 'in' or 'out'
    if direction == 'in':
        qs = qs.filter(coins__gt=0)
    elif direction == 'out':
        qs = qs.filter(coins__lt=0)

    try:
        page = max(int(request.query_params.get('page', 1)), 1)
        page_size = min(max(int(request.query_params.get('page_size', 20)), 1), 100)
    except ValueError:
        page, page_size = 1, 20

    total = qs.count()
    start = (page - 1) * page_size
    end = start + page_size
    items = qs[start:end]

    return Response({
        'count': total,
        'page': page,
        'page_size': page_size,
        'has_next': end < total,
        'has_prev': page > 1,
        'results': [_serialize_transaction(tx) for tx in items],
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def withdrawal_info(request):
    """
    Get withdrawal eligibility info + preview conversion for a given amount.
    Query params: ?coins=<amount>
    """
    balance = _get_or_create_balance(request.user)
    config = WalletConfig.get_config()

    coins_param = request.query_params.get('coins')
    preview = None
    if coins_param:
        try:
            coins = int(coins_param)
            if coins > 0:
                breakdown = config.calculate_withdrawal(coins)
                preview = {
                    'coins': breakdown['coins'],
                    'gross_birr': str(breakdown['gross_birr']),
                    'fee_birr': str(breakdown['fee_birr']),
                    'net_birr': str(breakdown['net_birr']),
                    'fee_percent': str(breakdown['fee_percent']),
                }
        except ValueError:
            pass

    return Response({
        'enabled': config.withdrawal_enabled,
        'min_coins': config.withdrawal_min_coins,
        'max_coins_per_request': config.withdrawal_max_coins_per_request,
        'coins_per_birr': config.coins_per_birr,
        'fee_percent': str(config.withdrawal_fee_percent),
        'processing_days': config.withdrawal_processing_days,
        'available_coins': balance.earned_balance,
        'eligible': (
            config.withdrawal_enabled
            and balance.earned_balance >= config.withdrawal_min_coins
        ),
        'payout_methods': [
            {'value': v, 'label': l} for v, l in WithdrawalRequest.PAYOUT_METHODS
        ],
        'preview': preview,
        'currency': 'ETB',
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_withdrawal(request):
    """
    Create a withdrawal request using points (not coins).
    Body: { point_amount, payout_method, payout_account, payout_account_name }
    """
    config = WalletConfig.get_config()
    
    logger.info(f"[Withdrawal Request] User={request.user.username}, data={request.data}")

    if not config.withdrawal_enabled:
        logger.warning(f"[Withdrawal Request] Withdrawals disabled for user={request.user.username}")
        return Response(
            {'error': 'Withdrawals are currently disabled'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        point_amount = int(request.data.get('point_amount', 0))
    except (TypeError, ValueError):
        logger.warning(f"[Withdrawal Request] Invalid point_amount for user={request.user.username}: {request.data.get('point_amount')}")
        return Response({'error': 'Invalid point_amount'}, status=status.HTTP_400_BAD_REQUEST)

    payout_method = request.data.get('payout_method', 'telebirr')
    payout_account = (request.data.get('payout_account') or '').strip()
    payout_account_name = (request.data.get('payout_account_name') or '').strip()
    
    logger.info(f"[Withdrawal Request] Parsed: point_amount={point_amount}, method={payout_method}, account={payout_account}")
    
    # Auto-fill phone number from profile if not provided and using Telebirr
    if payout_method == 'telebirr' and not payout_account:
        if request.user.profile.phone_number:
            payout_account = request.user.profile.phone_number
            logger.info(f"[Withdrawal Request] Auto-filled phone number from profile: {payout_account}")
        else:
            logger.warning(f"[Withdrawal Request] No phone number in profile for user={request.user.username}")

    if point_amount < config.withdrawal_min_points:
        logger.warning(f"[Withdrawal Request] Amount too low: {point_amount} < {config.withdrawal_min_points}")
        return Response(
            {'error': f'Minimum withdrawal is {config.withdrawal_min_points} points'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if point_amount > config.withdrawal_max_points_per_request:
        logger.warning(f"[Withdrawal Request] Amount too high: {point_amount} > {config.withdrawal_max_points_per_request}")
        return Response(
            {'error': f'Maximum per request is {config.withdrawal_max_points_per_request} points'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if payout_method not in dict(WithdrawalRequest.PAYOUT_METHODS):
        logger.warning(f"[Withdrawal Request] Invalid payout method: {payout_method}")
        return Response({'error': 'Invalid payout method'}, status=status.HTTP_400_BAD_REQUEST)
    if not payout_account:
        logger.warning(f"[Withdrawal Request] No payout account provided")
        return Response(
            {'error': 'payout_account is required (phone or bank account number)'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Check user's point balance with row-level lock to prevent race conditions
    from django.db import transaction
    with transaction.atomic():
        user_profile = UserProfile.objects.select_for_update().get(user=request.user)
        
        if user_profile.points < point_amount:
            return Response(
                {'error': f'Insufficient points. You have {user_profile.points} points.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        breakdown = config.calculate_points_withdrawal(point_amount)

        # Deduct points now (refunded if rejected/failed)
        user_profile.points -= point_amount
        user_profile.points_withdrawn_total += point_amount
        user_profile.save()

        # Create withdrawal request
        withdrawal = WithdrawalRequest.objects.create(
            user=request.user,
            point_amount=point_amount,
            gross_birr=breakdown['gross_birr'],
            fee_birr=breakdown['fee_birr'],
            platform_fee_birr=breakdown['platform_fee_birr'],
            net_birr=breakdown['net_birr'],
            conversion_rate=config.points_per_birr,
            payout_method=payout_method,
            payout_account=payout_account,
            payout_account_name=payout_account_name,
            status='pending',
        )
        
        logger.info(f"[Withdrawal Request] Created withdrawal request ID={withdrawal.id}, user={request.user.username}, "
                   f"points={point_amount}, gross={breakdown['gross_birr']}, platform_fee={breakdown['platform_fee_birr']}, "
                   f"net={breakdown['net_birr']}, method={payout_method}, account={payout_account}")

        # If Telebirr payout, immediately trigger B2C payment
        if payout_method == 'telebirr':
            from .telebirr_direct_debit_service import telebirr_direct_debit_service
            
            # Format phone number with country code if needed
            receiver_msisdn = payout_account
            if not receiver_msisdn.startswith('251'):
                receiver_msisdn = '251' + receiver_msisdn.lstrip('0')
            
            logger.info(f"[B2C Initiation] Starting B2C payment for withdrawal ID={withdrawal.id}, "
                       f"receiver={receiver_msisdn}, amount={breakdown['net_birr']} ETB")
            
            # Initiate B2C payment
            b2c_result = telebirr_direct_debit_service.initiate_b2c_payment(
                receiver_msisdn=receiver_msisdn,
                amount=float(breakdown['net_birr']),
                currency='ETB',
                reason_type='Points withdrawal payout',
                remark=f'Withdrawal #{withdrawal.id} - {point_amount} points to Birr',
                reference_data={'withdrawal_id': str(withdrawal.id)},
                debug=False
            )
            
            logger.info(f"[B2C Initiation] B2C response for withdrawal ID={withdrawal.id}: "
                       f"success={b2c_result.get('success')}, "
                       f"transaction_id={b2c_result.get('transaction_id')}, "
                       f"originator_conversation_id={b2c_result.get('originator_conversation_id')}, "
                       f"conversation_id={b2c_result.get('conversation_id')}, "
                       f"telebirr_transaction_id={b2c_result.get('telebirr_transaction_id')}, "
                       f"error={b2c_result.get('error')}")
            
            if b2c_result.get('success'):
                # Link B2C transaction to withdrawal
                withdrawal.b2c_transaction_id = b2c_result.get('transaction_id')  # UUIDField - use None if missing
                withdrawal.originator_conversation_id = b2c_result.get('originator_conversation_id') or ''
                withdrawal.conversation_id = b2c_result.get('conversation_id') or ''
                withdrawal.telebirr_transaction_id = b2c_result.get('telebirr_transaction_id') or ''
                withdrawal.status = 'processing'
                withdrawal.save()
                
                logger.info(f"[B2C Initiation] Successfully linked B2C transaction to withdrawal ID={withdrawal.id}, "
                           f"status changed to 'processing'")
            else:
                # B2C failed, refund points
                user_profile.points += point_amount
                user_profile.points_withdrawn_total -= point_amount
                user_profile.save()
                
                withdrawal.status = 'failed'
                withdrawal.rejection_reason = f'B2C payment failed: {b2c_result.get("error", "Unknown error")}'
                withdrawal.save()
                
                logger.error(f"[B2C Initiation] B2C payment failed for withdrawal ID={withdrawal.id}, "
                            f"refunded {point_amount} points to user, error: {b2c_result.get('error')}")
                
                return Response(
                    {
                        'error': 'B2C payment initiation failed',
                        'details': b2c_result.get('error'),
                        'withdrawal': _serialize_withdrawal(withdrawal),
                        'new_balance': {
                            'points': user_profile.points,
                            'points_earned_total': user_profile.points_earned_total,
                            'points_withdrawn_total': user_profile.points_withdrawn_total,
                        },
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

    return Response(
        {
            'message': 'Withdrawal request submitted successfully',
            'withdrawal': _serialize_withdrawal(withdrawal),
            'new_balance': {
                'points': user_profile.points,
                'points_earned_total': user_profile.points_earned_total,
                'points_withdrawn_total': user_profile.points_withdrawn_total,
            },
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reinvest_points(request):
    """
    Convert points back to coins (re-invest).
    Body: { points }
    1 Point = 1 Coin
    """
    try:
        points_amount = int(request.data.get('points', 0))
    except (TypeError, ValueError):
        return Response({'error': 'Invalid points amount'}, status=status.HTTP_400_BAD_REQUEST)

    if points_amount < 1:
        return Response({'error': 'Minimum 1 point required'}, status=status.HTTP_400_BAD_REQUEST)

    # Check user's point balance with row-level lock to prevent race conditions
    from django.db import transaction
    with transaction.atomic():
        user_profile = UserProfile.objects.select_for_update().get(user=request.user)
        
        if user_profile.points < points_amount:
            return Response(
                {'error': f'Insufficient points. You have {user_profile.points} points.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get or create user's coin balance
        coin_balance = _get_or_create_balance(request.user)

        # Deduct points
        user_profile.points -= points_amount
        user_profile.save()

        # Add coins (1 point = 1 coin)
        coin_balance.earned_balance += points_amount
        coin_balance.balance += points_amount
        coin_balance.total_earned += points_amount
        coin_balance._sync_balance()
        coin_balance.save(update_fields=[
            'earned_balance', 'balance', 'total_earned', 'updated_at'
        ])

        # Create transaction record
        CoinTransaction.objects.create(
            user=request.user,
            transaction_type='reinvest',
            coins=points_amount,
            description=f'Converted {points_amount} points to coins'
        )

    return Response({
        'message': 'Successfully converted points to coins',
        'points_converted': points_amount,
        'coins_received': points_amount,
        'new_balance': {
            'points': user_profile.points,
            'coins': coin_balance.balance,
            'earned_coins': coin_balance.earned_balance,
            'telebirr_purchased_coins': coin_balance.telebirr_purchased_balance,
            'airtime_purchased_coins': coin_balance.airtime_purchased_balance,
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_withdrawals(request):
    """List current user's withdrawal requests with pagination."""
    qs = WithdrawalRequest.objects.filter(user=request.user).order_by('-created_at')
    
    try:
        page = max(int(request.query_params.get('page', 1)), 1)
        page_size = min(max(int(request.query_params.get('page_size', 20)), 1), 100)
    except ValueError:
        page, page_size = 1, 20

    total = qs.count()
    start = (page - 1) * page_size
    end = start + page_size
    items = qs[start:end]

    return Response({
        'count': total,
        'page': page,
        'page_size': page_size,
        'has_next': end < total,
        'has_prev': page > 1,
        'results': [_serialize_withdrawal(w) for w in items],
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cancel_withdrawal(request, withdrawal_id):
    """Cancel a pending withdrawal request and refund the coins."""
    try:
        withdrawal = WithdrawalRequest.objects.get(id=withdrawal_id, user=request.user)
    except WithdrawalRequest.DoesNotExist:
        return Response({'error': 'Withdrawal request not found'}, status=status.HTTP_404_NOT_FOUND)

    if not withdrawal.can_cancel():
        return Response(
            {'error': f'Cannot cancel a {withdrawal.status} withdrawal'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Refund coins back to earned balance
    balance = _get_or_create_balance(request.user)
    balance.earned_balance = (balance.earned_balance or 0) + withdrawal.coin_amount
    balance.total_withdrawn = max(0, balance.total_withdrawn - withdrawal.coin_amount)
    balance._sync_balance()
    balance.save()

    CoinTransaction.objects.create(
        user=request.user,
        transaction_type='refund',
        coins=withdrawal.coin_amount,
        description=f'Cancelled withdrawal #{withdrawal.id}',
    )

    withdrawal.status = 'cancelled'
    withdrawal.save()

    return Response({
        'message': 'Withdrawal cancelled and coins refunded',
        'withdrawal': _serialize_withdrawal(withdrawal),
        'new_balance': {
            'total': balance.balance,
            'earned': balance.earned_balance,
            'purchased': balance.purchased_balance,
            'telebirr_purchased': balance.telebirr_purchased_balance,
            'airtime_purchased': balance.airtime_purchased_balance,
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def public_wallet_config(request):
    """
    Returns public-safe configuration (rates, costs, packages) for frontend display.
    No sensitive admin info.
    """
    config = WalletConfig.get_config()

    try:
        packages = [
            {
                'id': p.id,
                'name': p.name,
                'price_etb': str(p.price_etb),
                'coin_amount': p.coin_amount,
                'bonus_coins': p.bonus_coins,
                'total_coins': p.get_total_coins(),
                'is_featured': p.is_featured,
                'allows_airtime': p.allows_airtime,
                'apple_product_id': p.apple_product_id,
            }
            for p in CoinPackage.objects.filter(is_active=True).order_by('sort_order', 'price_etb')
        ]
    except Exception:
        # Table may not exist yet - return default packages
        packages = [
            {'id': 1, 'name': 'Starter Pack', 'price_etb': '10.0', 'coin_amount': 100, 'bonus_coins': 0, 'total_coins': 100, 'is_featured': False, 'allows_airtime': True},
            {'id': 2, 'name': 'Good Value', 'price_etb': '50.0', 'coin_amount': 550, 'bonus_coins': 0, 'total_coins': 550, 'is_featured': False, 'allows_airtime': False},
            {'id': 3, 'name': 'Most Popular', 'price_etb': '100.0', 'coin_amount': 1150, 'bonus_coins': 0, 'total_coins': 1150, 'is_featured': True, 'allows_airtime': False},
            {'id': 4, 'name': 'Best Deal', 'price_etb': '500.0', 'coin_amount': 6000, 'bonus_coins': 0, 'total_coins': 6000, 'is_featured': False, 'allows_airtime': False},
            {'id': 5, 'name': 'Premium Package', 'price_etb': '1000.0', 'coin_amount': 13000, 'bonus_coins': 0, 'total_coins': 13000, 'is_featured': False, 'allows_airtime': False},
        ]

    return Response({
        'currency': 'ETB',
        'currency_label': 'Birr',
        'coins_per_birr': config.coins_per_birr,
        'points_per_birr': config.points_per_birr,
        'withdrawal_min_points': config.withdrawal_min_points,
        'withdrawal_max_points_per_request': config.withdrawal_max_points_per_request,
        'coins_to_points_conversion': config.coins_to_points_conversion,
        'rewards': {
            'welcome_bonus': config.welcome_bonus,
            'daily_post_bonus': config.daily_post_bonus,
            'campaign_join': config.campaign_join_reward,
            'receive_like': config.receive_like_reward,
            'campaign_winner': config.campaign_winner_reward,
            'referral': config.referral_reward,
        },
        'costs': {
            'post_create': config.cost_post_create,
            'like': config.cost_like,
            'comment': config.cost_comment,
            'share': config.cost_share,
            'gift': config.cost_gift,
            'join_campaign': config.cost_join_campaign,
            'extra_campaign_entry': config.cost_extra_campaign_entry,
            'boost_2hr': config.cost_boost_2hr,
            'boost_24hr': config.cost_boost_24hr,
        },
        'withdrawal': {
            'enabled': config.withdrawal_enabled,
            'min_coins': config.withdrawal_min_coins,
            'fee_percent': str(config.withdrawal_fee_percent),
            'processing_days': config.withdrawal_processing_days,
        },
        'gifting': {
            'earned_coins_giftable': config.earned_coins_giftable,
            'purchased_coins_giftable': config.purchased_coins_giftable,
            'min_points_per_transaction': config.gift_min_points_per_transaction,
            'max_points_per_transaction': config.gift_max_points_per_transaction,
            'max_points_to_recipient_per_day': config.gift_max_points_to_recipient_per_day,
            'max_total_points_sent_per_day': config.gift_max_total_points_sent_per_day,
        },
        'packages': packages,
    })


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

@api_view(['GET', 'PATCH'])
@permission_classes([IsAdminUser])
def admin_wallet_config(request):
    """Get or update wallet configuration (admin only)."""
    config = WalletConfig.get_config()

    if request.method == 'GET':
        return Response({'config': _serialize_full_config(config)})

    # PATCH
    editable_fields = [
        'welcome_bonus',
        'daily_login_day1', 'daily_login_day2', 'daily_login_day3', 'daily_login_day4',
        'daily_login_day5', 'daily_login_day6', 'daily_login_day7',
        'daily_post_bonus', 'campaign_join_reward', 'receive_like_reward',
        'receive_like_daily_cap', 'quality_comment_reward', 'quality_comment_daily_cap',
        'profile_complete_reward', 'referral_reward', 'campaign_winner_reward',
        'cost_post_create', 'cost_post_create_long_video', 'cost_like', 'cost_comment', 'cost_share', 'cost_gift', 'cost_join_campaign',
        'cost_extra_campaign_entry', 'cost_boost_1hr', 'cost_boost_2hr', 'cost_boost_24hr',
        'cost_trending_1hr', 'cost_trending_24hr',
        'cost_post_create_non_campaign', 'cost_post_create_long_video_non_campaign', 'cost_like_non_campaign', 'cost_comment_non_campaign',
        'cost_share_non_campaign', 'cost_gift_non_campaign', 'cost_boost_1hr_non_campaign',
        'cost_boost_2hr_non_campaign', 'cost_boost_24hr_non_campaign',
        'cost_trending_1hr_non_campaign', 'cost_trending_24hr_non_campaign',
        'min_balance_to_post', 'min_balance_to_join_campaign',
        'withdrawal_enabled', 'withdrawal_min_coins', 'withdrawal_max_coins_per_request',
        'coins_per_birr', 'withdrawal_fee_percent', 'withdrawal_processing_days',
        'earned_coins_giftable', 'purchased_coins_giftable',
        'earned_coins_withdrawable', 'purchased_coins_withdrawable',
        'earned_coins_expire_days',
        'coins_to_points_conversion',
        'points_per_birr',
        'withdrawal_min_points',
        'withdrawal_max_points_per_request',
        'daily_winner_points',
        'weekly_winner_points',
        'monthly_winner_points',
        'grand_finalist_points',
        'grand_winner_points',
        'gift_min_points_per_transaction',
        'gift_max_points_per_transaction',
        'gift_max_points_to_recipient_per_day',
        'gift_max_total_points_sent_per_day',
    ]
    
    print(f"[WALLET_CONFIG] Request data keys: {list(request.data.keys())}")
    print(f"[WALLET_CONFIG] Non-campaign fields in request: {[k for k in request.data.keys() if 'non_campaign' in k]}")
    
    for field in editable_fields:
        if field in request.data:
            value = request.data[field]
            print(f"[WALLET_CONFIG] Processing {field}={value} (type: {type(value).__name__})")
            if field in ('withdrawal_fee_percent',):
                value = Decimal(str(value))
            elif field.startswith(('earned_coins_', 'purchased_coins_', 'withdrawal_enabled')):
                if isinstance(value, str):
                    value = value.lower() in ('true', '1', 'yes', 'on')
            elif field.startswith('cost_') or field.startswith('daily_') or field.startswith('min_') or field.startswith('max_') or field.startswith('coins_per_') or field.startswith('points_per_') or field.startswith('withdrawal_') or field.startswith('gift_'):
                # Convert to integer for cost/points/withdrawal fields
                if isinstance(value, str):
                    try:
                        value = int(value)
                        print(f"[WALLET_CONFIG] Converted {field} to int: {value}")
                    except ValueError:
                        print(f"[WALLET_CONFIG] Failed to convert {field}={value} to int")
            print(f"[WALLET_CONFIG] Setting {field}={value} (type: {type(value).__name__})")
            setattr(config, field, value)

    config.updated_by = request.user
    config.save()

    return Response({
        'message': 'Wallet configuration updated',
        'config': _serialize_full_config(config),
    })


def _serialize_full_config(config):
    return {
        'rewards': {
            'welcome_bonus': config.welcome_bonus,
            'daily_login_day1': config.daily_login_day1,
            'daily_login_day2': config.daily_login_day2,
            'daily_login_day3': config.daily_login_day3,
            'daily_login_day4': config.daily_login_day4,
            'daily_login_day5': config.daily_login_day5,
            'daily_login_day6': config.daily_login_day6,
            'daily_login_day7': config.daily_login_day7,
            'daily_post_bonus': config.daily_post_bonus,
            'campaign_join_reward': config.campaign_join_reward,
            'receive_like_reward': config.receive_like_reward,
            'receive_like_daily_cap': config.receive_like_daily_cap,
            'quality_comment_reward': config.quality_comment_reward,
            'quality_comment_daily_cap': config.quality_comment_daily_cap,
            'profile_complete_reward': config.profile_complete_reward,
            'referral_reward': config.referral_reward,
            'campaign_winner_reward': config.campaign_winner_reward,
        },
        'costs': {
            'post_create': config.cost_post_create,
            'post_create_long_video': config.cost_post_create_long_video,
            'like': config.cost_like,
            'comment': config.cost_comment,
            'share': config.cost_share,
            'gift': config.cost_gift,
            'join_campaign': config.cost_join_campaign,
            'extra_campaign_entry': config.cost_extra_campaign_entry,
            'boost_1hr': config.cost_boost_1hr,
            'boost_2hr': config.cost_boost_2hr,
            'boost_24hr': config.cost_boost_24hr,
            'trending_1hr': config.cost_trending_1hr,
            'trending_24hr': config.cost_trending_24hr,
            'post_create_non_campaign': config.cost_post_create_non_campaign,
            'post_create_long_video_non_campaign': config.cost_post_create_long_video_non_campaign,
            'like_non_campaign': config.cost_like_non_campaign,
            'comment_non_campaign': config.cost_comment_non_campaign,
            'share_non_campaign': config.cost_share_non_campaign,
            'gift_non_campaign': config.cost_gift_non_campaign,
            'boost_1hr_non_campaign': config.cost_boost_1hr_non_campaign,
            'boost_2hr_non_campaign': config.cost_boost_2hr_non_campaign,
            'boost_24hr_non_campaign': config.cost_boost_24hr_non_campaign,
            'trending_1hr_non_campaign': config.cost_trending_1hr_non_campaign,
            'trending_24hr_non_campaign': config.cost_trending_24hr_non_campaign,
        },
        'thresholds': {
            'min_balance_to_post': config.min_balance_to_post,
            'min_balance_to_join_campaign': config.min_balance_to_join_campaign,
        },
        'withdrawal': {
            'enabled': config.withdrawal_enabled,
            'min_coins': config.withdrawal_min_coins,
            'max_coins_per_request': config.withdrawal_max_coins_per_request,
            'coins_per_birr': config.coins_per_birr,
            'fee_percent': str(config.withdrawal_fee_percent),
            'processing_days': config.withdrawal_processing_days,
        },
        'gifting': {
            'earned_coins_giftable': config.earned_coins_giftable,
            'purchased_coins_giftable': config.purchased_coins_giftable,
            'earned_coins_withdrawable': config.earned_coins_withdrawable,
            'purchased_coins_withdrawable': config.purchased_coins_withdrawable,
            'min_points_per_transaction': config.gift_min_points_per_transaction,
            'max_points_per_transaction': config.gift_max_points_per_transaction,
            'max_points_to_recipient_per_day': config.gift_max_points_to_recipient_per_day,
            'max_total_points_sent_per_day': config.gift_max_total_points_sent_per_day,
        },
        'expiry': {
            'earned_coins_expire_days': config.earned_coins_expire_days,
        },
        'points': {
            'coins_to_points_conversion': config.coins_to_points_conversion,
            'points_per_birr': config.points_per_birr,
            'withdrawal_min_points': config.withdrawal_min_points,
            'withdrawal_max_points_per_request': config.withdrawal_max_points_per_request,
            'daily_winner_points': config.daily_winner_points,
            'weekly_winner_points': config.weekly_winner_points,
            'monthly_winner_points': config.monthly_winner_points,
            'grand_finalist_points': config.grand_finalist_points,
            'grand_winner_points': config.grand_winner_points,
        },
        'updated_at': config.updated_at.isoformat() if config.updated_at else None,
        'updated_by': config.updated_by.username if config.updated_by_id else None,
    }


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_withdrawals_list(request):
    """List all withdrawal requests for admin review."""
    status_filter = request.query_params.get('status', '')
    date_from = request.query_params.get('date_from', '')
    date_to = request.query_params.get('date_to', '')
    search = request.query_params.get('search', '')
    
    qs = WithdrawalRequest.objects.select_related('user', 'reviewed_by').order_by('-created_at')
    
    if status_filter:
        qs = qs.filter(status=status_filter)
    if date_from:
        qs = qs.filter(created_at__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__lte=date_to)
    if search:
        qs = qs.filter(user__username__icontains=search)

    try:
        page = max(int(request.query_params.get('page', 1)), 1)
        page_size = min(max(int(request.query_params.get('page_size', 25)), 1), 100)
    except ValueError:
        page, page_size = 1, 25

    total = qs.count()
    start = (page - 1) * page_size
    end = start + page_size

    results = []
    for w in qs[start:end]:
        item = _serialize_withdrawal(w)
        item['user'] = {
            'id': w.user_id,
            'username': w.user.username,
            'email': w.user.email,
        }
        if w.reviewed_by_id:
            item['reviewed_by'] = w.reviewed_by.username
        results.append(item)

    summary = {
        'pending': WithdrawalRequest.objects.filter(status='pending').count(),
        'approved': WithdrawalRequest.objects.filter(status='approved').count(),
        'processing': WithdrawalRequest.objects.filter(status='processing').count(),
        'completed': WithdrawalRequest.objects.filter(status='completed').count(),
        'rejected': WithdrawalRequest.objects.filter(status='rejected').count(),
    }

    return Response({
        'count': total,
        'page': page,
        'page_size': page_size,
        'has_next': end < total,
        'summary': summary,
        'results': results,
    })


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_withdrawal_analytics(request):
    """Get withdrawal analytics for admin dashboard."""
    from django.db.models import Sum, Count, Avg, DecimalField
    from django.db.models.functions import Coalesce
    from decimal import Decimal
    
    try:
        # Overall statistics
        all_withdrawals = WithdrawalRequest.objects.all()
        
        total_gross = all_withdrawals.aggregate(
            total=Coalesce(Sum('gross_birr'), Decimal('0.00'))
        )['total'] or Decimal('0.00')
        
        # Try to get platform fee, but handle if field doesn't exist yet
        try:
            total_platform_fee = all_withdrawals.aggregate(
                total=Coalesce(Sum('platform_fee_birr'), Decimal('0.00'))
            )['total'] or Decimal('0.00')
        except Exception:
            # Fallback: calculate 20% of gross if field doesn't exist
            total_platform_fee = total_gross * Decimal('0.20')
        
        total_net = all_withdrawals.aggregate(
            total=Coalesce(Sum('net_birr'), Decimal('0.00'))
        )['total'] or Decimal('0.00')
        
        total_count = all_withdrawals.count()
        
        # Status counts
        completed_count = all_withdrawals.filter(status='completed').count()
        pending_count = all_withdrawals.filter(status='pending').count()
        failed_count = all_withdrawals.filter(status='failed').count()
        
        # Average withdrawal amount
        avg_withdrawal = all_withdrawals.filter(status='completed').aggregate(
            avg=Coalesce(Avg('net_birr'), Decimal('0.00'))
        )['avg'] or Decimal('0.00')
        
        return Response({
            'total_gross_birr': float(total_gross),
            'total_platform_fee_birr': float(total_platform_fee),
            'total_net_birr': float(total_net),
            'total_withdrawals': total_count,
            'completed_count': completed_count,
            'pending_count': pending_count,
            'failed_count': failed_count,
            'avg_withdrawal_birr': float(avg_withdrawal),
        })
    except Exception as e:
        logger.error(f"[Admin Withdrawal Analytics] Error: {str(e)}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_withdrawal_action(request, withdrawal_id):
    """
    Admin action on a withdrawal request.
    Body: { action: 'approve'|'reject'|'mark_processing'|'mark_completed', notes?, payout_reference? }
    """
    try:
        withdrawal = WithdrawalRequest.objects.get(id=withdrawal_id)
    except WithdrawalRequest.DoesNotExist:
        return Response({'error': 'Withdrawal not found'}, status=status.HTTP_404_NOT_FOUND)

    action = (request.data.get('action') or '').lower()
    notes = request.data.get('notes', '')
    payout_reference = request.data.get('payout_reference', '')

    if action == 'approve':
        if withdrawal.status != 'pending':
            return Response({'error': f'Cannot approve a {withdrawal.status} withdrawal'},
                            status=status.HTTP_400_BAD_REQUEST)
        withdrawal.status = 'approved'
        withdrawal.reviewed_at = timezone.now()
        withdrawal.reviewed_by = request.user
        if notes:
            withdrawal.admin_notes = notes
        withdrawal.save()

    elif action == 'reject':
        if withdrawal.status not in ('pending', 'approved'):
            return Response({'error': f'Cannot reject a {withdrawal.status} withdrawal'},
                            status=status.HTTP_400_BAD_REQUEST)
        withdrawal.mark_rejected(request.user, reason=notes)

    elif action == 'mark_processing':
        if withdrawal.status not in ('approved',):
            return Response({'error': f'Must be approved before processing'},
                            status=status.HTTP_400_BAD_REQUEST)
        withdrawal.status = 'processing'
        if notes:
            withdrawal.admin_notes = notes
        withdrawal.save()

    elif action == 'mark_completed':
        if withdrawal.status not in ('approved', 'processing'):
            return Response({'error': f'Must be approved/processing first'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not payout_reference:
            return Response({'error': 'payout_reference is required'},
                            status=status.HTTP_400_BAD_REQUEST)
        withdrawal.mark_completed(request.user, payout_reference=payout_reference)
        if notes:
            withdrawal.admin_notes = notes
            withdrawal.save()

    else:
        return Response({'error': 'Invalid action'}, status=status.HTTP_400_BAD_REQUEST)

    return Response({
        'message': f'Withdrawal {action} successful',
        'withdrawal': _serialize_withdrawal(withdrawal),
    })


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_user_wallet(request, user_id):
    """Get user wallet data (admin only)."""
    try:
        user = User.objects.get(id=user_id)
        balance = _get_or_create_balance(user)

        # Ensure user has a profile
        if not hasattr(user, 'profile'):
            from .models import UserProfile
            UserProfile.objects.get_or_create(user=user)
            user.refresh_from_db()

        return Response({
            'balance': {
                'total': balance.balance,
                'earned': balance.earned_balance,
                'purchased': balance.purchased_balance,
            },
            'points': {
                'current': user.profile.points if hasattr(user, 'profile') else 0,
                'earned_total': user.profile.points_earned_total if hasattr(user, 'profile') else 0,
                'withdrawn_total': user.profile.points_withdrawn_total if hasattr(user, 'profile') else 0,
            }
        })
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"[Admin Wallet] Error for user {user_id}: {str(e)}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_user_transactions(request):
    """Get user transaction history (admin only)."""
    user_id = request.query_params.get('user_id')
    if not user_id:
        return Response({'error': 'user_id parameter required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        user = User.objects.get(id=user_id)
        page_size = int(request.query_params.get('page_size', 20))
        
        transactions = CoinTransaction.objects.filter(user=user).order_by('-created_at')[:page_size]
        
        data = [{
            'id': tx.id,
            'transaction_type': tx.transaction_type,
            'type_display': TRANSACTION_DISPLAY.get(tx.transaction_type, tx.transaction_type),
            'coins': tx.coins if tx.coins is not None else 0,
            'is_credit': tx.coins > 0 if tx.coins is not None else False,
            'created_at': tx.created_at.isoformat() if tx.created_at else None,
            'description': tx.description or '',
            'fee_amount': float(tx.fee_amount) if tx.fee_amount else 0,
            'payment_method': tx.payment_method or '',
        } for tx in transactions]
        
        return Response({'results': data})
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        import logging
        logging.error(f"[Admin Transactions] Error for user {user_id}: {str(e)}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_all_coin_transactions(request):
    """Get all coin transactions (admin only). Optional ?type=purchase to filter by purchase type."""
    try:
        page_size = int(request.query_params.get('page_size', 50))
        # Limit page_size to prevent DoS via large queries
        if page_size > 500:
            page_size = 500
        tx_type = request.query_params.get('type')

        qs = CoinTransaction.objects.all().order_by('-created_at')
        if tx_type:
            qs = qs.filter(transaction_type=tx_type)

        transactions = qs[:page_size]

        data = []
        for tx in transactions:
            user_obj = tx.user
            phone = ''
            if user_obj and hasattr(user_obj, 'profile') and getattr(user_obj.profile, 'phone_number', None):
                # Mask phone number for PII protection
                phone_num = user_obj.profile.phone_number
                if phone_num and len(phone_num) >= 4:
                    phone = phone_num[:9] + '****'
                else:
                    phone = phone_num

            data.append({
                'id': tx.id,
                'transaction_type': tx.transaction_type,
                'type_display': TRANSACTION_DISPLAY.get(tx.transaction_type, tx.transaction_type),
                'coins': tx.coins if tx.coins is not None else 0,
                'is_credit': tx.coins > 0 if tx.coins is not None else False,
                'created_at': tx.created_at.isoformat() if tx.created_at else None,
                'description': tx.description or '',
                'fee_amount': float(tx.fee_amount) if tx.fee_amount else 0,
                'payment_method': tx.payment_method or '',
                'user': user_obj.username if user_obj else 'N/A',
                'user_id': user_obj.id if user_obj else None,
                'email': user_obj.email if user_obj else '',
                'phone': phone,
            })

        return Response({'results': data, 'count': len(data)})
    except Exception as e:
        import logging
        logging.error(f"[Admin All Transactions] Error: {str(e)}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_adjust_balance(request):
    """
    Manually credit or debit a user's wallet (admin only).
    Body: { user_id, amount (positive or negative), bucket: 'earned'|'purchased'|'points', reason }
    """
    try:
        user_id = int(request.data.get('user_id'))
        amount = int(request.data.get('amount'))
    except (TypeError, ValueError):
        return Response({'error': 'Invalid user_id or amount'}, status=status.HTTP_400_BAD_REQUEST)

    bucket = request.data.get('bucket', 'earned')
    reason = request.data.get('reason', 'Admin adjustment')

    if bucket not in ('earned', 'purchased', 'points'):
        return Response({'error': 'bucket must be earned, purchased, or points'}, status=status.HTTP_400_BAD_REQUEST)

    # Add amount limits to prevent abuse
    MAX_ADJUSTMENT = 1000000  # Maximum single adjustment
    if abs(amount) > MAX_ADJUSTMENT:
        return Response({'error': f'Amount exceeds maximum allowed adjustment of {MAX_ADJUSTMENT}'}, 
                       status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    # Check if user is active
    if not user.is_active:
        return Response({'error': 'Cannot adjust balance for inactive user'}, 
                       status=status.HTTP_400_BAD_REQUEST)

    # Use transaction with row-level lock to prevent race conditions
    from django.db import transaction
    with transaction.atomic():
        # Handle points adjustment
        if bucket == 'points':
            profile = UserProfile.objects.select_for_update().get(user=user)
            if amount >= 0:
                profile.points += amount
                profile.points_earned_total += amount
            else:
                deduct = abs(amount)
                if profile.points < deduct:
                    return Response({'error': 'Insufficient points to deduct'},
                                    status=status.HTTP_400_BAD_REQUEST)
                profile.points -= deduct
                profile.points_withdrawn_total += deduct
            profile.save()
            
            # Log the adjustment for audit trail using helper
            from .models_admin import SystemLog
            SystemLog.objects.create(
                log_type='admin_action',
                message=f'Admin adjusted points for user {user.username} by {amount}',
                user=request.user,
                details={
                    'ip': request.META.get('REMOTE_ADDR'),
                    'user_agent': request.META.get('HTTP_USER_AGENT', '')[:200],
                    'target_user_id': user_id,
                    'target_username': user.username,
                    'target_email': user.email or '',
                    'action': 'balance_adjustment',
                    'amount': amount,
                    'bucket': bucket,
                    'reason': reason,
                }
            )
            
            return Response({
                'message': f'Adjusted {user.username}\'s points by {amount}',
                'new_points': profile.points,
            })

        # Handle coin balance adjustment
        balance = _get_or_create_balance(user)
        # Lock the balance row
        balance = UserCoinBalance.objects.select_for_update().get(id=balance.id)

        if amount >= 0:
            if bucket == 'earned':
                balance.add_earned(amount, transaction_type='admin_adjustment', description=reason)
            else:
                balance.add_purchased(amount, transaction_type='admin_adjustment', description=reason)
        else:
            # Debit
            deduct = abs(amount)
            if bucket == 'earned':
                if balance.earned_balance < deduct:
                    return Response({'error': 'Insufficient earned balance to deduct'},
                                    status=status.HTTP_400_BAD_REQUEST)
                balance.earned_balance -= deduct
            else:
                if balance.purchased_balance < deduct:
                    return Response({'error': 'Insufficient purchased balance to deduct'},
                                    status=status.HTTP_400_BAD_REQUEST)
                balance.purchased_balance -= deduct
            balance.total_spent += deduct
            balance._sync_balance()
            balance.save()
            CoinTransaction.objects.create(
                user=user,
                transaction_type='admin_adjustment',
                coins=-deduct,
                description=reason,
            )

        # Log the adjustment for audit trail with full details
        from .models_admin import SystemLog
        SystemLog.objects.create(
            log_type='admin_action',
            message=f'Admin adjusted {bucket} balance for user {user.username} by {amount}',
            user=request.user,
            details={
                'ip': request.META.get('REMOTE_ADDR'),
                'user_agent': request.META.get('HTTP_USER_AGENT', '')[:200],
                'target_user_id': user_id,
                'target_username': user.username,
                'target_email': user.email or '',
                'action': 'balance_adjustment',
                'amount': amount,
                'bucket': bucket,
                'reason': reason,
            }
        )

    return Response({
        'message': f'Adjusted {user.username}\'s {bucket} balance by {amount}',
        'new_balance': {
            'total': balance.balance,
            'earned': balance.earned_balance,
            'purchased': balance.purchased_balance,
        },
    })


# ---------------------------------------------------------------------------
# Telebirr Payment Integration
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def telebirr_initiate_payment(request):
    """
    Create a Telebirr H5 (InApp) prepaid order for a coin purchase.

    Body: { package_id }
    Returns a signed `raw_request` string that the H5 page must hand to the
    SuperApp via window.consumerapp.evaluate(js_fun_start_pay).
    """
    package_id = request.data.get('package_id')

    if not package_id:
        return Response({'error': 'package_id is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        package = CoinPackage.objects.get(id=package_id, is_active=True)
    except CoinPackage.DoesNotExist:
        return Response({'error': 'Package not found or inactive'}, status=status.HTTP_404_NOT_FOUND)

    total_amount = '{:.2f}'.format(float(package.price_etb))

    # Create the prepaid order with Telebirr (applyFabricToken -> preOrder).
    # Use create_order_ondemand for coin purchases (without payee fields).
    result = telebirr_service.create_order_ondemand(
        title=package.name,
        amount=total_amount,
        trade_type='InApp',
    )

    if not result.get('success'):
        return Response({
            'error': result.get('error', 'Payment initiation failed'),
            'details': result,
        }, status=status.HTTP_400_BAD_REQUEST)

    merch_order_id = result.get('merch_order_id')

    # Record a pending transaction keyed by merch_order_id so the async
    # notify/queryOrder can resolve it later.
    CoinTransaction.objects.create(
        user=request.user,
        transaction_type='purchase',
        coins=0,  # credited after payment confirmation
        payment_method='telebirr',
        payment_reference=merch_order_id,
        package=package,
        description=f'Pending Telebirr H5 payment for {package.name}',
        is_successful=False,
    )

    return Response({
        'success': True,
        'raw_request': result.get('raw_request'),
        'merch_order_id': merch_order_id,
        'prepay_id': result.get('prepay_id'),
        'amount': total_amount,
        'package': {
            'id': package.id,
            'name': package.name,
            'coin_amount': package.coin_amount,
            'bonus_coins': package.bonus_coins,
            'total_coins': package.get_total_coins(),
        },
        'message': 'Order created. Call js_fun_start_pay with raw_request.',
    })


def _credit_telebirr_order(merch_order_id, payment_order_id=None):
    """
    Idempotently credit coins for a completed Telebirr order.
    Returns (handled: bool, coins_added: int).
    """
    logger.info(f'[TELEBIRR] Attempting to credit order: merch_order_id={merch_order_id}, payment_order_id={payment_order_id}')
    try:
        transaction = CoinTransaction.objects.get(
            payment_reference=merch_order_id,
            payment_method='telebirr',
            is_successful=False,
        )
    except CoinTransaction.DoesNotExist:
        logger.warning(f'[TELEBIRR] No pending transaction found for merch_order_id={merch_order_id}')
        return False, 0

    package = transaction.package
    total_coins = package.get_total_coins() if package else 0

    logger.info(f'[TELEBIRR] Crediting {total_coins} coins to user {transaction.user.username} for order {merch_order_id}')
    # NOTE: Credit balance buckets directly instead of via balance.add_purchased(),
    # which also creates a brand new CoinTransaction row. We already have the
    # original pending `transaction` row to finalize below, so calling
    # add_purchased() here would create a duplicate CoinTransaction row for the
    # same real-world payment (correct total coins, but duplicated history).
    balance = _get_or_create_balance(transaction.user)
    balance.telebirr_purchased_balance = (balance.telebirr_purchased_balance or 0) + total_coins
    balance.total_telebirr_purchased = (balance.total_telebirr_purchased or 0) + total_coins
    balance.total_purchased = (balance.total_purchased or 0) + total_coins
    balance._sync_balance()
    balance.save(update_fields=[
        'telebirr_purchased_balance', 'purchased_balance', 'balance',
        'total_purchased', 'total_telebirr_purchased', 'updated_at'
    ])

    transaction.coins = total_coins
    transaction.is_successful = True
    transaction.payment_reference = payment_order_id or merch_order_id
    transaction.description = f'Successful Telebirr payment for {package.name if package else "Unknown"}'
    transaction.save()
    return True, total_coins


@api_view(['POST'])
@permission_classes([AllowAny])  # Telebirr calls this without authentication
def telebirr_callback(request):
    """
    Handle the Telebirr async payment notification (notify_url webhook).
    Verifies the SP signature, then credits coins on a Completed payment.
    """
    logger.info(f'[TELEBIRR CALLBACK] Received callback: {request.data}')
    notify = telebirr_service.verify_notify(request.data)

    if not notify.get('verified'):
        logger.error(f'[TELEBIRR CALLBACK] Invalid signature for callback: {request.data}')
        return Response({'error': 'Invalid signature'}, status=status.HTTP_400_BAD_REQUEST)

    merch_order_id = notify.get('merch_order_id')
    if not merch_order_id:
        logger.error(f'[TELEBIRR CALLBACK] Missing merch_order_id in callback')
        return Response({'error': 'Missing merch_order_id'}, status=status.HTTP_400_BAD_REQUEST)

    logger.info(f'[TELEBIRR CALLBACK] Processing callback for merch_order_id={merch_order_id}, is_paid={notify.get("is_paid")}, trade_status={notify.get("trade_status")}')

    # Check if this is a subscription order (starts with SUB)
    if merch_order_id.startswith('SUB'):
        logger.info(f'[TELEBIRR CALLBACK] Subscription order detected, delegating to subscription callback')
        # Import here to avoid circular dependency
        from .views_subscription import telebirr_one_time_callback
        return telebirr_one_time_callback(request)

    if not notify.get('is_paid'):
        # Mark the pending transaction as failed (best effort).
        CoinTransaction.objects.filter(
            payment_reference=merch_order_id,
            payment_method='telebirr',
            is_successful=False,
        ).update(description=f'Failed Telebirr payment: {notify.get("trade_status")}')
        logger.warning(f'[TELEBIRR CALLBACK] Payment not paid, marked as failed: {notify.get("trade_status")}')
        return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'received'})

    handled, coins_added = _credit_telebirr_order(
        merch_order_id, payment_order_id=notify.get('payment_order_id')
    )

    if not handled:
        # Either unknown order or already processed (idempotent OK).
        logger.info(f'[TELEBIRR CALLBACK] Order already processed or not found: {merch_order_id}')
        return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'already processed'})

    return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'success',
                     'coins_added': coins_added})


@api_view(['POST'])
@permission_classes([AllowAny])
def client_log(request):
    """
    Client-side logging endpoint.
    Accepts logs from frontend and writes them to server logs for visibility in production.
    Body: { level: 'info'|'error'|'warn', message: string, context: object }
    """
    import logging
    logger = logging.getLogger(__name__)

    level = request.data.get('level', 'info')
    message = request.data.get('message', '')
    context = request.data.get('context', {})

    log_message = f'[CLIENT_LOG] {message}'
    if context:
        log_message += f' | Context: {context}'

    if level == 'error':
        logger.error(log_message)
    elif level == 'warn':
        logger.warning(log_message)
    else:
        logger.info(log_message)

    return Response({'status': 'logged'})


@api_view(['POST'])
@permission_classes([AllowAny])
def telebirr_auth(request):
    """
    Telebirr SuperApp auto-login endpoint.

    Accepts an access_token from the SuperApp, exchanges it for user info,
    and logs in or creates a user account based on the phone number.

    Request body:
        { "access_token": "token_from_superapp" }

    Response:
        { "user": {...}, "token": "drf_token_key" } on success
        { "error": "..." } on failure
    """
    import logging
    logger = logging.getLogger(__name__)

    access_token = request.data.get('access_token')
    logger.info('[TELEBIRR_AUTH] Request received. access_token: %s...', access_token[:20] if access_token else 'None')

    if not access_token:
        logger.error('[TELEBIRR_AUTH] Missing access_token')
        return Response({'error': 'access_token is required'}, status=status.HTTP_400_BAD_REQUEST)

    # Get user info from Telebirr
    logger.info('[TELEBIRR_AUTH] Calling Telebirr request_auth_token...')
    auth_result = telebirr_service.request_auth_token(access_token)
    logger.info('[TELEBIRR_AUTH] Telebirr response: success=%s, raw=%s', auth_result.get('success'), auth_result.get('raw'))
    
    # Log all fields from Telebirr response for debugging
    logger.info('[TELEBIRR_AUTH] Telebirr response fields: open_id=%s, identityId=%s, identifier=%s, nickName=%s, status=%s',
                 auth_result.get('open_id'), auth_result.get('identityId'), auth_result.get('identifier'),
                 auth_result.get('nickName'), auth_result.get('status'))

    if not auth_result.get('success'):
        logger.error('[TELEBIRR_AUTH] Failed to get user info from Telebirr: %s', auth_result.get('error'))
        return Response({'error': auth_result.get('error', 'Failed to get user info from Telebirr')},
                        status=status.HTTP_400_BAD_REQUEST)

    # Extract phone number (identifier) from Telebirr response
    phone_number = auth_result.get('identifier')
    logger.info('[TELEBIRR_AUTH] Phone number from Telebirr (identifier field): %s', phone_number)

    if not phone_number:
        logger.error('[TELEBIRR_AUTH] No phone number in Telebirr response - identifier field is None or empty')
        logger.error('[TELEBIRR_AUTH] Full auth_result: %s', auth_result)
        return Response({'error': 'No phone number returned from Telebirr'},
                        status=status.HTTP_400_BAD_REQUEST)

    # Clean phone number (remove any non-digit characters)
    phone_number = ''.join(filter(str.isdigit, phone_number))
    logger.info('[TELEBIRR_AUTH] Cleaned phone number: %s', phone_number)

    # Build phone number variants for lookup (handle different formats)
    phone_variants = {phone_number}
    if phone_number.startswith('251'):
        phone_variants.add('0' + phone_number[3:])
    elif phone_number.startswith('0'):
        phone_variants.add('251' + phone_number[1:])
    logger.info('[TELEBIRR_AUTH] Phone variants for lookup: %s', phone_variants)

    # Try to find existing user by phone number
    # Only auto-login if user is already registered with this phone number
    user = None
    logger.info('[TELEBIRR_AUTH] Looking up user by phone number variants: %s', phone_variants)
    try:
        profile = UserProfile.objects.filter(phone_number__in=phone_variants).first()
        if profile:
            try:
                user = profile.user
                logger.info('[TELEBIRR_AUTH] EXISTING USER FOUND: id=%s, username=%s, profile_phone=%s, lookup_phone=%s',
                            user.id, user.username, profile.phone_number, phone_number)
            except User.DoesNotExist:
                # Orphaned profile (user was deleted but profile remains)
                logger.warning('[TELEBIRR_AUTH] Orphaned profile found for phone %s - deleting and treating as new user', phone_number)
                profile.delete()
                raise UserProfile.DoesNotExist()
        else:
            logger.info('[TELEBIRR_AUTH] No profile found for phone variants - this is a NEW phone number')
            raise UserProfile.DoesNotExist()
    except UserProfile.DoesNotExist:
        # User doesn't exist - create minimal account for SuperApp new user onboarding
        logger.warning('[TELEBIRR_AUTH] NEW PHONE NUMBER DETECTED: %s - creating minimal account for SuperApp onboarding', phone_number)
        
        # Create or get User account (handle orphaned users from previous failed attempts)
        username = phone_number  # Use phone number as username
        user, user_created = User.objects.get_or_create(username=username)
        if user_created:
            logger.info('[TELEBIRR_AUTH] Created new user: id=%s, username=%s', user.id, user.username)
        else:
            logger.info('[TELEBIRR_AUTH] Found existing user (orphaned from previous attempt): id=%s, username=%s', user.id, user.username)
        
        # Create or get UserProfile (handle orphaned profiles from previous failed attempts)
        profile, profile_created = UserProfile.objects.get_or_create(
            user=user,
            defaults={'phone_number': phone_number}
        )
        if profile_created:
            logger.info('[TELEBIRR_AUTH] Created profile for user: user_id=%s, phone=%s', user.id, profile.phone_number)
        else:
            # Profile exists but may have null phone_number from previous failed attempt
            if not profile.phone_number:
                profile.phone_number = phone_number
                profile.save()
                logger.info('[TELEBIRR_AUTH] Updated null phone_number for existing profile: user_id=%s, phone=%s', user.id, profile.phone_number)
            else:
                logger.info('[TELEBIRR_AUTH] Found existing profile for user: user_id=%s, phone=%s', user.id, profile.phone_number)
        
        # Create or get UserCoinBalance (handle orphaned balances from previous failed attempts)
        from .models_contest import UserCoinBalance
        balance, balance_created = UserCoinBalance.objects.get_or_create(user=user)
        if balance_created:
            logger.info('[TELEBIRR_AUTH] Created UserCoinBalance for user: user_id=%s', user.id)
        else:
            logger.info('[TELEBIRR_AUTH] Found existing UserCoinBalance for user: user_id=%s', user.id)
        
        # Generate token for the new user
        token, _ = Token.objects.get_or_create(user=user)
        logger.info('[TELEBIRR_AUTH] Token generated for new user: %s...', token.key[:10])
        
        # Return user info and token, but still indicate subscription is required
        from .serializers import UserSerializer
        return Response({
            'user': UserSerializer(user).data,
            'token': token.key,
            'telebirr_info': {
                'open_id': auth_result.get('open_id'),
                'identityId': auth_result.get('identityId'),
                'identifier': auth_result.get('identifier'),
                'nickName': auth_result.get('nickName'),
            },
            'requires_subscription': True,  # Still redirect to subscription page
            'phone_number': phone_number,
            'is_new_user': True  # Flag for frontend to handle new user flow
        }, status=status.HTTP_401_UNAUTHORIZED)

    # Generate or get existing token
    token, _ = Token.objects.get_or_create(user=user)
    logger.info('[TELEBIRR_AUTH] Token generated: %s...', token.key[:10])

    # Return user info and token
    from .serializers import UserSerializer
    response_data = {
        'user': UserSerializer(user).data,
        'token': token.key,
        'telebirr_info': {
            'open_id': auth_result.get('open_id'),
            'identityId': auth_result.get('identityId'),
            'identifier': auth_result.get('identifier'),  # Phone number for SuperApp
            'nickName': auth_result.get('nickName'),
        }
    }
    logger.info('[TELEBIRR_AUTH] Auto-login successful for user %s', user.username)
    return Response(response_data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def telebirr_query_order(request):
    """
    Query a Telebirr order's status and credit coins if paid.
    Used as a fallback when the async notify was not received.
    Query param: ?merch_order_id=<id>
    """
    merch_order_id = request.query_params.get('merch_order_id')
    if not merch_order_id:
        return Response({'error': 'merch_order_id is required'}, status=status.HTTP_400_BAD_REQUEST)

    logger.info(f'[TELEBIRR QUERY] Querying order status for merch_order_id={merch_order_id}')
    result = telebirr_service.query_order(merch_order_id)
    if not result.get('success'):
        logger.error(f'[TELEBIRR QUERY] Query failed for merch_order_id={merch_order_id}: {result}')
        return Response({'error': result.get('error', 'Query failed'), 'details': result},
                        status=status.HTTP_400_BAD_REQUEST)

    logger.info(f'[TELEBIRR QUERY] Order status: is_paid={result.get("is_paid")}, trade_status={result.get("trade_status")}, order_status={result.get("order_status")}')

    coins_added = 0
    if result.get('is_paid'):
        _, coins_added = _credit_telebirr_order(
            merch_order_id, payment_order_id=result.get('payment_order_id')
        )

    return Response({
        'success': True,
        'is_paid': result.get('is_paid'),
        'trade_status': result.get('trade_status'),
        'order_status': result.get('order_status'),
        'merch_order_id': merch_order_id,
        'payment_order_id': result.get('payment_order_id'),
        'coins_added': coins_added,
    })


# ---------------------------------------------------------------------------
# USSD Push Coin Purchase (BuyGoodsForCustomer)
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def telebirr_ussd_purchase(request):
    """
    Initiate USSD Push payment for coin purchase using BuyGoodsForCustomer.
    
    Request Body:
    {
        "package_id": 1
    }
    
    Returns:
    {
        "success": true,
        "originator_conversation_id": "S_X20260804...",
        "conversation_id": "AG_20260804_...",
        "message": "Accept the service request successfully."
    }
    """
    from .telebirr_direct_debit_service import telebirr_direct_debit_service
    from .models_contest import CoinPackage
    
    package_id = request.data.get('package_id')
    
    if not package_id:
        return Response({'error': 'package_id is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        package = CoinPackage.objects.get(id=package_id, is_active=True)
    except CoinPackage.DoesNotExist:
        return Response({'error': 'Package not found or inactive'}, status=status.HTTP_404_NOT_FOUND)
    
    # Get user's phone number from profile
    try:
        profile = request.user.profile
        phone_number = profile.phone_number
        if not phone_number:
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
    normalized_phone = _normalize_ethiopian_phone(phone_number)
    if normalized_phone:
        phone_number = normalized_phone
        logger.info(f"[USSD PURCHASE] Normalized phone number: {phone_number}")
    else:
        logger.warning(f"[USSD PURCHASE] Could not normalize phone number: {phone_number}")
    
    # Calculate amount
    amount = '{:.2f}'.format(float(package.price_etb))
    coins = package.get_total_coins()
    
    # Initiate USSD Push payment
    result = telebirr_direct_debit_service.initiate_ussd_push_payment(
        amount=amount,
        phone_number=phone_number,
        coins=coins
    )
    
    if not result.get('success'):
        return Response({
            'error': result.get('error', 'USSD Push payment initiation failed'),
            'details': result
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    # Create pending transaction record
    CoinTransaction.objects.create(
        user=request.user,
        transaction_type='purchase',
        coins=0,  # credited after payment confirmation
        payment_method='telebirr_ussd',
        payment_reference=result.get('originator_conversation_id'),
        package=package,
        description=f'Pending USSD Push payment for {package.name}',
        is_successful=False,
    )
    
    return Response({
        'success': True,
        'originator_conversation_id': result.get('originator_conversation_id'),
        'conversation_id': result.get('conversation_id'),
        'message': result.get('message'),
        'package': {
            'id': package.id,
            'name': package.name,
            'coin_amount': package.coin_amount,
            'bonus_coins': package.bonus_coins,
            'total_coins': coins,
        },
    })


@api_view(['POST'])
@permission_classes([AllowAny])  # Telebirr calls this without authentication
def telebirr_ussd_webhook(request):
    """
    Handle USSD Push payment result webhook from Telebirr.
    
    Receives SOAP Result envelope with payment completion status.
    Credits coins on successful payment.
    """
    from .telebirr_direct_debit_service import telebirr_direct_debit_service
    import xml.etree.ElementTree as ET
    
    # NOTE: Telebirr's SOAP client (Axis2) POSTs with Content-Type: text/xml.
    # Accessing request.data here would trigger DRF's parser negotiation and
    # raise 415 Unsupported Media Type before we even get a chance to parse
    # the XML ourselves. Use the raw body instead (same fix as
    # telebirr_direct_debit_webhook in views_direct_debit.py).
    raw_body = request.body or b''
    logger.info(f"[USSD WEBHOOK] Received callback. Content-Type: {request.META.get('CONTENT_TYPE')}, Body: {raw_body[:2000]}")
    
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
        
        logger.info(f"[USSD WEBHOOK] Parsed result: originator={originator_conversation_id}, conversation={conversation_id}, result_code={result_code}, result_type={result_type}, transaction_id={transaction_id}")
        
        # Determine success
        is_success = result_code == '0' and result_type == '0'
        
        if not is_success:
            logger.warning(f"[USSD WEBHOOK] Payment failed: {result_desc}")
            # Mark pending transaction as failed
            CoinTransaction.objects.filter(
                payment_reference=originator_conversation_id,
                payment_method='telebirr_ussd',
                is_successful=False,
            ).update(description=f'Failed USSD Push payment: {result_desc}')
            return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'received'})
        
        # Credit coins on success
        try:
            transaction = CoinTransaction.objects.get(
                payment_reference=originator_conversation_id,
                payment_method='telebirr_ussd',
                is_successful=False,
            )
        except CoinTransaction.DoesNotExist:
            logger.warning(f"[USSD WEBHOOK] No pending transaction found for originator_conversation_id={originator_conversation_id}")
            return Response({'result': 'SUCCESS', 'code': '0', 'msg': 'transaction not found'})
        
        package = transaction.package
        total_coins = package.get_total_coins() if package else 0
        
        logger.info(f"[USSD WEBHOOK] Crediting {total_coins} coins to user {transaction.user.username} for order {originator_conversation_id}")
        
        # NOTE: We credit the balance buckets directly here instead of calling
        # balance.add_purchased() because add_purchased() ALSO creates a brand
        # new CoinTransaction row. Since we already have the original pending
        # `transaction` row (created at initiate time) that we're about to
        # finalize below, calling add_purchased() would create a SECOND,
        # duplicate CoinTransaction row for the same real-world payment
        # (correct total coin balance, but misleading/duplicated transaction
        # history). Update the balance fields directly and keep a single row.
        balance = _get_or_create_balance(transaction.user)
        balance.telebirr_purchased_balance = (balance.telebirr_purchased_balance or 0) + total_coins
        balance.total_telebirr_purchased = (balance.total_telebirr_purchased or 0) + total_coins
        balance.total_purchased = (balance.total_purchased or 0) + total_coins
        balance._sync_balance()
        balance.save(update_fields=[
            'telebirr_purchased_balance', 'purchased_balance', 'balance',
            'total_purchased', 'total_telebirr_purchased', 'updated_at'
        ])
        
        transaction.coins = total_coins
        transaction.is_successful = True
        transaction.payment_reference = transaction_id or originator_conversation_id
        transaction.description = f'Successful USSD Push payment for {package.name if package else "Unknown"}'
        transaction.save()
        
        logger.info(f"[USSD WEBHOOK] Successfully credited {total_coins} coins")
        
        return Response({
            'result': 'SUCCESS',
            'code': '0',
            'msg': 'success',
            'coins_added': total_coins
        })
        
    except Exception as e:
        logger.error(f"[USSD WEBHOOK] Exception: {str(e)}")
        return Response({'result': 'ERROR', 'code': '1', 'msg': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# Apple In-App Purchase (StoreKit) - Coin Purchase Receipt Verification
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def apple_verify_coin_purchase(request):
    """
    Verify an Apple StoreKit receipt for a coin package purchase and credit coins.

    Request Body:
    {
        "package_id": 1,
        "receipt_data": "<base64 receipt from react-native-iap>",
        "product_id": "com.flipstar.coins.100"   # Apple product ID, for cross-check
    }

    Returns:
    {
        "success": true,
        "coins_added": 110,
        "balance": { ... }
    }
    """
    package_id = request.data.get('package_id')
    receipt_data = request.data.get('receipt_data')
    apple_product_id = request.data.get('product_id')

    if not package_id or not receipt_data:
        return Response({'error': 'package_id and receipt_data are required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        package = CoinPackage.objects.get(id=package_id, is_active=True)
    except CoinPackage.DoesNotExist:
        return Response({'error': 'Package not found or inactive'}, status=status.HTTP_404_NOT_FOUND)

    expected_product_id = apple_product_id or package.apple_product_id
    if not expected_product_id:
        return Response({'error': 'This package has no Apple product ID configured'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        verified = apple_iap_service.verify_receipt(receipt_data)
        txn = apple_iap_service.extract_latest_transaction(verified, expected_product_id=expected_product_id)
    except apple_iap_service.AppleIAPError as e:
        logger.warning(f"[APPLE IAP] Coin purchase receipt verification failed: {e}")
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    transaction_id = txn.get('transaction_id')
    if not transaction_id:
        return Response({'error': 'Receipt is missing a transaction_id'}, status=status.HTTP_400_BAD_REQUEST)

    # Idempotency: never credit the same Apple transaction twice.
    existing = AppleIAPTransaction.objects.filter(transaction_id=transaction_id).first()
    if existing:
        balance = _get_or_create_balance(request.user)
        return Response({
            'success': True,
            'already_processed': True,
            'coins_added': 0,
            'balance': {
                'balance': balance.balance,
                'purchased_balance': balance.purchased_balance,
                'earned_balance': balance.earned_balance,
            },
        })

    total_coins = package.get_total_coins()
    balance = _get_or_create_balance(request.user)
    balance.add_purchased(
        total_coins,
        payment_method='apple',
        package=package,
        payment_reference=transaction_id,
        description=f'Apple In-App Purchase: {package.name}',
        is_successful=True,
    )

    AppleIAPTransaction.objects.create(
        user=request.user,
        product_type='coins',
        apple_product_id=expected_product_id,
        transaction_id=transaction_id,
        original_transaction_id=txn.get('original_transaction_id'),
        reference_id=str(package.id),
        raw_receipt_response=txn,
    )

    balance.refresh_from_db()
    logger.info(f"[APPLE IAP] Credited {total_coins} coins to {request.user.username} for {expected_product_id}")

    return Response({
        'success': True,
        'coins_added': total_coins,
        'balance': {
            'balance': balance.balance,
            'purchased_balance': balance.purchased_balance,
            'earned_balance': balance.earned_balance,
        },
    })
