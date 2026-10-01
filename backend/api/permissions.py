"""
Reusable DRF permission classes (Finding #12 — Unauthorized batch
delete via user-facing endpoints).

ReelViewSet / CommentViewSet / CommentReplyViewSet were registered with
`permission_classes = [AllowAny]` and never overrode permissions for
write operations, so anonymous or non-owner authenticated users could
DELETE/PATCH anyone else's content. `IsOwnerOrAdminOrReadOnly` fixes
this without disturbing the public read paths.
"""

from rest_framework.permissions import BasePermission, SAFE_METHODS


def _is_staff(user):
    return bool(
        user
        and user.is_authenticated
        and (user.is_staff or user.is_superuser)
    )


class IsOwnerOrAdminOrReadOnly(BasePermission):
    """
    Allow safe (GET/HEAD/OPTIONS) requests to anyone.

    For write requests:
      - User must be authenticated.
      - User must own the object (object.user == request.user) OR be staff.

    Object ownership is determined by an attribute named one of:
      `user`, `owner`, `author`, `creator`, or by being the same User.
    Override the class attribute `owner_field` on a subclass if your model
    uses something else.
    """

    owner_field_candidates = ("user", "owner", "author", "creator")

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        if _is_staff(request.user):
            return True

        # Match the object's owner field to the requesting user.
        for field in self.owner_field_candidates:
            owner = getattr(obj, field, None)
            if owner is not None:
                return owner == request.user
        # Fallback: object IS a User and that user IS the requester.
        return obj == request.user


class HasAdminPermission(BasePermission):
    """
    Check if user has specific admin permission based on their AdminRole.
    
    Usage: Add `permission_classes = [HasAdminPermission]` to views
    and set `required_permission = 'view_users'` on the view.
    
    Permission levels:
    - read_only: Only view permissions (starts with 'view_')
    - edit_only: View, edit, update, moderate (no delete/critical)
    - full: Full access to role permissions
    """
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Super admin has full access
        if request.user.is_superuser:
            return True
        
        # Get required permission from view
        required_permission = getattr(view, 'required_permission', None)
        if not required_permission:
            # If no specific permission required, just check if staff
            return request.user.is_staff
        
        # Check AdminRole
        try:
            from .models_subscription import AdminRole
            admin_role = AdminRole.objects.get(user=request.user)
            return admin_role.has_permission(required_permission)
        except AdminRole.DoesNotExist:
            return False
