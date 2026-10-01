import os
from celery import Celery
from decouple import config

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('flipstar')

# Load configuration from Django settings
app.config_from_object('django.conf:settings', namespace='CELERY')

# Redis configuration
app.conf.broker_url = f"redis://{config('REDIS_HOST', default='127.0.0.1')}:{config('REDIS_PORT', default=6379)}/0"
app.conf.result_backend = f"redis://{config('REDIS_HOST', default='127.0.0.1')}:{config('REDIS_PORT', default=6379)}/0"

# Celery beat configuration
app.conf.beat_schedule = {
    'cleanup-typing-indicators': {
        'task': 'api.tasks.cleanup_typing_indicators',
        'schedule': 60.0,  # Run every 60 seconds
    },
    'generate-daily-leaderboards': {
        'task': 'api.tasks.generate_daily_leaderboards',
        'schedule': 86400.0,  # Run every 24 hours at midnight
    },
    'generate-weekly-leaderboards': {
        'task': 'api.tasks.generate_weekly_leaderboards',
        'schedule': 604800.0,  # Run every 7 days
    },
    'generate-monthly-leaderboards': {
        'task': 'api.tasks.generate_monthly_leaderboards',
        'schedule': 2592000.0,  # Run every 30 days
    },
    'auto-select-winners': {
        'task': 'api.tasks.auto_select_campaign_winners',
        'schedule': 3600.0,  # Run every hour to check for ended campaigns
    },
    # COMMENTED OUT: Telebirr mandate subscription tasks (replaced by USSD Push)
    # 'process-telebirr-mandate-deductions': {
    #     'task': 'api.tasks.process_telebirr_mandate_deductions',
    #     'schedule': 3600.0,  # Run every hour to check for due subscriptions
    # },
    # 'reconcile-pending-telebirr-mandates': {
    #     'task': 'api.tasks.reconcile_pending_telebirr_mandates',
    #     'schedule': 30.0,  # Run every 30 seconds to catch mandates signed but not confirmed by frontend
    # },
    # 'expire-telebirr-subscriptions': {
    #     'task': 'api.tasks.expire_telebirr_subscriptions',
    #     'schedule': 300.0,  # Run every 5 minutes to expire subs and cancel mandates on Telebirr
    # },
}

# Auto-discover tasks in all registered apps
app.autodiscover_tasks()

@app.task(bind=True)
def debug_task(self):
    print(f'Request: {self.request!r}')
