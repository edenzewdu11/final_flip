import os
import mimetypes
from pathlib import Path
from decouple import config

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config('SECRET_KEY', default='django-insecure-key')
DEBUG = config('DEBUG', default=False, cast=bool)

# ALLOWED_HOSTS: read from env, then guarantee critical hosts are present.
ALLOWED_HOSTS = [h.strip() for h in config('ALLOWED_HOSTS', default='localhost,127.0.0.1').split(',') if h.strip()]
_required_hosts = [
    'localhost',
    '127.0.0.1',
    # 'postworq.onrender.com',
    # '.onrender.com',
    # Ethio Telecom production server
    'flipstar.et',
    # 'www.flipstar.et',
    'uat.flipstar.et',
    '196.189.236.140',
    # Local network IPs for mobile app testing (Expo Go)
    '192.168.1.8',
    '10.0.2.2',
]
for _h in _required_hosts:
    if _h not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(_h)

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'channels',  # Django Channels for real-time WebSocket
    'django_celery_beat',  # Celery beat for scheduled tasks
    'drf_spectacular',
    'drf_spectacular_sidecar',
    'api',
]

# Celery Configuration
CELERY_BROKER_URL = f"redis://{config('REDIS_HOST', default='127.0.0.1')}:{config('REDIS_PORT', default=6379)}/0"
CELERY_RESULT_BACKEND = f"redis://{config('REDIS_HOST', default='127.0.0.1')}:{config('REDIS_PORT', default=6379)}/0"
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'UTC'
CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'

# CORS settings
CORS_ALLOWED_ORIGINS = [
    "https://flipstar.et",
    "https://www.flipstar.et",
    "https://uat.flipstar.et",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:30001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:30001",
]
CSRF_TRUSTED_ORIGINS = [
    'https://flipstar.et',
    'https://www.flipstar.et',
    'https://uat.flipstar.et',
]
# Finding #11: never combine wildcard origins with credentialed requests.
# Explicit allowlist below (also redeclared further down) is the source of truth.
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True

MIDDLEWARE = [
    'api.middleware.CustomCorsMiddleware',  # Custom CORS for Vercel - handles all origins
    'api.middleware.SecurityScanMiddleware',  # Block common security scanner probes
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    # Finding #14: blanket guard on /api/admin/* — runs after auth so
    # request.user is populated; also resolves DRF token from header.
    'api.middleware.AdminPathGuardMiddleware',
    'api.middleware.AdminLoginThrottleMiddleware',  # Throttle admin login attempts
    # Finding #13: generic error handler to prevent verbose error messages
    'api.middleware.GenericErrorHandlerMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'api.middleware.SecurityHeadersMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [os.path.join(BASE_DIR, 'api', 'templates')],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Shared Redis cache (Finding #1: DRF throttle counters MUST be shared
# across gunicorn workers, otherwise each worker keeps its own counter and
# the effective rate limit is multiplied by the number of workers). Falls
# back to LocMemCache only if Redis is unreachable, but that should not
# happen in production where Redis is also used by Celery and Channels.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': f"redis://{config('REDIS_HOST', default='127.0.0.1')}:{config('REDIS_PORT', default=6379)}/1",
        'TIMEOUT': 300,
    }
}

# Django Channels configuration for Redis channel layer
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            "hosts": [(config('REDIS_HOST', default='127.0.0.1'), int(config('REDIS_PORT', default=6379)))],
        },
    },
}

# Auto-detect Render environment (RENDER env var is set automatically by Render)
IS_RENDER = config('RENDER', default=False, cast=bool) or os.environ.get('RENDER', False)

# Explicit override for self-hosted Docker deployments (e.g. Ethio Telecom server).
# When USE_DOCKER_DB=true is set in the .env, we ALWAYS use the local Docker
# postgres service regardless of RENDER / DATABASE_URL being present. This
# prevents the app from silently connecting to an old Neon database if stray
# env vars are carried over from a previous deploy.
USE_DOCKER_DB = config('USE_DOCKER_DB', default=False, cast=bool)
if USE_DOCKER_DB:
    IS_RENDER = False

# Database configuration
if IS_RENDER:
    # Render deployment: Use Neon database
    # Check for multiple possible environment variable names
    database_url = (config('DATABASE_URL', default=None) or
                    config('POSTGRES_URL', default=None) or
                    config('POSTGRESQL_URL', default=None) or
                    os.environ.get('DATABASE_URL') or
                    os.environ.get('POSTGRES_URL') or
                    os.environ.get('POSTGRESQL_URL'))

    if database_url:
        # Parse DATABASE_URL
        import urllib.parse
        parsed = urllib.parse.urlparse(database_url)
        DATABASES = {
            'default': {
                'ENGINE': 'django.db.backends.postgresql',
                'NAME': parsed.path.lstrip('/'),
                'USER': parsed.username,
                'PASSWORD': parsed.password,
                'HOST': parsed.hostname,
                'PORT': parsed.port or 5432,
                'OPTIONS': {
                    'sslmode': 'require',
                },
                'CONN_MAX_AGE': 0,
            }
        }
        print(f"=== USING DATABASE_URL ===")
        print(f"DATABASE_HOST: {parsed.hostname}")
        print(f"DATABASE_NAME: {parsed.path.lstrip('/')}")
    else:
        # Fallback to individual environment variables
        DATABASES = {
            'default': {
                'ENGINE': 'django.db.backends.postgresql',
                'NAME': config('DB_NAME', default='neondb'),
                'USER': config('DB_USER', default='neondb_owner'),
                'PASSWORD': config('DB_PASSWORD', default='your-db-password-here'),
                'HOST': config('DB_HOST', default='your-db-host-here'),
                'PORT': config('DB_PORT', default='5432'),
                'OPTIONS': {
                    'sslmode': 'require',
                    'connect_timeout': 10,
                },
                'CONN_MAX_AGE': 0,
            }
        }
        print(f"=== USING INDIVIDUAL ENV VARS ===")
        print(f"DATABASE_HOST: {DATABASES['default']['HOST']}")

    # Debug: Print database configuration (remove in production)
    print(f"=== NEW DEPLOYMENT DETECTED ===")
    print(f"DATABASE_HOST: {DATABASES['default']['HOST']}")
    print(f"DATABASE_NAME: {DATABASES['default']['NAME']}")
    print(f"DATABASE_USER: {DATABASES['default']['USER']}")
    print(f"=== DEPLOYMENT VERSION: 3.0 ===")

    # Test database connection and handle errors gracefully
    try:
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        print("=== DATABASE CONNECTION SUCCESSFUL ===")
    except Exception as e:
        print(f"=== DATABASE CONNECTION FAILED: {e} ===")
        print("=== FALLBACK TO SQLITE FOR CRITICAL OPERATIONS ===")
        # Fallback to SQLite for basic functionality
        DATABASES['default'] = {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': str(BASE_DIR / 'fallback_db.sqlite3'),
        }
else:
    # Local / Docker development
    _db_engine = config('DB_ENGINE', default='django.db.backends.sqlite3')
    if _db_engine == 'django.db.backends.postgresql':
        DATABASES = {
            'default': {
                'ENGINE': _db_engine,
                'NAME': config('DB_NAME', default='flipstar_db'),
                'USER': config('DB_USER', default='flipstar_user'),
                'PASSWORD': config('DB_PASSWORD', default='changeme'),
                'HOST': config('DB_HOST', default='postgres'),
                'PORT': config('DB_PORT', default='5432'),
            }
        }
    else:
        DATABASES = {
            'default': {
                'ENGINE': _db_engine,
                'NAME': config('DB_NAME', default=str(BASE_DIR / 'db.sqlite3')),
            }
        }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Africa/Addis_Ababa'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')
STATICFILES_DIRS = [
    os.path.join(BASE_DIR, 'static'),
]
MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# Backend URL for building absolute URLs in API responses
# This is used by serializers to construct full URLs for media files
BACKEND_URL = config('BACKEND_URL', default='https://flipstar.et')

# S3/MinIO storage configuration
S3_ACCESS_KEY_ID = config('ACCESS_KEY_ID', default='')
S3_SECRET_ACCESS_KEY = config('SECRET_ACCESS_KEY', default='')
S3_BUCKET_NAME = config('STORAGE_BUCKET_NAME', default='')
S3_REGION_NAME = config('REGION_NAME', default='us-east-1')
S3_ENDPOINT_URL = config('S3_ENDPOINT_URL', default='')
S3_CUSTOM_DOMAIN = f'{S3_BUCKET_NAME}.s3.amazonaws.com' if S3_BUCKET_NAME else None

# Use S3/MinIO for media storage if credentials are provided
if S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY and S3_BUCKET_NAME:
    DEFAULT_FILE_STORAGE = 'storages.backends.s3boto3.S3Boto3Storage'
    # Use WhiteNoise for static files, S3 only for media
    STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
    
    # S3 storage settings
    AWS_STORAGE_BUCKET_NAME = S3_BUCKET_NAME
    AWS_ACCESS_KEY_ID = S3_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY = S3_SECRET_ACCESS_KEY
    S3_OBJECT_PARAMETERS = {
        'CacheControl': 'max-age=86400',
    }
    S3_FILE_OVERWRITE = False
    S3_DEFAULT_ACL = 'public-read'  # Make files publicly accessible
    AWS_QUERYSTRING_AUTH = False  # Disable signed URLs for Ethiotelecom OBS
    AWS_S3_REGION_NAME = S3_REGION_NAME
    
    # Media compression settings
    COMPRESSION_ENABLED = True
    COMPRESSION_IMAGE_THRESHOLD_MB = 1  # Compress images larger than 1MB
    COMPRESSION_VIDEO_THRESHOLD_MB = 10  # Compress videos larger than 10MB
    COMPRESSION_IMAGE_QUALITY = 85  # JPEG quality (1-100)
    COMPRESSION_IMAGE_MAX_SIZE = (1920, 1080)  # Max dimensions
    COMPRESSION_VIDEO_RESOLUTION = '720p'  # Target resolution
    COMPRESSION_VIDEO_BITRATE = '2M'  # Target bitrate
    
    # If S3_ENDPOINT_URL is set, use MinIO/Ethiotelecom (self-hosted), otherwise use AWS S3
    if S3_ENDPOINT_URL:
        AWS_S3_ENDPOINT_URL = S3_ENDPOINT_URL
        AWS_S3_USE_SSL = False
        # Use nginx proxy to avoid mixed content (HTTP endpoint on HTTPS site)
        MEDIA_URL = 'https://uat.flipstar.et/flipstar-media/'
        # Static files served by WhiteNoise, not S3
    else:
        # AWS S3
        MEDIA_URL = f'https://{S3_CUSTOM_DOMAIN}/media/'
        # Static files served by WhiteNoise, not S3
    
    # S3/MinIO health check function
    def check_s3_health():
        """Check S3/MinIO connectivity and bucket access."""
        try:
            import boto3
            from botocore.exceptions import ClientError
            
            s3_kwargs = {
                'aws_access_key_id': S3_ACCESS_KEY_ID,
                'aws_secret_access_key': S3_SECRET_ACCESS_KEY,
                'region_name': S3_REGION_NAME,
            }
            if S3_ENDPOINT_URL:
                s3_kwargs['endpoint_url'] = S3_ENDPOINT_URL
            
            s3 = boto3.client('s3', **s3_kwargs)
            
            # Check bucket exists and is accessible
            s3.head_bucket(Bucket=S3_BUCKET_NAME)
            
            return {
                'status': 'healthy',
                'storage_type': 'MinIO' if S3_ENDPOINT_URL else 'AWS S3',
                'bucket': S3_BUCKET_NAME,
                'endpoint': S3_ENDPOINT_URL or 'AWS S3'
            }
        except ClientError as e:
            return {
                'status': 'unhealthy',
                'error': str(e),
                'bucket': S3_BUCKET_NAME
            }
        except Exception as e:
            return {
                'status': 'unhealthy',
                'error': str(e),
                'bucket': S3_BUCKET_NAME
            }
else:
    # Local storage
    DEFAULT_FILE_STORAGE = 'django.core.files.storage.FileSystemStorage'
    STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
    
    def check_s3_health():
        """S3 not configured, using local storage."""
        return {
            'status': 'not_configured',
            'storage_type': 'local',
            'message': 'S3/MinIO not configured, using local filesystem storage'
        }

# Configure mimetypes for video files
mimetypes.add_type('video/mp4', '.mp4', True)
mimetypes.add_type('video/webm', '.webm', True)
mimetypes.add_type('video/ogg', '.ogv', True)

# Streaming response settings
STREAMING_CONTENT_LENGTH = 4096

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Finding #6: token TTL (days) before forced re-auth. Configurable so the
# operations team can dial it down (e.g. to 1 for high-risk environments)
# without code changes.
AUTH_TOKEN_TTL_DAYS = config('AUTH_TOKEN_TTL_DAYS', default=14, cast=int)

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'api.authentication.ExpiringTokenAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'EXCEPTION_HANDLER': 'api.exception_handler.safe_exception_handler',
    # Disable schema generation to prevent API endpoint disclosure
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    # Finding #1: rate limiting on sensitive auth endpoints. Throttle classes
    # are applied per-view via @throttle_classes; scopes are defined here.
    'DEFAULT_THROTTLE_CLASSES': [],
    'DEFAULT_THROTTLE_RATES': {
        # Generic anon/user fallbacks (not globally enforced; available for
        # views that opt in to AnonRateThrottle / UserRateThrottle).
        'anon': '120/min',
        'user': '600/min',
        # Scoped throttles for ScopedRateThrottle.
        # 6 attempts per 10 minutes -> 10-minute lockout after the 6th fail.
        'login': '6/10min',
        'admin_login': '4/10min',
        'otp_send': '5/min',
        'otp_verify': '10/min',
        'password_reset': '5/min',
        'phone_lookup': '20/min',
    },
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'FlipStar API',
    'DESCRIPTION': 'OpenAPI schema for FlipStar web, mobile and admin clients.',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
    'SERVE_PUBLIC': False,
    'COMPONENT_SPLIT_REQUEST': True,
    'SCHEMA_PATH_PREFIX': r'/api/',
    'SCHEMA_PATH_PREFIX_TRIM': True,
    'SWAGGER_UI_DIST': 'SIDECAR',
    'REDOC_DIST': 'SIDECAR',
}

CORS_ALLOWED_ORIGINS = [
    "https://flipstar.et",
    "https://www.flipstar.et",
    "https://uat.flipstar.et",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:30001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:30001",
]

# The MACLE simulator serves the mini app from http://localhost:<port> with a
# port that changes every session, so allowlist any loopback port by regex.
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^http://(localhost|127\.0\.0\.1):\d+$",
]

# Finding #11: explicit allowlist only; credentials require non-wildcard origin.
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
]
CORS_EXPOSE_HEADERS = [
    'content-type',
    'x-csrftoken',
]

# File upload settings
FILE_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024 * 1024  # 50MB
DATA_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024 * 1024  # 50MB

# Trust X-Forwarded-Proto header from nginx for HTTPS behind reverse proxy
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# Clickjacking protection (Finding #4). XFrameOptionsMiddleware is already in
# MIDDLEWARE; force DENY so the site cannot be framed at all. CSP also enforces
# `frame-ancestors 'none'` via SecurityHeadersMiddleware as a modern fallback.
X_FRAME_OPTIONS = 'DENY'

# ─── Web Push (VAPID) ───────────────────────────────────────────────────────
# Generate keys once with:
#   python -m py_vapid --gen --applicationServerKey
# Then set them as env vars VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
# VAPID_PUBLIC_KEY is what the frontend sends to PushManager.subscribe().
VAPID_PUBLIC_KEY = config('VAPID_PUBLIC_KEY', default='')
VAPID_PRIVATE_KEY = config('VAPID_PRIVATE_KEY', default='')
VAPID_SUBJECT = config('VAPID_SUBJECT', default='mailto:admin@flipstar.et')

# ─── Telebirr Direct Debit (SOAP API) ───────────────────────────────────────
# SOAP API endpoint for direct debit mandate operations
TELEBIRR_SOAP_URL = config('TELEBIRR_SOAP_URL', default='http://10.180.79.13:30001/payment/services/APIRequestMgrService')
TELEBIRR_THIRD_PARTY_ID = config('TELEBIRR_THIRD_PARTY_ID', default='TestMer')
TELEBIRR_THIRD_PARTY_PASSWORD = config('TELEBIRR_THIRD_PARTY_PASSWORD', default='jIfxwUU1S7jJmh1dgP3+wK3fd4Qxlxxcc4cb4i0z4Tk=')
TELEBIRR_SHORTCODE = config('TELEBIRR_SHORTCODE', default='232323')
TELEBIRR_RESULT_URL = config('TELEBIRR_RESULT_URL', default='http://uat.flipstar.et:6082/api/webhooks/telebirrDirectDebit/')
TELEBIRR_PAYEE_ACCOUNT_NAME = config('TELEBIRR_PAYEE_ACCOUNT_NAME', default='Flipstar')
TELEBIRR_CALLER_TYPE = config('TELEBIRR_CALLER_TYPE', default='2')  # 2 = Third Party

# SP Operator credentials for SOAP API
TELEBIRR_SP_OPERATOR_ID = config('TELEBIRR_SP_OPERATOR_ID', default='TestSPOperAPI')
TELEBIRR_SP_OPERATOR_CREDENTIAL = config('TELEBIRR_SP_OPERATOR_CREDENTIAL', default='U40FWdnyHMyoEL2AHxPj0gZfmsMSyTZTxQUEvnWraqU=')

# Organization Operator credentials for SOAP API (InitTrans)
TELEBIRR_ORG_OPERATOR_ID = config('TELEBIRR_ORG_OPERATOR_ID', default='TestAPI')
TELEBIRR_ORG_OPERATOR_CREDENTIAL = config('TELEBIRR_ORG_OPERATOR_CREDENTIAL', default='w6byUD48WhFJzIqacTA1i/SBhBhzSbfRdQMvkEzOs6M=')

# ─── Telebirr B2C Payment (Individual B2C) ─────────────────────────────────────
# Service code for B2C payment CommandID format: InitTrans_{ServiceCode}
TELEBIRR_B2C_SERVICE_CODE = config('TELEBIRR_B2C_SERVICE_CODE', default='2304')
# Reason type for B2C payment transactions
TELEBIRR_B2C_REASON_TYPE = config('TELEBIRR_B2C_REASON_TYPE', default='Pay for Individual B2C_VDF_Demo')
# Webhook URL for B2C payment result callbacks
TELEBIRR_B2C_RESULT_URL = config('TELEBIRR_B2C_RESULT_URL', default='https://uat.flipstar.et/api/webhooks/telebirrB2C/')
# B2C-specific ORG operator credentials
TELEBIRR_B2C_ORG_OPERATOR_ID = config('TELEBIRR_B2C_ORG_OPERATOR_ID', default='')
TELEBIRR_B2C_ORG_OPERATOR_CREDENTIAL = config('TELEBIRR_B2C_ORG_OPERATOR_CREDENTIAL', default='')
# B2C-specific SOAP URL
TELEBIRR_B2C_SOAP_URL = config('TELEBIRR_B2C_SOAP_URL', default='')
# B2C-specific ThirdParty credentials
TELEBIRR_B2C_THIRD_PARTY_ID = config('TELEBIRR_B2C_THIRD_PARTY_ID', default='')
TELEBIRR_B2C_THIRD_PARTY_PASSWORD = config('TELEBIRR_B2C_THIRD_PARTY_PASSWORD', default='')

# ─── Telebirr USSD Push Payment (BuyGoodsForCustomer) ───────────────────────
# Merchant shortcode for receiving payments (ReceiverParty)
TELEBIRR_USSD_MERCHANT_SHORTCODE = config('TELEBIRR_USSD_MERCHANT_SHORTCODE', default='53599')
# Webhook URL for USSD Push result callbacks
TELEBIRR_USSD_RESULT_URL = config('TELEBIRR_USSD_RESULT_URL', default='http://uat.flipstar.et:6082/api/webhooks/telebirrUssdPurchase/')
# USSD Push SOAP URL (can reuse B2C SOAP URL)
TELEBIRR_USSD_SOAP_URL = config('TELEBIRR_USSD_SOAP_URL', default='https://10.180.70.177:30002/payment/services/APIRequestMgrService')
# Dedicated USSD Push credentials (ThirdPartyID/Password + Org Operator Identifier/SecurityCredential)
TELEBIRR_USSD_THIRD_PARTY_ID = config('TELEBIRR_USSD_THIRD_PARTY_ID', default='SKYKIN')
TELEBIRR_USSD_THIRD_PARTY_PASSWORD = config('TELEBIRR_USSD_THIRD_PARTY_PASSWORD', default='')
TELEBIRR_USSD_ORG_OPERATOR_ID = config('TELEBIRR_USSD_ORG_OPERATOR_ID', default='')
TELEBIRR_USSD_ORG_OPERATOR_CREDENTIAL = config('TELEBIRR_USSD_ORG_OPERATOR_CREDENTIAL', default='')

# ─── Telebirr H5 / SuperApp Web Checkout (Fabric Payment Gateway) ────────────
# Used by TelebirrService (api/telebirr_service.py) for the H5 InApp flow:
#   applyFabricToken -> preOrder -> rawRequest -> js_fun_start_pay -> notify/queryOrder
# Test bed defaults point at the developer portal. For production set
# TELEBIRR_H5_BASE_URL to the production gateway.
TELEBIRR_H5_BASE_URL = config(
    'TELEBIRR_H5_BASE_URL',
    default='https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway',
)
# Fabric portal credentials (X-APP-Key + appSecret)
TELEBIRR_FABRIC_APP_ID = config('TELEBIRR_FABRIC_APP_ID', default='')
TELEBIRR_APP_SECRET = config('TELEBIRR_APP_SECRET', default='')
# Merchant identity assigned by the Mobile Payment system
TELEBIRR_MERCHANT_APP_ID = config('TELEBIRR_MERCHANT_APP_ID', default='')
TELEBIRR_MERCHANT_CODE = config('TELEBIRR_MERCHANT_CODE', default='')
# RSA key material (PEM). TELEBIRR_PRIVATE_KEY signs our requests;
# TELEBIRR_PUBLIC_KEY (the SP/Telebirr public key) verifies async notifications.
def _format_pem_key(key_str, key_type='PRIVATE'):
    """Format a single-line PEM key with proper newlines."""
    if not key_str:
        return key_str
    
    # First, replace literal \n with actual newlines
    key_str = key_str.replace('\\n', '\n')
    
    # Check if header/footer are present, if not add them
    if not key_str.startswith('-----BEGIN'):
        # Docker Compose stripped the header/footer, add them back
        if key_type == 'PRIVATE':
            key_str = '-----BEGIN PRIVATE KEY-----\n' + key_str + '\n-----END PRIVATE KEY-----'
        else:
            key_str = '-----BEGIN PUBLIC KEY-----\n' + key_str + '\n-----END PUBLIC KEY-----'
    
    # Extract header (everything up to first newline)
    header_end = key_str.find('\n')
    if header_end == -1:
        # No newline, find the end of the header line by looking for the second -----
        header_end = key_str.find('-----', 5) + 5
    header = key_str[:header_end]
    
    # Extract footer (everything from last -----END to end)
    footer_start = key_str.rfind('-----END')
    footer = key_str[footer_start:]
    
    # Extract base64 data (everything between header and footer)
    base64_data = key_str[header_end:footer_start].replace('\n', '')
    
    # Format with proper newlines
    formatted = header + '\n'
    # Split base64 into 64-character chunks
    for i in range(0, len(base64_data), 64):
        formatted += base64_data[i:i+64] + '\n'
    formatted += footer
    
    return formatted

TELEBIRR_PRIVATE_KEY = _format_pem_key(config('TELEBIRR_PRIVATE_KEY', default=''), 'PRIVATE')
TELEBIRR_PUBLIC_KEY = _format_pem_key(config('TELEBIRR_PUBLIC_KEY', default=''), 'PUBLIC')
# Callback URLs
TELEBIRR_NOTIFY_URL = config('TELEBIRR_NOTIFY_URL', default='https://196.189.236.140/api/wallet/telebirr-callback/')
TELEBIRR_REDIRECT_URL = config('TELEBIRR_REDIRECT_URL', default='https://196.189.236.140/wallet')
TELEBIRR_DISBURSE_NOTIFY_URL = config('TELEBIRR_DISBURSE_NOTIFY_URL', default='https://196.189.236.140/api/subscription/telebirr-disburse-callback/')

# ─── Onevas SMS Configuration ─────────────────────────────────────────────────────
ONEVAS_APPLICATION_KEY = config('ONEVAS_APPLICATION_KEY', default='UPJG5ZM3X6C9LLDSKKCME4MA86UQRKWV')
ONEVAS_PRODUCT_NUMBER = config('ONEVAS_PRODUCT_NUMBER', default='10000302850')

# ─── Onevas Charging Configuration (for on-demand coin purchases) ───────────────
ONEVAS_CHARGING_APPLICATION_KEY = config('ONEVAS_CHARGING_APPLICATION_KEY', default='4CROFBT0EGCM1OK8R88EQBTEZOMI3138')
ONEVAS_CHARGING_PRODUCT_NUMBER = config('ONEVAS_CHARGING_PRODUCT_NUMBER', default='10000302853')

# ─── Apple In-App Purchase (StoreKit Receipt Validation) ───────────────────────
# Shared secret from App Store Connect > App Information > App-Specific Shared Secret.
# Required for validating auto-renewable subscription receipts.
APPLE_SHARED_SECRET = config('APPLE_SHARED_SECRET', default='')
# Bundle identifier of the iOS app (must match Xcode / App Store Connect).
APPLE_BUNDLE_ID = config('APPLE_BUNDLE_ID', default='com.skykintech.flipstar')
# Apple's receipt verification endpoints (production tries first, falls back to
# sandbox automatically on status 21007 per Apple's guidance).
APPLE_VERIFY_RECEIPT_URL_PRODUCTION = 'https://buy.itunes.apple.com/verifyReceipt'
APPLE_VERIFY_RECEIPT_URL_SANDBOX = 'https://sandbox.itunes.apple.com/verifyReceipt'

# ─── Ethio Telecom CRM Integration (PresentServiceGift API) ─────────────────────
CRM_ENDPOINT = config('CRM_ENDPOINT', default='http://10.190.9.3:7080/IPCC/ESB4mVASHandle')
CRM_SERVICE_NUMBER_A = config('CRM_SERVICE_NUMBER_A', default='0911227833')
CRM_ACCESS_USER = config('CRM_ACCESS_USER', default='FlipStar')
CRM_ACCESS_PASSWORD = config('CRM_ACCESS_PASSWORD', default='K/RZDkC9/Oltz5TR3IZ7RA==')
CRM_CHANNEL_ID = config('CRM_CHANNEL_ID', default='126')
CRM_TECHNICAL_CHANNEL_ID = config('CRM_TECHNICAL_CHANNEL_ID', default='51')
CRM_TENANT_ID = config('CRM_TENANT_ID', default='101')
CRM_CURRENCY_ID = config('CRM_CURRENCY_ID', default='1048')  # ETB currency ID
CRM_CHARGE_CODE = config('CRM_CHARGE_CODE', default='CC_GIFT_ONCE_OFF_FEE')
CRM_OFFERING_ID = config('CRM_OFFERING_ID', default='1939006845')  # Default offering ID for gifts
CRM_CHARGE_AMOUNT = config('CRM_CHARGE_AMOUNT', default='5566.60')  # Default charge amount for gifts

# ─── Logging Configuration ─────────────────────────────────────────────────────
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'loggers': {
        'api.crm_service': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
        'api.tasks': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
        'django': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}
