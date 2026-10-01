"""
Celery tasks for media compression.
Handles async video compression and other heavy processing tasks.
"""

from celery import shared_task
from django.conf import settings
import logging
from .compression import VideoCompressor
from .models import Reel
import os
import tempfile

logger = logging.getLogger(__name__)
compression_logger = logging.getLogger('compression')
s3_logger = logging.getLogger('s3')


@shared_task(bind=True, max_retries=3)
def compress_video_task(self, reel_id):
    """
    Compress video for a reel asynchronously.
    
    Args:
        reel_id: ID of the Reel to compress video for
    """
    compression_logger.info(f"[COMPRESSION] Starting async video compression task for Reel {reel_id}")
    
    try:
        reel = Reel.objects.get(id=reel_id)
        compression_logger.info(f"[COMPRESSION] Found Reel {reel_id}")
        
        if not reel.media or not reel.media.name:
            compression_logger.warning(f"[COMPRESSION] Reel {reel_id} has no media to compress")
            return
        
        compression_logger.info(f"[COMPRESSION] Media file: {reel.media.name}")
        
        # Download video from S3 to temp file
        import boto3
        from botocore.client import Config
        
        s3_logger.info(f"[S3] Connecting to Ethiotelecom S3 for video download")
        s3_client = boto3.client(
            's3',
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            region_name=settings.S3_REGION_NAME,
            config=Config(signature_version='s3v4')
        )
        s3_logger.info(f"[S3] Connected to S3: {settings.S3_ENDPOINT_URL}")
        
        # Create temp files
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as input_file:
            input_path = input_file.name
            compression_logger.info(f"[COMPRESSION] Created temp input file: {input_path}")
            # Download from S3
            s3_logger.info(f"[S3] Downloading {reel.media.name} from bucket {settings.S3_BUCKET_NAME}")
            s3_client.download_file(
                settings.S3_BUCKET_NAME,
                reel.media.name,
                input_path
            )
            s3_logger.info(f"[S3] Download completed")
        
        # Compress video
        output_path = tempfile.mktemp(suffix='.mp4')
        compression_logger.info(f"[COMPRESSION] Created temp output file: {output_path}")
        compressed_path = VideoCompressor.compress_video(
            input_path,
            output_path,
            resolution=getattr(settings, 'COMPRESSION_VIDEO_RESOLUTION', '720p'),
            bitrate=getattr(settings, 'COMPRESSION_VIDEO_BITRATE', '2M')
        )
        
        # Upload compressed video back to S3
        compression_logger.info(f"[COMPRESSION] Uploading compressed video to S3")
        s3_logger.info(f"[S3] Uploading compressed video to {reel.media.name}")
        with open(compressed_path, 'rb') as compressed_file:
            s3_client.upload_fileobj(
                compressed_file,
                settings.S3_BUCKET_NAME,
                reel.media.name,
                ExtraArgs={'ACL': 'public-read'}
            )
        s3_logger.info(f"[S3] Upload completed with public-read ACL")
        
        # Clean up temp files
        compression_logger.info(f"[COMPRESSION] Cleaning up temp files")
        os.unlink(input_path)
        os.unlink(compressed_path)
        
        compression_logger.info(f"[COMPRESSION] Successfully compressed video for Reel {reel_id}")
        
    except Reel.DoesNotExist:
        compression_logger.error(f"[COMPRESSION] Reel {reel_id} not found")
    except Exception as e:
        compression_logger.error(f"[COMPRESSION] Video compression failed for Reel {reel_id}: {e}")
        logger.error(f"Video compression failed for reel {reel_id}: {e}")
        # Retry with exponential backoff
        raise self.retry(exc=e, countdown=60 * (self.request.retries + 1))


@shared_task
def compress_existing_videos():
    """
    Batch task to compress all existing videos in the system.
    This can be run periodically to compress older content.
    """
    from django.conf import settings
    
    if not getattr(settings, 'COMPRESSION_ENABLED', False):
        logger.info("Compression is disabled, skipping batch compression")
        return
    
    # Get all reels with media
    reels = Reel.objects.exclude(media__isnull=True).exclude(media='')
    
    compressed_count = 0
    for reel in reels:
        try:
            # Check if video needs compression based on size
            if hasattr(reel.media, 'size'):
                size_mb = reel.media.size / (1024 * 1024)
                threshold = getattr(settings, 'COMPRESSION_VIDEO_THRESHOLD_MB', 10)
                
                if size_mb > threshold:
                    # Queue compression task
                    compress_video_task.delay(reel.id)
                    compressed_count += 1
                    
        except Exception as e:
            logger.error(f"Failed to queue compression for reel {reel.id}: {e}")
    
    logger.info(f"Queued compression for {compressed_count} videos")
    return compressed_count
