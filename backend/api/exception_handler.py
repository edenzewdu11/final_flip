import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_default_handler

logger = logging.getLogger(__name__)


def safe_exception_handler(exc, context):
    """
    Wraps DRF's default exception handler.

    - Known DRF exceptions (validation, auth, permission, throttling, 404, etc.)
      pass through with their normal sanitized responses.
    - Unhandled server-side exceptions are logged in full server-side, and a
      generic JSON message is returned to the client so no stack traces,
      module paths, or internal details leak through HTTP responses.

    Wired in via settings.REST_FRAMEWORK['EXCEPTION_HANDLER'].
    """
    response = drf_default_handler(exc, context)
    if response is not None:
        return response

    view = context.get("view") if context else None
    request = context.get("request") if context else None
    logger.exception(
        "Unhandled exception in %s (path=%s)",
        view.__class__.__name__ if view else "unknown view",
        getattr(request, "path", "unknown"),
    )
    return Response(
        {"detail": "Internal server error."},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
