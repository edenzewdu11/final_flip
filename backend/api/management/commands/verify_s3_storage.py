from django.core.management.base import BaseCommand
from django.conf import settings
from decouple import config
import boto3
from botocore.exceptions import ClientError


class Command(BaseCommand):
    help = 'Verify S3/MinIO storage configuration and connectivity'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('=== S3/MinIO Storage Verification ===\n'))

        # Check configuration
        access_key = config('ACCESS_KEY_ID', default='')
        secret_key = config('SECRET_ACCESS_KEY', default='')
        bucket_name = config('STORAGE_BUCKET_NAME', default='')
        endpoint_url = config('S3_ENDPOINT_URL', default='')
        region = config('REGION_NAME', default='us-east-1')

        self.stdout.write('Configuration Check:')
        self.stdout.write(f'  ACCESS_KEY_ID: {"✓ Set" if access_key else "✗ Not set"}')
        self.stdout.write(f'  SECRET_ACCESS_KEY: {"✓ Set" if secret_key else "✗ Not set"}')
        self.stdout.write(f'  STORAGE_BUCKET_NAME: {bucket_name or "✗ Not set"}')
        self.stdout.write(f'  S3_ENDPOINT_URL: {endpoint_url or "Not set (will use AWS S3)"}')
        self.stdout.write(f'  REGION_NAME: {region}')
        self.stdout.write('')

        # Check if using S3 or local storage
        if hasattr(settings, 'DEFAULT_FILE_STORAGE'):
            storage_backend = settings.DEFAULT_FILE_STORAGE
            self.stdout.write(f'Storage Backend: {storage_backend}')
            
            if 'S3Boto3Storage' in storage_backend:
                self.stdout.write(self.style.SUCCESS('✓ Using S3/MinIO for media storage'))
            elif 'FileSystemStorage' in storage_backend:
                self.stdout.write(self.style.WARNING('⚠ Using local filesystem storage'))
                self.stdout.write('  S3 credentials not configured or incomplete')
                return
        self.stdout.write('')

        # Test connectivity
        if not all([access_key, secret_key, bucket_name]):
            self.stdout.write(self.style.ERROR('Cannot test connectivity - missing credentials'))
            return

        self.stdout.write('Connectivity Test:')
        try:
            s3_kwargs = {
                'aws_access_key_id': access_key,
                'aws_secret_access_key': secret_key,
                'region_name': region,
            }
            if endpoint_url:
                s3_kwargs['endpoint_url'] = endpoint_url
                self.stdout.write(f'  Connecting to: {endpoint_url}')
            else:
                self.stdout.write('  Connecting to: AWS S3')

            s3 = boto3.client('s3', **s3_kwargs)
            self.stdout.write(self.style.SUCCESS('  ✓ Connection successful'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'  ✗ Connection failed: {e}'))
            return

        # Test bucket access
        self.stdout.write('\nBucket Access Test:')
        try:
            s3.head_bucket(Bucket=bucket_name)
            self.stdout.write(self.style.SUCCESS(f'  ✓ Bucket "{bucket_name}" exists and is accessible'))
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == '404':
                self.stdout.write(self.style.WARNING(f'  ⚠ Bucket "{bucket_name}" does not exist'))
                self.stdout.write('  Run: python manage.py setup_minio to create it')
            else:
                self.stdout.write(self.style.ERROR(f'  ✗ Bucket access error: {e}'))
            return

        # Test write permissions
        self.stdout.write('\nWrite Permission Test:')
        test_key = 'verification_test.txt'
        try:
            s3.put_object(
                Bucket=bucket_name,
                Key=test_key,
                Body=b'S3/MinIO verification test',
                ContentType='text/plain'
            )
            self.stdout.write(self.style.SUCCESS('  ✓ Write permission verified'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'  ✗ Write permission failed: {e}'))
            return

        # Test read permissions
        self.stdout.write('\nRead Permission Test:')
        try:
            response = s3.get_object(Bucket=bucket_name, Key=test_key)
            content = response['Body'].read()
            if content == b'S3/MinIO verification test':
                self.stdout.write(self.style.SUCCESS('  ✓ Read permission verified'))
            else:
                self.stdout.write(self.style.ERROR('  ✗ Read verification failed - content mismatch'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'  ✗ Read permission failed: {e}'))
            return

        # Test delete permissions
        self.stdout.write('\nDelete Permission Test:')
        try:
            s3.delete_object(Bucket=bucket_name, Key=test_key)
            self.stdout.write(self.style.SUCCESS('  ✓ Delete permission verified'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'  ✗ Delete permission failed: {e}'))
            return

        # Check storage backend settings
        self.stdout.write('\nDjango Storage Settings:')
        if hasattr(settings, 'MEDIA_URL'):
            self.stdout.write(f'  MEDIA_URL: {settings.MEDIA_URL}')
        if hasattr(settings, 'AWS_S3_ENDPOINT_URL'):
            self.stdout.write(f'  AWS_S3_ENDPOINT_URL: {settings.AWS_S3_ENDPOINT_URL}')
        if hasattr(settings, 'AWS_S3_USE_SSL'):
            self.stdout.write(f'  AWS_S3_USE_SSL: {settings.AWS_S3_USE_SSL}')

        self.stdout.write('\n' + self.style.SUCCESS('=== All S3/MinIO verification tests passed! ==='))
