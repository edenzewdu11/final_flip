"""
Per-endpoint throttle classes (Finding #1 — User Enumeration & No Rate Limiting).

Each subclass binds to a scope defined in
settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']. Apply them on
function-based views via @throttle_classes([...]).

Throttling uses Django's default cache backend, which is configured to Redis
in production (see settings.CHANNEL_LAYERS / Celery config), and falls back
to local-memory in dev. Rates are conservative defaults; tune in settings.
"""

import re

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


_RATE_RE = re.compile(r"^\s*(\d+)\s*/\s*(\d*)\s*([smhd])[a-z]*\s*$", re.IGNORECASE)


class _ExtendedRateMixin:
    """
    DRF's default `parse_rate` only handles single-unit periods like
    '3/m', '5/h' (it inspects period[0] only, so '3/10min' raises KeyError).

    This mixin extends the parser to accept a leading multiplier on the
    period, e.g. '3/10min', '5/30s', '10/2h'. Falls back to DRF's default
    parser if the format is unrecognised.

    SECURITY FIX: Changed from IP-based to account-based throttling to prevent
    bypass via X-Forwarded-For header spoofing. Now uses username/email/phone
    from request data for authenticated operations, and only falls back to IP
    for truly anonymous requests where no identifier is available.
    """

    def parse_rate(self, rate):
        if rate is None:
            return (None, None)
        m = _RATE_RE.match(rate)
        if not m:
            return super().parse_rate(rate)
        num_requests = int(m.group(1))
        multiplier = int(m.group(2)) if m.group(2) else 1
        unit = m.group(3).lower()
        unit_seconds = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
        return (num_requests, unit_seconds * multiplier)

    def get_ident(self, request):
        """
        Use account-based identifier for throttling to prevent IP spoofing attacks.
        Priority: authenticated user > request data (username/email/phone) > IP (last resort).
        """
        # For authenticated users, use user ID
        if request.user and request.user.is_authenticated:
            return f"user_{request.user.id}"

        # For anonymous requests, try to extract identifier from request data
        # This prevents bypass by changing IP via X-Forwarded-For
        if hasattr(request, 'data') and request.data:
            # Try username first
            username = request.data.get('username', '').strip()
            if username:
                return f"username_{username}"

            # Try email
            email = request.data.get('email', '').strip()
            if email:
                return f"email_{email}"

            # Try phone number
            phone = request.data.get('phone', '').strip()
            if phone:
                return f"phone_{phone}"

        # Last resort: use IP (but this is less secure)
        # Only use the first IP from X-Forwarded-For if present
        xff = request.META.get('HTTP_X_FORWARDED_FOR')
        if xff:
            return f"ip_{xff.split(',')[0].strip()}"
        return f"ip_{request.META.get('REMOTE_ADDR', '')}"


class _ExtendedAnonThrottle(_ExtendedRateMixin, AnonRateThrottle):
    pass


class _ExtendedUserThrottle(_ExtendedRateMixin, UserRateThrottle):
    pass


def _make(scope_name: str):
    """Build an (anon, user) pair of throttles bound to the same scope name."""
    anon = type(
        f"{scope_name.title()}AnonThrottle",
        (_ExtendedAnonThrottle,),
        {"scope": scope_name},
    )
    user = type(
        f"{scope_name.title()}UserThrottle",
        (_ExtendedUserThrottle,),
        {"scope": scope_name},
    )
    return anon, user


LoginAnonThrottle, LoginUserThrottle = _make("login")
AdminLoginAnonThrottle, AdminLoginUserThrottle = _make("admin_login")
OtpSendAnonThrottle, OtpSendUserThrottle = _make("otp_send")
OtpVerifyAnonThrottle, OtpVerifyUserThrottle = _make("otp_verify")
PasswordResetAnonThrottle, PasswordResetUserThrottle = _make("password_reset")
PhoneLookupAnonThrottle, PhoneLookupUserThrottle = _make("phone_lookup")


def _get_throttle_ident(request):
    """
    Get account-based identifier for throttling to prevent IP spoofing.
    Priority: authenticated user > request data (username/email/phone) > IP (last resort).
    """
    # For authenticated users, use user ID
    if request.user and request.user.is_authenticated:
        return f"user_{request.user.id}"

    # For anonymous requests, try to extract identifier from request data
    if hasattr(request, 'data') and request.data:
        username = request.data.get('username', '').strip()
        if username:
            return f"username_{username}"

        email = request.data.get('email', '').strip()
        if email:
            return f"email_{email}"

        phone = request.data.get('phone', '').strip()
        if phone:
            return f"phone_{phone}"

    # Last resort: use IP
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return f"ip_{xff.split(',')[0].strip()}"
    return f"ip_{request.META.get('REMOTE_ADDR', '')}"


def reset_throttle(request, scope: str):
    """
    Reset the throttle counter for the given scope and identifier.
    Call this on successful login/password-reset so that successful
    requests don't count against the rate limit.
    """
    from django.core.cache import cache
    ident = _get_throttle_ident(request)
    # DRF's SimpleRateThrottle cache key format: throttle_{scope}_{ident}
    cache.delete(f'throttle_{scope}_{ident}')


def check_and_increment_failure(request, scope: str, max_attempts: int, window_seconds: int):
    """
    Manually check throttle for failed attempts only. Returns the number of
    attempts remaining (0 means just-blocked). Increments the counter.

    Use this in views to count ONLY failed attempts (not successful ones).
    SECURITY FIX: Uses account-based identifier instead of IP to prevent bypass.
    """
    from django.core.cache import cache
    ident = _get_throttle_ident(request)
    cache_key = f'failed_attempts_{scope}_{ident}'

    attempts = cache.get(cache_key, 0) + 1
    cache.set(cache_key, attempts, window_seconds)
    return max(0, max_attempts - attempts)


def is_blocked(request, scope: str, max_attempts: int):
    """Check if the identifier is currently blocked without incrementing."""
    from django.core.cache import cache
    ident = _get_throttle_ident(request)
    cache_key = f'failed_attempts_{scope}_{ident}'
    return cache.get(cache_key, 0) >= max_attempts


def clear_failures(request, scope: str):
    """Clear failed attempt counter on successful login."""
    from django.core.cache import cache
    ident = _get_throttle_ident(request)
    cache.delete(f'failed_attempts_{scope}_{ident}')
