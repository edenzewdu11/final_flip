from rest_framework.schemas.openapi import AutoSchema


class DisabledAutoSchema(AutoSchema):
    """Schema class that returns empty schema to prevent API endpoint disclosure."""
    
    def get_operation(self, path, method):
        return None
    
    def get_paths(self):
        return {}
