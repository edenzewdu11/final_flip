import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('api', '0097_add_account_locking_fields'),
    ]

    operations = [
        migrations.CreateModel(
            name='MiniAppOrder',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('merch_order_id', models.CharField(db_index=True, max_length=64, unique=True)),
                ('prepay_id', models.CharField(blank=True, default='', max_length=128)),
                ('payment_order_id', models.CharField(blank=True, default='', max_length=64)),
                ('trans_id', models.CharField(blank=True, default='', max_length=64)),
                ('title', models.CharField(max_length=512)),
                ('total_amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('trans_currency', models.CharField(default='ETB', max_length=3)),
                ('trade_type', models.CharField(default='InApp', max_length=20)),
                ('status', models.CharField(choices=[('created', 'Created'), ('pending', 'Pending Payment'), ('paid', 'Paid'), ('failed', 'Failed'), ('expired', 'Expired'), ('closed', 'Closed'), ('refunding', 'Refunding'), ('refunded', 'Refunded')], db_index=True, default='created', max_length=20)),
                ('raw_request', models.TextField(blank=True, default='')),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('notify_payload', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('paid_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='miniapp_orders', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Mini App Order',
                'verbose_name_plural': 'Mini App Orders',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='MiniAppRefund',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('refund_request_no', models.CharField(db_index=True, max_length=64, unique=True)),
                ('refund_order_id', models.CharField(blank=True, default='', max_length=64)),
                ('actual_amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('refund_currency', models.CharField(default='ETB', max_length=3)),
                ('refund_reason', models.CharField(blank=True, default='', max_length=256)),
                ('status', models.CharField(choices=[('requested', 'Requested'), ('refunding', 'Refunding'), ('success', 'Success'), ('failed', 'Failed'), ('duplicated', 'Duplicated')], db_index=True, default='requested', max_length=20)),
                ('response_payload', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='refunds', to='api.miniapporder')),
            ],
            options={
                'verbose_name': 'Mini App Refund',
                'verbose_name_plural': 'Mini App Refunds',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='miniapporder',
            index=models.Index(fields=['user', '-created_at'], name='api_miniapp_user_id_idx'),
        ),
        migrations.AddIndex(
            model_name='miniapporder',
            index=models.Index(fields=['status', '-created_at'], name='api_miniapp_status_idx'),
        ),
        migrations.AddIndex(
            model_name='miniapporder',
            index=models.Index(fields=['merch_order_id'], name='api_miniapp_merch_idx'),
        ),
        migrations.AddIndex(
            model_name='miniapprefund',
            index=models.Index(fields=['order', '-created_at'], name='api_miniapp_refund_order_idx'),
        ),
        migrations.AddIndex(
            model_name='miniapprefund',
            index=models.Index(fields=['status', '-created_at'], name='api_miniapp_refund_status_idx'),
        ),
    ]
