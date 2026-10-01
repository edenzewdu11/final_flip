#!/usr/bin/env python3
"""
Migrate files from local storage to Ethiotelecom object storage
Maintains directory structure and uploads with public-read permissions
"""
import os
import boto3
from pathlib import Path

def migrate_to_ethiotelecom():
    # Configuration
    endpoint_url = "http://flipstar.obsv3.et-global-3.ethiotelecom.et"
    access_key = "DW2I41MO9FQVNYSD0QJG"
    secret_key = "n7KKo9gFxX8X8GmGsMnPXHx6wWGY3QaEFVDtU6Bl"
    region = "et-global-3"
    bucket_name = "flipstar-media"
    local_media_dir = "backend/media"
    
    # Initialize S3 client
    s3 = boto3.client(
        's3',
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region
    )
    
    print(f"Starting migration to Ethiotelecom...")
    print(f"Endpoint: {endpoint_url}")
    print(f"Bucket: {bucket_name}")
    print(f"Local directory: {local_media_dir}")
    print("=" * 60)
    
    # Count total files
    total_files = 0
    for root, dirs, files in os.walk(local_media_dir):
        total_files += len(files)
    
    print(f"Total files to migrate: {total_files}")
    print("=" * 60)
    
    # Migrate files
    success_count = 0
    failure_count = 0
    failed_files = []
    
    for root, dirs, files in os.walk(local_media_dir):
        for file in files:
            local_path = os.path.join(root, file)
            # Create S3 key by removing the 'backend/media/' prefix
            s3_key = local_path.replace(local_media_dir + '/', '')
            
            try:
                print(f"Uploading: {s3_key}")
                s3.upload_file(
                    local_path,
                    bucket_name,
                    s3_key,
                    ExtraArgs={'ACL': 'public-read'}
                )
                success_count += 1
                print(f"  ✓ Success ({success_count}/{total_files})")
            except Exception as e:
                failure_count += 1
                failed_files.append(s3_key)
                print(f"  ✗ Failed: {e}")
    
    print("=" * 60)
    print(f"Migration complete!")
    print(f"✓ Successful: {success_count}")
    print(f"✗ Failed: {failure_count}")
    
    if failed_files:
        print("\nFailed files:")
        for file in failed_files:
            print(f"  - {file}")
    
    # Verify uploads (Ethiotelecom OBS doesn't support listing, so we verify by downloading a sample)
    print("\nVerifying uploads (Ethiotelecom OBS doesn't support listing)...")
    try:
        # Try to download the first uploaded file to verify it exists
        first_file = None
        for root, dirs, files in os.walk(local_media_dir):
            if files:
                first_file = os.path.join(root, files[0])
                first_key = first_file.replace(local_media_dir + '/', '')
                break
        
        if first_file:
            s3.download_file(bucket_name, first_key, '/tmp/verify_download.jpg')
            print(f"✓ Verified file exists and can be downloaded: {first_key}")
            os.remove('/tmp/verify_download.jpg')
    except Exception as e:
        print(f"✗ Verification failed: {e}")
    
    print("=" * 60)
    return failure_count == 0

if __name__ == "__main__":
    success = migrate_to_ethiotelecom()
    exit(0 if success else 1)
