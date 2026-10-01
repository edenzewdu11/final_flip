import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

import boto3
from botocore.client import Config
from django.conf import settings

s3 = boto3.client(
    's3',
    endpoint_url=settings.S3_ENDPOINT_URL,
    aws_access_key_id=settings.S3_ACCESS_KEY_ID,
    aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
    region_name=settings.S3_REGION_NAME,
    config=Config(signature_version='s3v4')
)

print(f'=== Ethiotelecom S3 Storage Analysis ===')
print(f'Bucket: {settings.S3_BUCKET_NAME}')
print(f'Endpoint: {settings.S3_ENDPOINT_URL}')
print()

# Since Ethiotelecom doesn't support listing, we'll use Django models to estimate
from api.models import Reel, UserProfile, Campaign

print('=== Storage Estimation from Database ===')
total_files = 0
file_count_by_type = {
    'reels_media': 0,
    'reels_image': 0, 
    'reels_thumbnail': 0,
    'profile_photos': 0,
    'campaigns': 0
}

# Count Reel files
for reel in Reel.objects.all():
    if reel.media and reel.media.name:
        file_count_by_type['reels_media'] += 1
        total_files += 1
    if reel.image and reel.image.name:
        file_count_by_type['reels_image'] += 1
        total_files += 1
    if reel.thumbnail and reel.thumbnail.name:
        file_count_by_type['reels_thumbnail'] += 1
        total_files += 1

# Count UserProfile photos
for profile in UserProfile.objects.all():
    if profile.profile_photo and profile.profile_photo.name:
        file_count_by_type['profile_photos'] += 1
        total_files += 1

# Count Campaign images
for campaign in Campaign.objects.all():
    if campaign.image and campaign.image.name:
        file_count_by_type['campaigns'] += 1
        total_files += 1

print(f'Total files in database: {total_files}')
print()
print('Files by type:')
for file_type, count in file_count_by_type.items():
    print(f'  {file_type}: {count}')

print()
print('=== Ethiotelecom S3 Known Limitations ===')
print('✗ list_buckets() - Not supported')
print('✗ head_bucket() - Not supported') 
print('✗ list_objects() - Not supported')
print('✗ get_bucket_location() - Not supported')
print('✗ get_bucket_size() - Not supported')
print()
print('✓ put_object() - Supported (upload files)')
print('✓ get_object() - Supported (download files)')
print('✓ head_object() - Supported (check file exists)')
print('✓ delete_object() - Supported (delete files)')
print('✓ put_object_acl() - Supported (set permissions)')
print()
print('=== Storage Monitoring Recommendations ===')
print('1. Use database queries to track file count')
print('2. Monitor via Ethiotelecom web console if available')
print('3. Implement periodic size tracking in Django')
print('4. Set up alerts for storage limits via Ethiotelecom')
