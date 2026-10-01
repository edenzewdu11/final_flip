"""Endpoint for receiving frontend logs and printing them to the backend log.

This is useful for debugging client-side issues (e.g. camera access) on
production deployments where the browser's developer console is not
accessible to the engineer.
"""

import logging

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([AllowAny])
def client_log(request):
    """Receive a client-side log message and print it to the backend log."""
    try:
        data = request.data or {}
        source = str(data.get('source', 'client'))[:64]
        level = str(data.get('level', 'info')).lower()
        message = str(data.get('message', ''))[:2000]
        context = data.get('context', {})
        user_agent = str(data.get('userAgent', ''))[:300]
        user = getattr(request, 'user', None)
        username = getattr(user, 'username', 'anonymous')

        line = f"[CLIENT-LOG][{source}][user={username}] {message} | UA={user_agent}"
        
        # Add context to the log if present
        if context:
            context_str = str(context)[:500]
            line += f" | Context: {context_str}"

        if level == 'error':
            logger.error(line)
            print(f"ERROR {line}", flush=True)
        elif level == 'warn' or level == 'warning':
            logger.warning(line)
            print(f"WARN  {line}", flush=True)
        else:
            logger.info(line)
            print(f"INFO  {line}", flush=True)

        return Response({'ok': True})
    except Exception as e:  # pragma: no cover - defensive
        logger.exception('client_log failed: %s', e)
        return Response({'ok': False, 'error': str(e)}, status=200)


@api_view(['POST'])
@permission_classes([AllowAny])
def clear_pending_mandate(request):
    """Clear pending mandate from frontend localStorage.
    
    This endpoint tells the frontend to clear the telebirr_pending_mandate
    from localStorage, which is useful when a mandate was never created
    on Telebirr but the frontend keeps trying to reconcile it.
    """
    try:
        logger.info('[CLEAR_PENDING_MANDATE] Request received to clear pending mandate')
        user = getattr(request, 'user', None)
        username = getattr(user, 'username', 'anonymous')
        logger.info(f'[CLEAR_PENDING_MANDATE] User: {username}')
        
        return Response({
            'ok': True,
            'action': 'clear_local_storage',
            'key': 'telebirr_pending_mandate'
        })
    except Exception as e:
        logger.exception('clear_pending_mandate failed: %s', e)
        return Response({'ok': False, 'error': str(e)}, status=200)
