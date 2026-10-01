import re

from django.utils.deprecation import MiddlewareMixin
from django.contrib.auth.models import AnonymousUser
from django.http import JsonResponse
from rest_framework.response import Response
from rest_framework import status
from django.core.cache import cache

class SubscriptionRequiredMiddleware(MiddlewareMixin):
    """
    Middleware to check if authenticated users have active subscriptions.
    Redirects users without active subscriptions to subscription page.
    Also blocks write operations for users in grace period.
    """

    # Paths that don't require subscription check
    EXEMPT_PATHS = [
        '/api/auth/',
        '/api/subscription/',
        '/api/health/',
        '/api/settings/public/',
        '/api/posts/',  # Allow viewing posts (GET only)
        '/api/reels/',  # Allow viewing reels (GET only)
        '/api/profile/',  # Allow viewing profiles (GET only)
        '/api/campaigns/',  # Allow viewing campaigns (GET only)
        '/api/search/',  # Allow search (GET only)
        '/api/explorer/',  # Allow explorer (GET only)
        '/api/follows/',  # Allow viewing followers/following (GET only)
        '/api/gamification/',  # Allow gamification features (daily bonuses, spins)
        '/api/wallet/',  # Allow wallet access
        '/api/coins/',  # Allow coin operations
        '/api/messages/',  # Allow messaging features
        '/api/direct-debit/',  # Payment-related endpoints
        '/admin/',
        '/media/',
        '/static/',
    ]

    # Specific endpoints that are always exempt (even if they fall under exempt paths)
    ALWAYS_EXEMPT_ENDPOINTS = [
        '/api/posts/create',  # This will be checked separately
        '/api/reels/create',
        '/api/comments/',
        '/api/likes/',
        '/api/gifts/',
        '/api/follows/toggle',
        '/api/saved/',
    ]

    # HTTP methods that don't require subscription (GET requests for viewing)
    EXEMPT_METHODS = ['GET', 'HEAD', 'OPTIONS']

    # Paths that are allowlisted for write operations during grace period
    GRACE_ALLOWLIST_PATHS = [
        '/api/auth/',
        '/api/profile/me/',
        '/api/subscription/',
        '/api/direct-debit/',
    ]

    def process_request(self, request):
        print(f"[Subscription Middleware] Processing request: {request.method} {request.path}")

        # Skip for unauthenticated users
        if not request.user or isinstance(request.user, AnonymousUser):
            print(f"[Subscription Middleware] User not authenticated, skipping")
            return None

        # Check if user has active subscription or is in grace period
        try:
            from .models_subscription import SubscriptionPlan
            from django.utils import timezone

            active_subscription = SubscriptionPlan.objects.filter(
                user=request.user,
                status='active',
                end_date__gt=timezone.now()
            ).first()

            # Check for grace period subscription
            grace_subscription = SubscriptionPlan.objects.filter(
                user=request.user,
                status='grace_period'
            ).first()

            # Auto-expire grace period if expired
            if grace_subscription and not grace_subscription.is_in_grace:
                print(f"[Subscription Middleware] Grace period expired for subscription {grace_subscription.id}, marking as expired")
                grace_subscription.status = 'expired'
                grace_subscription.save()
                grace_subscription = None

            if not active_subscription and not grace_subscription:
                # User has no active subscription and not in grace
                # Block POST/PUT/DELETE requests (write operations)
                if request.method not in self.EXEMPT_METHODS:
                    # For API requests, return 403 with subscription required info
                    if request.path.startswith('/api/'):
                        print(f"[Subscription Middleware] Blocking request - no subscription: {request.method} {request.path}")
                        return Response({
                            'error': 'Subscription required',
                            'message': 'You need an active subscription to perform this action',
                            'code': 'SUBSCRIPTION_REQUIRED'
                        }, status=status.HTTP_403_FORBIDDEN)

            if grace_subscription:
                # User is in grace period - block write operations except for allowlisted paths
                if request.method not in self.EXEMPT_METHODS:
                    # Check if path is allowlisted
                    is_allowlisted = any(request.path.startswith(path) for path in self.GRACE_ALLOWLIST_PATHS)

                    if not is_allowlisted:
                        print(f"[Subscription Middleware] Blocking request - grace period: {request.method} {request.path}")
                        return Response({
                            'error': 'Grace period active',
                            'message': 'Your subscription is in a grace period. Top up your balance to restore full access.',
                            'code': 'GRACE_PERIOD_ACTIVE',
                            'grace_period': True,
                            'grace_expires_at': grace_subscription.grace_expires_at.isoformat() if grace_subscription.grace_expires_at else None
                        }, status=status.HTTP_403_FORBIDDEN)

        except Exception as e:
            # If there's any error checking subscription, allow the request to proceed
            # to avoid breaking the app
            print(f"[Subscription Middleware] Error: {e}")
            pass

        return None

class AdminPathGuardMiddleware(MiddlewareMixin):
    """
    Finding #14 — Exposed Admin Endpoints & Privilege Escalation.

    The audit showed that several `/api/admin/*` endpoints were callable
    with a regular user's token. Per-view permission decorators do exist
    on most admin views, but the surface is huge (70+ endpoints across
    14 modules) and a single missed decorator yields full broken access
    control.

    This middleware enforces a single chokepoint: any request whose path
    begins with `/api/admin/` must come from an authenticated staff user.
    All per-view `IsAdminUser` decorators remain in place as defense in
    depth.

    Auth resolution: Django's session middleware doesn't know about DRF
    tokens, so we parse `Authorization: Token <key>` ourselves and look
    up the user. Anything else (no header, bad token, non-staff user) is
    refused with HTTP 403 and a generic JSON body.
    """

    ADMIN_PATH_PREFIX = "/api/admin/"

    def process_request(self, request):
        path = request.path or ""
        print(f"[AdminPathGuard] Processing: {request.method} {path}")

        if not path.startswith(self.ADMIN_PATH_PREFIX):
            return None

        # OPTIONS preflight is handled by the CORS middleware; let it through.
        if request.method == "OPTIONS":
            print(f"[AdminPathGuard] Allowing OPTIONS preflight")
            return None

        user = self._resolve_user(request)
        print(f"[AdminPathGuard] Resolved user: {user}, is_authenticated: {user.is_authenticated if user else False}, is_staff: {getattr(user, 'is_staff', False) if user else False}")

        if user is None or not user.is_authenticated:
            print(f"[AdminPathGuard] Blocking - authentication required")
            # Log unauthorized access attempt
            self._log_security_event(request, 'UNAUTHORIZED_API', 'HIGH', user, 'Authentication required')
            return JsonResponse(
                {"detail": "Authentication required."},
                status=401,
            )
        if not (getattr(user, "is_staff", False) or getattr(user, "is_superuser", False)):
            print(f"[AdminPathGuard] Blocking - admin privileges required")
            # Log unauthorized access attempt
            self._log_security_event(request, 'UNAUTHORIZED_API', 'HIGH', user, 'Admin privileges required')
            return JsonResponse(
                {"detail": "You do not have permission to perform this action."},
                status=403,
            )

        # Pin the user on the request so downstream views see the staff
        # account even if the per-view auth class hasn't run yet.
        request.user = user

        # Enforce permission_level for write actions. The AdminRole
        # permission_level is the source of truth — it applies even to
        # users whose Django `is_superuser` flag is True, because the
        # super_admin ROLE is independent of the granular LEVEL
        # (read_only / edit_only / full). Only users with NO AdminRole
        # at all (e.g. the bootstrap Django superuser created via
        # `createsuperuser`) bypass this check.
        #   - read_only: only GET / HEAD / OPTIONS allowed
        #   - edit_only: GET / HEAD / OPTIONS / POST / PUT / PATCH allowed
        #                (DELETE blocked — destructive)
        #   - full:      no extra restriction (per-view perms still apply)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            try:
                from .models_subscription import AdminRole
                admin_role = AdminRole.objects.filter(user=user, is_active=True).first()
            except Exception:
                admin_role = None

            if admin_role:
                level = admin_role.permission_level
                method = request.method
                blocked = False
                if level == "read_only":
                    blocked = True
                elif level == "edit_only" and method == "DELETE":
                    blocked = True

                if blocked:
                    print(f"[AdminPathGuard] Blocking {method} for {user.username} (role={admin_role.role}, level={level})")
                    self._log_security_event(
                        request, 'PERMISSION_DENIED', 'MEDIUM', user,
                        f'role={admin_role.role} level={level} cannot perform {method}'
                    )
                    nice_level = level.replace('_', ' ')
                    return JsonResponse(
                        {"detail": f"Your access level ({nice_level}) does not allow this action. Contact a super admin if you need access."},
                        status=403,
                    )
        return None

    def _log_security_event(self, request, event_type, severity, user, details):
        """Log security event to database"""
        try:
            from .models import SecurityEvent
            SecurityEvent.objects.create(
                event_type=event_type,
                severity=severity,
                user=user,
                username=user.username if user else 'Anonymous',
                ip_address=self._get_client_ip(request),
                user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
                endpoint=request.path,
                action=request.method,
                details=details
            )
            print(f"[AdminPathGuard] Logged security event: {event_type}")
        except Exception as e:
            print(f"[AdminPathGuard] Failed to log security event: {e}")

    def _get_client_ip(self, request):
        """Get client IP address from request"""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip

    @staticmethod
    def _resolve_user(request):
        # 1. Already authenticated by Django session middleware.
        existing = getattr(request, "user", None)
        if existing is not None and getattr(existing, "is_authenticated", False):
            return existing

        # 2. Resolve from DRF Token header.
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header:
            return None
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "token":
            return None
        try:
            from rest_framework.authtoken.models import Token  # local import to keep middleware light
            token = Token.objects.select_related("user").get(key=parts[1])
        except Exception:
            return None
        return token.user


class SecurityHeadersMiddleware(MiddlewareMixin):
    """
    Adds security-related response headers that are not handled by Django's
    built-in SecurityMiddleware. Kept intentionally permissive so it does not
    break the existing SPA, Django admin, or media streaming.

    Headers set:
      - Content-Security-Policy: baseline policy with frame-ancestors 'none'
        (blocks clickjacking) and object-src 'none'. Allows inline/eval for
        scripts/styles to remain compatible with the current React build;
        tighten in a follow-up once the bundle is verified.
      - X-Content-Type-Options: nosniff
      - Referrer-Policy: strict-origin-when-cross-origin

    Existing headers from upstream (nginx, Django, other middleware) are
    respected and never overwritten.
    """

    CSP = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https: http://flipstar.obsv3.et-global-3.ethiotelecom.et; "
        "media-src 'self' blob: https: http://flipstar.obsv3.et-global-3.ethiotelecom.et; "
        "font-src 'self' data: https:; "
        "connect-src 'self' https: wss:; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "object-src 'none'"
    )

    def process_response(self, request, response):
        response.setdefault('Content-Security-Policy', self.CSP)
        response.setdefault('X-Content-Type-Options', 'nosniff')
        response.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
        return response


class VideoStreamingMiddleware(MiddlewareMixin):
    """
    Middleware to add proper headers for video streaming
    """
    def process_response(self, request, response):
        # Only apply to video files
        if request.path.startswith('/media/') and any(request.path.endswith(ext) for ext in ['.mp4', '.webm', '.ogg', '.mov']):
            response['Accept-Ranges'] = 'bytes'
            response['Cache-Control'] = 'public, max-age=3600, must-revalidate'
            
            # Ensure proper content type
            if request.path.endswith('.mp4'):
                response['Content-Type'] = 'video/mp4'
            elif request.path.endswith('.webm'):
                response['Content-Type'] = 'video/webm'
            elif request.path.endswith('.ogg'):
                response['Content-Type'] = 'video/ogg'
            elif request.path.endswith('.mov'):
                response['Content-Type'] = 'video/quicktime'
                
        return response


class CustomCorsMiddleware(MiddlewareMixin):
    """
    Enhanced CORS middleware to ensure proper headers are set for the frontend.
    Works even if database connection fails.

    Finding #11: previously this middleware echoed
    `Access-Control-Allow-Origin: *` for any unknown origin while also setting
    `Access-Control-Allow-Credentials: true`, which violates the CORS spec and
    enables credentialed cross-origin abuse. We now strictly allowlist origins
    and only emit ACAO/ACAC headers when the request origin is trusted; for
    unknown origins we omit the headers, which is the correct behaviour
    (browser will block the cross-origin response).
    """

    ALLOWED_ORIGINS = (
        'https://uat.flipstar.et',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:30001',
    )

    ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD'
    ALLOWED_HEADERS = (
        'accept, accept-encoding, authorization, content-type, dnt, origin, '
        'user-agent, x-csrftoken, x-requested-with, x-forwarded-for, '
        'x-forwarded-host, x-forwarded-proto'
    )

    # The MACLE simulator serves the mini app from http://localhost:<port> and
    # the port changes every session (30001, 30003, ...). Allow any loopback
    # port so credentialed POST preflights from the simulator succeed. Loopback
    # origins only reach the server from the developer's own machine, so this
    # does not widen exposure to remote cross-origin callers.
    LOOPBACK_ORIGIN_REGEX = re.compile(r'^http://(localhost|127\.0\.0\.1):\d+$')

    def _is_allowed_origin(self, origin):
        if not origin:
            return False
        return origin in self.ALLOWED_ORIGINS or bool(self.LOOPBACK_ORIGIN_REGEX.match(origin))

    def _apply_cors_headers(self, response, origin):
        """Set CORS headers only for trusted origins; otherwise leave unset."""
        if self._is_allowed_origin(origin):
            response['Access-Control-Allow-Origin'] = origin
            response['Vary'] = 'Origin'
            response['Access-Control-Allow-Credentials'] = 'true'
            response['Access-Control-Allow-Methods'] = self.ALLOWED_METHODS
            response['Access-Control-Allow-Headers'] = self.ALLOWED_HEADERS
            response['Access-Control-Expose-Headers'] = 'content-type, x-csrftoken'
        return response

    def process_response(self, request, response):
        origin = request.META.get('HTTP_ORIGIN', '')
        self._apply_cors_headers(response, origin)
        if request.method == 'OPTIONS' and self._is_allowed_origin(origin):
            response.status_code = 200
            response['Access-Control-Max-Age'] = '86400'
        return response

    def process_request(self, request):
        # Handle OPTIONS preflight early so we don't hit the DB for it.
        if request.method == 'OPTIONS':
            from django.http import HttpResponse
            response = HttpResponse()
            origin = request.META.get('HTTP_ORIGIN', '')
            self._apply_cors_headers(response, origin)
            if self._is_allowed_origin(origin):
                response['Access-Control-Max-Age'] = '86400'
            return response
        return None


class AdminLoginThrottleMiddleware(MiddlewareMixin):
    """
    Throttle Django admin login attempts to prevent brute force attacks.
    Allows 4 attempts per 10 minutes per IP address.
    """
    MAX_ATTEMPTS = 4
    TIME_WINDOW = 600  # 10 minutes in seconds

    def process_request(self, request):
        # Only apply to admin login
        if not (request.path.startswith('/admin/') and request.method == 'POST'):
            return None

        # Get client IP
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0].strip()
        else:
            ip = request.META.get('REMOTE_ADDR', 'unknown')

        cache_key = f'admin_login_attempts:{ip}'
        attempts = cache.get(cache_key, 0)

        if attempts >= self.MAX_ATTEMPTS:
            from django.http import HttpResponse
            return HttpResponse(
                'Too many login attempts. Please try again in 10 minutes.',
                status=429
            )

        return None

    def process_response(self, request, response):
        # Only apply to admin login
        if not (request.path.startswith('/admin/') and request.method == 'POST'):
            return response

        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        ip = x_forwarded_for.split(',')[0].strip() if x_forwarded_for else request.META.get('REMOTE_ADDR', 'unknown')
        cache_key = f'admin_login_attempts:{ip}'

        # Django admin returns 302 (redirect) on successful login, 200 on failed login
        if response.status_code == 302:
            # Successful login - reset the failed-attempts counter
            cache.delete(cache_key)
        elif response.status_code == 200:
            # Failed login - increment failed-attempts counter
            attempts = cache.get(cache_key, 0) + 1
            cache.set(cache_key, attempts, self.TIME_WINDOW)

        return response


class SecurityScanMiddleware(MiddlewareMixin):
    """
    Middleware to block common security scanner and bot probe paths.
    This reduces 404 noise in logs and protects against automated attacks.
    """
    
    # Common scanner/bot probe patterns
    BLOCKED_PATHS = [
        '/proc.php',
        '/nuclei.svg',
        '/webui',
        '/admin.php',
        '/wp-admin',
        '/xmlrpc.php',
        '/.env',
        '/config.php',
        '/phpmyadmin',
        '/mysql',
        '/runners',
        '/robots.txt',
        '/sitemap.xml',
        '/favicon.ico',
    ]
    
    def process_request(self, request):
        path = request.path.lower()

        # Block root path requests from suspicious user agents (scanner probes)
        if path == '/' and self._is_suspicious_user_agent(request):
            try:
                from .models import SecurityEvent
                # Safely get user info - handle ASGI requests where user may not be set yet
                user = getattr(request, 'user', None)
                is_authenticated = getattr(user, 'is_authenticated', False) if user else False
                username = getattr(user, 'username', 'Anonymous') if is_authenticated else 'Anonymous'

                SecurityEvent.objects.create(
                    event_type='SCANNER_PROBE',
                    severity='LOW',
                    user=user if is_authenticated else None,
                    username=username,
                    ip_address=self._get_client_ip(request),
                    user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
                    endpoint=request.path,
                    action=request.method,
                    details='Blocked root path probe from suspicious user agent'
                )
                print(f"[SecurityScanMiddleware] Blocked root path probe from suspicious UA: {self._get_client_ip(request)}")
            except Exception as e:
                print(f"[SecurityScanMiddleware] Failed to log blocked probe: {e}")

            from django.http import HttpResponseForbidden
            return HttpResponseForbidden()

        # Check if path matches any blocked pattern
        for blocked in self.BLOCKED_PATHS:
            if blocked in path:
                # Log the blocked attempt
                try:
                    from .models import SecurityEvent
                    # Safely get user info - handle ASGI requests where user may not be set yet
                    user = getattr(request, 'user', None)
                    is_authenticated = getattr(user, 'is_authenticated', False) if user else False
                    username = getattr(user, 'username', 'Anonymous') if is_authenticated else 'Anonymous'

                    SecurityEvent.objects.create(
                        event_type='SCANNER_PROBE',
                        severity='LOW',
                        user=user if is_authenticated else None,
                        username=username,
                        ip_address=self._get_client_ip(request),
                        user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
                        endpoint=request.path,
                        action=request.method,
                        details=f'Blocked scanner probe: {blocked}'
                    )
                    print(f"[SecurityScanMiddleware] Blocked scanner probe: {request.path} from {self._get_client_ip(request)}")
                except Exception as e:
                    print(f"[SecurityScanMiddleware] Failed to log blocked probe: {e}")

                # Return 403 Forbidden
                from django.http import HttpResponseForbidden
                return HttpResponseForbidden()

        return None
    
    def _get_client_ip(self, request):
        """Get client IP address from request"""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip
    
    def _is_suspicious_user_agent(self, request):
        """Detect suspicious user agents commonly used by scanners"""
        user_agent = request.META.get('HTTP_USER_AGENT', '').lower()
        
        # Common scanner/bot patterns
        suspicious_patterns = [
            'zz;',  # Fake UA
            'ss;',  # Fake UA
            'kubuntu',
            'centos',
            'ubuntu',
            'scanner',
            'bot',
            'crawler',
            'spider',
        ]
        
        # Check if UA matches any suspicious pattern
        for pattern in suspicious_patterns:
            if pattern in user_agent:
                return True
        
        # Check for multiple requests from same IP to root path (rate limiting could be added here)
        return False


class GenericErrorHandlerMiddleware(MiddlewareMixin):
    """
    Finding #13 — Information Disclosure via Verbose Error Messages.

    In production, Django's DEBUG=False prevents stack traces from being shown,
    but API responses may still contain internal details in error messages.
    This middleware intercepts exceptions and returns generic error responses
    without exposing internal paths, stack traces, or system details.
    """
    
    def process_exception(self, request, exception):
        # Only handle API requests
        if not request.path.startswith('/api/'):
            return None
        
        # Let Django handle 404s and 403s normally (they're already generic)
        from django.http import Http404
        from django.core.exceptions import PermissionDenied
        if isinstance(exception, (Http404, PermissionDenied)):
            return None
        
        # For all other exceptions in production, return a generic error
        from django.conf import settings
        if not settings.DEBUG:
            from rest_framework.response import Response
            from rest_framework import status
            from .models import SecurityEvent
            
            # Log the detailed error server-side
            import traceback
            error_details = {
                'type': type(exception).__name__,
                'message': str(exception),
                'traceback': traceback.format_exc(),
                'path': request.path,
                'method': request.method,
            }
            
            # Log to security events if it looks like an attack
            if 'admin' in request.path.lower() or 'auth' in request.path.lower():
                try:
                    SecurityEvent.objects.create(
                        event_type='ERROR_EXCEPTION',
                        severity='MEDIUM',
                        user=request.user if request.user.is_authenticated else None,
                        username=request.user.username if request.user.is_authenticated else 'Anonymous',
                        ip_address=self._get_client_ip(request),
                        user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
                        endpoint=request.path,
                        action=request.method,
                        details=str(exception)[:500]
                    )
                except Exception:
                    pass  # Don't fail if logging fails
            
            # Return generic error to client
            return Response(
                {'error': 'An error occurred. Please try again later.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        return None
    
    def _get_client_ip(self, request):
        """Get client IP address from request"""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip
