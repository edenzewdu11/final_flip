import os
import django
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.utils import timezone
from api.models_subscription import SubscriptionPlan

# Fix existing Telebirr mandate subscriptions that have end_date=None
subscriptions = SubscriptionPlan.objects.filter(
    payment_method='telebirr',
    status='active',
    end_date__isnull=True
)

print(f"Found {subscriptions.count()} Telebirr subscriptions with end_date=None")

for sub in subscriptions:
    if sub.tier and sub.tier.duration_days:
        now = timezone.now()
        end_date = now + timezone.timedelta(days=sub.tier.duration_days)
        sub.end_date = end_date
        sub.next_renewal_date = end_date
        sub.save()
        print(f"  ✓ Updated subscription {sub.id} for user {sub.user.username}: end_date={end_date}")
    else:
        print(f"  ✗ Skipped subscription {sub.id} - no tier or duration_days")

print("\n✅ Done!")
