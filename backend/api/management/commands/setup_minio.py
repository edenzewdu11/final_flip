from django.core.management.base import BaseCommand
from django.conf import settings
from decouple import config
import boto3
from botocore.exceptions import ClientError


class Command(BaseCommand):
    help = 'Initialize MinIO S3 storage - create buckets and set policies'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('Starting MinIO setup...'))

        # Get configuration
        access_key = config('ACCESS_KEY_ID', default='')
        secret_key = config('SECRET_ACCESS_KEY', default='')
        bucket_name = config('STORAGE_BUCKET_NAME', default='')
        endpoint_url = config('S3_ENDPOINT_URL', default='')
        region = config('REGION_NAME', default='us-east-1')

        # Check if credentials are configured
        if not all([access_key, secret_key, bucket_name]):
            self.stdout.write(self.style.ERROR(
                'S3/MinIO credentials not configured. '
                'Please set ACCESS_KEY_ID, SECRET_ACCESS_KEY, and STORAGE_BUCKET_NAME in .env'
            ))
            return

        # Initialize S3 client
        try:
            s3_kwargs = {
                'aws_access_key_id': access_key,
                'aws_secret_access_key': secret_key,
                'region_name': region,
            }
            if endpoint_url:
                s3_kwargs['endpoint_url'] = endpoint_url
                self.stdout.write(f'Connecting to MinIO at: {endpoint_url}')
            else:
                self.stdout.write('Connecting to AWS S3')

            s3 = boto3.client('s3', **s3_kwargs)
            self.stdout.write(self.style.SUCCESS('Successfully connected to S3/MinIO'))

        except Exception as e:
            self.stdout.write(self.style.ERROR(f'Failed to connect to S3/MinIO: {e}'))
            return

        # Create bucket if it doesn't exist
        try:
            s3.head_bucket(Bucket=bucket_name)
            self.stdout.write(self.style.SUCCESS(f'Bucket "{bucket_name}" already exists'))
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == '404':
                try:
                    if endpoint_url:  # MinIO
                        s3.create_bucket(Bucket=bucket_name)
                    else:  # AWS S3 - need region
                        s3.create_bucket(
                            Bucket=bucket_name,
                            CreateBucketConfiguration={'LocationConstraint': region}
                        )
                    self.stdout.write(self.style.SUCCESS(f'Created bucket "{bucket_name}"'))
                except Exception as create_error:
                    self.stdout.write(self.style.ERROR(f'Failed to create bucket: {create_error}'))
                    return
            else:
                self.stdout.write(self.style.ERROR(f'Error checking bucket: {e}'))
                return

        # Set bucket policy for public read access
        bucket_policy = {
            'Version': '2012-10-17',
            'Statement': [
                {
                    'Sid': 'PublicReadGetObject',
                    'Effect': 'Allow',
                    'Principal': '*',
                    'Action': 's3:GetObject',
                    'Resource': f'arn:aws:s3:::{bucket_name}/*'
                }
            ]
        }

        try:
            s3.put_bucket_policy(
                Bucket=bucket_name,
                Policy=str(bucket_policy).replace("'", '"')
            )
            self.stdout.write(self.style.SUCCESS('Set bucket policy for public read access'))
        except Exception as policy_error:
            self.stdout.write(self.style.WARNING(f'Could not set bucket policy: {policy_error}'))
            self.stdout.write('Note: MinIO may not support bucket policies in all configurations')

        # Create subdirectories (prefixes) for organization
        directories = ['media', 'media/profile_photos', 'media/reels', 'media/campaigns']
        for directory in directories:
            try:
                s3.put_object(
                    Bucket=bucket_name,
                    Key=f'{directory}/',
                    Body=''
                )
                self.stdout.write(self.style.SUCCESS(f'Created directory: {directory}/'))
            except Exception as dir_error:
                self.stdout.write(self.style.WARNING(f'Could not create directory {directory}: {dir_error}'))

        # Test upload
        test_key = 'test_upload.txt'
        try:
            s3.put_object(
                Bucket=bucket_name,
                Key=test_key,
                Body=b'MinIO setup test',
                ContentType='text/plain'
            )
            self.stdout.write(self.style.SUCCESS('Test upload successful'))

            # Clean up test file
            s3.delete_object(Bucket=bucket_name, Key=test_key)
            self.stdout.write(self.style.SUCCESS('Test cleanup successful'))
        except Exception as test_error:
            self.stdout.write(self.style.ERROR(f'Test upload failed: {test_error}'))

        self.stdout.write(self.style.SUCCESS('MinIO setup completed successfully!'))
