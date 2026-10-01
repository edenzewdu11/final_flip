from rest_framework import serializers
from .models_subscription import (
    SubscriptionTier, Subscription, SubscriptionPayment, SubscriptionHistory,
    OnevasWebhookLog, SubscriptionCoinTransaction, AdminRole, SubscriptionReport
)


class SubscriptionTierSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionTier
        fields = '__all__'


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    tier = SubscriptionTierSerializer(read_only=True)
    
    class Meta:
        model = SubscriptionPlan
        fields = '__all__'


class SubscriptionPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionPayment
        fields = '__all__'


class SubscriptionHistorySerializer(serializers.ModelSerializer):
    tier = SubscriptionTierSerializer(read_only=True)
    
    class Meta:
        model = SubscriptionHistory
        fields = '__all__'


class OnevasWebhookLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = OnevasWebhookLog
        fields = ['id', 'webhook_id', 'event_type', 'event_data', 'created_at', 'updated_at']


class SubscriptionCoinTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionCoinTransaction
        fields = '__all__'


class AdminRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdminRole
        fields = '__all__'


class SubscriptionReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionReport
        fields = '__all__'
