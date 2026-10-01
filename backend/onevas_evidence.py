import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.utils import timezone
from api.models_subscription import SubscriptionPlan, OnevasWebhookLog
from datetime import timedelta

phone_number = '251932220014'

print("=" * 80)
print("EVIDENCE FOR ONEVAS TEAM: RENEWAL WEBHOOKS STOPPED FOR PHONE 251932220014")
print("=" * 80)
print()

print("1. ALL RENEWAL WEBHOOKS FOR PHONE 251932220014:")
print("-" * 80)
renewal_webhooks = OnevasWebhookLog.objects.filter(webhook_type='renewal', payload__phone_number=phone_number).order_by('-created_at')
print(f"Count: {renewal_webhooks.count()}")
for webhook in renewal_webhooks:
    print(f"Date: {webhook.created_at}")
    print(f"Payload: {webhook.payload}")
    print(f"Response Status: {webhook.response_status}")
print()

print("2. CURRENT SUBSCRIPTION STATUS:")
print("-" * 80)
current_sub = SubscriptionPlan.objects.filter(onevas_phone_number=phone_number, status='active').order_by('-created_at').first()
if current_sub:
    print(f"Subscription ID: {current_sub.id}")
    print(f"Created: {current_sub.created_at}")
    print(f"Start Date: {current_sub.start_date}")
    print(f"End Date: {current_sub.end_date}")
    print(f"Next Renewal Date: {current_sub.next_renewal_date}")
    print(f"Status: {current_sub.status}")
else:
    print("NO ACTIVE SUBSCRIPTION FOUND")
print()

print("3. SUBSCRIPTION HISTORY (LAST 10):")
print("-" * 80)
all_subs = SubscriptionPlan.objects.filter(onevas_phone_number=phone_number).order_by('-created_at')[:10]
for sub in all_subs:
    print(f"ID: {sub.id} | Created: {sub.created_at} | Status: {sub.status} | End: {sub.end_date} | Next Renewal: {sub.next_renewal_date}")
print()

print("4. OTHER PHONES RECEIVING RENEWAL WEBHOOKS (LAST 24 HOURS):")
print("-" * 80)
recent_renewals = OnevasWebhookLog.objects.filter(webhook_type='renewal', created_at__gte=timezone.now() - timedelta(days=1)).order_by('-created_at')[:10]
for webhook in recent_renewals:
    phone = webhook.payload.get('phone_number')
    print(f"Phone: {phone} | Date: {webhook.created_at} | Payload: {webhook.payload}")
print()

print("5. TIMELINE COMPARISON:")
print("-" * 80)
last_renewal_for_problem_phone = OnevasWebhookLog.objects.filter(webhook_type='renewal', payload__phone_number=phone_number).order_by('-created_at').first()
if last_renewal_for_problem_phone:
    days_since = (timezone.now() - last_renewal_for_problem_phone.created_at).days
    print(f"Phone 251932220014 - Last renewal webhook: {last_renewal_for_problem_phone.created_at} ({days_since} days ago)")
else:
    print(f"Phone 251932220014 - NO renewal webhooks ever received")
print("Other phones - Recent renewal webhooks:")
other_phones = OnevasWebhookLog.objects.filter(webhook_type='renewal', created_at__gte=timezone.now() - timedelta(days=2)).exclude(payload__phone_number=phone_number)
unique_phones = set()
for webhook in other_phones[:20]:
    phone = webhook.payload.get('phone_number')
    if phone and phone not in unique_phones:
        unique_phones.add(phone)
        print(f"  {phone}: {webhook.created_at}")
print()

print("=" * 80)
print("CONCLUSION: Phone 251932220014 is NOT receiving renewal webhooks")
print("=" * 80)
print()
print("6. CHECKING FOR OTHER PHONES WITH NO RENEWAL WEBHOOKS (LAST 7 DAYS):")
print("-" * 80)
active_subs = SubscriptionPlan.objects.filter(status='active', subscription_source='sms')
phones_without_recent_renewals = []
for sub in active_subs:
    if sub.onevas_phone_number:
        last_renewal = OnevasWebhookLog.objects.filter(
            webhook_type='renewal',
            payload__phone_number=sub.onevas_phone_number,
            created_at__gte=timezone.now() - timedelta(days=7)
        ).first()
        if not last_renewal:
            phones_without_recent_renewals.append(sub.onevas_phone_number)

print(f"Active SMS subscriptions: {active_subs.count()}")
print(f"Phones without renewal webhooks in last 7 days: {len(phones_without_recent_renewals)}")
if phones_without_recent_renewals:
    print("Phone numbers:")
    for phone in phones_without_recent_renewals[:20]:
        print(f"  {phone}")
print()
