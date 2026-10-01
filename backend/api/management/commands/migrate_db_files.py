from django.core.management.base import BaseCommand
import os
import boto3
from django.conf import settings

class Command(BaseCommand):
    help = 'Migrate all database-referenced files to Ethiotelecom S3'

    def handle(self, *args, **options):
        from api.models import UserProfile, Reel
        from api.models_campaign import Campaign
        
        # S3 configuration
        endpoint_url = settings.S3_ENDPOINT_URL
        access_key = settings.S3_ACCESS_KEY_ID
        secret_key = settings.S3_SECRET_ACCESS_KEY
        region = settings.S3_REGION_NAME
        bucket_name = settings.S3_BUCKET_NAME
        
        s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region
        )
        
        self.stdout.write(f'Migrating database-referenced files to {bucket_name}...')
        self.stdout.write(f'Endpoint: {endpoint_url}')
        self.stdout.write('=' * 60)
        
        migrated_count = 0
        failed_count = 0
        failed_files = []
        
        # Migrate Reel media files
        self.stdout.write('\nMigrating Reel media files...')
        for reel in Reel.objects.all():
            for field_name in ['media', 'image', 'thumbnail']:
                field = getattr(reel, field_name)
                if field and hasattr(field, 'name'):
                    s3_key = field.name
                    # Try to find the file in local storage
                    local_path = f'/app/media/{s3_key}'
                    if os.path.exists(local_path):
                        try:
                            s3.upload_file(local_path, bucket_name, s3_key)
                            migrated_count += 1
                            self.stdout.write(f'  ✓ Migrated: {s3_key}')
                        except Exception as e:
                            failed_count += 1
                            failed_files.append(s3_key)
                            self.stdout.write(f'  ✗ Failed: {s3_key} - {e}')
                    else:
                        self.stdout.write(f'  ⊘ Local file not found: {s3_key}')
        
        # Migrate UserProfile profile photos
        self.stdout.write('\nMigrating UserProfile profile photos...')
        for profile in UserProfile.objects.all():
            if profile.profile_photo and hasattr(profile.profile_photo, 'name'):
                s3_key = profile.profile_photo.name
                # Try to find the file in local storage
                local_path = f'/app/media/{s3_key}'
                if os.path.exists(local_path):
                    try:
                        s3.upload_file(local_path, bucket_name, s3_key)
                        migrated_count += 1
                        self.stdout.write(f'  ✓ Migrated: {s3_key}')
                    except Exception as e:
                        failed_count += 1
                        failed_files.append(s3_key)
                        self.stdout.write(f'  ✗ Failed: {s3_key} - {e}')
                else:
                    self.stdout.write(f'  ⊘ Local file not found: {s3_key}')
        
        # Migrate Campaign media files
        self.stdout.write('\nMigrating Campaign media files...')
        for campaign in Campaign.objects.all():
            if campaign.image and hasattr(campaign.image, 'name'):
                s3_key = campaign.image.name
                # Try to find the file in local storage
                local_path = f'/app/media/{s3_key}'
                if os.path.exists(local_path):
                    try:
                        s3.upload_file(local_path, bucket_name, s3_key)
                        migrated_count += 1
                        self.stdout.write(f'  ✓ Migrated: {s3_key}')
                    except Exception as e:
                        failed_count += 1
                        failed_files.append(s3_key)
                        self.stdout.write(f'  ✗ Failed: {s3_key} - {e}')
                else:
                    self.stdout.write(f'  ⊘ Local file not found: {s3_key}')
        
        self.stdout.write('=' * 60)
        self.stdout.write(f'Migration complete!')
        self.stdout.write(f'✓ Successful: {migrated_count}')
        self.stdout.write(f'✗ Failed: {failed_count}')
        
        if failed_files:
            self.stdout.write('\nFailed files:')
            for file in failed_files:
                self.stdout.write(f'  - {file}')
