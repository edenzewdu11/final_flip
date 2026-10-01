from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0098_miniapp_order_refund'),
    ]

    operations = [
        migrations.DeleteModel(
            name='MiniAppRefund',
        ),
        migrations.DeleteModel(
            name='MiniAppOrder',
        ),
    ]
