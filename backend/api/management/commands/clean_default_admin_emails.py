"""
Clean up auto-generated default emails of the form `<username>@flipstar.app`
that were assigned to admin users by older registration code. After running
this, only admins whose email was explicitly set through the "Edit
Credentials" flow will have a stored email; the rest will be empty so they
correctly show "—" in the Admin Management table.

Usage:
    # Dry run — print what would change, no DB writes
    python manage.py clean_default_admin_emails

    # Apply changes
    python manage.py clean_default_admin_emails --apply

    # Restrict to staff users only (default scans all users)
    python manage.py clean_default_admin_emails --apply --staff-only
"""
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Clear auto-default '<username>@flipstar.app' emails so the Admin Management table only shows real emails."

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Actually update the DB. Without this flag the command runs in dry-run mode.',
        )
        parser.add_argument(
            '--staff-only',
            action='store_true',
            help='Only target users with is_staff=True.',
        )

    def handle(self, *args, **options):
        apply = options['apply']
        staff_only = options['staff_only']

        qs = User.objects.all()
        if staff_only:
            qs = qs.filter(is_staff=True)

        # Match either the exact <username>@flipstar.app pattern or any
        # other stray @flipstar.app placeholder.
        candidates = qs.filter(email__iendswith='@flipstar.app')
        total = candidates.count()

        if total == 0:
            self.stdout.write(self.style.SUCCESS('No matching emails found. Nothing to do.'))
            return

        self.stdout.write(f'Found {total} user(s) with @flipstar.app emails:')
        affected = []
        for user in candidates.iterator():
            auto_default = f'{user.username.lower()}@flipstar.app'
            is_auto = user.email.lower() == auto_default
            tag = 'AUTO-DEFAULT' if is_auto else 'OTHER @flipstar.app'
            self.stdout.write(
                f'  - id={user.id:<6} username={user.username:<24} email={user.email:<40} [{tag}]'
            )
            affected.append(user.id)

        if not apply:
            self.stdout.write('')
            self.stdout.write(self.style.WARNING(
                'Dry run — no changes written. Re-run with --apply to clear these emails.'
            ))
            return

        with transaction.atomic():
            updated = User.objects.filter(id__in=affected).update(email='')

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(f'Cleared email on {updated} user(s).'))
