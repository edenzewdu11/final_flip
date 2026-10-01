from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from api.models import UserProfile


class Command(BaseCommand):
    help = (
        'Check and optionally reactivate a user account (is_active=False) '
        'looked up by phone number. Use --reactivate to actually flip the flag; '
        'without it, the command only reports the current status.'
    )

    def add_arguments(self, parser):
        parser.add_argument('phone_number', type=str, help='Phone number to search (e.g., 0911528271)')
        parser.add_argument(
            '--reactivate',
            action='store_true',
            help='Actually set is_active=True on the matched user (default: dry-run report only)',
        )

    def handle(self, *args, **options):
        phone_number = options['phone_number']
        reactivate = options['reactivate']

        normalized_phone = phone_number
        if phone_number.startswith('0'):
            normalized_phone = '251' + phone_number[1:]

        self.stdout.write(f"Searching for profile with phone: {phone_number} (normalized: {normalized_phone})")

        profile = UserProfile.objects.filter(phone_number__in=[phone_number, normalized_phone]).first()
        if not profile:
            self.stdout.write(self.style.WARNING(f"No UserProfile found for phone: {phone_number}"))
            return

        user = profile.user
        self.stdout.write(f"\n{'='*60}")
        self.stdout.write(f"User: {user.username} (id={user.id})")
        self.stdout.write(f"is_active: {user.is_active}")
        self.stdout.write(f"date_joined: {user.date_joined}")
        self.stdout.write(f"last_login: {user.last_login}")
        self.stdout.write(f"{'='*60}\n")

        if user.is_active:
            self.stdout.write(self.style.SUCCESS("This account is already active. Nothing to do."))
            return

        if not reactivate:
            self.stdout.write(self.style.WARNING(
                "This account is INACTIVE (deactivated, e.g. via a moderation permanent ban). "
                "Re-run with --reactivate to set is_active=True."
            ))
            return

        user.is_active = True
        user.save(update_fields=['is_active'])
        self.stdout.write(self.style.SUCCESS(f"Reactivated user {user.username} (id={user.id})."))
