"""
Add grace_period status + grace_started_at / grace_expires_at fields to
SubscriptionPlan. Used when Onevas reports insufficient balance on
renewal — the user gets 24h of read-only browsing on home/reels/profile
before the subscription is fully expired.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0093_draft'),
    ]

    operations = [
        migrations.AlterField(
            model_name='subscriptionplan',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending', 'Pending'),
                    ('active', 'Active'),
                    ('cancelled', 'Cancelled'),
                    ('expired', 'Expired'),
                    ('failed', 'Failed'),
                    ('grace_period', 'Grace Period (insufficient balance)'),
                ],
                default='pending',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='subscriptionplan',
            name='grace_started_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='subscriptionplan',
            name='grace_expires_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
