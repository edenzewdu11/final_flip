from django.core.management.base import BaseCommand
from api.models_contest import CoinPackage


class Command(BaseCommand):
    help = 'Seed/update coin packages for Telebirr (and Airtime for 10 ETB) purchase'

    def handle(self, *args, **options):
        packages_data = [
            {
                'name': 'Starter Pack',
                'price_etb': 10,
                'coin_amount': 100,
                'bonus_coins': 0,
                'is_featured': False,
                'sort_order': 1,
                'allows_airtime': True,
            },
            {
                'name': 'Good Value',
                'price_etb': 50,
                'coin_amount': 550,
                'bonus_coins': 0,
                'is_featured': False,
                'sort_order': 2,
                'allows_airtime': False,
            },
            {
                'name': 'Most Popular',
                'price_etb': 100,
                'coin_amount': 1150,
                'bonus_coins': 0,
                'is_featured': True,
                'sort_order': 3,
                'allows_airtime': False,
            },
            {
                'name': 'Best Deal',
                'price_etb': 500,
                'coin_amount': 6000,
                'bonus_coins': 0,
                'is_featured': False,
                'sort_order': 4,
                'allows_airtime': False,
            },
            {
                'name': 'Premium Package',
                'price_etb': 1000,
                'coin_amount': 13000,
                'bonus_coins': 0,
                'is_featured': False,
                'sort_order': 5,
                'allows_airtime': False,
            },
        ]

        # Deactivate any old/stale packages that don't match the new lineup by price
        target_prices = {p['price_etb'] for p in packages_data}
        stale = CoinPackage.objects.exclude(price_etb__in=target_prices)
        stale_count = stale.update(is_active=False)
        if stale_count:
            self.stdout.write(self.style.WARNING(f'Deactivated {stale_count} stale package(s) not in the new lineup'))

        for pkg_data in packages_data:
            pkg, created = CoinPackage.objects.update_or_create(
                price_etb=pkg_data['price_etb'],
                defaults={**pkg_data, 'is_active': True},
            )
            action = 'Created' if created else 'Updated'
            self.stdout.write(self.style.SUCCESS(
                f"{action}: {pkg.name} - {pkg.price_etb} ETB = {pkg.get_total_coins()} coins "
                f"(airtime={'yes' if pkg.allows_airtime else 'no'})"
            ))

        self.stdout.write(self.style.SUCCESS('Coin packages seeded successfully.'))
