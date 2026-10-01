"""
Views for CRM Gift Integration
API endpoints for awarding CRM packages to users
"""

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q, Count
from django.contrib.auth.models import User
from django.conf import settings
from decimal import Decimal

from .models_crm import CRMGiftPackage, CRMGiftTransaction, CRMGiftAuditLog
from .serializers_crm import (
    CRMGiftPackageSerializer, CRMGiftTransactionSerializer,
    AwardCRMGiftSerializer, CRMGiftAuditLogSerializer
)
from .crm_service import CRMService
from .models import UserProfile
from .models_campaign_extended import SelectedWinner, WinnerSelection, WinnerFrequencyRecord
from .models_gift import WinnerGiftPackage, WinnerGiftTransaction
from .telebirr_direct_debit_service import TelebirrDirectDebitService


class CRMGiftPackageViewSet(viewsets.ModelViewSet):
    """Admin viewset for managing CRM gift packages"""
    permission_classes = [permissions.IsAdminUser]
    
    def get_queryset(self):
        queryset = CRMGiftPackage.objects.all()
        is_active = self.request.query_params.get('is_active')
        trigger_condition = self.request.query_params.get('trigger_condition')
        
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        if trigger_condition:
            queryset = queryset.filter(trigger_condition=trigger_condition)
        
        return queryset.order_by('name')
    
    serializer_class = CRMGiftPackageSerializer
    
    @action(detail=False, methods=['get'])
    def active(self, request):
        """Get all active CRM packages"""
        packages = CRMGiftPackage.objects.filter(is_active=True).order_by('name')
        serializer = CRMGiftPackageSerializer(packages, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def by_trigger(self, request):
        """Get packages grouped by trigger condition"""
        trigger = request.query_params.get('trigger')
        if not trigger:
            return Response({'error': 'trigger parameter required'}, status=status.HTTP_400_BAD_REQUEST)
        
        packages = CRMGiftPackage.objects.filter(
            is_active=True,
            trigger_condition=trigger
        ).order_by('name')
        serializer = CRMGiftPackageSerializer(packages, many=True)
        return Response(serializer.data)


class CRMGiftTransactionViewSet(viewsets.ReadOnlyModelViewSet):
    """Viewset for CRM gift transactions"""
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        queryset = CRMGiftTransaction.objects.select_related('user', 'package')
        
        # Non-admin users can only see their own transactions
        if not self.request.user.is_staff:
            queryset = queryset.filter(user=self.request.user)
        
        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        
        # Filter by user (admin only)
        user_id = self.request.query_params.get('user_id')
        if user_id and self.request.user.is_staff:
            queryset = queryset.filter(user_id=user_id)
        
        return queryset.order_by('-created_at')
    
    serializer_class = CRMGiftTransactionSerializer
    
    @action(detail=False, methods=['get'])
    def my_transactions(self, request):
        """Get current user's CRM gift transactions"""
        transactions = CRMGiftTransaction.objects.filter(
            user=request.user
        ).select_related('package').order_by('-created_at')
        serializer = CRMGiftTransactionSerializer(transactions, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def retry(self, request, pk=None):
        """Retry a failed CRM gift transaction (admin only)"""
        if not request.user.is_staff:
            return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        
        transaction = self.get_object()
        if transaction.status != 'failed':
            return Response({'error': 'Can only retry failed transactions'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Retry the CRM call
        success, message, response_data = CRMService.send_gift(
            service_number_b=transaction.phone_number,
            offering_id=transaction.offering_id,
            charge_amount=float(transaction.charge_amount),
            access_user=getattr(settings, 'CRM_ACCESS_USER', ''),
            access_pwd=getattr(settings, 'CRM_ACCESS_PASSWORD', '')
        )
        
        if success:
            transaction.mark_success(response_data.get('ret_code', '0'), message)
        else:
            transaction.mark_failed(response_data.get('ret_code', 'ERROR'), message)
        
        # Log the retry
        CRMGiftAuditLog.objects.create(
            transaction=transaction,
            action='retry',
            performed_by=request.user,
            details=f"Retried transaction: {message}",
            ip_address=self.get_client_ip(request)
        )
        
        serializer = CRMGiftTransactionSerializer(transaction)
        return Response(serializer.data)
    
    def get_client_ip(self, request):
        """Get client IP address"""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip


class CRMGiftAwardViewSet(viewsets.ViewSet):
    """Viewset for awarding CRM gifts to users"""
    permission_classes = [permissions.IsAdminUser]
    
    @action(detail=False, methods=['post'])
    def award(self, request):
        """Award a CRM gift package to a user"""
        serializer = AwardCRMGiftSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        user_id = serializer.validated_data['user_id']
        package_id = serializer.validated_data['package_id']
        trigger_source = serializer.validated_data.get('trigger_source', 'manual')
        campaign_id = serializer.validated_data.get('campaign_id')
        
        # Get user
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        # Get user's phone number
        try:
            phone_number = user.profile.phone_number
            if not phone_number:
                return Response({'error': 'User has no phone number'}, status=status.HTTP_400_BAD_REQUEST)
        except UserProfile.DoesNotExist:
            return Response({'error': 'User profile not found'}, status=status.HTTP_404_NOT_FOUND)
        
        # Normalize phone number for CRM (use local 09 format)
        phone_number = phone_number.replace(' ', '').replace('-', '').replace('+', '')
        # CRM expects local format (09...), not international (251...)
        if phone_number.startswith('251'):
            phone_number = '0' + phone_number[3:]
        elif not phone_number.startswith('0'):
            phone_number = '0' + phone_number
        
        # Get package
        try:
            package = CRMGiftPackage.objects.get(id=package_id, is_active=True)
        except CRMGiftPackage.DoesNotExist:
            return Response({'error': 'Package not found or inactive'}, status=status.HTTP_404_NOT_FOUND)
        
        # Check eligibility
        if user.profile.level < package.min_level:
            return Response({
                'error': f'User level {user.profile.level} below required level {package.min_level}'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Check max awards per user
        if package.max_awards_per_user > 0:
            awards_count = CRMGiftTransaction.objects.filter(
                user=user,
                package=package,
                status='success'
            ).count()
            if awards_count >= package.max_awards_per_user:
                return Response({
                    'error': f'User has already received this package {awards_count} times (max: {package.max_awards_per_user})'
                }, status=status.HTTP_400_BAD_REQUEST)
        
        # Generate transaction ID
        transaction_id = CRMService.generate_transaction_id()
        
        # Create pending transaction
        transaction = CRMGiftTransaction.objects.create(
            user=user,
            phone_number=phone_number,
            package=package,
            offering_id=package.offering_id,
            transaction_id=transaction_id,
            charge_amount=package.charge_amount,
            trigger_source=trigger_source,
            campaign_id=campaign_id,
            status='pending'
        )
        
        # Call CRM service
        success, message, response_data = CRMService.send_gift(
            service_number_b=phone_number,
            offering_id=package.offering_id,
            charge_amount=float(package.charge_amount),
            access_user=getattr(settings, 'CRM_ACCESS_USER', ''),
            access_pwd=getattr(settings, 'CRM_ACCESS_PASSWORD', '')
        )
        
        # Update transaction status
        if success:
            transaction.mark_success(response_data.get('ret_code', '0'), message)
        else:
            transaction.mark_failed(response_data.get('ret_code', 'ERROR'), message)
        
        # Log the award
        CRMGiftAuditLog.objects.create(
            transaction=transaction,
            action='award',
            performed_by=request.user,
            details=f"Awarded {package.name} to {user.username}: {message}",
            ip_address=self.get_client_ip(request)
        )
        
        serializer = CRMGiftTransactionSerializer(transaction)
        return Response(serializer.data, status=status.HTTP_201_CREATED if success else status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['post'])
    def award_by_phone(self, request):
        """Award CRM gift by phone number (for external integrations)"""
        phone_number = request.data.get('phone_number')
        offering_id = request.data.get('offering_id')
        charge_amount = request.data.get('charge_amount')
        trigger_source = request.data.get('trigger_source', 'external_api')
        
        if not all([phone_number, offering_id, charge_amount]):
            return Response({
                'error': 'phone_number, offering_id, and charge_amount are required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Normalize phone number for CRM (use local 09 format)
        phone_number = phone_number.replace(' ', '').replace('-', '').replace('+', '')
        # CRM expects local format (09...), not international (251...)
        if phone_number.startswith('251'):
            phone_number = '0' + phone_number[3:]
        elif not phone_number.startswith('0'):
            phone_number = '0' + phone_number
        
        # Try to find user by phone number
        try:
            user = User.objects.get(profile__phone_number=phone_number)
        except User.DoesNotExist:
            # Create transaction without user (for external numbers)
            user = None
        
        # Generate transaction ID
        transaction_id = CRMService.generate_transaction_id()
        
        # Create pending transaction
        transaction = CRMGiftTransaction.objects.create(
            user=user,
            phone_number=phone_number,
            offering_id=offering_id,
            transaction_id=transaction_id,
            charge_amount=charge_amount,
            trigger_source=trigger_source,
            status='pending'
        )
        
        # Call CRM service
        success, message, response_data = CRMService.send_gift(
            service_number_b=phone_number,
            offering_id=offering_id,
            charge_amount=float(charge_amount),
            access_user=getattr(settings, 'CRM_ACCESS_USER', ''),
            access_pwd=getattr(settings, 'CRM_ACCESS_PASSWORD', '')
        )
        
        # Update transaction status
        if success:
            transaction.mark_success(response_data.get('ret_code', '0'), message)
        else:
            transaction.mark_failed(response_data.get('ret_code', 'ERROR'), message)
        
        # Log the award
        CRMGiftAuditLog.objects.create(
            transaction=transaction,
            action='award',
            performed_by=request.user if request.user.is_authenticated else None,
            details=f"External award to {phone_number}: {message}",
            ip_address=self.get_client_ip(request)
        )
        
        serializer = CRMGiftTransactionSerializer(transaction)
        return Response(serializer.data, status=status.HTTP_201_CREATED if success else status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['post'])
    def award_campaign_winners(self, request):
        """Award CRM gifts to campaign winners by selection type (daily, weekly, monthly, grand)"""
        selection_type = request.data.get('selection_type')  # daily, weekly, monthly, grand
        campaign_id = request.data.get('campaign_id')
        package_id = request.data.get('package_id')
        
        if not all([selection_type, package_id]):
            return Response({
                'error': 'selection_type and package_id are required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate selection type
        valid_types = ['daily', 'weekly', 'monthly', 'grand']
        if selection_type not in valid_types:
            return Response({
                'error': f'Invalid selection_type. Must be one of: {", ".join(valid_types)}'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get CRM package
        try:
            package = CRMGiftPackage.objects.get(id=package_id, is_active=True)
        except CRMGiftPackage.DoesNotExist:
            return Response({
                'error': 'Package not found or inactive'
            }, status=status.HTTP_404_NOT_FOUND)
        
        # Build query for WinnerSelection to get the most recent selection
        selection_query = WinnerSelection.objects.filter(
            selection_type=selection_type
        ).select_related('campaign')
        
        # Filter by campaign if specified
        if campaign_id:
            selection_query = selection_query.filter(campaign_id=campaign_id)
        
        # Get the most recent selection for this type (current period)
        latest_selection = selection_query.order_by('-created_at').first()
        
        if not latest_selection:
            # No formal selection exists - use leaderboard as fallback
            from .models_campaign_extended import Leaderboard, LeaderboardEntry
            from django.utils import timezone
            from datetime import timedelta
            
            now = timezone.now()
            
            # Determine period dates
            if selection_type == 'daily':
                period_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
                period_end = period_start + timedelta(days=1)
            elif selection_type == 'weekly':
                period_start = now - timedelta(days=now.weekday())
                period_start = period_start.replace(hour=0, minute=0, second=0, microsecond=0)
                period_end = period_start + timedelta(days=7)
            elif selection_type == 'monthly':
                period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                next_month = period_start + timedelta(days=32)
                period_end = next_month.replace(day=1)
            else:  # grand
                period_start = now - timedelta(days=180)
                period_end = now
            
            # Get the most recent leaderboard for this period
            leaderboard_query = Leaderboard.objects.filter(
                period_type=selection_type,
                period_start=period_start
            )
            
            if campaign_id:
                leaderboard_query = leaderboard_query.filter(campaign_id=campaign_id)
            
            latest_leaderboard = leaderboard_query.order_by('-created_at').first()
            
            if not latest_leaderboard:
                return Response({
                    'error': f'No {selection_type} winner selection or leaderboard found'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Get leaderboard entries as winners
            entries = LeaderboardEntry.objects.filter(
                leaderboard=latest_leaderboard
            ).select_related('user').order_by('rank')
            
            # Convert to winner-like objects for processing
            winners = []
            for entry in entries:
                winners.append({
                    'user': entry.user,
                    'rank': entry.rank,
                    'final_score': entry.score,
                    'is_from_leaderboard': True
                })
        else:
            # Build query for winners from the most recent selection only
            winners_query = SelectedWinner.objects.filter(
                selection=latest_selection
            ).select_related('user', 'selection')
            
            # Get winners
            winners = winners_query.all()
        
        # Check if we have winners (either from selection or leaderboard)
        if isinstance(winners, list):
            # Winners from leaderboard fallback
            if not winners:
                return Response({
                    'error': f'No winners found for selection_type={selection_type}'
                }, status=status.HTTP_404_NOT_FOUND)
        else:
            # Winners from formal selection
            if not winners.exists():
                return Response({
                    'error': f'No winners found for selection_type={selection_type}'
                }, status=status.HTTP_404_NOT_FOUND)
        
        results = {
            'total_winners': len(winners) if isinstance(winners, list) else winners.count(),
            'successful': 0,
            'failed': 0,
            'skipped': 0,
            'errors': []
        }
        
        # Process each winner
        for winner in winners:
            user = winner['user'] if isinstance(winner, dict) else winner.user
            
            # Check if user has phone number
            try:
                phone_number = user.profile.phone_number
                if not phone_number:
                    results['skipped'] += 1
                    results['errors'].append({
                        'user': user.username,
                        'reason': 'No phone number'
                    })
                    continue
            except UserProfile.DoesNotExist:
                results['skipped'] += 1
                results['errors'].append({
                    'user': user.username,
                    'reason': 'No profile'
                })
                continue
            
            # Normalize phone number for CRM (use local 09 format)
            phone_number = phone_number.replace(' ', '').replace('-', '').replace('+', '')
            # CRM expects local format (09...), not international (251...)
            if phone_number.startswith('251'):
                phone_number = '0' + phone_number[3:]
            elif not phone_number.startswith('0'):
                phone_number = '0' + phone_number
            
            # Check eligibility
            if user.profile.level < package.min_level:
                results['skipped'] += 1
                results['errors'].append({
                    'user': user.username,
                    'reason': f'Level {user.profile.level} below required {package.min_level}'
                })
                continue
            
            # Check frequency eligibility
            is_eligible, current_wins, max_wins = WinnerFrequencyRecord.check_frequency_eligibility(
                user, selection_type, campaign_id and latest_selection.campaign
            )
            if not is_eligible:
                results['skipped'] += 1
                results['errors'].append({
                    'user': user.username,
                    'reason': f'Already won {selection_type} {current_wins} times (max: {max_wins}) in this period'
                })
                continue
            
            # Check max awards per user
            if package.max_awards_per_user > 0:
                awards_count = CRMGiftTransaction.objects.filter(
                    user=user,
                    package=package,
                    status='success'
                ).count()
                if awards_count >= package.max_awards_per_user:
                    results['skipped'] += 1
                    results['errors'].append({
                        'user': user.username,
                        'reason': f'Already received package {awards_count} times (max: {package.max_awards_per_user})'
                    })
                    continue
            
            # Generate transaction ID
            transaction_id = CRMService.generate_transaction_id()
            
            # Create pending transaction
            transaction = CRMGiftTransaction.objects.create(
                user=user,
                phone_number=phone_number,
                package=package,
                offering_id=package.offering_id,
                transaction_id=transaction_id,
                charge_amount=package.charge_amount,
                trigger_source=f'campaign_{selection_type}',
                campaign_id=campaign_id if campaign_id else (winner.selection.campaign_id if not isinstance(winner, dict) else None),
                status='pending'
            )
            
            # Call CRM service
            success, message, response_data = CRMService.send_gift(
                service_number_b=phone_number,
                offering_id=package.offering_id,
                charge_amount=float(package.charge_amount),
                access_user=getattr(settings, 'CRM_ACCESS_USER', ''),
                access_pwd=getattr(settings, 'CRM_ACCESS_PASSWORD', '')
            )
            
            # Update transaction status
            if success:
                transaction.mark_success(response_data.get('ret_code', '0'), message)
                results['successful'] += 1
                
                # Record win for frequency tracking
                campaign = latest_selection.campaign if latest_selection else None
                WinnerFrequencyRecord.record_win(
                    user=user,
                    winner_type=selection_type,
                    campaign=campaign,
                    selection=latest_selection
                )
            else:
                transaction.mark_failed(response_data.get('ret_code', 'ERROR'), message)
                results['failed'] += 1
                results['errors'].append({
                    'user': user.username,
                    'reason': message
                })
            
            # Log the award
            CRMGiftAuditLog.objects.create(
                transaction=transaction,
                action='award',
                performed_by=request.user,
                details=f"Campaign winner award ({selection_type}): {message}",
                ip_address=self.get_client_ip(request)
            )
        
        return Response(results)
    
    @action(detail=False, methods=['post'])
    def send_b2c_gift(self, request):
        """Send B2C cash gift to a single winner"""
        user_id = request.data.get('user_id')
        amount = request.data.get('amount', 1000)
        winner_type = request.data.get('winner_type', 'weekly')

        if not user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Get user
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        # Check if user is Telebirr user
        try:
            if not user.profile.is_telebirr_user():
                return Response({'error': 'User is not a Telebirr user'}, status=status.HTTP_400_BAD_REQUEST)
        except UserProfile.DoesNotExist:
            return Response({'error': 'User profile not found'}, status=status.HTTP_404_NOT_FOUND)

        # Get user's phone number
        try:
            phone_number = user.profile.phone_number
            if not phone_number:
                return Response({'error': 'User has no phone number'}, status=status.HTTP_400_BAD_REQUEST)
        except UserProfile.DoesNotExist:
            return Response({'error': 'User profile not found'}, status=status.HTTP_404_NOT_FOUND)

        # Normalize phone number for Telebirr (use local 09 format)
        phone_number = phone_number.replace(' ', '').replace('-', '').replace('+', '')
        if phone_number.startswith('251'):
            phone_number = '0' + phone_number[3:]
        elif not phone_number.startswith('0'):
            phone_number = '0' + phone_number

        # Get or create gift package
        gift_package, _ = WinnerGiftPackage.objects.get_or_create(
            winner_type=winner_type,
            defaults={
                'gift_type': 'cash',
                'payment_method': 'telebirr_b2c',
                'amount': Decimal(str(amount)),
                'is_active': True
            }
        )

        # Create transaction record
        transaction = WinnerGiftTransaction.objects.create(
            winner=user,
            winner_type=winner_type,
            gift_package=gift_package,
            amount=Decimal(str(amount)),
            payment_method='telebirr_b2c',
            receiver_msisdn=phone_number,
            status='processing'
        )

        # Initiate B2C payment
        try:
            telebirr_service = TelebirrDirectDebitService()
            result = telebirr_service.initiate_b2c_payment(
                receiver_msisdn=phone_number,
                amount=Decimal(str(amount)),
                currency='ETB',
                reason_type='Pay for Individual B2C_VDF_Demo',
                remark=f'{winner_type.capitalize()} Winner Gift',
                initiator_type='org_operator'
            )

            if result.get('success'):
                # Update transaction with B2C details
                transaction.originator_conversation_id = result.get('originator_conversation_id', '')
                transaction.conversation_id = result.get('conversation_id', '')
                transaction.telebirr_transaction_id = result.get('transaction_id', '')
                transaction.status = 'success'
                transaction.save()

                return Response({
                    'success': True,
                    'transaction_id': str(transaction.id),
                    'message': 'B2C gift sent successfully',
                    'telebirr_transaction_id': result.get('transaction_id')
                })
            else:
                transaction.status = 'failed'
                transaction.error_message = result.get('error', 'Unknown error')
                transaction.save()

                return Response({
                    'success': False,
                    'error': result.get('error', 'Failed to send B2C gift')
                }, status=status.HTTP_400_BAD_REQUEST)

        except Exception as e:
            transaction.status = 'failed'
            transaction.error_message = str(e)
            transaction.save()

            return Response({
                'success': False,
                'error': f'Error sending B2C gift: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'])
    def send_b2c_bulk(self, request):
        """Send B2C cash gifts to all winners of a type"""
        winner_type = request.data.get('winner_type', 'weekly')
        amount = request.data.get('amount', 1000)

        # Validate winner type
        valid_types = ['daily', 'weekly', 'monthly', 'grand']
        if winner_type not in valid_types:
            return Response({
                'error': f'Invalid winner_type. Must be one of: {", ".join(valid_types)}'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Get winners for this type
        from django.utils import timezone
        from datetime import timedelta

        now = timezone.now()

        # Determine period dates
        if winner_type == 'daily':
            period_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            period_end = period_start + timedelta(days=1)
        elif winner_type == 'weekly':
            period_start = now - timedelta(days=now.weekday())
            period_start = period_start.replace(hour=0, minute=0, second=0, microsecond=0)
            period_end = period_start + timedelta(days=7)
        elif winner_type == 'monthly':
            period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            next_month = period_start + timedelta(days=32)
            period_end = next_month.replace(day=1)
        else:  # grand
            period_start = now - timedelta(days=180)
            period_end = now

        # Get winners from campaign_winners endpoint logic
        # Use the same logic as campaign_winners to get current winners
        selection_query = WinnerSelection.objects.filter(
            selection_type=winner_type
        ).select_related('campaign')

        latest_selection = selection_query.order_by('-created_at').first()

        if latest_selection:
            winners_query = SelectedWinner.objects.filter(
                selection=latest_selection
            ).select_related('user')
            winners = list(winners_query.all())
        else:
            # Fallback to empty list if no selection
            winners = []

        results = {
            'total_winners': len(winners),
            'successful': 0,
            'failed': 0,
            'skipped': 0,
            'errors': []
        }

        # Get or create gift package
        gift_package, _ = WinnerGiftPackage.objects.get_or_create(
            winner_type=winner_type,
            defaults={
                'gift_type': 'cash',
                'payment_method': 'telebirr_b2c',
                'amount': Decimal(str(amount)),
                'is_active': True
            }
        )

        # Process each winner
        for winner in winners:
            user = winner.user

            # Check if user is Telebirr user
            try:
                if not user.profile.is_telebirr_user():
                    results['skipped'] += 1
                    results['errors'].append({
                        'user': user.username,
                        'reason': 'Not a Telebirr user'
                    })
                    continue
            except UserProfile.DoesNotExist:
                results['skipped'] += 1
                results['errors'].append({
                    'user': user.username,
                    'reason': 'No profile'
                })
                continue

            # Get user's phone number
            try:
                phone_number = user.profile.phone_number
                if not phone_number:
                    results['skipped'] += 1
                    results['errors'].append({
                        'user': user.username,
                        'reason': 'No phone number'
                    })
                    continue
            except UserProfile.DoesNotExist:
                results['skipped'] += 1
                results['errors'].append({
                    'user': user.username,
                    'reason': 'No profile'
                })
                continue

            # Normalize phone number for Telebirr
            phone_number = phone_number.replace(' ', '').replace('-', '').replace('+', '')
            if phone_number.startswith('251'):
                phone_number = '0' + phone_number[3:]
            elif not phone_number.startswith('0'):
                phone_number = '0' + phone_number

            # Create transaction record
            transaction = WinnerGiftTransaction.objects.create(
                winner=user,
                winner_type=winner_type,
                gift_package=gift_package,
                amount=Decimal(str(amount)),
                payment_method='telebirr_b2c',
                receiver_msisdn=phone_number,
                status='processing'
            )

            # Initiate B2C payment
            try:
                telebirr_service = TelebirrDirectDebitService()
                result = telebirr_service.initiate_b2c_payment(
                    receiver_msisdn=phone_number,
                    amount=Decimal(str(amount)),
                    currency='ETB',
                    reason_type='Pay for Individual B2C_VDF_Demo',
                    remark=f'{winner_type.capitalize()} Winner Gift',
                    initiator_type='org_operator'
                )

                if result.get('success'):
                    transaction.originator_conversation_id = result.get('originator_conversation_id', '')
                    transaction.conversation_id = result.get('conversation_id', '')
                    transaction.telebirr_transaction_id = result.get('transaction_id', '')
                    transaction.status = 'success'
                    transaction.save()
                    results['successful'] += 1
                else:
                    transaction.status = 'failed'
                    transaction.error_message = result.get('error', 'Unknown error')
                    transaction.save()
                    results['failed'] += 1
                    results['errors'].append({
                        'user': user.username,
                        'reason': result.get('error', 'Unknown error')
                    })
            except Exception as e:
                transaction.status = 'failed'
                transaction.error_message = str(e)
                transaction.save()
                results['failed'] += 1
                results['errors'].append({
                    'user': user.username,
                    'reason': str(e)
                })

        return Response(results)

    @action(detail=False, methods=['get'])
    def campaign_winners(self, request):
        """Get campaign winners filtered by selection type and current period
        Uses real-time score calculation to sync with frontend leaderboard display
        """
        selection_type = request.query_params.get('selection_type')
        campaign_id = request.query_params.get('campaign_id')
        date_filter = request.query_params.get('date')  # Optional: YYYY-MM-DD for historical lookups
        
        if not selection_type:
            return Response({
                'error': 'selection_type parameter is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate selection type
        valid_types = ['daily', 'weekly', 'monthly', 'grand']
        if selection_type not in valid_types:
            return Response({
                'error': f'Invalid selection_type. Must be one of: {", ".join(valid_types)}'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        from django.utils import timezone
        from datetime import timedelta, datetime
        from django.contrib.auth import get_user_model
        from .models import Campaign, PostScore, Vote, Comment
        from .models_gift import GiftTransaction
        from .campaign_scoring_engine import CampaignScoringEngine
        
        User = get_user_model()
        now = timezone.now()
        
        # Determine target date
        target_dt = now
        if date_filter:
            try:
                parsed_date = datetime.strptime(date_filter, '%Y-%m-%d').date()
                target_dt = timezone.make_aware(datetime.combine(parsed_date, datetime.min.time()), timezone.get_current_timezone())
            except ValueError:
                return Response({
                    'error': 'Invalid date format. Use YYYY-MM-DD'
                }, status=status.HTTP_400_BAD_REQUEST)
        
        # Determine date range based on period_type
        if selection_type == 'daily':
            start_date = target_dt.date()
            period_start = target_dt.replace(hour=0, minute=0, second=0, microsecond=0)
            period_end = period_start + timedelta(days=1)
        elif selection_type == 'weekly':
            week_start = target_dt - timedelta(days=target_dt.weekday())
            period_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
            period_end = period_start + timedelta(days=7)
            start_date = period_start.date()
        elif selection_type == 'monthly':
            period_start = target_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            next_month = period_start + timedelta(days=32)
            period_end = next_month.replace(day=1)
            start_date = period_start.date()
        else:  # grand
            period_start = now - timedelta(days=180)
            period_end = now
            start_date = period_start.date()
        
        # Build campaign filter
        campaign_filter = {}
        if campaign_id:
            campaign_filter['campaign_id'] = campaign_id
        
        # Get posts for the period
        if selection_type == 'daily':
            posts_qs = PostScore.objects.filter(
                created_at__date=start_date,
                **campaign_filter
            ).exclude(moderation_status='rejected')
        elif selection_type == 'weekly':
            posts_qs = PostScore.objects.filter(
                created_at__gte=period_start,
                **campaign_filter
            ).exclude(moderation_status='rejected')
        elif selection_type == 'monthly':
            posts_qs = PostScore.objects.filter(
                created_at__year=target_dt.year,
                created_at__month=target_dt.month,
                **campaign_filter
            ).exclude(moderation_status='rejected')
        else:  # grand
            posts_qs = PostScore.objects.filter(
                created_at__gte=period_start,
                **campaign_filter
            ).exclude(moderation_status='rejected')
        
        # Get all unique users with posts in this period
        user_ids = list(posts_qs.values_list('user_id', flat=True).distinct())
        
        if not user_ids:
            return Response({
                'selection_type': selection_type,
                'campaign_id': campaign_id,
                'date_filter': date_filter,
                'count': 0,
                'winners': [],
                'message': f'No participants found for {selection_type} period'
            })
        
        # Get scoring weights from campaign configuration
        likes_weight = 1.0
        comments_weight = 2.0
        shares_weight = 3.0
        gifts_weight = 5.0
        
        if campaign_id:
            try:
                campaign = Campaign.objects.get(id=campaign_id)
                engine = CampaignScoringEngine(campaign)
                config = engine.type_config
                engagement_weights = config.get('engagement', {})
                if campaign.campaign_type == 'grand':
                    engagement_weights = config.get('phase1_qualification', {})
                likes_weight = engagement_weights.get('likes_weight', 1.0)
                comments_weight = engagement_weights.get('comments_weight', 2.0)
                shares_weight = engagement_weights.get('shares_weight', 3.0)
                gifts_weight = engagement_weights.get('gifts_weight', 5.0)
            except Campaign.DoesNotExist:
                pass
        
        # Calculate scores for each user (real-time like frontend leaderboard)
        users = User.objects.filter(id__in=user_ids)
        entries_data = []
        
        for user in users:
            # Get user's posts in this period
            user_posts = posts_qs.filter(user=user).select_related('reel')
            reel_ids = list(user_posts.values_list('reel_id', flat=True))
            
            if not reel_ids:
                continue
            
            # Count engagement metrics
            total_likes = Vote.objects.filter(reel_id__in=reel_ids).count()
            total_comments = Comment.objects.filter(reel_id__in=reel_ids).count()
            total_shares = 0  # TODO: implement shares tracking
            total_gifters = GiftTransaction.objects.filter(reel_id__in=reel_ids).count()
            
            # Calculate score from engagement (same as frontend leaderboard)
            calculated_score = (
                total_likes * likes_weight +
                total_comments * comments_weight +
                total_shares * shares_weight +
                total_gifters * gifts_weight
            )
            
            entries_data.append({
                'user_id': user.id,
                'username': user.username,
                'phone_number': user.profile.phone_number if hasattr(user, 'profile') else None,
                'total_score': float(calculated_score),
                'post_count': len(reel_ids),
                'likes_count': total_likes,
                'comments_count': total_comments,
                'gifts_count': total_gifters
            })
        
        # Sort by calculated score descending
        entries_data.sort(key=lambda x: x['total_score'], reverse=True)
        
        # Apply limits based on selection type
        limits = {
            'daily': 50,
            'weekly': 10,
            'monthly': 5,
            'grand': 3
        }
        limit = limits.get(selection_type, 50)
        entries_data = entries_data[:limit]
        
        # Add ranks and format response
        winners_data = []
        for idx, entry in enumerate(entries_data):
            # Get user object to check Telebirr status
            user = User.objects.get(id=entry['user_id'])
            is_telebirr_user = user.profile.is_telebirr_user() if hasattr(user, 'profile') else False

            winners_data.append({
                'id': f'rt-{entry["user_id"]}',
                'user_id': entry['user_id'],
                'username': entry['username'],
                'phone_number': entry['phone_number'],
                'rank': idx + 1,
                'final_score': entry['total_score'],
                'selection_method': 'Real-time Leaderboard',
                'campaign_id': campaign_id,
                'campaign_title': Campaign.objects.get(id=campaign_id).title if campaign_id else 'All Campaigns',
                'selection_type': selection_type,
                'selection_date': now,
                'created_at': now,
                'is_from_realtime': True,
                'post_count': entry['post_count'],
                'likes_count': entry['likes_count'],
                'comments_count': entry['comments_count'],
                'gifts_count': entry['gifts_count'],
                'is_telebirr_user': is_telebirr_user
            })
        
        return Response({
            'selection_type': selection_type,
            'campaign_id': campaign_id,
            'date_filter': date_filter,
            'count': len(winners_data),
            'winners': winners_data,
            'source': 'realtime_calculation',
            'period_start': period_start,
            'period_end': period_end
        })
    
    def get_client_ip(self, request):
        """Get client IP address"""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip


class CRMGiftAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Viewset for CRM audit logs (admin only)"""
    permission_classes = [permissions.IsAdminUser]
    
    def get_queryset(self):
        queryset = CRMGiftAuditLog.objects.select_related('transaction', 'performed_by')
        
        transaction_id = self.request.query_params.get('transaction_id')
        if transaction_id:
            queryset = queryset.filter(transaction_id=transaction_id)
        
        action = self.request.query_params.get('action')
        if action:
            queryset = queryset.filter(action=action)
        
        return queryset.order_by('-created_at')
    
    serializer_class = CRMGiftAuditLogSerializer
