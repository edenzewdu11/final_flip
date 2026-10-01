from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

# Import campaign models
from .models_campaign import Campaign, CampaignEntry, CampaignVote, CampaignWinner, CampaignNotification
from .models_master_campaign import MasterCampaign, MasterCampaignParticipant
from .models_campaign_extended import (
    CampaignScoringConfig, CampaignTheme, PostScore, UserCampaignStats, Leaderboard, LeaderboardEntry,
    WinnerSelection, SelectedWinner, CampaignBadge
)
# Import legal models
from .models_legal import LegalDocument, LegalDocumentVersion, UserLegalAcceptance
# Import messaging models
from .models_messaging import Conversation, Message, MessageRead
# Import gift models
from .models_gift import Gift, GiftTransaction, GiftCombo, UserGiftStats
# Import wallet models
from .models_wallet import WalletConfig, WithdrawalRequest
# Import support models
from .models_support import SupportRequest
# Import subscription models
from .models_subscription import (
    SubscriptionTier, SubscriptionPlan, SubscriptionPayment, SubscriptionHistory,
    OnevasWebhookLog, PromoCode, UserPromoUsage, SubscriptionFeatureUsage,
    ExpiredSubscriptionAction, TrialPopupLog, SubscriptionCoinTransaction, AdminRole, SubscriptionReport,
    PendingTelebirrMandate
)
# Import direct debit models
from .models_direct_debit import DirectDebitMandate, DirectDebitTransaction
# Import payment backup models
from .models_payment_backup import PaymentMandateBackup, PaymentTransactionBackup
# Import boost models
from .models_boost import BoostConfig, BoostCampaign, BoostImpression, BoostEngagement, BoostStats
# Import CRM gift models
from .models_crm import CRMGiftPackage, CRMGiftTransaction, CRMGiftAuditLog


# WHY: Tracks admin privilege grant/revoke actions for accountability and audit trail.
# RELATES TO: User (via target_user_id/performed_by_id as plain IntegerFields, not FK - kept
# denormalized so the log survives even if the user account is later deleted).
class PrivilegeAuditLog(models.Model):
    """Audit log for privilege changes (admin grants/revocations)"""
    ACTION_CHOICES = [
        ('GRANT', 'Grant'),
        ('REVOKE', 'Revoke'),
    ]

    action = models.CharField(max_length=10, choices=ACTION_CHOICES)
    target_user = models.CharField(max_length=150)
    target_user_id = models.IntegerField()
    performed_by = models.CharField(max_length=150)
    performed_by_id = models.IntegerField()
    details = models.TextField(blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
        verbose_name = 'Privilege Audit Log'
        verbose_name_plural = 'Privilege Audit Logs'

    def __str__(self):
        return f"{self.action} - {self.target_user} by {self.performed_by}"


# WHY: Logs suspicious/unauthorized activity (failed auth, rate limits, brute force) for
# security monitoring and incident response.
# RELATES TO: User (nullable FK - event may occur before/without an authenticated user).
class SecurityEvent(models.Model):
    """Security event logging for unauthorized access attempts and suspicious activities"""
    EVENT_TYPE_CHOICES = [
        ('UNAUTHORIZED_API', 'Unauthorized API Access'),
        ('UNAUTHORIZED_PAGE', 'Unauthorized Page Access'),
        ('PERMISSION_DENIED', 'Permission Denied'),
        ('SUSPICIOUS_ACTIVITY', 'Suspicious Activity'),
        ('RATE_LIMIT_EXCEEDED', 'Rate Limit Exceeded'),
        ('BRUTE_FORCE_ATTEMPT', 'Brute Force Attempt'),
        ('ADMIN_ACTION', 'Admin Action'),
    ]
    SEVERITY_CHOICES = [
        ('LOW', 'Low'),
        ('MEDIUM', 'Medium'),
        ('HIGH', 'High'),
        ('CRITICAL', 'Critical'),
    ]

    event_type = models.CharField(max_length=30, choices=EVENT_TYPE_CHOICES)
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES, default='MEDIUM')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='security_events')
    username = models.CharField(max_length=150, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    endpoint = models.CharField(max_length=255, blank=True)
    page = models.CharField(max_length=255, blank=True)
    action = models.CharField(max_length=100, blank=True)
    details = models.TextField(blank=True)
    is_resolved = models.BooleanField(default=False)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['-timestamp']),
            models.Index(fields=['event_type']),
            models.Index(fields=['severity']),
            models.Index(fields=['is_resolved']),
        ]
        verbose_name = 'Security Event'
        verbose_name_plural = 'Security Events'

    def __str__(self):
        return f"{self.event_type} - {self.username or 'Anonymous'} - {self.timestamp}"

# WHY: Admin-managed content categories (e.g. dance, comedy) used to classify Reels for
# discovery/filtering.
# RELATES TO: Reel (one Category has many Reels via Reel.category FK).
class Category(models.Model):
    """Content categories for posts - admin-managed"""
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True, help_text='Icon name (e.g., dance, comedy, etc.)')
    order = models.IntegerField(default=0, help_text='Display order')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'name']
        verbose_name_plural = 'Categories'

    def __str__(self):
        return self.name

# WHY: Extends Django's built-in User with app-specific data: gamification (coins, points,
# XP, streaks, spins), phone/OTP auth, trial/subscription flags, privacy settings, and
# moderation state (shadowban/ban).
# RELATES TO: User (1-to-1). Referenced indirectly by nearly every other model that has a
# `user` FK to auth.User. is_telebirr_user() queries SubscriptionPayment.
class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    profile_photo = models.ImageField(upload_to='profile_photos/', null=True, blank=True)
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True)
    bio = models.TextField(blank=True)
    xp = models.IntegerField(default=0)
    level = models.IntegerField(default=1)
    streak = models.IntegerField(default=0)
    last_checkin = models.DateTimeField(null=True, blank=True)
    language = models.CharField(max_length=10, default='en')
    
    # Gamification - Coins
    coins = models.IntegerField(default=0, help_text='User coin balance')
    coins_earned_total = models.IntegerField(default=0, help_text='Total coins earned lifetime')
    coins_spent_total = models.IntegerField(default=0, help_text='Total coins spent lifetime')
    
    # Gamification - Points (for withdrawals and transfers as birr)
    points = models.IntegerField(default=0, help_text='User point balance (convertible to birr)')
    points_earned_total = models.IntegerField(default=0, help_text='Total points earned lifetime')
    points_withdrawn_total = models.IntegerField(default=0, help_text='Total points withdrawn lifetime')
    
    # Gamification - Daily Spin
    last_spin_date = models.DateField(null=True, blank=True, help_text='Last daily spin date')
    spins_total = models.IntegerField(default=0, help_text='Total spins done')
    
    # Gamification - Login Streak
    login_streak = models.IntegerField(default=0, help_text='Consecutive login days')
    last_login_date = models.DateField(null=True, blank=True)
    longest_login_streak = models.IntegerField(default=0)
    
    # Privacy Settings
    allow_mentions = models.BooleanField(default=True, help_text='Allow other users to mention you in comments')
    
    # Gamification - Gifts
    gifts_sent_today = models.IntegerField(default=0)
    gifts_received_today = models.IntegerField(default=0)
    gifts_sent_total = models.IntegerField(default=0)
    gifts_received_total = models.IntegerField(default=0)
    last_gift_reset = models.DateField(null=True, blank=True, help_text='Last daily gift counter reset')
    
    # Ethiopian phone number (e.g. +251912345678) — set during phone-OTP registration
    phone_number = models.CharField(max_length=20, blank=True, null=True, unique=True)
    
    # Free trial tracking for first-time subscribers
    has_used_free_trial = models.BooleanField(default=False, help_text='User has used their 1-day free trial')
    
    # Welcome bonus tracking (one-time per phone number)
    has_received_welcome_bonus = models.BooleanField(default=False, help_text='User has received one-time welcome bonus (3 coins)')
    
    # Trial tracking
    trial_start_date = models.DateTimeField(null=True, blank=True, help_text='When 3-day trial started')
    trial_end_date = models.DateTimeField(null=True, blank=True, help_text='When 3-day trial ends')
    is_trial_user = models.BooleanField(default=True, help_text='User is in trial period')

    def is_telebirr_user(self):
        """Check if user has used Telebirr for payments"""
        from .models_subscription import SubscriptionPayment
        return SubscriptionPayment.objects.filter(
            user=self.user,
            payment_method='telebirr'
        ).exists()
    trial_popup_shown_count = models.IntegerField(default=0, help_text='How many times popup shown')
    trial_interaction_count = models.IntegerField(default=0, help_text='How many interactions attempted')
    
    # OTP tracking
    otp_code = models.CharField(max_length=6, blank=True, null=True)
    otp_expires_at = models.DateTimeField(null=True, blank=True)
    otp_attempts = models.IntegerField(default=0)

    # Account security - failed login tracking
    failed_login_attempts = models.IntegerField(default=0, help_text='Number of consecutive failed login attempts')
    account_locked_until = models.DateTimeField(null=True, blank=True, help_text='Account locked until this time due to too many failed attempts')

    # Push notifications
    fcm_token = models.CharField(max_length=512, blank=True, default='')

    # Privacy settings
    is_private = models.BooleanField(default=False)
    show_activity = models.BooleanField(default=True)
    allow_messages = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    
    # Moderation
    is_shadowbanned = models.BooleanField(default=False, help_text='User is shadow banned - content hidden from others but visible to self')
    ban_expires_at = models.DateTimeField(null=True, blank=True, help_text='When temporary ban expires (null if not temp banned)')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username} - Level {self.level}"

# WHY: Stores in-progress/unpublished posts so users can resume editing before publishing
# as a Reel.
# RELATES TO: User (each draft belongs to one user).
class Draft(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='drafts')
    image = models.ImageField(upload_to='drafts/', null=True, blank=True)
    media = models.FileField(upload_to='drafts/', null=True, blank=True)
    caption = models.TextField(blank=True)
    hashtags = models.TextField(blank=True)
    overlay_text = models.TextField(blank=True, default='')
    filter = models.CharField(max_length=50, blank=True, default='none')
    
    # Audio for video drafts
    audio_file = models.FileField(upload_to='drafts/audio/', null=True, blank=True)
    audio_volume_level = models.IntegerField(default=80)
    original_volume_level = models.IntegerField(default=100)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Draft by {self.user.username} - {self.created_at}"

# WHY: The core content model - a published video/image post. Central to almost every other
# feature (campaigns, boosts, comments, votes, gifts, reports).
# RELATES TO: User (owner), Category, Campaign, CampaignTheme, BoostCampaign
# (active_boost_campaign). Reverse-referenced by Comment, Vote, SavedPost, GiftTransaction,
# Notification, Report, NotInterested, PostScore, ContestPostScore, and more.
class Reel(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reels')
    image = models.ImageField(upload_to='reels/', null=True, blank=True)
    media = models.FileField(upload_to='reels/', null=True, blank=True)
    caption = models.TextField(blank=True)
    hashtags = models.TextField(blank=True)
    overlay_text = models.TextField(blank=True, default='')
    votes = models.IntegerField(default=0)
    view_count = models.PositiveBigIntegerField(default=0)
    shares = models.IntegerField(default=0)

    # Audio for video posts
    audio_file = models.FileField(upload_to='reels/audio/', null=True, blank=True)
    audio_volume_level = models.IntegerField(default=80)
    original_volume_level = models.IntegerField(default=100)

    # Category
    category = models.ForeignKey('Category', on_delete=models.SET_NULL, null=True, blank=True, related_name='reels')

    # Campaign integration
    campaign = models.ForeignKey('Campaign', on_delete=models.SET_NULL, null=True, blank=True, related_name='campaign_posts')
    theme = models.ForeignKey('CampaignTheme', on_delete=models.SET_NULL, null=True, blank=True, related_name='theme_posts')
    is_campaign_post = models.BooleanField(default=False)

    # Media processing
    thumbnail = models.ImageField(upload_to='thumbnails/', null=True, blank=True)
    blurhash = models.CharField(max_length=100, blank=True, default='')
    duration = models.FloatField(null=True, blank=True)
    processed = models.BooleanField(default=False)

    # Boost functionality
    is_boosted = models.BooleanField(default=False, help_text='Whether this post is currently boosted')
    active_boost_campaign = models.ForeignKey(
        BoostCampaign,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='boosted_reels',
        help_text='Currently active boost campaign for this post'
    )
    total_boost_impressions = models.IntegerField(default=0, help_text='Total impressions from all boost campaigns')
    total_boost_engagements = models.IntegerField(default=0, help_text='Total engagements from all boost campaigns')

    # Moderation
    is_hidden = models.BooleanField(default=False, help_text='Content is hidden/removed by moderation (soft-delete)')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['-created_at']),
            models.Index(fields=['campaign', '-created_at']),
            models.Index(fields=['is_campaign_post', '-created_at']),
            models.Index(fields=['is_boosted', '-created_at']),
        ]

    def __str__(self):
        return f"Reel by {self.user.username}"
    
    def get_hashtags_list(self):
        if self.hashtags:
            return [tag.strip() for tag in self.hashtags.split(',') if tag.strip()]
        return []

# WHY: User comments on a Reel; supports soft-delete and a 15-minute edit window.
# RELATES TO: User (author), Reel (parent post). Reverse-referenced by CommentLike,
# CommentReply, Mention, Report, Notification.
class Comment(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='comments')
    reel = models.ForeignKey(Reel, on_delete=models.CASCADE, related_name='comments')
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            # Speeds up the per-reel recent-comments prefetch used by the feed
            models.Index(fields=['reel', '-created_at']),
        ]

    def __str__(self):
        return f"Comment by {self.user.username} on {self.reel.id}"
    
    @property
    def likes_count(self):
        return self.comment_likes.count()
    
    @property
    def replies_count(self):
        return self.replies.count()
    
    @property
    def is_editable(self):
        """Comments can be edited within 15 minutes of creation (similar to messages)."""
        if self.is_deleted:
            return False
        from datetime import timedelta
        return (timezone.now() - self.created_at) <= timedelta(minutes=15)

# WHY: Records a like on either a Comment or a CommentReply (mutually exclusive via FK +
# unique constraints).
# RELATES TO: User (liker), Comment, CommentReply.
class CommentLike(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='comment_likes')
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name='comment_likes', null=True, blank=True)
    reply = models.ForeignKey('CommentReply', on_delete=models.CASCADE, related_name='reply_likes', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'comment'],
                condition=models.Q(comment__isnull=False),
                name='unique_user_comment_like'
            ),
            models.UniqueConstraint(
                fields=['user', 'reply'],
                condition=models.Q(reply__isnull=False),
                name='unique_user_reply_like'
            ),
        ]
        ordering = ['-created_at']

    def __str__(self):
        if self.comment:
            return f"{self.user.username} liked comment {self.comment.id}"
        if self.reply:
            return f"{self.user.username} liked reply {self.reply.id}"
        return f"{self.user.username} like"

# WHY: Nested reply to a Comment, supporting further nested replies via self-referencing FK.
# RELATES TO: User (author), Comment (parent), CommentReply (self, for reply-to-reply).
class CommentReply(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='comment_replies')
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name='replies')
    parent_reply = models.ForeignKey('self', on_delete=models.CASCADE, related_name='child_replies', null=True, blank=True)
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        parent = f"reply {self.parent_reply.id}" if self.parent_reply else f"comment {self.comment.id}"
        return f"Reply by {self.user.username} on {parent}"
    
    @property
    def likes_count(self):
        return self.reply_likes.count()
    
    @property
    def is_editable(self):
        """Replies can be edited within 15 minutes of creation."""
        if self.is_deleted:
            return False
        from datetime import timedelta
        return (timezone.now() - self.created_at) <= timedelta(minutes=15)

# WHY: Tracks @mentions of users inside comments/replies so mentioned users can be notified.
# RELATES TO: User (mentioned_user, mentioned_by), Comment, CommentReply.
class Mention(models.Model):
    """Track mentions of users in comments and replies."""
    mentioned_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='mentions_received')
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name='mentions', null=True, blank=True)
    reply = models.ForeignKey(CommentReply, on_delete=models.CASCADE, related_name='mentions', null=True, blank=True)
    mentioned_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='mentions_sent')
    created_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['mentioned_user', 'created_at']),
            models.Index(fields=['comment']),
            models.Index(fields=['reply']),
        ]

    def __str__(self):
        target = f"reply {self.reply.id}" if self.reply else f"comment {self.comment.id}"
        return f"{self.mentioned_by.username} mentioned {self.mentioned_user.username} in {target}"

# WHY: Lets a user bookmark a Reel for later viewing (like Instagram's "Saved").
# RELATES TO: User, Reel.
class SavedPost(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='saved_posts')
    reel = models.ForeignKey(Reel, on_delete=models.CASCADE, related_name='saved_by')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'reel')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.username} saved reel {self.reel.id}"

# WHY: Records a single user's vote on a Reel, primarily used for legacy Competition voting.
# RELATES TO: User, Reel.
class Vote(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    reel = models.ForeignKey(Reel, on_delete=models.CASCADE, related_name='reel_votes')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'reel')
        indexes = [
            models.Index(fields=['user', 'reel']),
        ]

    def __str__(self):
        return f"{self.user.username} voted on {self.reel.id}"

# WHY: Legacy gamification quest definition (not actively used - see comment history).
# RELATES TO: Referenced by UserQuest (completion tracking per user).
class Quest(models.Model):
    title = models.CharField(max_length=200)
    description = models.TextField()
    xp_reward = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title

# WHY: Tracks a user's completion status for a given legacy Quest.
# RELATES TO: User, Quest.
class UserQuest(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    quest = models.ForeignKey(Quest, on_delete=models.CASCADE)
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('user', 'quest')

    def __str__(self):
        return f"{self.user.username} - {self.quest.title}"

# WHY: Legacy simple subscription plan (free/pro/premium) - superseded by the full
# SubscriptionTier/SubscriptionPlan system in models_subscription.py.
# RELATES TO: User (1-to-1).
class Subscription(models.Model):
    PLAN_CHOICES = [
        ('free', 'Free'),
        ('pro', 'Pro'),
        ('premium', 'Premium'),
    ]
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='subscription')
    plan = models.CharField(max_length=20, choices=PLAN_CHOICES, default='free')
    started_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.user.username} - {self.plan}"

# WHY: Per-user opt-in/opt-out settings for notification channels (email/push/SMS) and
# specific notification types (likes, comments, follows, etc.).
# RELATES TO: User (1-to-1).
class NotificationPreference(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='notification_prefs')
    email_notifications = models.BooleanField(default=True)
    push_notifications = models.BooleanField(default=True)
    sms_notifications = models.BooleanField(default=False)
    phone = models.CharField(max_length=20, blank=True)
    # Specific notification type preferences
    likes = models.BooleanField(default=True)
    comments = models.BooleanField(default=True)
    follows = models.BooleanField(default=True)
    messages = models.BooleanField(default=True)
    mentions = models.BooleanField(default=True)

    def __str__(self):
        return f"Notifications for {self.user.username}"

# WHY: Legacy competition model - superseded by the Campaign system (models_campaign.py).
# RELATES TO: Referenced by Winner.
class Competition(models.Model):
    title = models.CharField(max_length=200)
    description = models.TextField()
    start_date = models.DateTimeField()
    end_date = models.DateTimeField()
    prize = models.TextField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

# WHY: Legacy winner record for the old Competition system.
# RELATES TO: Competition, User, Reel.
class Winner(models.Model):
    competition = models.ForeignKey(Competition, on_delete=models.CASCADE, related_name='winners')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='wins')
    reel = models.ForeignKey(Reel, on_delete=models.CASCADE, related_name='wins', null=True, blank=True)
    votes_received = models.IntegerField(default=0)
    prize_claimed = models.BooleanField(default=False)
    announced_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-announced_at']

    def __str__(self):
        return f"{self.user.username} - {self.competition.title}"

# WHY: User-submitted report flagging inappropriate content/behavior (reel, comment, or
# user) for moderator review.
# RELATES TO: User (reported_by, reported_user, reviewed_by), Reel, Comment. Reverse-
# referenced by ModerationAction (the action taken in response to this report).
class Report(models.Model):
    REPORT_TYPES = [
        ('inappropriate', 'Inappropriate Content'),
        ('spam', 'Spam'),
        ('harassment', 'Harassment'),
        ('copyright', 'Copyright Violation'),
        ('scam', 'Scam/Fraud'),
        ('hate_speech', 'Hate Speech'),
        ('self_harm', 'Self Harm'),
        ('violence', 'Violence'),
        ('other', 'Other'),
    ]
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('reviewing', 'Under Review'),
        ('resolved', 'Resolved'),
        ('dismissed', 'Dismissed'),
    ]

    TARGET_TYPES = [
        ('reel', 'Reel'),
        ('comment', 'Comment'),
        ('user', 'User'),
    ]

    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('critical', 'Critical'),
    ]
    
    reported_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reports_made')
    reported_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reports_received', null=True, blank=True)
    reported_reel = models.ForeignKey(Reel, on_delete=models.CASCADE, related_name='reports', null=True, blank=True)
    reported_comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name='reports', null=True, blank=True)
    target_type = models.CharField(max_length=20, choices=TARGET_TYPES, default='reel')
    report_type = models.CharField(max_length=50, choices=REPORT_TYPES)
    description = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium')
    resolution_notes = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='reports_reviewed')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"Report #{self.id} - {self.report_type} by {self.reported_by.username}"


# WHY: Records the action a moderator took in response to a Report (warning, content
# removal, ban, etc.), including undo tracking.
# RELATES TO: Report, User (moderator, undone_by).
class ModerationAction(models.Model):
    ACTION_CHOICES = [
        ('warning', 'Warning Issued'),
        ('content_removed', 'Content Removed'),
        ('shadowban', 'Shadow Banned'),
        ('temp_ban', 'Temporary Ban'),
        ('permanent_ban', 'Permanent Ban'),
        ('no_action', 'No Action Taken'),
    ]

    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name='moderation_actions')
    moderator = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='moderation_actions_taken')
    action_taken = models.CharField(max_length=30, choices=ACTION_CHOICES)
    reason_details = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    undone = models.BooleanField(default=False)
    undone_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='moderation_actions_undone')
    undone_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Action #{self.id}: {self.action_taken} on Report #{self.report_id}"

# WHY: User-to-user follow relationship (social graph), powering feeds and follower counts.
# RELATES TO: User (follower, following).
class Follow(models.Model):
    follower = models.ForeignKey(User, on_delete=models.CASCADE, related_name='following')
    following = models.ForeignKey(User, on_delete=models.CASCADE, related_name='followers')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['follower', 'following']
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.follower.username} follows {self.following.username}"

# WHY: User-to-user block relationship, used to hide content/interactions between blocker
# and blocked user.
# RELATES TO: User (blocker, blocked).
class Block(models.Model):
    blocker = models.ForeignKey(User, on_delete=models.CASCADE, related_name='blocked_users')
    blocked = models.ForeignKey(User, on_delete=models.CASCADE, related_name='blocked_by')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['blocker', 'blocked']
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.blocker.username} blocked {self.blocked.username}"

# WHY: General-purpose notification for user activity (likes, comments, follows, mentions,
# gifts, moderation actions).
# RELATES TO: User (recipient, sender), Reel, Comment.
class Notification(models.Model):
    """General notifications for user activities (likes, comments, follows, etc.)"""
    NOTIFICATION_TYPES = [
        ('like', 'Like'),
        ('comment', 'Comment'),
        ('follow', 'Follow'),
        ('mention', 'Mention'),
        ('gift', 'Gift'),
        ('moderation', 'Moderation Action'),
    ]
    
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications_sent')
    notification_type = models.CharField(max_length=20, choices=NOTIFICATION_TYPES)
    reel = models.ForeignKey(Reel, on_delete=models.CASCADE, null=True, blank=True, related_name='notifications')
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, null=True, blank=True, related_name='notifications')
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', '-created_at']),
            models.Index(fields=['recipient', 'is_read']),
        ]
    
    def __str__(self):
        return f"{self.notification_type} notification for {self.recipient.username}"


# WHY: Lets a user hide a specific Reel from their feed without blocking the poster.
# RELATES TO: User, Reel.
class NotInterested(models.Model):
    """Tracks reels a user marked as 'not interested' to hide from their feed"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='not_interested_reels')
    reel = models.ForeignKey(Reel, on_delete=models.CASCADE, related_name='not_interested_by')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ('user', 'reel')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'reel']),
            models.Index(fields=['user', '-created_at']),
        ]
    
    def __str__(self):
        return f"{self.user.username} not interested in reel {self.reel.id}"


# WHY: Stores Web Push (VAPID) subscription details per browser/device so the server can
# send encrypted push notifications.
# RELATES TO: User (one user can have multiple device/browser subscriptions).
class PushSubscription(models.Model):
    """Web Push (VAPID) subscription for a user's browser.

    Each browser/device produces a unique `endpoint`. We store the public-key
    material (`p256dh`) and `auth` secret returned by the PushManager so the
    server can sign and encrypt push payloads.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='push_subscriptions')
    endpoint = models.URLField(max_length=600, unique=True)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    user_agent = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [models.Index(fields=['user'])]

    def __str__(self):
        return f"PushSubscription({self.user.username}, {self.endpoint[:40]}…)"
