import os
import tempfile
import requests as http_requests
import redis
from io import BytesIO
from celery import shared_task
from django.conf import settings
from decouple import config

_redis = redis.Redis(
    host=config('REDIS_HOST', default='127.0.0.1'),
    port=int(config('REDIS_PORT', default=6379)),
    db=0,
)


# ── Presence cleanup ────────────────────────────────────────────────────────

@shared_task
def cleanup_typing_indicators():
    """Clean up expired typing indicators from Redis."""
    try:
        keys = _redis.keys('typing:*')
        return f"Found {len(keys)} active typing indicators"
    except Exception as e:
        return f"Error: {str(e)}"


# ── Helpers ─────────────────────────────────────────────────────────────────

def _fetch_to_temp(url, suffix):
    """Download a remote URL to a NamedTemporaryFile; caller must delete."""
    # SSRF protection: Only allow HTTPS URLs from trusted domains
    if not url.startswith('https://'):
        raise ValueError(f"Only HTTPS URLs are allowed for security reasons")
    
    # Block private/internal IP ranges to prevent SSRF
    from urllib.parse import urlparse
    parsed = urlparse(url)
    hostname = parsed.hostname or ''
    
    # Block localhost and private IP ranges
    blocked_domains = ['localhost', '127.0.0.1', '0.0.0.0', '::1']
    if hostname in blocked_domains:
        raise ValueError(f"Blocked hostname: {hostname}")
    
    # Block private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    import ipaddress
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            raise ValueError(f"Blocked private IP: {hostname}")
    except ValueError:
        # Not an IP address, continue with domain check
        pass
    
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        resp = http_requests.get(url, stream=True, timeout=60)
        resp.raise_for_status()
        for chunk in resp.iter_content(8192):
            tmp.write(chunk)
    finally:
        tmp.close()
    return tmp.name


def _local_path(value):
    """Resolve a stored field value (URL or relative path) to an abs path."""
    if not value:
        return None
    if value.startswith('http://') or value.startswith('https://'):
        return None  # needs download — handled per-task
    if value.startswith('/'):
        return value
    return os.path.join(settings.MEDIA_ROOT, value)


def _upload_to_s3(local_path, s3_key):
    """Upload processed file to S3/MinIO and return public URL."""
    bucket = config('STORAGE_BUCKET_NAME', default='')
    endpoint_url = config('S3_ENDPOINT_URL', default='')
    region = config('REGION_NAME', default='us-east-1')
    if not bucket:
        return None
    try:
        import boto3
        from botocore.exceptions import ClientError
        
        s3_kwargs = {
            'aws_access_key_id': config('ACCESS_KEY_ID'),
            'aws_secret_access_key': config('SECRET_ACCESS_KEY'),
            'region_name': region,
        }
        if endpoint_url:
            s3_kwargs['endpoint_url'] = endpoint_url
        
        s3 = boto3.client('s3', **s3_kwargs)
        
        # Auto-create bucket if it doesn't exist
        try:
            s3.head_bucket(Bucket=bucket)
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == '404':
                try:
                    if endpoint_url:  # MinIO
                        s3.create_bucket(Bucket=bucket)
                    else:  # AWS S3 - need region
                        s3.create_bucket(
                            Bucket=bucket,
                            CreateBucketConfiguration={'LocationConstraint': region}
                        )
                    print(f"[TASKS] Created bucket: {bucket}")
                except Exception as create_error:
                    print(f"[TASKS] Failed to create bucket: {create_error}")
                    return None
        
        s3.upload_file(local_path, bucket, s3_key, ExtraArgs={'ACL': 'public-read'})
        
        if endpoint_url:
            return f"{endpoint_url}/{bucket}/{s3_key}"
        else:
            return f"https://{bucket}.s3.{region}.amazonaws.com/{s3_key}"
    except Exception as e:
        print(f"[TASKS] S3/MinIO upload failed: {e}")
        return None


# ── Video processing ─────────────────────────────────────────────────────────

def _process_video(input_path, reel_id, overlay_text='', audio_file=None):
    """Compress to 720p H.264/AAC, burn overlays, mix audio, extract thumbnail, return (video_path, thumb_path, duration)."""
    import ffmpeg
    import json
    import logging

    logger = logging.getLogger(__name__)

    processed_dir = os.path.join(settings.MEDIA_ROOT, 'reels', 'processed')
    thumb_dir = os.path.join(settings.MEDIA_ROOT, 'thumbnails')
    os.makedirs(processed_dir, exist_ok=True)
    os.makedirs(thumb_dir, exist_ok=True)

    out_video = os.path.join(processed_dir, f'reel_{reel_id}_720p.mp4')
    out_thumb = os.path.join(thumb_dir, f'reel_{reel_id}_thumb.jpg')

    logger.info(f"[PROCESS_VIDEO] Reel {reel_id}: overlay_text={overlay_text[:100] if overlay_text else 'None'}..., audio_file={audio_file}")

    probe = ffmpeg.probe(input_path)
    duration = float(probe['format'].get('duration', 0))

    # Build video filter chain
    video_filter = 'scale=-2:720'

    # Add text overlays if provided
    if overlay_text:
        try:
            overlays = json.loads(overlay_text) if isinstance(overlay_text, str) else overlay_text
            logger.info(f"[PROCESS_VIDEO] Parsed overlays: {len(overlays) if isinstance(overlays, list) else 'not a list'}")
            if isinstance(overlays, list) and len(overlays) > 0:
                # Build drawtext filters for each overlay
                drawtext_filters = []
                for ov in overlays:
                    text = ov.get('text', '').replace(':', '\\:').replace("'", "\\'")
                    x = ov.get('x', 50)
                    y = ov.get('y', 50)
                    color = ov.get('color', '#ffffff')
                    font_size = ov.get('fontSize', 22)
                    style = ov.get('style', 'bold')
                    align = ov.get('align', 'center')

                    # Build font style
                    font_style = ''
                    if style == 'bold':
                        font_style = ':style=Bold'
                    elif style == 'italic':
                        font_style = ':style=Italic'

                    # Build alignment
                    align_code = 'center'
                    if align == 'left':
                        align_code = 'left'
                    elif align == 'right':
                        align_code = 'right'

                    # Convert hex color to RGB for FFmpeg
                    if color.startswith('#'):
                        color = color[1:]
                        r = int(color[0:2], 16)
                        g = int(color[2:4], 16)
                        b = int(color[4:6], 16)
                        color_str = f'&H{b:02x}{g:02x}{r:02x}&'
                    else:
                        color_str = '&HFFFFFF&'

                    # Add drawtext filter
                    drawtext = f"drawtext=text='{text}':x={x}%:y={y}%:fontsize={font_size}:fontcolor={color_str}{font_style}:alignment={align_code}"
                    drawtext_filters.append(drawtext)

                if drawtext_filters:
                    video_filter = f"{video_filter},{','.join(drawtext_filters)}"
        except (json.JSONDecodeError, TypeError) as e:
            print(f"[TASKS] Failed to parse overlay_text: {e}")

    # Build FFmpeg command
    input_video = ffmpeg.input(input_path)

    # Handle audio mixing if custom audio is provided
    if audio_file and os.path.exists(audio_file):
        logger.info(f"[PROCESS_VIDEO] Mixing custom audio: {audio_file}")
        # Mix original audio with custom audio
        input_audio = ffmpeg.input(audio_file)
        # Use amix filter to combine audio tracks
        audio_filter = 'amix=inputs=2:duration=first:dropout_transition=2'
        output = ffmpeg.output(
            input_video.video.filter(video_filter),
            ffmpeg.filter([input_video.audio, input_audio.audio], audio_filter),
            out_video,
            vcodec='libx264',
            acodec='aac',
            crf=23,
            preset='fast',
            movflags='faststart',
        )
    else:
        logger.info(f"[PROCESS_VIDEO] No custom audio, using original audio only")
        # No custom audio, just process video with original audio
        output = input_video.output(
            out_video,
            vcodec='libx264',
            acodec='aac',
            vf=video_filter,
            crf=23,
            preset='fast',
            movflags='faststart',
        )

    output.overwrite_output().run(quiet=True)

    seek = min(1.0, duration * 0.1) if duration > 0 else 0
    (
        ffmpeg
        .input(input_path, ss=seek)
        .output(out_thumb, vframes=1, format='image2', vcodec='mjpeg')
        .overwrite_output()
        .run(quiet=True)
    )

    return out_video, out_thumb, duration


def _process_image(input_path, max_px=1080):
    """Resize + compress image in-place, return path."""
    from PIL import Image
    try:
        img = Image.open(input_path).convert('RGB')
        if img.width > max_px or img.height > max_px:
            img.thumbnail((max_px, max_px), Image.LANCZOS)
        img.save(input_path, 'JPEG', quality=85, optimize=True)
    except Exception as e:
        print(f"[TASKS] Image optimize error: {e}")
    return input_path


def _write_reel_fields(reel_pk, **fields):
    """Update reel fields via raw SQL (same pattern as existing upload code)."""
    from django.db import connection
    set_clause = ', '.join(f"{k}=%s" for k in fields)
    values = list(fields.values()) + [reel_pk]
    with connection.cursor() as cur:
        cur.execute(f"UPDATE api_reel SET {set_clause} WHERE id=%s", values)


# ── Main reel processing task ────────────────────────────────────────────────

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def process_reel_media(self, reel_id):
    """Process a reel's media after upload: compress video or optimise image, generate thumbnail."""
    from api.models import Reel

    try:
        reel = Reel.objects.get(pk=reel_id)
    except Reel.DoesNotExist:
        return f"Reel {reel_id} not found"

    media_val = str(reel.media or '').strip()
    image_val = str(reel.image or '').strip()
    tmp_file = None

    try:
        if media_val:
            # ── Video flow ──
            if media_val.startswith('http'):
                tmp_file = _fetch_to_temp(media_val, '.mp4')
                input_path = tmp_file
            else:
                input_path = _local_path(media_val)

            if not input_path or not os.path.exists(input_path):
                return f"Reel {reel_id}: video file not accessible"

            # Get overlay text and audio file from reel
            overlay_text = reel.overlay_text or ''
            audio_file = None
            if hasattr(reel, 'audio_file') and reel.audio_file:
                audio_file_path = _local_path(str(reel.audio_file))
                if audio_file_path and os.path.exists(audio_file_path):
                    audio_file = audio_file_path

            out_video, out_thumb, duration = _process_video(input_path, reel_id, overlay_text=overlay_text, audio_file=audio_file)

            # Try S3 upload first; fall back to relative local path
            video_url = _upload_to_s3(out_video, f'reels/processed/reel_{reel_id}_720p.mp4') \
                        or os.path.relpath(out_video, settings.MEDIA_ROOT)
            thumb_url = _upload_to_s3(out_thumb, f'thumbnails/reel_{reel_id}_thumb.jpg') \
                        or os.path.relpath(out_thumb, settings.MEDIA_ROOT)

            _write_reel_fields(reel_id, media=video_url, thumbnail=thumb_url,
                               duration=duration, processed=True)

        elif image_val:
            # ── Image flow ──
            if image_val.startswith('http'):
                tmp_file = _fetch_to_temp(image_val, '.jpg')
                input_path = tmp_file
            else:
                input_path = _local_path(image_val)

            if not input_path or not os.path.exists(input_path):
                return f"Reel {reel_id}: image file not accessible"

            _process_image(input_path)

            img_url = _upload_to_s3(input_path, f'reels/reel_{reel_id}.jpg') or image_val
            _write_reel_fields(reel_id, image=img_url, thumbnail=img_url, processed=True)

        else:
            return f"Reel {reel_id} has no media"

        # Always generate blurhash after processing
        generate_reel_blurhash.delay(reel_id)
        return f"Reel {reel_id} processed OK"

    except Exception as exc:
        print(f"[TASKS] process_reel_media error reel={reel_id}: {exc}")
        raise self.retry(exc=exc)
    finally:
        if tmp_file and os.path.exists(tmp_file):
            os.unlink(tmp_file)


# ── Blurhash ─────────────────────────────────────────────────────────────────

@shared_task
def generate_reel_blurhash(reel_id):
    """Generate blurhash string from reel thumbnail or image."""
    from api.models import Reel
    from PIL import Image
    import blurhash

    try:
        reel = Reel.objects.get(pk=reel_id)
    except Reel.DoesNotExist:
        return

    source = str(reel.thumbnail or '') or str(reel.image or '')
    if not source:
        return

    tmp = None
    try:
        if source.startswith('http'):
            tmp = _fetch_to_temp(source, '.jpg')
            img_path = tmp
        else:
            img_path = _local_path(source)

        if not img_path or not os.path.exists(img_path):
            return f"Reel {reel_id}: source image not found for blurhash"

        img = Image.open(img_path).convert('RGB')
        img.thumbnail((64, 64))
        hash_val = blurhash.encode(img, x_components=4, y_components=3)
        Reel.objects.filter(pk=reel_id).update(blurhash=hash_val)
        return f"Blurhash OK reel={reel_id}: {hash_val}"
    except Exception as e:
        return f"Blurhash error reel={reel_id}: {e}"
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)


# ── Profile image optimisation ───────────────────────────────────────────────

@shared_task
def optimize_profile_image(user_id):
    """Resize and compress a user's profile photo."""
    from django.contrib.auth.models import User
    from PIL import Image

    try:
        profile = User.objects.select_related('profile').get(pk=user_id).profile
    except User.DoesNotExist:
        return

    if not profile.profile_photo:
        return

    try:
        path = profile.profile_photo.path
        img = Image.open(path).convert('RGB')
        img.thumbnail((400, 400), Image.LANCZOS)
        img.save(path, 'JPEG', quality=85, optimize=True)

        s3_url = _upload_to_s3(path, f'profile_photos/user_{user_id}.jpg')
        if s3_url:
            from django.db import connection
            with connection.cursor() as cur:
                cur.execute(
                    "UPDATE api_userprofile SET profile_photo=%s WHERE user_id=%s",
                    [s3_url, user_id]
                )
        return f"Profile photo optimised user={user_id}"
    except Exception as e:
        return f"Profile photo error user={user_id}: {e}"


# ── Push notifications (FCM) ─────────────────────────────────────────────────

@shared_task
def send_push_notification(user_id, message_data):
    """Send FCM push notification. Requires FIREBASE_SERVER_KEY in env."""
    fcm_key = config('FIREBASE_SERVER_KEY', default='')
    if not fcm_key:
        return "FCM not configured — set FIREBASE_SERVER_KEY"

    try:
        from django.contrib.auth.models import User
        profile = User.objects.select_related('profile').get(pk=user_id).profile
        fcm_token = getattr(profile, 'fcm_token', '')
        if not fcm_token:
            return f"No FCM token for user {user_id}"

        resp = http_requests.post(
            'https://fcm.googleapis.com/fcm/send',
            json={
                'to': fcm_token,
                'notification': {
                    'title': message_data.get('title', 'FlipStar'),
                    'body': message_data.get('body', ''),
                    'sound': 'default',
                },
                'data': message_data.get('data', {}),
                'priority': 'high',
            },
            headers={
                'Authorization': f'key={fcm_key}',
                'Content-Type': 'application/json',
            },
            timeout=10,
        )
        return f"FCM sent user={user_id} status={resp.status_code}"
    except Exception as e:
        return f"FCM error user={user_id}: {e}"


# ── Leaderboard generation tasks ─────────────────────────────────────────────

@shared_task
def generate_daily_leaderboards():
    """Generate daily leaderboards for all active campaigns."""
    from django.utils import timezone
    from datetime import timedelta
    from api.models_campaign import Campaign
    from api.models_campaign_extended import Leaderboard, LeaderboardEntry, UserCampaignStats

    try:
        now = timezone.now()
        yesterday = now - timedelta(days=1)
        period_start = yesterday.replace(hour=0, minute=0, second=0, microsecond=0)
        period_end = period_start + timedelta(days=1)

        # Get all active campaigns
        campaigns = Campaign.objects.filter(status='active', campaign_type__in=['daily', 'weekly', 'monthly', 'grand'])

        count = 0
        for campaign in campaigns:
            # Check if daily leaderboard already exists for this date
            existing = Leaderboard.objects.filter(
                campaign=campaign,
                period_type='daily',
                period_start=period_start
            ).exists()

            if existing:
                continue

            # Mark previous daily leaderboards as not current
            Leaderboard.objects.filter(
                campaign=campaign,
                period_type='daily'
            ).update(is_current=False)

            # Create new leaderboard snapshot
            leaderboard = Leaderboard.objects.create(
                campaign=campaign,
                period_type='daily',
                period_start=period_start,
                period_end=period_end,
                is_current=True
            )

            # Get user stats and create entries
            stats = UserCampaignStats.objects.filter(
                campaign=campaign
            ).order_by('-total_score')

            for rank, stat in enumerate(stats, start=1):
                LeaderboardEntry.objects.create(
                    leaderboard=leaderboard,
                    user=stat.user,
                    rank=rank,
                    score=stat.total_score,
                    posts_count=stat.approved_posts
                )
                # Update user's daily rank
                stat.daily_rank = rank
                stat.save()

            count += 1

        return f"Generated {count} daily leaderboards for {period_start.date()}"
    except Exception as e:
        return f"Error generating daily leaderboards: {str(e)}"


@shared_task
def generate_weekly_leaderboards():
    """Generate weekly leaderboards for all active campaigns."""
    from django.utils import timezone
    from datetime import timedelta
    from api.models_campaign import Campaign
    from api.models_campaign_extended import Leaderboard, LeaderboardEntry, UserCampaignStats

    try:
        now = timezone.now()
        week_start = now - timedelta(days=now.weekday())
        week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
        week_end = week_start + timedelta(days=7)

        # Get all active campaigns
        campaigns = Campaign.objects.filter(status='active', campaign_type__in=['weekly', 'monthly', 'grand'])

        count = 0
        for campaign in campaigns:
            # Check if weekly leaderboard already exists for this week
            existing = Leaderboard.objects.filter(
                campaign=campaign,
                period_type='weekly',
                period_start=week_start
            ).exists()

            if existing:
                continue

            # Mark previous weekly leaderboards as not current
            Leaderboard.objects.filter(
                campaign=campaign,
                period_type='weekly'
            ).update(is_current=False)

            # Create new leaderboard snapshot
            leaderboard = Leaderboard.objects.create(
                campaign=campaign,
                period_type='weekly',
                period_start=week_start,
                period_end=week_end,
                is_current=True
            )

            # Get user stats and create entries
            stats = UserCampaignStats.objects.filter(
                campaign=campaign
            ).order_by('-total_score')

            for rank, stat in enumerate(stats, start=1):
                LeaderboardEntry.objects.create(
                    leaderboard=leaderboard,
                    user=stat.user,
                    rank=rank,
                    score=stat.total_score,
                    posts_count=stat.approved_posts
                )
                # Update user's weekly rank
                stat.weekly_rank = rank
                stat.save()

            count += 1

        return f"Generated {count} weekly leaderboards for week of {week_start.date()}"
    except Exception as e:
        return f"Error generating weekly leaderboards: {str(e)}"


@shared_task
def generate_monthly_leaderboards():
    """Generate monthly leaderboards for all active campaigns."""
    from django.utils import timezone
    from datetime import timedelta
    from api.models_campaign import Campaign
    from api.models_campaign_extended import Leaderboard, LeaderboardEntry, UserCampaignStats

    try:
        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        next_month = month_start + timedelta(days=32)
        month_end = next_month.replace(day=1)

        # Get all active campaigns
        campaigns = Campaign.objects.filter(status='active', campaign_type__in=['monthly', 'grand'])

        count = 0
        for campaign in campaigns:
            # Check if monthly leaderboard already exists for this month
            existing = Leaderboard.objects.filter(
                campaign=campaign,
                period_type='monthly',
                period_start=month_start
            ).exists()

            if existing:
                continue

            # Mark previous monthly leaderboards as not current
            Leaderboard.objects.filter(
                campaign=campaign,
                period_type='monthly'
            ).update(is_current=False)

            # Create new leaderboard snapshot
            leaderboard = Leaderboard.objects.create(
                campaign=campaign,
                period_type='monthly',
                period_start=month_start,
                period_end=month_end,
                is_current=True
            )

            # Get user stats and create entries
            stats = UserCampaignStats.objects.filter(
                campaign=campaign
            ).order_by('-total_score')

            for rank, stat in enumerate(stats, start=1):
                LeaderboardEntry.objects.create(
                    leaderboard=leaderboard,
                    user=stat.user,
                    rank=rank,
                    score=stat.total_score,
                    posts_count=stat.approved_posts
                )
                # Update user's monthly rank
                stat.monthly_rank = rank
                stat.save()

            count += 1

        return f"Generated {count} monthly leaderboards for {month_start.strftime('%B %Y')}"
    except Exception as e:
        return f"Error generating monthly leaderboards: {str(e)}"


@shared_task
def auto_select_campaign_winners():
    """Automatically select winners for campaigns that have ended."""
    from django.utils import timezone
    from api.models_campaign import Campaign
    from api.models_campaign_extended import Leaderboard, WinnerSelection, SelectedWinner

    try:
        now = timezone.now()

        # Find campaigns that have ended but don't have winner selections
        ended_campaigns = Campaign.objects.filter(
            status='active',
            entry_deadline__lt=now
        ).exclude(
            winner_selections__isnull=False
        )

        count = 0
        for campaign in ended_campaigns:
            # Get the latest leaderboard for this campaign
            leaderboard = Leaderboard.objects.filter(
                campaign=campaign,
                period_type='overall'
            ).order_by('-period_start').first()

            if not leaderboard:
                continue

            # Determine selection type based on campaign type
            selection_type = campaign.campaign_type if campaign.campaign_type in ['daily', 'weekly', 'monthly'] else 'grand'

            # Create winner selection
            winner_selection = WinnerSelection.objects.create(
                campaign=campaign,
                selection_type=selection_type,
                leaderboard=leaderboard,
                is_finalized=True,
                finalized_at=now
            )

            # Select top 3 as winners
            entries = leaderboard.entries.order_by('rank')[:3]
            for entry in entries:
                SelectedWinner.objects.create(
                    selection=winner_selection,
                    user=entry.user,
                    rank=entry.rank,
                    final_score=entry.score,
                    selection_method='top_scorer'
                )

            # Mark campaign as completed
            campaign.status = 'completed'
            campaign.winners_announced = True
            campaign.save()

            count += 1

        return f"Auto-selected winners for {count} ended campaigns"
    except Exception as e:
        return f"Error auto-selecting winners: {str(e)}"


# ── Telebirr Mandate Deductions ───────────────────────────────────────────────

@shared_task
def process_telebirr_mandate_deductions():
    """Process Telebirr mandate deductions for due subscriptions (daily/weekly/monthly)."""
    from django.core.management import call_command
    from io import StringIO
    import sys

    try:
        # Capture output
        out = StringIO()
        call_command('process_telebirr_mandate_deductions', stdout=out)
        output = out.getvalue()
        return f"Telebirr mandate deductions processed: {output}"
    except Exception as e:
        return f"Error processing Telebirr mandate deductions: {str(e)}"


# ── Telebirr Mandate Reconciliation (Background) ─────────────────────────────

@shared_task
def reconcile_pending_telebirr_mandates():
    """
    Background task that reconciles pending Telebirr mandates.
    
    The SuperApp often kills the H5 WebView before the frontend can finish polling,
    leaving mandates in 'pending' state even though they were signed successfully.
    This task queries Telebirr for each pending mandate and creates the subscription
    if the mandate is ACTIVE.
    """
    from django.utils import timezone
    from datetime import timedelta
    from django.db.models import Q
    from django.contrib.auth.models import User
    import logging

    logger = logging.getLogger('api.views_subscription')

    try:
        from api.models import PendingTelebirrMandate, UserProfile
        from api.models_subscription import SubscriptionTier, SubscriptionPlan as UserSubscription
        from api.services.telebirr_mandate_service import TelebirrMandateService

        # Only process mandates that are:
        # - status = 'pending'
        # - created within the last 10 minutes (avoid re-processing old dead ones)
        cutoff = timezone.now() - timedelta(minutes=10)
        pending_mandates = PendingTelebirrMandate.objects.filter(
            status='pending',
            created_at__gte=cutoff
        ).order_by('created_at')

        if not pending_mandates.exists():
            return "No pending mandates to reconcile"

        mandate_service = TelebirrMandateService()
        reconciled = 0
        checked = 0

        for pending in pending_mandates:
            checked += 1
            mct_contract_no = pending.mct_contract_no
            plan_type = pending.plan_type

            logger.info(f'[MANDATE_RECONCILE] Checking pending mandate: mct={mct_contract_no} plan={plan_type}')

            # Query Telebirr
            try:
                query_result = mandate_service.query_mandate(mct_contract_no=mct_contract_no)
            except Exception as e:
                logger.warning(f'[MANDATE_RECONCILE] Query failed for {mct_contract_no}: {e}')
                continue

            if query_result.get('result') != 'SUCCESS':
                err_code = query_result.get('code') or query_result.get('errorCode')
                logger.info(f'[MANDATE_RECONCILE] Mandate {mct_contract_no} not found yet (code={err_code}), trying previous mct_contract_nos...')

                # FALLBACK: mandate may exist under a different mct_contract_no from a
                # prior preorder (SuperApp said "already exists" and used the old one).
                # Filter by phone to avoid cross-user matching.
                found_via_fallback = False
                fallback_filter = {'plan_type': plan_type}
                if phone_number:
                    # Normalize to 0-prefix for consistent lookup
                    fp = phone_number.lstrip('+').replace(' ', '')
                    if fp.startswith('251'):
                        fp = '0' + fp[3:]
                    elif not fp.startswith('0'):
                        fp = '0' + fp
                    fallback_filter['phone_number'] = fp
                candidate_mcts = PendingTelebirrMandate.objects.filter(
                    **fallback_filter,
                ).exclude(
                    mct_contract_no=mct_contract_no
                ).exclude(
                    status='completed'
                ).order_by('-created_at').values_list('mct_contract_no', flat=True)[:20]

                for old_mct in candidate_mcts:
                    try:
                        old_result = mandate_service.query_mandate(mct_contract_no=old_mct)
                        if old_result.get('result') == 'SUCCESS':
                            biz = old_result.get('biz_content', {})
                            cid = biz.get('mandate_contract_id')
                            cstatus = (biz.get('status') or '').upper()
                            if cid and cstatus == 'ACTIVE':
                                query_result = old_result
                                mct_contract_no = old_mct
                                logger.info(f'[MANDATE_RECONCILE] FOUND ACTIVE mandate via old mct={old_mct}: id={cid}')
                                found_via_fallback = True
                                break
                    except Exception as e:
                        logger.warning(f'[MANDATE_RECONCILE] Failed to query old mct={old_mct}: {e}')

                if not found_via_fallback:
                    continue

            # Extract mandate info
            biz_content = query_result.get('biz_content', {})
            mandate_contract_id = biz_content.get('mandate_contract_id')
            mandate_status = (biz_content.get('status') or '').upper()

            if not mandate_contract_id:
                logger.warning(f'[MANDATE_RECONCILE] No mandate_contract_id in response for {mct_contract_no}')
                continue

            if mandate_status != 'ACTIVE':
                logger.info(f'[MANDATE_RECONCILE] Mandate {mct_contract_no} status={mandate_status}, skipping (not ACTIVE)')
                # Mark as failed if CANCELLED
                if mandate_status == 'CANCELLED':
                    pending.status = 'cancelled'
                    pending.mandate_contract_id = mandate_contract_id
                    pending.save()
                continue

            # Mandate is ACTIVE - create the subscription
            logger.info(f'[MANDATE_RECONCILE] Mandate {mct_contract_no} is ACTIVE! Creating subscription...')

            # Find the tier
            tier = SubscriptionTier.objects.filter(duration_type=plan_type, is_active=True).first()
            if not tier:
                logger.error(f'[MANDATE_RECONCILE] No active tier for plan_type={plan_type}')
                continue

            # Find the user - try phone_number from pending record, or payer info
            user = None
            phone_number = pending.phone_number
            payer_id = biz_content.get('payer_id', '')

            if phone_number:
                # Normalize phone to find user
                cleaned = phone_number.lstrip('+').replace(' ', '')
                if cleaned.startswith('251'):
                    local = '0' + cleaned[3:]
                elif cleaned.startswith('0'):
                    local = cleaned
                else:
                    local = '0' + cleaned

                username = f'telebirr_{local}'
                try:
                    user = User.objects.get(username=username)
                except User.DoesNotExist:
                    # Try profile lookup
                    variants = [cleaned, local, '+' + cleaned if not cleaned.startswith('+') else cleaned]
                    profile = UserProfile.objects.filter(phone_number__in=variants).first()
                    if profile:
                        user = profile.user

            if not user:
                logger.warning(f'[MANDATE_RECONCILE] Cannot find user for mandate {mct_contract_no} phone={phone_number}')
                continue

            # Check if subscription already exists for this mandate (by mct OR mandate_contract_id)
            existing = UserSubscription.objects.filter(
                Q(mct_contract_no=mct_contract_no) | Q(mandate_contract_id=mandate_contract_id),
                status='active'
            ).exists()
            if existing:
                logger.info(f'[MANDATE_RECONCILE] Subscription already exists for mct={mct_contract_no} or mandate={mandate_contract_id}, marking pending as completed')
                pending.status = 'completed'
                pending.mandate_contract_id = mandate_contract_id
                pending.save()
                reconciled += 1
                continue

            # Create the subscription
            now = timezone.now()
            end_date = now + timedelta(days=tier.duration_days) if tier.duration_days else None

            # Normalize phone for storage
            cleaned_phone = phone_number.lstrip('+').replace(' ', '') if phone_number else ''
            if cleaned_phone.startswith('251'):
                cleaned_phone = '0' + cleaned_phone[3:]

            subscription = UserSubscription.objects.create(
                user=user,
                tier=tier,
                payment_method='telebirr',
                duration_type=plan_type,
                status='active',
                mandate_contract_id=mandate_contract_id,
                mct_contract_no=mct_contract_no,
                mandate_status='active',
                telebirr_phone_number=cleaned_phone,
                auto_renew=True,
                start_date=now,
                end_date=end_date,
                next_renewal_date=end_date,
            )

            # Mark pending as completed
            pending.status = 'completed'
            pending.mandate_contract_id = mandate_contract_id
            pending.phone_number = cleaned_phone
            pending.save()

            logger.info(f'[MANDATE_RECONCILE] SUCCESS! Created subscription {subscription.id} for user {user.username} mandate={mandate_contract_id}')

            # Send SMS notification
            try:
                from api.services.superapp_sms_service import superapp_sms_service
                superapp_sms_service.send_subscription_success(
                    phone_number=cleaned_phone,
                    plan_name=tier.name,
                    amount=tier.price_etb,
                    duration_type=plan_type,
                    next_renewal_date=end_date
                )
            except Exception as e:
                logger.warning(f'[MANDATE_RECONCILE] Failed to send SMS: {e}')

            reconciled += 1

        return f"Reconciled {reconciled}/{checked} pending mandates"
    except Exception as e:
        import traceback
        return f"Error reconciling mandates: {str(e)}\n{traceback.format_exc()}"


@shared_task
def expire_telebirr_subscriptions():
    """
    Full Telebirr subscription sync task. Ensures DB and Telebirr are always consistent.

    1) Expire subscriptions past end_date and cancel their mandates on Telebirr
    2) Sync all active subscriptions: if mandate is CANCELLED on Telebirr, cancel in DB
    3) Prevent duplicates: if multiple active subs share the same mandate, keep only the latest
    """
    from django.utils import timezone
    from django.db.models import Count, Q
    import logging

    logger = logging.getLogger('api.views_subscription')

    try:
        from api.models_subscription import SubscriptionPlan as UserSubscription
        from api.services.telebirr_mandate_service import TelebirrMandateService

        now = timezone.now()
        mandate_service = TelebirrMandateService()
        expired_count = 0
        cancelled_on_telebirr = 0
        synced_from_telebirr = 0
        deduped = 0

        # ── STEP 1: Expire subscriptions past their end_date ─────────────────
        expired_subs = UserSubscription.objects.filter(
            payment_method='telebirr',
            status='active',
            end_date__lt=now,
        )

        for sub in expired_subs:
            expired_count += 1
            logger.info(f'[TELEBIRR_SYNC] Expiring sub {sub.id} user={sub.user} '
                        f'mandate={sub.mandate_contract_id} end_date={sub.end_date}')

            # Cancel mandate on Telebirr
            if sub.mandate_contract_id and sub.telebirr_phone_number:
                try:
                    q = mandate_service.query_mandate(mandate_contract_id=sub.mandate_contract_id)
                    t_status = (q.get('biz_content', {}).get('status') or '').upper()
                    if t_status == 'ACTIVE':
                        cr = mandate_service.cancel_mandate(
                            mandate_contract_id=sub.mandate_contract_id,
                            initiator_phone=sub.telebirr_phone_number,
                            reason='Subscription expired'
                        )
                        logger.info(f'[TELEBIRR_SYNC] Cancelled mandate {sub.mandate_contract_id}: {cr.get("msg")}')
                        cancelled_on_telebirr += 1
                except Exception as e:
                    logger.warning(f'[TELEBIRR_SYNC] Error cancelling mandate {sub.mandate_contract_id}: {e}')

            sub.status = 'cancelled'
            sub.mandate_status = 'cancelled'
            sub.save(update_fields=['status', 'mandate_status'])

        # ── STEP 2: Sync active subs with Telebirr status ────────────────────
        # Check all active subs: if Telebirr says CANCELLED, update DB
        active_subs = UserSubscription.objects.filter(
            payment_method='telebirr',
            status='active',
            mandate_contract_id__isnull=False,
        ).exclude(mandate_contract_id='')

        # Cache mandate queries to avoid duplicate API calls
        mandate_cache = {}

        for sub in active_subs:
            mid = sub.mandate_contract_id
            if mid not in mandate_cache:
                try:
                    q = mandate_service.query_mandate(mandate_contract_id=mid)
                    if q.get('result') == 'SUCCESS':
                        mandate_cache[mid] = (q.get('biz_content', {}).get('status') or '').upper()
                    else:
                        mandate_cache[mid] = 'NOT_FOUND'
                except Exception as e:
                    logger.warning(f'[TELEBIRR_SYNC] Error querying mandate {mid}: {e}')
                    mandate_cache[mid] = 'ERROR'

            telebirr_status = mandate_cache.get(mid, 'UNKNOWN')

            # If Telebirr says CANCELLED but DB says active, sync DB
            if telebirr_status in ('CANCELLED', 'NOT_FOUND') and sub.mandate_status != 'cancelled':
                logger.info(f'[TELEBIRR_SYNC] Mandate {mid} is {telebirr_status} on Telebirr but '
                            f'DB shows mandate_status={sub.mandate_status}. Syncing...')
                sub.mandate_status = 'cancelled'
                # If subscription hasn't expired yet, keep it active but mark mandate as cancelled
                # If expired, fully cancel
                if sub.end_date and sub.end_date < now:
                    sub.status = 'cancelled'
                sub.save(update_fields=['status', 'mandate_status'])
                synced_from_telebirr += 1

        # ── STEP 3: De-duplicate active subs with same mandate_contract_id ───
        active_dupes = UserSubscription.objects.filter(
            payment_method='telebirr',
            status='active',
            mandate_contract_id__isnull=False,
        ).exclude(mandate_contract_id='').values('mandate_contract_id').annotate(
            count=Count('id')
        ).filter(count__gt=1)

        for dup in active_dupes:
            mid = dup['mandate_contract_id']
            subs = UserSubscription.objects.filter(
                mandate_contract_id=mid,
                status='active'
            ).order_by('-created_at')
            # Keep the latest, cancel the rest
            for extra in subs[1:]:
                logger.info(f'[TELEBIRR_SYNC] De-duplicating: cancelling extra sub {extra.id} '
                            f'for mandate {mid}')
                extra.status = 'cancelled'
                extra.mandate_status = 'cancelled'
                extra.save(update_fields=['status', 'mandate_status'])
                deduped += 1

        result = (f"Sync complete: expired={expired_count}, cancelled_on_telebirr={cancelled_on_telebirr}, "
                  f"synced_from_telebirr={synced_from_telebirr}, deduped={deduped}")
        logger.info(f'[TELEBIRR_SYNC] {result}')
        return result
    except Exception as e:
        import traceback
        return f"Error in telebirr sync: {str(e)}\n{traceback.format_exc()}"


# ── Payment backup cleanup ───────────────────────────────────────────────────

@shared_task
def cleanup_expired_payment_backups():
    """
    Clean up expired payment backup records.
    
    This task should be scheduled to run daily via Celery Beat.
    It deletes PaymentMandateBackup and PaymentTransactionBackup records
    that have exceeded their retention period.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        from api.models_payment_backup import PaymentMandateBackup, PaymentTransactionBackup
        from django.utils import timezone
        from django.conf import settings
        
        retention_days = getattr(settings, 'PAYMENT_BACKUP_RETENTION_DAYS', 15)
        cutoff_date = timezone.now() - timezone.timedelta(days=retention_days)
        
        logger.info(f'[PAYMENT_BACKUP_CLEANUP] Starting cleanup with retention={retention_days} days, cutoff={cutoff_date}')
        
        # Clean up mandate backups
        mandate_deleted, _ = PaymentMandateBackup.objects.filter(
            expires_at__lt=cutoff_date
        ).delete()
        
        # Clean up transaction backups
        transaction_deleted, _ = PaymentTransactionBackup.objects.filter(
            expires_at__lt=cutoff_date
        ).delete()
        
        total_deleted = mandate_deleted + transaction_deleted
        
        logger.info(f'[PAYMENT_BACKUP_CLEANUP] Deleted {mandate_deleted} mandate backups, {transaction_deleted} transaction backups (total: {total_deleted})')
        
        return f"Cleanup complete: deleted {total_deleted} expired backup records ({mandate_deleted} mandates, {transaction_deleted} transactions)"
        
    except Exception as e:
        import traceback
        logger.error(f'[PAYMENT_BACKUP_CLEANUP] Error: {str(e)}\n{traceback.format_exc()}')
        return f"Error in payment backup cleanup: {str(e)}\n{traceback.format_exc()}"
