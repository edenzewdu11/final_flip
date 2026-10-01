from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from .models import UserProfile, Subscription, NotificationPreference, Notification, Vote, Comment, Follow

# Import payment backup signals to register them
from . import signals_payment_backup

@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)
        Subscription.objects.create(user=instance)
        NotificationPreference.objects.create(user=instance)
        Token.objects.create(user=instance)
        
        # Give welcome bonus coins (one-time per phone number)
        try:
            from .models_contest import UserCoinBalance, CoinTransaction
            from .models_wallet import WalletConfig
            config = WalletConfig.get_config()
            welcome_amount = config.welcome_bonus
            
            # Only give welcome bonus if user hasn't received it before
            if welcome_amount > 0 and not instance.profile.has_received_welcome_bonus:
                balance, _ = UserCoinBalance.objects.get_or_create(user=instance)
                balance.earned_balance = (balance.earned_balance or 0) + welcome_amount
                balance.total_earned = (balance.total_earned or 0) + welcome_amount
                balance._sync_balance()
                balance.save()
                
                CoinTransaction.objects.create(
                    user=instance,
                    transaction_type='welcome_bonus',
                    coins=welcome_amount,
                    description=f'Welcome bonus: {welcome_amount} coins'
                )
                
                # Mark that user has received welcome bonus
                instance.profile.has_received_welcome_bonus = True
                instance.profile.save()
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Failed to give welcome bonus: {e}")

@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    if hasattr(instance, 'profile'):
        instance.profile.save()

@receiver(post_save, sender=Vote)
def create_like_notification(sender, instance, created, **kwargs):
    """Create notification when someone likes a reel"""
    if created and instance.user != instance.reel.user:
        # Check if recipient has like notifications enabled
        try:
            prefs = instance.reel.user.notification_prefs
            if not prefs.likes:
                return
        except NotificationPreference.DoesNotExist:
            pass
        Notification.objects.create(
            recipient=instance.reel.user,
            sender=instance.user,
            notification_type='like',
            reel=instance.reel,
            message=f"{instance.user.username} liked your reel"
        )

@receiver(post_save, sender=Comment)
def create_comment_notification(sender, instance, created, **kwargs):
    """Create notification when someone comments on a reel"""
    try:
        if created and instance.user != instance.reel.user:
            # Check if recipient has comment notifications enabled
            try:
                prefs = instance.reel.user.notification_prefs
                if not prefs.comments:
                    return
            except NotificationPreference.DoesNotExist:
                pass
            Notification.objects.create(
                recipient=instance.reel.user,
                sender=instance.user,
                notification_type='comment',
                reel=instance.reel,
                comment=instance,
                message=f"{instance.user.username} commented on your reel: {instance.text[:50]}"
            )
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Failed to create comment notification: {e}")

@receiver(post_save, sender=Follow)
def create_follow_notification(sender, instance, created, **kwargs):
    """Create notification when someone follows a user"""
    if created:
        # Check if recipient has follow notifications enabled
        try:
            prefs = instance.following.notification_prefs
            if not prefs.follows:
                return
        except NotificationPreference.DoesNotExist:
            pass
        Notification.objects.create(
            recipient=instance.following,
            sender=instance.follower,
            notification_type='follow',
            message=f"{instance.follower.username} started following you"
        )

@receiver(post_delete, sender=Vote)
def delete_like_notification(sender, instance, **kwargs):
    """Delete notification when someone unlikes a reel"""
    Notification.objects.filter(
        sender=instance.user,
        recipient=instance.reel.user,
        notification_type='like',
        reel=instance.reel
    ).delete()


@receiver(post_save, sender=Notification)
def push_notification_on_create(sender, instance, created, **kwargs):
    """Fan out a new Notification row to FCM (mobile) and Web Push (browser)."""
    if not created:
        return
    type_titles = {
        'like': 'New Like',
        'comment': 'New Comment',
        'follow': 'New Follower',
        'mention': 'You were mentioned',
        'gift': 'You received a gift!',
    }
    title = type_titles.get(instance.notification_type, 'FlipStar')
    payload = {
        'title': title,
        'body': instance.message,
        'data': {
            'notification_type': instance.notification_type,
            'reel_id': instance.reel_id,
            'comment_id': instance.comment_id,
            'notification_id': instance.id,
        },
    }
    # FCM / mobile push (best-effort, async via Celery if configured)
    try:
        from api.tasks import send_push_notification
        send_push_notification.delay(instance.recipient_id, payload)
    except Exception:
        pass
    # Web Push (browser) — synchronous but cheap; ignored if VAPID unset
    try:
        from .push_service import send_web_push_to_user
        send_web_push_to_user(instance.recipient, payload)
    except Exception:
        pass


@receiver(post_save, sender=UserProfile)
def optimize_profile_photo_on_save(sender, instance, **kwargs):
    """Queue profile photo optimisation whenever it changes."""
    try:
        if instance.profile_photo and not str(instance.profile_photo).startswith('http'):
            try:
                from api.tasks import optimize_profile_image
                optimize_profile_image.delay(instance.user_id)
            except Exception:
                pass
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Error in optimize_profile_photo_on_save: {e}")


@receiver(post_save, sender='api.Reel')
def set_s3_acl_on_reel_save(sender, instance, **kwargs):
    """Automatically set public-read ACL on newly uploaded media files for Ethiotelecom S3."""
    from django.conf import settings
    import boto3
    from botocore.client import Config
    import logging
    
    s3_logger = logging.getLogger('s3')
    
    # Only run if using Ethiotelecom S3
    if not hasattr(settings, 'S3_ENDPOINT_URL') or not settings.S3_ENDPOINT_URL:
        return
    
    s3_logger.info(f"[S3] Setting ACL for Reel {instance.id}")
    
    try:
        s3_client = boto3.client(
            's3',
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            region_name=settings.S3_REGION_NAME,
            config=Config(signature_version='s3v4')
        )
        
        s3_logger.info(f"[S3] Connected to Ethiotelecom S3: {settings.S3_ENDPOINT_URL}")
        s3_logger.info(f"[S3] Bucket: {settings.S3_BUCKET_NAME}")
        
        # Set ACL for each file field
        for field_name in ['image', 'media', 'thumbnail']:
            field = getattr(instance, field_name)
            if field and hasattr(field, 'name') and field.name:
                try:
                    s3_logger.info(f"[S3] Setting public-read ACL for {field_name}: {field.name}")
                    s3_client.put_object_acl(
                        Bucket=settings.S3_BUCKET_NAME,
                        Key=field.name,
                        ACL='public-read'
                    )
                    s3_logger.info(f"[S3] Successfully set ACL for {field.name}")
                except Exception as e:
                    s3_logger.error(f"[S3] Failed to set ACL for {field.name}: {e}")
    except Exception as e:
        s3_logger.error(f"[S3] Failed to set S3 ACL on reel save: {e}")
        logging.getLogger(__name__).error(f"Failed to set S3 ACL on reel save: {e}")


@receiver(post_save, sender='api.Reel')
def compress_media_on_reel_save(sender, instance, created, **kwargs):
    """Compress media files on upload to reduce storage costs."""
    from django.conf import settings
    from .compression import MediaCompressor, ImageCompressor
    import logging
    
    compression_logger = logging.getLogger('compression')
    
    # Only run if compression is enabled
    if not getattr(settings, 'COMPRESSION_ENABLED', False):
        compression_logger.info(f"[COMPRESSION] Compression disabled, skipping for Reel {instance.id}")
        return
    
    # Only compress on new uploads, not updates
    if not created:
        compression_logger.info(f"[COMPRESSION] Skipping compression for existing Reel {instance.id}")
        return
    
    compression_logger.info(f"[COMPRESSION] Starting compression for new Reel {instance.id}")
    
    try:
        # Compress image
        if instance.image and hasattr(instance.image, 'name') and instance.image.name:
            try:
                # Get file size
                if hasattr(instance.image, 'size'):
                    size_mb = instance.image.size / (1024 * 1024)
                    compression_logger.info(f"[COMPRESSION] Image size: {size_mb:.2f} MB")
                    
                    if MediaCompressor.should_compress(size_mb, 'image'):
                        compression_logger.info(f"[COMPRESSION] Image exceeds threshold, compressing...")
                        # Compress and replace
                        compressed = ImageCompressor.compress_image(
                            instance.image,
                            max_size=settings.COMPRESSION_IMAGE_MAX_SIZE,
                            quality=settings.COMPRESSION_IMAGE_QUALITY
                        )
                        # Save compressed version
                        instance.image.save(
                            instance.image.name,
                            compressed,
                            save=False
                        )
                        compression_logger.info(f"[COMPRESSION] Image compression completed for Reel {instance.id}")
                    else:
                        compression_logger.info(f"[COMPRESSION] Image below threshold, skipping compression")
            except Exception as e:
                compression_logger.error(f"[COMPRESSION] Failed to compress reel image: {e}")
                logging.getLogger(__name__).error(f"Failed to compress reel image: {e}")
        
        # Note: Video compression is more complex and should be done async
        # This is a placeholder for future async video compression
        if instance.media and hasattr(instance.media, 'name') and instance.media.name:
            compression_logger.info(f"[COMPRESSION] Video detected for Reel {instance.id}, queuing for async compression")
            # Video compression should be handled by Celery task
            # due to processing time requirements
            pass
            
    except Exception as e:
        compression_logger.error(f"[COMPRESSION] Failed to compress reel media: {e}")
        logging.getLogger(__name__).error(f"Failed to compress reel media: {e}")


@receiver(post_save, sender='api.UserProfile')
def set_s3_acl_on_profile_photo_save(sender, instance, **kwargs):
    """Automatically set public-read ACL on newly uploaded profile photos for Ethiotelecom S3."""
    try:
        from django.conf import settings
        import boto3
        from botocore.client import Config
        import logging

        s3_logger = logging.getLogger('s3')

        # Only run if using Ethiotelecom S3
        if not hasattr(settings, 'S3_ENDPOINT_URL') or not settings.S3_ENDPOINT_URL:
            return

        s3_logger.info(f"[S3] Setting ACL for UserProfile {instance.user_id}")

        if instance.profile_photo and hasattr(instance.profile_photo, 'name') and instance.profile_photo.name:
            s3_logger.info(f"[S3] Profile photo detected: {instance.profile_photo.name}")
            s3_client = boto3.client(
                's3',
                endpoint_url=settings.S3_ENDPOINT_URL,
                aws_access_key_id=settings.S3_ACCESS_KEY_ID,
                aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
                region_name=settings.S3_REGION_NAME,
                config=Config(signature_version='s3v4')
            )
            try:
                s3_logger.info(f"[S3] Setting public-read ACL for profile photo")
                s3_client.put_object_acl(
                    Bucket=settings.S3_BUCKET_NAME,
                    Key=instance.profile_photo.name,
                    ACL='public-read'
                )
                s3_logger.info(f"[S3] Successfully set ACL for profile photo")
            except Exception as e:
                s3_logger.error(f"[S3] Failed to set ACL for profile photo: {e}")
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Failed to set S3 ACL on profile photo save: {e}")


@receiver(post_save, sender='api.UserProfile')
def compress_profile_photo_on_save(sender, instance, **kwargs):
    """Compress profile photos on upload to reduce storage costs."""
    try:
        from django.conf import settings
        from .compression import MediaCompressor, ImageCompressor
        import logging

        compression_logger = logging.getLogger('compression')

        # Only run if compression is enabled
        if not getattr(settings, 'COMPRESSION_ENABLED', False):
            compression_logger.info(f"[COMPRESSION] Compression disabled, skipping for UserProfile {instance.user_id}")
            return

        compression_logger.info(f"[COMPRESSION] Starting compression for UserProfile {instance.user_id}")

        if instance.profile_photo and hasattr(instance.profile_photo, 'name') and instance.profile_photo.name:
            try:
                # Get file size
                if hasattr(instance.profile_photo, 'size'):
                    size_mb = instance.profile_photo.size / (1024 * 1024)
                    compression_logger.info(f"[COMPRESSION] Profile photo size: {size_mb:.2f} MB")

                    if MediaCompressor.should_compress(size_mb, 'image'):
                        compression_logger.info(f"[COMPRESSION] Profile photo exceeds threshold, compressing...")
                        # Compress and replace
                        compressed = ImageCompressor.compress_image(
                            instance.profile_photo,
                            max_size=(800, 800),  # Profile photos smaller
                            quality=settings.COMPRESSION_IMAGE_QUALITY
                        )
                        # Save compressed version
                        instance.profile_photo.save(
                            instance.profile_photo.name,
                            compressed,
                            save=False
                        )
                        compression_logger.info(f"[COMPRESSION] Profile photo compression completed for UserProfile {instance.user_id}")
                    else:
                        compression_logger.info(f"[COMPRESSION] Profile photo below threshold, skipping compression")
            except Exception as e:
                compression_logger.error(f"[COMPRESSION] Failed to compress profile photo: {e}")
                logging.getLogger(__name__).error(f"Failed to compress profile photo: {e}")
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Failed to compress profile photo: {e}")
