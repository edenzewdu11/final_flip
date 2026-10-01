"""
Custom authentication classes (Finding #6 — Account Takeover).

DRF's default `TokenAuthentication` issues tokens that never expire, which
combined with the historic lack of session invalidation on password change
(see Finding #7) made stolen tokens long-lived. We wrap it with a TTL check
so tokens older than `AUTH_TOKEN_TTL_DAYS` (default 14) force the user to
re-authenticate.

Token rotation on password change/reset is handled in views.py.
"""

from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.utils import timezone
from rest_framework.authentication import BasicAuthentication, TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed


class ExpiringTokenAuthentication(TokenAuthentication):
    """
    TokenAuthentication that rejects tokens older than AUTH_TOKEN_TTL_DAYS.

    On expiry the stale token is deleted server-side and a 401 is returned
    so the client cleanly re-authenticates.
    """

    def authenticate_credentials(self, key):
        user, token = super().authenticate_credentials(key)

        ttl_days = getattr(settings, "AUTH_TOKEN_TTL_DAYS", 14)
        if ttl_days and ttl_days > 0:
            age = timezone.now() - token.created
            if age > timedelta(days=ttl_days):
                token.delete()
                raise AuthenticationFailed(
                    "Authentication token has expired. Please log in again."
                )

        return user, token


class StaffBasicAuthentication(BasicAuthentication):
    """Basic auth that accepts username, phone number, or email as the userid."""

    def authenticate_credentials(self, userid, password, request=None):
        user = authenticate(request=request, username=userid, password=password)

        if user is None:
            User = get_user_model()
            if user is None and hasattr(User, "phone_number"):
                found = User._default_manager.filter(phone_number=userid).first()
                if found and found.check_password(password):
                    user = found

            if user is None and hasattr(User, "email"):
                found = User._default_manager.filter(email=userid).first()
                if found and found.check_password(password):
                    user = found

        if user is None or not user.is_active:
            raise AuthenticationFailed("Invalid username/password.")

        return (user, None)
