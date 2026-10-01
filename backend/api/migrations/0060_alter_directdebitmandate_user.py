# Generated migration

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0059_alter_subscriptionhistory_user'),
    ]

    operations = [
        migrations.AlterField(
            model_name='directdebitmandate',
            name='user',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='direct_debit_mandates',
                to='auth.user'
            ),
        ),
    ]
