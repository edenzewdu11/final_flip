"""
Django shell script to create subscription tiers for Telebirr USSD Push
Run on server with: sudo docker compose exec backend python manage.py shell < create_subscription_tiers_server.py
"""

from api.models_subscription import SubscriptionTier
from django.utils import timezone

# Define the tiers
tiers_data = [
    {
        'name': 'Daily',
        'slug': 'daily',
        'description': 'Daily subscription plan',
        'duration_type': 'daily',
        'duration_days': 1,
        'price_etb': 3.00,
        'price_coins': None,
        'is_active': True,
        'sort_order': 1,
    },
    {
        'name': 'Weekly',
        'slug': 'weekly',
        'description': 'Weekly subscription plan',
        'duration_type': 'weekly',
        'duration_days': 7,
        'price_etb': 20.00,
        'price_coins': None,
        'is_active': True,
        'sort_order': 2,
    },
    {
        'name': 'Monthly',
        'slug': 'monthly',
        'description': 'Monthly subscription plan',
        'duration_type': 'monthly',
        'duration_days': 30,
        'price_etb': 70.00,
        'price_coins': None,
        'is_active': True,
        'sort_order': 3,
    },
]

# Create or update tiers
for tier_data in tiers_data:
    slug = tier_data['slug']
    tier, created = SubscriptionTier.objects.get_or_create(
        slug=slug,
        defaults=tier_data
    )
    
    if created:
        print(f"Created tier: {tier.name} ({slug}) - {tier.price_etb} ETB")
    else:
        # Update existing tier
        for key, value in tier_data.items():
            setattr(tier, key, value)
        tier.save()
        print(f"Updated tier: {tier.name} ({slug}) - {tier.price_etb} ETB")

print("\nSubscription tiers created/updated successfully!")
