from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth.models import User
from django.db.models import Count, Sum, Q, Avg
from django.utils import timezone
from datetime import timedelta
from .models import UserProfile, Reel, Quest, Competition, Subscription, Vote, Comment, Follow, SavedPost, SecurityEvent, PrivilegeAuditLog
from .serializers import UserSerializer, ReelSerializer, QuestSerializer, CompetitionSerializer
from .permissions import HasAdminPermission
from .models_subscription import SubscriptionPayment


def mask_phone_number(phone):
    """Mask phone number to show only first 9 digits, mask last 4"""
    if not phone or len(phone) < 4:
        return phone
    return phone[:9] + '****'


def _log_admin_action(request, action, target_user=None, target_object=None, details=None):
    """
    Helper function to log admin actions with comprehensive details.
    Logs: admin name, action, target, IP address, timestamp, and full details.
    """
    try:
        from .models_admin import SystemLog
    except ImportError:
        # SystemLog not available in this version, skip logging
        return
    
    log_details = {
        'ip': request.META.get('REMOTE_ADDR'),
        'user_agent': request.META.get('HTTP_USER_AGENT', '')[:200],
    }
    
    if target_user:
        log_details['target_user_id'] = target_user.id
        log_details['target_username'] = target_user.username
        log_details['target_email'] = target_user.email or ''
    
    if target_object:
        log_details['target_object_id'] = getattr(target_object, 'id', None)
        log_details['target_object_type'] = target_object.__class__.__name__
    
    if details:
        log_details.update(details)
    
    SystemLog.objects.create(
        log_type='admin_action',
        message=f'{action} by {request.user.username}',
        user=request.user,
        details=log_details
    )

@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_dashboard_stats(request):
    """Get dashboard statistics"""
    # User stats
    total_users = User.objects.count()
    active_users_today = User.objects.filter(last_login__gte=timezone.now() - timedelta(days=1)).count()
    active_users_week = User.objects.filter(last_login__gte=timezone.now() - timedelta(days=7)).count()
    active_users_month = User.objects.filter(last_login__gte=timezone.now() - timedelta(days=30)).count()
    new_users_today = User.objects.filter(date_joined__gte=timezone.now() - timedelta(days=1)).count()
    new_users_week = User.objects.filter(date_joined__gte=timezone.now() - timedelta(days=7)).count()

    # Content stats
    total_reels = Reel.objects.count()
    reels_today = Reel.objects.filter(created_at__gte=timezone.now() - timedelta(days=1)).count()
    reels_week = Reel.objects.filter(created_at__gte=timezone.now() - timedelta(days=7)).count()
    total_comments = Comment.objects.count()
    comments_today = Comment.objects.filter(created_at__gte=timezone.now() - timedelta(days=1)).count()

    # Engagement stats
    total_votes = Vote.objects.count()
    votes_today = Vote.objects.filter(created_at__gte=timezone.now() - timedelta(days=1)).count()
    total_follows = Follow.objects.count()
    follows_today = Follow.objects.filter(created_at__gte=timezone.now() - timedelta(days=1)).count()
    total_saves = SavedPost.objects.count()

    # Subscription stats - use new UserSubscription model
    try:
        from .models_subscription import UserSubscription as NewSubscription
        subscription_stats = NewSubscription.objects.values('tier__name').annotate(count=Count('id'))
        active_subscriptions = NewSubscription.objects.filter(
            status='active',
            end_date__gt=timezone.now()
        ).count()
    except ImportError:
        # Fallback to old Subscription model if new model not available
        subscription_stats = Subscription.objects.values('plan').annotate(count=Count('id'))
        active_subscriptions = Subscription.objects.filter(
            plan='pro',
            expires_at__gt=timezone.now()
        ).count()

    # Revenue stats from SubscriptionPayment (new subscription system)
    total_revenue_new = SubscriptionPayment.objects.filter(
        status='completed'
    ).aggregate(total=Sum('amount'))['total'] or 0

    today_revenue_new = SubscriptionPayment.objects.filter(
        status='completed',
        created_at__gte=timezone.now() - timedelta(days=1)
    ).aggregate(total=Sum('amount'))['total'] or 0

    # Revenue stats from old Subscription model (estimate based on plan prices)
    # Get active subscriptions and their tier prices
    try:
        from .models_subscription import SubscriptionTier
        active_subs = Subscription.objects.filter(
            plan='pro',
            expires_at__gt=timezone.now()
        )

        total_revenue_old = 0
        today_revenue_old = 0

        for sub in active_subs:
            # Try to get tier price based on plan name
            try:
                tier = SubscriptionTier.objects.filter(duration_type=sub.plan.lower()).first()
                if tier:
                    # Check if subscription was created today
                    if sub.started_at and sub.started_at >= timezone.now() - timedelta(days=1):
                        today_revenue_old += tier.price_etb
                    total_revenue_old += tier.price_etb
            except:
                pass

        total_revenue = total_revenue_new + total_revenue_old
        today_revenue = today_revenue_new + today_revenue_old
    except:
        # Fallback to just SubscriptionPayment if tier lookup fails
        total_revenue = total_revenue_new
        today_revenue = today_revenue_new

    # Top creators - count actual votes from Vote model
    top_creators = User.objects.annotate(
        reel_count=Count('reels'),
        total_votes=Count('reels__reel_votes')
    ).order_by('-total_votes')[:10]

    top_creators_data = [{
        'id': user.id,
        'username': user.username,
        'reel_count': user.reel_count,
        'total_votes': user.total_votes or 0,
        'followers': user.followers.count()
    } for user in top_creators]

    # Trending reels - count actual votes from Vote model
    trending_reels = Reel.objects.filter(
        created_at__gte=timezone.now() - timedelta(days=7)
    ).annotate(
        vote_count=Count('reel_votes')
    ).order_by('-vote_count')[:10]

    trending_reels_data = [{
        'id': reel.id,
        'caption': reel.caption[:50] if reel.caption else 'No caption',
        'user': reel.user.username,
        'votes': reel.vote_count or 0,
        'comments': reel.comments.count(),
        'created_at': reel.created_at
    } for reel in trending_reels]

    return Response({
        'users': {
            'total': total_users,
            'active_today': active_users_today,
            'active_week': active_users_week,
            'active_month': active_users_month,
            'new_today': new_users_today,
            'new_week': new_users_week
        },
        'content': {
            'total_reels': total_reels,
            'reels_today': reels_today,
            'reels_week': reels_week,
            'total_comments': total_comments,
            'comments_today': comments_today
        },
        'engagement': {
            'total_votes': total_votes,
            'votes_today': votes_today,
            'total_follows': total_follows,
            'follows_today': follows_today,
            'total_saves': total_saves
        },
        'revenue': {
            'total': float(total_revenue),
            'today': float(today_revenue)
        },
        'subscriptions': {
            'by_plan': list(subscription_stats),
            'active': active_subscriptions
        },
        'top_creators': top_creators_data,
        'trending_reels': trending_reels_data
    })

@api_view(['GET'])
@permission_classes([HasAdminPermission])
def admin_users_list(request):
    """Get list of users for admin dashboard"""
    admin_users_list.required_permission = 'view_users'
    """Get all users with detailed info"""
    # Use Count with distinct to get accurate counts
    users = User.objects.select_related('profile').annotate(
        reel_count=Count('reels', distinct=True),
        follower_count=Count('followers', distinct=True),
        following_count=Count('following', distinct=True)
    ).order_by('-date_joined')
    
    # Debug: print first user counts
    if users.exists():
        first_user = users.first()
        print(f'[ADMIN] First user: {first_user.username}, reels: {first_user.reel_count}, followers: {first_user.follower_count}, following: {first_user.following_count}')
        print(f'[ADMIN] Direct count - reels: {first_user.reels.count()}, followers: {first_user.followers.count()}, following: {first_user.following.count()}')
    
    # Pagination
    page = int(request.GET.get('page', 1))
    page_size = int(request.GET.get('page_size', 20))
    start = (page - 1) * page_size
    end = start + page_size
    
    # Search
    search = request.GET.get('search', '')
    if search:
        # Normalize phone number for search - handle different formats
        normalized_search = search.replace(' ', '').replace('-', '').replace('+', '')
        # If search looks like a phone number starting with 0, also try with 251 prefix
        phone_search_variants = [search]
        if normalized_search.isdigit() and normalized_search.startswith('0'):
            phone_search_variants.append('251' + normalized_search[1:])
        
        phone_query = Q()
        for variant in phone_search_variants:
            phone_query |= Q(profile__phone_number__icontains=variant)
        
        users = users.filter(
            Q(username__icontains=search) | 
            Q(email__icontains=search) |
            Q(first_name__icontains=search) |
            Q(last_name__icontains=search) |
            phone_query
        )
    
    total = users.count()
    users_page = users[start:end]
    
    data = [{
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'phone': mask_phone_number(user.profile.phone_number) if hasattr(user, 'profile') and user.profile.phone_number else None,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'is_active': user.is_active,
        'is_staff': user.is_staff,
        'date_joined': user.date_joined,
        'last_login': user.last_login,
        'reel_count': user.reel_count,
        'follower_count': user.follower_count,
        'following_count': user.following_count,
        'level': user.profile.level if hasattr(user, 'profile') else 1,
        'xp': user.profile.xp if hasattr(user, 'profile') else 0,
        'subscription': Subscription.objects.filter(user=user).first().plan if Subscription.objects.filter(user=user).exists() else 'free'
    } for user in users_page]
    
    return Response({
        'users': data,
        'total': total,
        'page': page,
        'page_size': page_size,
        'total_pages': (total + page_size - 1) // page_size
    })

@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_user_detail(request, user_id):
    """Get detailed user information"""
    try:
        user = User.objects.select_related('profile').annotate(
            reel_count=Count('reels', distinct=True),
            follower_count=Count('followers', distinct=True),
            following_count=Count('following', distinct=True),
            total_votes=Sum('reels__votes')
        ).get(id=user_id)
        
        # Debug: print counts
        print(f'[ADMIN] User detail: {user.username}, reels: {user.reel_count}, followers: {user.follower_count}, following: {user.following_count}, total_votes: {user.total_votes}')
        print(f'[ADMIN] Direct count - reels: {user.reels.count()}, followers: {user.followers.count()}, following: {user.following.count()}')
        
        recent_reels = Reel.objects.filter(user=user).order_by('-created_at')[:10]
        recent_comments = Comment.objects.filter(user=user).order_by('-created_at')[:10]
        
        subscription = Subscription.objects.filter(user=user).first()
        
        return Response({
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'is_active': user.is_active,
            'is_staff': user.is_staff,
            'is_superuser': user.is_superuser,
            'date_joined': user.date_joined,
            'last_login': user.last_login,
            'reel_count': user.reel_count,
            'follower_count': user.follower_count,
            'following_count': user.following_count,
            'total_votes': user.total_votes or 0,
            'level': user.profile.level if hasattr(user, 'profile') else 1,
            'xp': user.profile.xp if hasattr(user, 'profile') else 0,
            'streak': user.profile.streak if hasattr(user, 'profile') else 0,
            'bio': user.profile.bio if hasattr(user, 'profile') else '',
            'subscription': {
                'plan': subscription.plan if subscription else 'free',
                'started_at': subscription.started_at if subscription else None,
                'expires_at': subscription.expires_at if subscription else None
            },
            'recent_reels': [{
                'id': reel.id,
                'caption': reel.caption,
                'votes': reel.votes,
                'created_at': reel.created_at
            } for reel in recent_reels],
            'recent_comments': [{
                'id': comment.id,
                'text': comment.text,
                'created_at': comment.created_at
            } for comment in recent_comments]
        })
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['PATCH'])
@permission_classes([HasAdminPermission])
def admin_user_update(request, user_id):
    admin_user_update.required_permission = 'edit_users'
    """Update user details"""
    try:
        user = User.objects.get(id=user_id)

        # Prevent admin from modifying their own admin status (self-protection)
        if user == request.user:
            if 'is_staff' in request.data or 'is_superuser' in request.data:
                return Response({'error': 'Cannot modify your own admin status'}, 
                               status=status.HTTP_400_BAD_REQUEST)

        # Log sensitive changes using the helper
        sensitive_fields = ['is_staff', 'is_superuser', 'is_active', 'password']
        sensitive_changes = {k: v for k, v in request.data.items() if k in sensitive_fields}

        if sensitive_changes:
            _log_admin_action(
                request,
                f'Modified sensitive fields for user {user.username}',
                target_user=user,
                details={
                    'action': 'user_update_sensitive',
                    'changes': sensitive_changes,
                }
            )

        if 'is_active' in request.data:
            user.is_active = request.data['is_active']
        if 'is_staff' in request.data:
            user.is_staff = request.data['is_staff']
        if 'is_superuser' in request.data:
            user.is_superuser = request.data['is_superuser']
        if 'email' in request.data:
            user.email = request.data['email']
        if 'first_name' in request.data:
            user.first_name = request.data['first_name']
        if 'last_name' in request.data:
            user.last_name = request.data['last_name']
        if 'password' in request.data:
            user.set_password(request.data['password'])

        user.save()

        # Update profile if provided
        if hasattr(user, 'profile'):
            if 'xp' in request.data:
                # Validate XP is non-negative
                xp = int(request.data['xp'])
                if xp < 0:
                    return Response({'error': 'XP cannot be negative'}, 
                                   status=status.HTTP_400_BAD_REQUEST)
                user.profile.xp = xp
            if 'level' in request.data:
                # Validate level is positive
                level = int(request.data['level'])
                if level < 1:
                    return Response({'error': 'Level must be at least 1'}, 
                                   status=status.HTTP_400_BAD_REQUEST)
                user.profile.level = level
            if 'bio' in request.data:
                user.profile.bio = request.data['bio']
            user.profile.save()

        return Response({'message': 'User updated successfully'})
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['DELETE'])
@permission_classes([HasAdminPermission])
def admin_user_delete(request, user_id):
    admin_user_delete.required_permission = 'delete_users'
    """Delete a user"""
    try:
        user = User.objects.get(id=user_id)
        username = user.username
        email = user.email
        is_staff = user.is_staff
        is_superuser = user.is_superuser
        date_joined = user.date_joined
        
        # Log before deletion
        _log_admin_action(
            request,
            f'Deleted user {username}',
            target_user=user,
            details={
                'action': 'user_delete',
                'deleted_username': username,
                'deleted_email': email,
                'was_staff': is_staff,
                'was_superuser': is_superuser,
                'date_joined': str(date_joined),
                'reel_count': user.reels.count() if hasattr(user, 'reels') else 0,
            }
        )
        
        user.delete()
        return Response({'message': f'User {username} deleted successfully'})
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['GET'])
@permission_classes([HasAdminPermission])
def admin_reels_list(request):
    admin_reels_list.required_permission = 'view_content'
    """Get all reels with moderation info"""
    reels = Reel.objects.select_related('user').annotate(
        comment_count=Count('comments'),
        save_count=Count('saved_by')
    ).order_by('-created_at')

    # Pagination
    page = int(request.GET.get('page', 1))
    page_size = int(request.GET.get('page_size', 20))
    start = (page - 1) * page_size
    end = start + page_size

    # Search
    search = request.GET.get('search', '')
    if search:
        reels = reels.filter(
            Q(caption__icontains=search) |
            Q(user__username__icontains=search) |
            Q(hashtags__icontains=search)
        )

    # Status filter
    status = request.GET.get('status', '')
    if status == 'approved':
        # Approved: visible content (is_hidden=False)
        reels = reels.filter(is_hidden=False)
    elif status == 'removed':
        # Removed: hidden content (is_hidden=True)
        reels = reels.filter(is_hidden=True)
    # 'pending' and 'all' show all reels (pending = all, since all start as pending)

    total = reels.count()
    reels_page = reels[start:end]

    data = [{
        'id': reel.id,
        'user': {
            'id': reel.user.id,
            'username': reel.user.username
        },
        'caption': reel.caption,
        'hashtags': reel.hashtags,
        'votes': reel.votes,
        'comment_count': reel.comment_count,
        'save_count': reel.save_count,
        'image': reel.image.url if reel.image else None,
        'media': reel.media.url if reel.media else None,
        'is_hidden': reel.is_hidden,
        'created_at': reel.created_at
    } for reel in reels_page]

    return Response({
        'reels': data,
        'total': total,
        'page': page,
        'page_size': page_size,
        'total_pages': (total + page_size - 1) // page_size
    })

@api_view(['DELETE'])
@permission_classes([HasAdminPermission])
def admin_reel_delete(request, reel_id):
    admin_reel_delete.required_permission = 'moderate_content'
    """Delete a reel"""
    try:
        reel = Reel.objects.get(id=reel_id)
        reel_owner = reel.user
        caption = reel.caption[:100] if reel.caption else ''
        votes = reel.votes
        created_at = reel.created_at
        
        # Log before deletion
        _log_admin_action(
            request,
            f'Deleted reel by {reel_owner.username}',
            target_user=reel_owner,
            target_object=reel,
            details={
                'action': 'reel_delete',
                'reel_id': reel_id,
                'reel_owner': reel_owner.username,
                'caption': caption,
                'votes': votes,
                'created_at': str(created_at),
            }
        )
        
        reel.delete()
        return Response({'message': 'Reel deleted successfully'})
    except Reel.DoesNotExist:
        return Response({'error': 'Reel not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_reel_boost(request, reel_id):
    """Boost reel votes"""
    try:
        reel = Reel.objects.get(id=reel_id)
        boost_amount = request.data.get('amount', 10)
        reel.votes += boost_amount
        reel.save()
        return Response({'message': f'Reel boosted by {boost_amount} votes', 'new_votes': reel.votes})
    except Reel.DoesNotExist:
        return Response({'error': 'Reel not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['POST'])
@permission_classes([HasAdminPermission])
def admin_reel_moderate(request, reel_id):
    """Approve or remove a reel (toggle is_hidden)"""
    admin_reel_moderate.required_permission = 'moderate_content'
    try:
        reel = Reel.objects.get(id=reel_id)
        action = request.data.get('action')  # 'approve' or 'remove'

        if action == 'approve':
            reel.is_hidden = False
            message = 'Reel approved and is now visible'
        elif action == 'remove':
            reel.is_hidden = True
            message = 'Reel removed and is now hidden'
        else:
            return Response({'error': 'Invalid action. Use "approve" or "remove"'}, status=status.HTTP_400_BAD_REQUEST)

        reel.save(update_fields=['is_hidden'])

        # Log the moderation action
        _log_admin_action(
            request,
            f'{action}d reel by {reel.user.username}',
            target_user=reel.user,
            target_object=reel,
            details={
                'action': f'reel_{action}',
                'reel_id': reel_id,
                'reel_owner': reel.user.username,
                'is_hidden': reel.is_hidden,
            }
        )

        return Response({
            'message': message,
            'is_hidden': reel.is_hidden,
            'reel_id': reel_id
        })
    except Reel.DoesNotExist:
        return Response({'error': 'Reel not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['GET'])
@permission_classes([HasAdminPermission])
def admin_reel_detail(request, reel_id):
    """Get detailed information about a single reel for moderation"""
    admin_reel_detail.required_permission = 'view_content'
    try:
        reel = Reel.objects.select_related('user', 'user__profile', 'campaign').annotate(
            comment_count=Count('comments', distinct=True),
            save_count=Count('saved_by', distinct=True),
            vote_count_db=Count('reel_votes', distinct=True),
            report_count=Count('reports', distinct=True),
        ).get(id=reel_id)

        # User profile extras
        profile = getattr(reel.user, 'profile', None)
        follower_count = reel.user.followers.count()
        following_count = reel.user.following.count()
        post_count = reel.user.reels.count()

        # Profile photo URL
        profile_photo = None
        if profile and profile.profile_photo:
            try:
                profile_photo = profile.profile_photo.url
            except Exception:
                pass
        if not profile_photo and profile and profile.avatar:
            try:
                profile_photo = profile.avatar.url
            except Exception:
                pass

        # Media URLs with error handling
        image_url = None
        media_url = None
        thumbnail_url = None
        
        if reel.image:
            try:
                image_url = reel.image.url
            except Exception:
                pass
        
        if reel.media:
            try:
                media_url = reel.media.url
            except Exception:
                pass
        
        if reel.thumbnail:
            try:
                thumbnail_url = reel.thumbnail.url
            except Exception:
                pass

        # Recent comments
        recent_comments = Comment.objects.filter(reel=reel).select_related('user').order_by('-created_at')[:10]
        comments_data = [{
            'id': c.id,
            'user': c.user.username,
            'text': c.text,
            'created_at': c.created_at.isoformat(),
        } for c in recent_comments]

        # Reports against this reel
        from .models import Report
        reports = Report.objects.filter(reported_reel=reel).select_related('reported_by').order_by('-created_at')
        reports_data = [{
            'id': r.id,
            'report_type': r.report_type,
            'description': r.description,
            'status': r.status,
            'priority': r.priority,
            'reported_by': r.reported_by.username,
            'created_at': r.created_at.isoformat(),
        } for r in reports]

        return Response({
            'id': reel.id,
            'user': {
                'id': reel.user.id,
                'username': reel.user.username,
                'first_name': reel.user.first_name,
                'last_name': reel.user.last_name,
                'email': reel.user.email,
                'is_active': reel.user.is_active,
                'date_joined': reel.user.date_joined.isoformat(),
                'last_login': reel.user.last_login.isoformat() if reel.user.last_login else None,
                'profile_photo': profile_photo,
                'bio': profile.bio if profile else '',
                'follower_count': follower_count,
                'following_count': following_count,
                'post_count': post_count,
                'is_shadowbanned': profile.is_shadowbanned if profile else False,
                'coins': profile.coins if profile else 0,
                'level': profile.level if profile else 1,
            },
            'caption': reel.caption,
            'hashtags': reel.hashtags,
            'overlay_text': reel.overlay_text,
            'votes': reel.votes,
            'vote_count_db': reel.vote_count_db,
            'view_count': reel.view_count,
            'shares': reel.shares,
            'comment_count': reel.comment_count,
            'save_count': reel.save_count,
            'report_count': reel.report_count,
            'image': image_url,
            'media': media_url,
            'thumbnail': thumbnail_url,
            'duration': reel.duration,
            'is_hidden': reel.is_hidden,
            'is_boosted': reel.is_boosted,
            'category': None,  # Category model schema mismatch - disabled for now
            'campaign': {
                'id': reel.campaign.id,
                'title': reel.campaign.title
            } if reel.campaign else None,
            'created_at': reel.created_at.isoformat(),
            'comments': comments_data,
            'reports': reports_data,
        })
    except Reel.DoesNotExist:
        return Response({'error': 'Reel not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_subscription_upgrade(request, user_id):
    """Upgrade user subscription"""
    try:
        user = User.objects.get(id=user_id)
        plan = request.data.get('plan', 'pro')
        days = request.data.get('days', 30)
        
        subscription, created = Subscription.objects.get_or_create(user=user)
        old_plan = subscription.plan
        old_expires = subscription.expires_at
        
        subscription.plan = plan
        subscription.expires_at = timezone.now() + timedelta(days=days)
        subscription.save()
        
        # Log the subscription upgrade
        _log_admin_action(
            request,
            f'Upgraded subscription for {user.username}',
            target_user=user,
            details={
                'action': 'subscription_upgrade',
                'old_plan': old_plan,
                'new_plan': plan,
                'days_added': days,
                'new_expires_at': str(subscription.expires_at),
                'was_new_subscription': created,
            }
        )
        
        return Response({
            'message': f'User upgraded to {plan} for {days} days',
            'subscription': {
                'plan': subscription.plan,
                'expires_at': subscription.expires_at
            }
        })
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_comments_list(request):
    """Get all comments for moderation"""
    comments = Comment.objects.select_related('user', 'reel').annotate(
        like_count=Count('comment_likes'),
        reply_count=Count('replies')
    ).order_by('-created_at')
    
    page = int(request.GET.get('page', 1))
    page_size = int(request.GET.get('page_size', 50))
    start = (page - 1) * page_size
    end = start + page_size
    
    total = comments.count()
    comments_page = comments[start:end]
    
    data = [{
        'id': comment.id,
        'user': {
            'id': comment.user.id,
            'username': comment.user.username
        },
        'reel_id': comment.reel.id,
        'text': comment.text,
        'like_count': comment.like_count,
        'reply_count': comment.reply_count,
        'created_at': comment.created_at
    } for comment in comments_page]
    
    return Response({
        'comments': data,
        'total': total,
        'page': page,
        'page_size': page_size,
        'total_pages': (total + page_size - 1) // page_size
    })

@api_view(['DELETE'])
@permission_classes([IsAdminUser])
def admin_comment_delete(request, comment_id):
    """Delete a comment"""
    try:
        comment = Comment.objects.get(id=comment_id)
        comment_author = comment.user
        comment_text = comment.text[:200] if comment.text else ''
        reel_id = comment.reel.id if comment.reel else None
        
        # Log before deletion
        _log_admin_action(
            request,
            f'Deleted comment by {comment_author.username}',
            target_user=comment_author,
            target_object=comment,
            details={
                'action': 'comment_delete',
                'comment_id': comment_id,
                'comment_author': comment_author.username,
                'comment_text': comment_text,
                'reel_id': reel_id,
            }
        )
        
        comment.delete()
        return Response({'message': 'Comment deleted successfully'})
    except Comment.DoesNotExist:
        return Response({'error': 'Comment not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_analytics_export(request):
    """Export analytics data"""
    export_type = request.GET.get('type', 'users')
    
    if export_type == 'users':
        users = User.objects.all().values(
            'id', 'username', 'email', 'date_joined', 'last_login', 'is_active'
        )
        return Response(list(users))
    elif export_type == 'reels':
        reels = Reel.objects.all().values(
            'id', 'user__username', 'caption', 'votes', 'created_at'
        )
        return Response(list(reels))
    
    return Response({'error': 'Invalid export type'}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['DELETE'])
@permission_classes([IsAdminUser])
def admin_wipe_all_posts(request):
    """Wipe all reels/posts and related data (comments, votes, saves, campaign entries)."""
    # Require explicit confirmation to prevent accidental deletion
    confirm = request.data.get('confirm')
    if confirm != 'WIPE_ALL_DATA_CONFIRMED':
        return Response({
            'error': 'Confirmation required. Send { "confirm": "WIPE_ALL_DATA_CONFIRMED" } to proceed.'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Log this critical action for audit trail using the helper
    _log_admin_action(
        request,
        'CRITICAL: Initiated wipe of all posts',
        details={
            'action': 'wipe_all_posts',
            'confirmation': 'WIPE_ALL_DATA_CONFIRMED',
        }
    )
    
    from .models import CommentLike, CommentReply
    from .models_campaign import CampaignEntry, CampaignVote, CampaignWinner, CampaignNotification
    
    results = {}
    results['campaign_votes'] = CampaignVote.objects.all().delete()[0]
    results['campaign_winners'] = CampaignWinner.objects.all().delete()[0]
    results['campaign_notifications'] = CampaignNotification.objects.all().delete()[0]
    results['campaign_entries'] = CampaignEntry.objects.all().delete()[0]
    results['comment_likes'] = CommentLike.objects.all().delete()[0]
    results['comment_replies'] = CommentReply.objects.all().delete()[0]
    results['comments'] = Comment.objects.all().delete()[0]
    results['saved_posts'] = SavedPost.objects.all().delete()[0]
    results['votes'] = Vote.objects.all().delete()[0]
    results['reels'] = Reel.objects.all().delete()[0]
    
    # Log completion using the helper
    _log_admin_action(
        request,
        f'CRITICAL: Wiped all posts - deleted {sum(results.values())} items',
        details={
            'action': 'wipe_all_posts_complete',
            'deleted_counts': results,
            'total_deleted': sum(results.values()),
        }
    )
    
    return Response({'message': 'All posts wiped!', 'deleted': results})


@api_view(['GET'])
@permission_classes([HasAdminPermission])
def admin_user_role(request, user_id):
    admin_user_role.required_permission = 'view_users'
    """Get admin role details for a user"""
    try:
        from .models_subscription import AdminRole
        admin_role = AdminRole.objects.filter(user_id=user_id).first()
        if admin_role:
            return Response({
                'role': admin_role.role,
                'permission_level': admin_role.permission_level,
                'is_active': admin_role.is_active
            })
        # Return 200 with null data instead of 404 to avoid console errors
        return Response({
            'role': None,
            'permission_level': None,
            'is_active': None
        })
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([HasAdminPermission])
def admin_user_logs(request, user_id):
    admin_user_logs.required_permission = 'view_users'
    """Get user activity logs"""
    try:
        from .models import PrivilegeAuditLog
        logs = PrivilegeAuditLog.objects.filter(
            Q(target_user_id=user_id) | Q(performed_by_id=user_id)
        ).order_by('-timestamp')[:50]
        
        return Response({
            'logs': [{
                'action': log.action,
                'target_user': log.target_user,
                'performed_by': log.performed_by,
                'details': log.details,
                'timestamp': log.timestamp.isoformat()
            } for log in logs]
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([HasAdminPermission])
def admin_grant_admin(request, user_id):
    admin_grant_admin.required_permission = 'manage_admins'
    """Grant or revoke admin privileges for a user with granular permissions"""
    try:
        user = User.objects.get(id=user_id)
        action = request.data.get('action', 'grant')  # 'grant' or 'revoke'

        if action == 'revoke':
            # Revoke admin privileges
            from .models_subscription import AdminRole
            AdminRole.objects.filter(user=user).delete()
            user.is_staff = False
            user.is_superuser = False
            user.save()

            # Log the action using the helper
            _log_admin_action(
                request,
                f'Revoked admin privileges from {user.username}',
                target_user=user,
                details={
                    'action': 'admin_revoke',
                    'was_staff': True,
                    'was_superuser': True,
                }
            )

            return Response({
                'message': 'Admin privileges revoked successfully',
                'user_id': user.id,
                'username': user.username,
                'is_staff': user.is_staff
            })

        # Grant admin privileges with role and permission level
        role = request.data.get('role', 'support_agent')
        permission_level = request.data.get('permission_level', 'read_only')

        from .models_subscription import AdminRole

        # Create or update AdminRole
        admin_role, created = AdminRole.objects.update_or_create(
            user=user,
            defaults={
                'role': role,
                'permission_level': permission_level,
                'is_active': True
            }
        )

        # Set user as staff
        user.is_staff = True
        user.is_superuser = (role == 'super_admin')
        user.save()

        # Log the action using the helper
        _log_admin_action(
            request,
            f'Granted admin privileges to {user.username}',
            target_user=user,
            details={
                'action': 'admin_grant',
                'role': role,
                'permission_level': permission_level,
                'is_superuser': user.is_superuser,
                'was_new_role': created,
            }
        )

        return Response({
            'message': f"Admin privileges granted successfully",
            'user_id': user.id,
            'username': user.username,
            'role': role,
            'permission_level': permission_level,
            'is_staff': user.is_staff
        })
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_privilege_audit(request):
    """Get privilege audit log"""
    try:
        from .models import PrivilegeAuditLog
    except ImportError:
        return Response({'logs': [], 'total': 0, 'page': 1, 'page_size': 50, 'total_pages': 0})

    try:
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 50))

        # Don't use select_related since fields might not be foreign keys
        logs = PrivilegeAuditLog.objects.order_by('-timestamp')
        total = logs.count()

        start = (page - 1) * page_size
        end = start + page_size
        logs_page = logs[start:end]

        # Get all user IDs that need to be fetched
        user_ids = set()
        for log in logs_page:
            if log.target_user_id:
                user_ids.add(log.target_user_id)
            if log.performed_by_id:
                user_ids.add(log.performed_by_id)

        # Fetch users in bulk
        from django.contrib.auth.models import User
        users = {u.id: u for u in User.objects.filter(id__in=user_ids).select_related('profile')}

        data = []
        for log in logs_page:
            try:
                target_user = users.get(log.target_user_id) if log.target_user_id else None
                performed_by = users.get(log.performed_by_id) if log.performed_by_id else None

                target_user_phone = None
                if target_user and hasattr(target_user, 'profile'):
                    target_user_phone = mask_phone_number(getattr(target_user.profile, 'phone_number', None))

                performed_by_phone = None
                if performed_by and hasattr(performed_by, 'profile'):
                    performed_by_phone = mask_phone_number(getattr(performed_by.profile, 'phone_number', None))

                data.append({
                    'id': log.id,
                    'timestamp': log.timestamp.isoformat() if log.timestamp else None,
                    'action': log.action,
                    'target_user': target_user.username if target_user else None,
                    'target_user_id': log.target_user_id,
                    'target_user_email': target_user.email if target_user else None,
                    'target_user_phone': target_user_phone,
                    'performed_by': performed_by.username if performed_by else None,
                    'performed_by_id': log.performed_by_id,
                    'performed_by_email': performed_by.email if performed_by else None,
                    'performed_by_phone': performed_by_phone,
                    'details': log.details
                })
            except Exception as e:
                import traceback
                traceback.print_exc()
                # Skip this log entry if there's an error
                continue

        return Response({
            'logs': data,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': (total + page_size - 1) // page_size
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({'logs': [], 'total': 0, 'page': 1, 'page_size': 50, 'total_pages': 0})


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_security_events(request):
    """Get security events for monitoring"""
    try:
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 50))
        event_type = request.GET.get('event_type', '')
        severity = request.GET.get('severity', '')
        is_resolved = request.GET.get('is_resolved', '')

        events = SecurityEvent.objects.all()

        # Filter by event type
        if event_type:
            events = events.filter(event_type=event_type)

        # Filter by severity
        if severity:
            events = events.filter(severity=severity)

        # Filter by resolved status
        if is_resolved:
            events = events.filter(is_resolved=is_resolved == 'true')

        total = events.count()

        start = (page - 1) * page_size
        end = start + page_size
        events_page = events[start:end]

        data = []
        for event in events_page:
            data.append({
                'id': event.id,
                'event_type': event.event_type,
                'severity': event.severity,
                'username': event.username,
                'ip_address': str(event.ip_address) if event.ip_address else None,
                'user_agent': event.user_agent,
                'endpoint': event.endpoint,
                'page': event.page,
                'action': event.action,
                'details': event.details,
                'is_resolved': event.is_resolved,
                'timestamp': event.timestamp.isoformat() if event.timestamp else None
            })

        return Response({
            'events': data,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': (total + page_size - 1) // page_size
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({'events': [], 'total': 0, 'page': 1, 'page_size': 50, 'total_pages': 0})


@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_resolve_security_event(request, event_id):
    """Mark a security event as resolved"""
    try:
        event = SecurityEvent.objects.get(id=event_id)
        event_type = event.event_type
        severity = event.severity
        username = event.username
        ip_address = str(event.ip_address) if event.ip_address else None

        event.is_resolved = True
        event.save()

        # Log the resolution
        _log_admin_action(
            request,
            f'Resolved security event: {event_type}',
            details={
                'action': 'security_event_resolve',
                'event_id': event_id,
                'event_type': event_type,
                'severity': severity,
                'affected_user': username,
                'ip_address': ip_address,
            }
        )

        return Response({'message': 'Security event resolved'})
    except SecurityEvent.DoesNotExist:
        return Response({'error': 'Security event not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_mark_all_security_events_read(request):
    """Mark all unresolved security events as resolved"""
    try:
        unresolved_count = SecurityEvent.objects.filter(is_resolved=False).count()
        updated = SecurityEvent.objects.filter(is_resolved=False).update(is_resolved=True)

        # Log the bulk resolution
        _log_admin_action(
            request,
            f'Marked all security events as read',
            details={
                'action': 'security_events_bulk_resolve',
                'count': updated,
            }
        )

        return Response({'message': f'Marked {updated} security events as resolved'})
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_security_stats(request):
    """Get security statistics for dashboard"""
    try:
        # Count events by type
        events_by_type = SecurityEvent.objects.values('event_type').annotate(count=Count('id'))

        # Count events by severity
        events_by_severity = SecurityEvent.objects.values('severity').annotate(count=Count('id'))

        # Count unresolved events
        unresolved_count = SecurityEvent.objects.filter(is_resolved=False).count()

        # Recent events (last 24 hours)
        recent_events = SecurityEvent.objects.filter(
            timestamp__gte=timezone.now() - timedelta(hours=24)
        ).count()

        # High severity events (last 7 days)
        high_severity_events = SecurityEvent.objects.filter(
            severity__in=['HIGH', 'CRITICAL'],
            timestamp__gte=timezone.now() - timedelta(days=7)
        ).count()

        return Response({
            'events_by_type': list(events_by_type),
            'events_by_severity': list(events_by_severity),
            'unresolved_count': unresolved_count,
            'recent_events': recent_events,
            'high_severity_events': high_severity_events
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_log_security_event(request):
    """Log a security event from frontend"""
    try:
        event_type = request.data.get('event_type')
        severity = request.data.get('severity', 'MEDIUM')
        page = request.data.get('page', '')
        details = request.data.get('details', '')

        SecurityEvent.objects.create(
            event_type=event_type,
            severity=severity,
            user=request.user,
            username=request.user.username,
            ip_address=request.META.get('REMOTE_ADDR'),
            user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
            page=page,
            details=details
        )

        return Response({'message': 'Security event logged'})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
