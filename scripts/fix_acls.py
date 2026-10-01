#!/usr/bin/env python3
"""
Script to fix ACLs on all objects in Ethiotelecom S3 bucket.
Sets all objects to public-read ACL.
Uses Django models to get file paths instead of listing (Ethiotelecom listing is broken).
"""

import os
import django
import boto3
from botocore.client import Config

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from api.models import Reel, Campaign, UserProfile

# Ethiotelecom S3 configuration
S3_ENDPOINT_URL = os.environ.get('S3_ENDPOINT_URL', 'http://flipstar.obsv3.et-global-3.ethiotelecom.et')
S3_ACCESS_KEY_ID = os.environ.get('S3_ACCESS_KEY_ID', 'DW2I41MO9FQVNYSD0QJG')
S3_SECRET_ACCESS_KEY = os.environ.get('S3_SECRET_ACCESS_KEY', 'n7KKo9gFxX8X8GmGsMnPXHx6wWGY3QaEFVDtU6Bl')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'flipstar-media')
S3_REGION_NAME = os.environ.get('S3_REGION_NAME', 'et-global-3')

print(f"Connecting to Ethiotelecom S3 at {S3_ENDPOINT_URL}")
print(f"Bucket: {S3_BUCKET_NAME}")
print(f"Region: {S3_REGION_NAME}")

# Create S3 client
s3_client = boto3.client(
    's3',
    endpoint_url=S3_ENDPOINT_URL,
    aws_access_key_id=S3_ACCESS_KEY_ID,
    aws_secret_access_key=S3_SECRET_ACCESS_KEY,
    region_name=S3_REGION_NAME,
    config=Config(signature_version='s3v4')
)

print("Connected successfully")

# Collect all file paths from database
print("Collecting file paths from database...")
file_paths = set()

# From Reels
for reel in Reel.objects.all():
    if reel.image and reel.image.name:
        file_paths.add(reel.image.name)
    if reel.media and reel.media.name:
        file_paths.add(reel.media.name)
    if reel.thumbnail and reel.thumbnail.name:
        file_paths.add(reel.thumbnail.name)

# From Campaigns
for campaign in Campaign.objects.all():
    if campaign.image and campaign.image.name:
        file_paths.add(campaign.image.name)

# From UserProfiles
for profile in UserProfile.objects.all():
    if profile.profile_photo and profile.profile_photo.name:
        file_paths.add(profile.profile_photo.name)

print(f"Found {len(file_paths)} unique file paths in database")

# Update ACLs
total_objects = len(file_paths)
updated_objects = 0
failed_objects = 0

for file_path in file_paths:
    print(f"Processing {file_path}...")
    try:
        # Set ACL to public-read
        s3_client.put_object_acl(
            Bucket=S3_BUCKET_NAME,
            Key=file_path,
            ACL='public-read'
        )
        updated_objects += 1
        print(f"  ✓ Updated ACL to public-read")
    except Exception as e:
        failed_objects += 1
        print(f"  ✗ Failed: {e}")

print(f"\nSummary:")
print(f"Total objects: {total_objects}")
print(f"Successfully updated: {updated_objects}")
print(f"Failed: {failed_objects}")
