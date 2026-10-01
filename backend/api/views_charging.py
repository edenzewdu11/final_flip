"""Onevas charging API views for on-demand subscription purchases"""
from django.contrib.auth.models import User
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
from django.db.models import Count, Sum, Q, F
from django.conf import settings
from datetime import timedelta, datetime

from .models_subscription import SubscriptionTier, OnevasChargingTransaction, SubscriptionPlan
from .models_contest import UserCoinBalance, CoinTransaction
from .onevas_charging_service import onevas_charging_service
import logging

logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def initiate_on_demand_charging(request):
    """
    Initiate on-demand charging for subscription purchase via Onevas
    
    Request body:
    - phone_number: User's phone number
    - subscription_tier_id: Subscription tier to purchase
    """
    try:
        phone_number = request.data.get('phone_number')
        subscription_tier_id = request.data.get('subscription_tier_id')
        
        if not phone_number or not subscription_tier_id:
            return Response(
                {'error': 'phone_number and subscription_tier_id are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get subscription tier
        try:
            tier = SubscriptionTier.objects.get(id=subscription_tier_id)
        except SubscriptionTier.DoesNotExist:
            return Response(
                {'error': 'Subscription tier not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Normalize phone number
        phone_number = phone_number.replace(' ', '').replace('-', '').replace('+', '')
        if not phone_number.startswith('251'):
            phone_number = '251' + phone_number[1:]
        
        # Get Onevas credentials from settings
        product_number = getattr(settings, 'ONEVAS_CHARGING_PRODUCT_NUMBER', '10000302853')
        application_key = getattr(settings, 'ONEVAS_CHARGING_APPLICATION_KEY', '4CROFBT0EGCM1OK8R88EQBTEZOMI3138')
        
        # Initiate charging via Onevas
        charging_response = onevas_charging_service.initiate_charging(
            phone_number=phone_number,
            product_number=product_number,
            application_key=application_key
        )
        
        # Parse response
        charging_status, error_message = onevas_charging_service.parse_charging_response(charging_response)
        
        # Create charging transaction record
        transaction = OnevasChargingTransaction.objects.create(
            user=request.user,
            phone_number=phone_number,
            product_number=product_number,
            application_key=application_key,
            subscription_tier=tier,
            amount_etb=tier.price,
            status=charging_status,
            transaction_id=charging_response.get('data', {}).get('transaction_id', ''),
            response_status=charging_response.get('status_code'),
            response_body=charging_response.get('data'),
            error_message=error_message or ''
        )
        
        if charging_status == 'success':
            # Activate subscription
            from .models_subscription import SubscriptionPayment, SubscriptionHistory
            subscription_payment = SubscriptionPayment.objects.create(
                user=request.user,
                subscription_tier=tier,
                amount=tier.price,
                payment_method='airtime',
                payment_reference=transaction.transaction_id,
                status='completed'
            )
            
            # Create subscription history
            SubscriptionHistory.objects.create(
                user=request.user,
                subscription_tier=tier,
                start_date=timezone.now(),
                end_date=timezone.now() + timedelta(days=tier.duration_days),
                payment=subscription_payment
            )
            
            return Response({
                'success': True,
                'message': 'Subscription activated successfully',
                'transaction_id': transaction.transaction_id,
                'subscription_tier': tier.name
            })
        else:
            return Response({
                'success': False,
                'error': error_message or 'Charging failed',
                'transaction_id': transaction.transaction_id
            }, status=status.HTTP_400_BAD_REQUEST)
            
    except Exception as e:
        logger.error(f"[On-Demand Charging] Error: {str(e)}")
        return Response(
            {'error': 'Internal server error', 'message': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_charging_statistics(request):
    """
    Get charging statistics (admin only) - queries CoinTransaction for on-demand airtime purchases
    
    Query params:
    - days: number of days to look back (default: 3650 = 10 years to show all)
    """
    try:
        # Check if user is admin
        if not request.user.is_staff:
            return Response(
                {'error': 'Admin access required'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        days = int(request.GET.get('days', 3650))  # Default to 10 years to show all
        start_date = timezone.now() - timedelta(days=days)
        
        # Query CoinTransaction for on-demand airtime purchases
        base_filter = Q(transaction_type='purchase') & Q(payment_method='airtime') & Q(created_at__gte=start_date)
        
        # Get statistics
        total_transactions = CoinTransaction.objects.filter(base_filter).count()
        
        successful_transactions = CoinTransaction.objects.filter(base_filter & Q(is_successful=True)).count()
        
        failed_transactions = CoinTransaction.objects.filter(base_filter & Q(is_successful=False)).count()
        
        # Calculate total coins purchased
        total_coins = CoinTransaction.objects.filter(base_filter & Q(is_successful=True)).aggregate(total=Sum('coins'))['total'] or 0
        
        # Calculate total amount (ETB) - assuming 10 ETB = 100 coins ratio
        total_amount_etb = (total_coins / 10) if total_coins else 0
        
        success_rate = (successful_transactions / total_transactions * 100) if total_transactions > 0 else 0
        
        # Daily statistics for charts
        daily_stats = []
        for i in range(min(days, 30)):  # Limit to 30 days for chart
            date = (timezone.now() - timedelta(days=days - i - 1)).date()
            day_transactions = CoinTransaction.objects.filter(
                base_filter & Q(created_at__date=date)
            ).aggregate(
                total=Count('id'),
                success=Count('id', filter=Q(is_successful=True)),
                coins=Sum('coins', filter=Q(is_successful=True))
            )
            
            daily_stats.append({
                'date': date.isoformat(),
                'total': day_transactions['total'] or 0,
                'success': day_transactions['success'] or 0,
                'coins': int(day_transactions['coins'] or 0),
                'amount': float((day_transactions['coins'] or 0) / 10)
            })
        
        return Response({
            'period_days': days,
            'total_transactions': total_transactions,
            'successful_transactions': successful_transactions,
            'failed_transactions': failed_transactions,
            'insufficient_balance': 0,  # Not applicable for CoinTransaction
            'expected_collection': total_amount_etb,
            'actual_collection': total_amount_etb,
            'success_rate': round(success_rate, 2),
            'daily_statistics': daily_stats
        })
        
    except Exception as e:
        logger.error(f"[Charging Statistics] Error: {str(e)}")
        return Response(
            {'error': 'Internal server error', 'message': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_charging_transactions(request):
    """
    Get charging transactions (admin only) - queries CoinTransaction for on-demand airtime purchases
    
    Query params:
    - status: filter by status (successful/failed)
    - days: number of days to look back (default: 3650 = 10 years to show all)
    - page: page number
    - page_size: items per page
    """
    try:
        # Check if user is admin
        if not request.user.is_staff:
            return Response(
                {'error': 'Admin access required'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        status_filter = request.GET.get('status')
        days = int(request.GET.get('days', 3650))  # Default to 10 years to show all transactions
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 20))
        
        start_date = timezone.now() - timedelta(days=days)
        
        # Query CoinTransaction for on-demand airtime purchases
        base_filter = Q(transaction_type='purchase') & Q(payment_method='airtime') & Q(created_at__gte=start_date)
        queryset = CoinTransaction.objects.filter(base_filter).select_related('user', 'user__profile').order_by('-created_at')
        
        if status_filter:
            if status_filter == 'successful':
                queryset = queryset.filter(is_successful=True)
            elif status_filter == 'failed':
                queryset = queryset.filter(is_successful=False)
        
        total_count = queryset.count()
        offset = (page - 1) * page_size
        transactions = queryset[offset:offset + page_size]
        
        transactions_data = []
        for t in transactions:
            # Get user phone from user profile if available
            phone = getattr(t.user, 'phone', '') or ''
            
            transactions_data.append({
                'id': str(t.id),
                'user': t.user.username,
                'phone_number': phone,
                'subscription_tier': None,  # Not applicable for coin purchases
                'amount_etb': float(t.coins / 10) if t.coins else 0,  # 10 ETB = 100 coins
                'status': 'success' if t.is_successful else 'failed',
                'transaction_id': t.payment_reference,
                'error_message': t.description if not t.is_successful else '',
                'created_at': t.created_at.isoformat(),
                'updated_at': t.created_at.isoformat(),
                'coins': t.coins
            })
        
        return Response({
            'total': total_count,
            'page': page,
            'page_size': page_size,
            'transactions': transactions_data
        })
        
    except Exception as e:
        logger.error(f"[Charging Transactions] Error: {str(e)}")
        return Response(
            {'error': 'Internal server error', 'message': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def purchase_coins_on_demand(request):
    """
    Purchase coins via airtime charging through Onevas
    
    Request body:
    - phone_number: User's phone number
    - coins: Number of coins to purchase
    """
    try:
        phone_number = request.data.get('phone_number')
        coins = request.data.get('coins')
        
        if not phone_number or not coins:
            return Response(
                {'error': 'phone_number and coins are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            coins = int(coins)
            if coins <= 0:
                return Response(
                    {'error': 'Coins must be greater than 0'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        except ValueError:
            return Response(
                {'error': 'Invalid coins value'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Calculate amount (10 ETB = 100 coins ratio)
        amount_etb = coins / 10
        
        # Normalize phone number
        phone_number = phone_number.replace(' ', '').replace('-', '').replace('+', '')
        if not phone_number.startswith('251'):
            phone_number = '251' + phone_number[1:]
        
        # Get Onevas credentials from settings
        product_number = getattr(settings, 'ONEVAS_CHARGING_PRODUCT_NUMBER', '10000302853')
        application_key = getattr(settings, 'ONEVAS_CHARGING_APPLICATION_KEY', '4CROFBT0EGCM1OK8R88EQBTEZOMI3138')
        
        # Initiate charging via Onevas
        logger.info(f"[Coin Purchase] Initiating Onevas charging for phone: {phone_number}, coins: {coins}")
        charging_response = onevas_charging_service.initiate_charging(
            phone_number=phone_number,
            product_number=product_number,
            application_key=application_key
        )
        
        logger.info(f"[Coin Purchase] Onevas response received: {charging_response}")
        
        # Parse response
        charging_status, error_message = onevas_charging_service.parse_charging_response(charging_response)
        
        logger.info(f"[Coin Purchase] Parsed status: {charging_status}, error: {error_message}")
        
        # Create coin transaction record
        transaction = CoinTransaction.objects.create(
            user=request.user,
            coins=coins,
            transaction_type='purchase',
            payment_method='airtime',
            payment_reference=charging_response.get('data', {}).get('transaction_id', ''),
            is_successful=(charging_status == 'success'),
            description=error_message or ''
        )
        
        if charging_status == 'success':
            # Update user coin balance using add_purchased with airtime payment method
            user_balance, created = UserCoinBalance.objects.get_or_create(
                user=request.user,
                defaults={'balance': 0, 'earned_balance': 0, 'purchased_balance': 0}
            )
            user_balance.add_purchased(
                amount=coins,
                transaction_type='purchase',
                payment_method='airtime',
                payment_reference=charging_response.get('data', {}).get('transaction_id', ''),
                description=f'Coin purchase via Airtime'
            )
            
            return Response({
                'success': True,
                'message': f'Successfully purchased {coins} coins',
                'transaction_id': transaction.payment_reference,
                'coins': coins,
                'amount_etb': amount_etb,
                'new_balance': user_balance.balance
            })
        else:
            # Provide user-friendly error message
            user_error = error_message or 'Charging failed'
            if error_message == 'HOUR_RETRY_LIMIT_EXCEEDED':
                user_error = 'You have reached the hourly limit for airtime purchases. Please try again later.'
            
            # Return appropriate status code based on error type
            if 'http_error_504' in error_message or '504' in error_message:
                status_code = status.HTTP_504_GATEWAY_TIMEOUT
            elif 'http_error_503' in error_message or '503' in error_message:
                status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            elif 'http_error_500' in error_message or '500' in error_message:
                status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
            else:
                status_code = status.HTTP_400_BAD_REQUEST
            
            return Response({
                'success': False,
                'error': user_error,
                'transaction_id': transaction.payment_reference
            }, status=status_code)
            
    except Exception as e:
        logger.error(f"[Coin Purchase] Error: {str(e)}")
        return Response(
            {'error': 'Internal server error', 'message': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def search_charging_transactions(request):
    """
    Search charging transactions by phone number or user ID (admin only) - queries CoinTransaction
    
    Query params:
    - phone: phone number to search
    - user_id: user ID to search
    """
    try:
        # Check if user is admin
        if not request.user.is_staff:
            return Response(
                {'error': 'Admin access required'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        phone = request.GET.get('phone')
        user_id = request.GET.get('user_id')
        
        if not phone and not user_id:
            return Response(
                {'error': 'Either phone or user_id parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Query CoinTransaction for on-demand airtime purchases
        base_filter = Q(transaction_type='purchase') & Q(payment_method='airtime')
        queryset = CoinTransaction.objects.filter(base_filter).select_related('user', 'user__profile').order_by('-created_at')
        
        if phone:
            # Search by phone in user profile
            queryset = queryset.filter(user__profile__phone_number__contains=phone)
        
        if user_id:
            try:
                user_id_int = int(user_id)
                queryset = queryset.filter(user_id=user_id_int)
            except ValueError:
                return Response(
                    {'error': 'Invalid user_id format'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        transactions = queryset[:100]  # Limit to 100 results
        
        transactions_data = []
        for t in transactions:
            # Get user phone from user profile
            phone = ''
            if hasattr(t.user, 'profile'):
                phone = getattr(t.user.profile, 'phone_number', '') or ''
            
            transactions_data.append({
                'id': str(t.id),
                'user_id': t.user.id,
                'user': t.user.username,
                'phone_number': phone,
                'subscription_tier': None,  # Not applicable for coin purchases
                'amount_etb': float(t.coins / 10) if t.coins else 0,
                'status': 'success' if t.is_successful else 'failed',
                'transaction_id': t.payment_reference,
                'error_message': t.description if not t.is_successful else '',
                'created_at': t.created_at.isoformat(),
                'updated_at': t.created_at.isoformat(),
                'coins': t.coins
            })
        
        return Response({
            'total': len(transactions_data),
            'transactions': transactions_data
        })
        
    except Exception as e:
        logger.error(f"[Charging Search] Error: {str(e)}")
        return Response(
            {'error': 'Internal server error', 'message': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_charging_analytics(request):
    """
    Get charging analytics by period (admin only) - queries CoinTransaction for on-demand airtime purchases
    
    Query params:
    - period: daily, monthly, yearly
    """
    try:
        # Check if user is admin
        if not request.user.is_staff:
            return Response(
                {'error': 'Admin access required'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        period = request.GET.get('period', 'daily')
        
        if period not in ['daily', 'monthly', 'yearly']:
            return Response(
                {'error': 'Invalid period. Must be daily, monthly, or yearly'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Determine date range based on period
        now = timezone.now()
        if period == 'daily':
            start_date = now - timedelta(days=30)
        elif period == 'monthly':
            start_date = now - timedelta(days=365)
        else:  # yearly
            start_date = now - timedelta(days=365 * 5)
        
        # Query CoinTransaction for on-demand airtime purchases
        base_filter = Q(transaction_type='purchase') & Q(payment_method='airtime') & Q(created_at__gte=start_date)
        
        # Get total statistics
        total_transactions = CoinTransaction.objects.filter(base_filter).count()
        
        successful = CoinTransaction.objects.filter(base_filter & Q(is_successful=True)).count()
        
        failed = CoinTransaction.objects.filter(base_filter & Q(is_successful=False)).count()
        
        total_coins = CoinTransaction.objects.filter(base_filter & Q(is_successful=True)).aggregate(total=Sum('coins'))['total'] or 0
        total_revenue = (total_coins / 10) if total_coins else 0  # 10 ETB = 100 coins
        
        success_rate = (successful / total_transactions * 100) if total_transactions > 0 else 0
        
        # Get period-wise breakdown
        if period == 'daily':
            breakdown = []
            for i in range(30):
                date = (now - timedelta(days=29 - i)).date()
                day_stats = CoinTransaction.objects.filter(
                    base_filter & Q(created_at__date=date)
                ).aggregate(
                    total=Count('id'),
                    success=Count('id', filter=Q(is_successful=True)),
                    failed=Count('id', filter=Q(is_successful=False)),
                    coins=Sum('coins', filter=Q(is_successful=True))
                )
                breakdown.append({
                    'date': date.isoformat(),
                    'total': day_stats['total'] or 0,
                    'success': day_stats['success'] or 0,
                    'failed': day_stats['failed'] or 0,
                    'revenue': float((day_stats['coins'] or 0) / 10)
                })
        elif period == 'monthly':
            breakdown = []
            for i in range(12):
                month_date = now - timedelta(days=30 * (11 - i))
                month_stats = CoinTransaction.objects.filter(
                    base_filter & Q(created_at__year=month_date.year, created_at__month=month_date.month)
                ).aggregate(
                    total=Count('id'),
                    success=Count('id', filter=Q(is_successful=True)),
                    failed=Count('id', filter=Q(is_successful=False)),
                    coins=Sum('coins', filter=Q(is_successful=True))
                )
                breakdown.append({
                    'month': f"{month_date.year}-{month_date.month:02d}",
                    'total': month_stats['total'] or 0,
                    'success': month_stats['success'] or 0,
                    'failed': month_stats['failed'] or 0,
                    'revenue': float((month_stats['coins'] or 0) / 10)
                })
        else:  # yearly
            breakdown = []
            for i in range(5):
                year_date = now - timedelta(days=365 * (4 - i))
                year_stats = CoinTransaction.objects.filter(
                    base_filter & Q(created_at__year=year_date.year)
                ).aggregate(
                    total=Count('id'),
                    success=Count('id', filter=Q(is_successful=True)),
                    failed=Count('id', filter=Q(is_successful=False)),
                    coins=Sum('coins', filter=Q(is_successful=True))
                )
                breakdown.append({
                    'year': str(year_date.year),
                    'total': year_stats['total'] or 0,
                    'success': year_stats['success'] or 0,
                    'failed': year_stats['failed'] or 0,
                    'revenue': float((year_stats['coins'] or 0) / 10)
                })
        
        return Response({
            'period': period,
            'total_transactions': total_transactions,
            'successful': successful,
            'failed': failed,
            'insufficient_balance': 0,  # Not applicable for CoinTransaction
            'total_revenue': float(total_revenue),
            'success_rate': round(success_rate, 2),
            'breakdown': breakdown
        })
        
    except Exception as e:
        logger.error(f"[Charging Analytics] Error: {str(e)}")
        return Response(
            {'error': 'Internal server error', 'message': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
