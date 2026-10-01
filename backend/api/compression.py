"""
Media compression utilities for S3 storage optimization.
Handles image and video compression to reduce storage costs and improve performance.
"""

import os
import io
from PIL import Image
import ffmpeg
from django.conf import settings
import logging

logger = logging.getLogger(__name__)
compression_logger = logging.getLogger('compression')


class ImageCompressor:
    """Compress images using Pillow library."""
    
    @staticmethod
    def compress_image(image_file, max_size=(1920, 1080), quality=85, format='JPEG'):
        """
        Compress an image file.
        
        Args:
            image_file: File object or path
            max_size: Maximum dimensions (width, height)
            quality: JPEG quality (1-100)
            format: Output format (JPEG, PNG, WEBP)
            
        Returns:
            Compressed image file object
        """
        compression_logger.info(f"[COMPRESSION] Starting image compression - Max size: {max_size}, Quality: {quality}, Format: {format}")
        
        try:
            # Open image
            if hasattr(image_file, 'read'):
                img = Image.open(image_file)
                img = img.convert('RGB')  # Convert to RGB for JPEG
            else:
                img = Image.open(image_file)
                if img.mode in ('RGBA', 'P'):
                    img = img.convert('RGB')
            
            original_size = img.size
            compression_logger.info(f"[COMPRESSION] Original image size: {original_size}")
            
            # Resize if needed
            img.thumbnail(max_size, Image.LANCZOS)
            new_size = img.size
            compression_logger.info(f"[COMPRESSION] Resized to: {new_size}")
            
            # Compress
            output = io.BytesIO()
            save_kwargs = {'quality': quality, 'optimize': True}
            
            if format == 'JPEG':
                img.save(output, format='JPEG', **save_kwargs)
            elif format == 'PNG':
                img.save(output, format='PNG', optimize=True)
            elif format == 'WEBP':
                img.save(output, format='WEBP', quality=quality, method=6)
            else:
                img.save(output, format='JPEG', **save_kwargs)
            
            compressed_size = output.tell()
            compression_logger.info(f"[COMPRESSION] Compressed size: {compressed_size} bytes ({compressed_size/1024:.2f} KB)")
            
            output.seek(0)
            compression_logger.info(f"[COMPRESSION] Image compression completed successfully")
            return output
            
        except Exception as e:
            compression_logger.error(f"[COMPRESSION] Image compression failed: {e}")
            logger.error(f"Image compression failed: {e}")
            return image_file  # Return original if compression fails
    
    @staticmethod
    def get_image_size(image_file):
        """Get image dimensions."""
        try:
            if hasattr(image_file, 'read'):
                img = Image.open(image_file)
            else:
                img = Image.open(image_file)
            return img.size
        except Exception as e:
            logger.error(f"Failed to get image size: {e}")
            return None


class VideoCompressor:
    """Compress videos using FFmpeg."""
    
    @staticmethod
    def compress_video(input_file, output_file=None, resolution='720p', bitrate='2M'):
        """
        Compress a video file using FFmpeg.
        
        Args:
            input_file: Input video file path
            output_file: Output video file path (if None, creates temp file)
            resolution: Target resolution (720p, 480p, 1080p)
            bitrate: Target bitrate (e.g., '2M', '1M')
            
        Returns:
            Path to compressed video file
        """
        compression_logger.info(f"[COMPRESSION] Starting video compression - Resolution: {resolution}, Bitrate: {bitrate}")
        
        try:
            if output_file is None:
                # Create temp file
                import tempfile
                output_file = tempfile.mktemp(suffix='.mp4')
                compression_logger.info(f"[COMPRESSION] Created temp output file: {output_file}")
            
            # Resolution mapping
            resolution_map = {
                '720p': (1280, 720),
                '480p': (854, 480),
                '1080p': (1920, 1080),
                '360p': (640, 360)
            }
            
            width, height = resolution_map.get(resolution, (1280, 720))
            compression_logger.info(f"[COMPRESSION] Target resolution: {width}x{height}")
            
            # Get original file size
            original_size = os.path.getsize(input_file)
            compression_logger.info(f"[COMPRESSION] Original video size: {original_size} bytes ({original_size/1024/1024:.2f} MB)")
            
            # FFmpeg compression command
            compression_logger.info(f"[COMPRESSION] Starting FFmpeg compression...")
            (
                ffmpeg
                .input(input_file)
                .output(
                    output_file,
                    vf=f'scale={width}:{height}',
                    video_bitrate=bitrate,
                    audio_bitrate='128k',
                    codec='libx264',
                    preset='medium',
                    movflags='faststart',
                    acodec='aac'
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            
            # Get compressed file size
            compressed_size = os.path.getsize(output_file)
            compression_logger.info(f"[COMPRESSION] Compressed video size: {compressed_size} bytes ({compressed_size/1024/1024:.2f} MB)")
            compression_logger.info(f"[COMPRESSION] Size reduction: {(1 - compressed_size/original_size)*100:.1f}%")
            compression_logger.info(f"[COMPRESSION] Video compression completed successfully")
            
            return output_file
            
        except Exception as e:
            compression_logger.error(f"[COMPRESSION] Video compression failed: {e}")
            logger.error(f"Video compression failed: {e}")
            return input_file  # Return original if compression fails
    
    @staticmethod
    def get_video_info(video_file):
        """Get video information (duration, size, etc)."""
        try:
            probe = ffmpeg.probe(video_file)
            video_info = probe['streams'][0]
            
            return {
                'duration': float(probe['format']['duration']),
                'width': int(video_info['width']),
                'height': int(video_info['height']),
                'bitrate': int(probe['format']['bit_rate']) if 'bit_rate' in probe['format'] else None,
                'size': int(probe['format']['size'])
            }
        except Exception as e:
            logger.error(f"Failed to get video info: {e}")
            return None


class MediaCompressor:
    """Main compression interface."""
    
    @staticmethod
    def compress_file(file_obj, file_type='image', **kwargs):
        """
        Compress a media file based on type.
        
        Args:
            file_obj: File object to compress
            file_type: 'image' or 'video'
            **kwargs: Additional compression parameters
            
        Returns:
            Compressed file object
        """
        if file_type == 'image':
            return ImageCompressor.compress_image(file_obj, **kwargs)
        elif file_type == 'video':
            return VideoCompressor.compress_video(file_obj, **kwargs)
        else:
            return file_obj
    
    @staticmethod
    def should_compress(file_size_mb=0, file_type='image'):
        """
        Determine if file should be compressed based on size and type.
        
        Args:
            file_size_mb: File size in MB
            file_type: 'image' or 'video'
            
        Returns:
            Boolean indicating if compression should be applied
        """
        # Get compression thresholds from settings
        image_threshold = getattr(settings, 'COMPRESSION_IMAGE_THRESHOLD_MB', 1)
        video_threshold = getattr(settings, 'COMPRESSION_VIDEO_THRESHOLD_MB', 10)
        
        if file_type == 'image':
            return file_size_mb > image_threshold
        elif file_type == 'video':
            return file_size_mb > video_threshold
        return False
