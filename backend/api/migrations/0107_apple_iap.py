import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('api', '0106_subscriptiontier_mandate_name_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='coinpackage',
            name='apple_product_id',
            field=models.CharField(blank=True, help_text='Apple App Store Connect product ID for this coin package', max_length=150, null=True, unique=True),
        ),
        migrations.AlterField(
            model_name='cointransaction',
            name='payment_method',
            field=models.CharField(blank=True, choices=[('telebirr', 'Telebirr'), ('airtime', 'Airtime'), ('coins', 'Coins'), ('apple', 'Apple In-App Purchase')], max_length=20),
        ),
        migrations.AddField(
            model_name='subscriptiontier',
            name='apple_product_id',
            field=models.CharField(blank=True, help_text='Apple App Store Connect product ID for this subscription tier', max_length=150, null=True, unique=True),
        ),
        migrations.AlterField(
            model_name='subscriptionplan',
            name='payment_method',
            field=models.CharField(choices=[('onevas', 'Onevas Airtime'), ('telebirr', 'Telebirr'), ('coins', 'Coins'), ('apple', 'Apple In-App Purchase')], default='onevas', max_length=20),
        ),
        migrations.AlterField(
            model_name='subscriptionpayment',
            name='payment_method',
            field=models.CharField(choices=[('onevas', 'Onevas Airtime'), ('telebirr', 'Telebirr'), ('coins', 'Coins'), ('apple', 'Apple In-App Purchase')], default='onevas', max_length=20),
        ),
        migrations.CreateModel(
            name='AppleIAPTransaction',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('product_type', models.CharField(choices=[('coins', 'Coin Package'), ('subscription', 'Subscription Tier')], max_length=20)),
                ('apple_product_id', models.CharField(help_text='Apple App Store Connect product ID', max_length=150)),
                ('transaction_id', models.CharField(help_text='Apple transaction_id (unique per purchase, prevents double-crediting)', max_length=100, unique=True)),
                ('original_transaction_id', models.CharField(blank=True, help_text='Original transaction_id (same across subscription renewals)', max_length=100, null=True)),
                ('reference_id', models.CharField(blank=True, help_text='CoinPackage id or SubscriptionTier id that was credited/activated', max_length=100, null=True)),
                ('raw_receipt_response', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='apple_iap_transactions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'apple_iap_transactions',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='appleiaptransaction',
            index=models.Index(fields=['user', '-created_at'], name='apple_iap_user_idx'),
        ),
        migrations.AddIndex(
            model_name='appleiaptransaction',
            index=models.Index(fields=['original_transaction_id'], name='apple_iap_orig_idx'),
        ),
    ]
