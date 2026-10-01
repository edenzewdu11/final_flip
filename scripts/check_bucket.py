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

print(f'Checking bucket: {settings.S3_BUCKET_NAME}')
print(f'Endpoint: {settings.S3_ENDPOINT_URL}')

# Try to check if bucket exists
try:
    s3.head_bucket(Bucket=settings.S3_BUCKET_NAME)
    print(f'✓ Bucket {settings.S3_BUCKET_NAME} exists and is accessible')
except Exception as e:
    print(f'✗ Bucket check failed: {e}')
    print('  (Ethiotelecom S3 may not support head_bucket)')

# Try to check if a specific file exists (better verification)
try:
    s3.head_object(Bucket=settings.S3_BUCKET_NAME, Key='profile_photos/Remy_ratatoullie.jpg')
    print('✓ File exists - bucket is working correctly')
except Exception as e:
    print(f'✗ File check failed: {e}')
