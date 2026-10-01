# FlipStar API Documentation

Complete API reference for the FlipStar social media platform. Base URL: `https://uat.flipstar.et/api/`

---

## Table of Contents

1. [Authentication](#authentication)
2. [User & Profile](#user--profile)
3. [Reels & Content](#reels--content)
4. [Campaigns & Contests](#campaigns--contests)
5. [Subscriptions & Payments](#subscriptions--payments)
6. [Wallet & Coins](#wallet--coins)
7. [Virtual Gifts](#virtual-gifts)
8. [Messaging](#messaging)
9. [Social Features](#social-features)
10. [Admin & Management](#admin--management)
11. [CRM Integration](#crm-integration)
12. [Legal & Privacy](#legal--privacy)
13. [Support](#support)
14. [Boost System](#boost-system)
15. [Gamification](#gamification)
16. [System & Health](#system--health)

---

## Authentication

### POST /api/auth/send-phone-otp/

Step 1 of app-first registration: Send OTP to phone for verification.

**Request Body:**
```json
{
  "phone": "251911234567"
}
```

**Backend Action:**
- Normalizes phone to Ethiopian format (251XXXXXXXXX)
- Validates phone is not already registered
- Generates 6-digit OTP via Onevas SMS service
- Stores OTP with device binding and IP rate limiting
- Rate limited: 3 OTPs per hour per phone
- In DEBUG mode: returns `dev_code` field with OTP for testing

**Response (200 OK):**
```json
{
  "message": "OTP sent successfully",
  "phone": "25191123****",
  "dev_code": "123456"
}
```

---

### POST /api/auth/verify-phone-otp/

Step 2: Verify OTP code entered by user.

**Request Body:**
```json
{
  "phone": "251911234567",
  "code": "123456"
}
```

**Backend Action:**
- Validates OTP code and expiry
- Checks device binding and IP rate limiting
- Marks phone as verified in PhoneOTP model
- OTP valid for 5 minutes

**Response (200 OK):**
```json
{
  "message": "Phone verified successfully",
  "phone": "25191123****"
}
```

---

### POST /api/auth/register-with-phone/

Step 3: Create account after phone verification. Password must be exactly 6 digits (PIN).

**Request Body:**
```json
{
  "phone": "251911234567",
  "username": "john_doe",
  "password": "123456",
  "email": "john@example.com",
  "date_of_birth": "2000-01-15",
  "age_confirmed": true,
  "skip_otp": false
}
```

**Backend Action:**
- Verifies phone was verified via OTP (unless `skip_otp=true` for SMS subscribers)
- Validates password is exactly 6 digits
- Rejects weak PIN patterns (sequential, repeating)
- Validates user is 18+ based on date_of_birth
- Creates User account with username and 6-digit PIN
- Creates UserProfile with phone_number
- Creates EligibilityVerification record
- Links any existing SMS subscriptions to new user
- Generates DRF authentication token

**Response (201 Created):**
```json
{
  "user": {
    "id": 1,
    "username": "john_doe",
    "email": "john@example.com",
    "phone_number": "251911234567"
  },
  "token": "9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b"
}
```

---

### POST /api/auth/login-with-phone/

Login with phone number and 6-digit PIN.

**Request Body:**
```json
{
  "phone": "251911234567",
  "password": "123456"
}
```

**Backend Action:**
- Normalizes phone to Ethiopian format
- Rate limits: 6 failed attempts per 10 minutes per IP
- Checks for active SMS subscription (primary path for SMS subscribers)
- Falls back to UserProfile.phone_number lookup
- Supports OTP-as-PIN login for new subscription setup
- On success: clears failure counters, returns token
- On failure: increments failure counter, may lock account

**Response (200 OK):**
```json
{
  "user": {
    "id": 1,
    "username": "john_doe",
    "phone_number": "251911234567"
  },
  "token": "9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b"
}
```

**Response (400 Bad Request) - SMS subscriber not registered:**
```json
{
  "error": "User account not created yet",
  "requires_registration": true,
  "phone": "25191123****"
}
```

---

### POST /api/auth/send-login-otp/

Send OTP for login (for existing users including SuperApp users).

**Request Body:**
```json
{
  "phone": "251911234567",
  "application_key": "UPJG5ZM3X6C9LLDSKKCME4MA86UQRKWV",
  "product_number": "10000302850"
}
```

**Backend Action:**
- Normalizes phone number
- Checks if user exists (for SuperApp users, may not exist yet)
- Sends OTP via Onevas SMS with device binding
- Uses tier-specific application_key and product_number if provided
- In DEBUG mode: returns `dev_code` field

**Response (200 OK):**
```json
{
  "message": "OTP sent successfully",
  "phone": "25191123****",
  "user_exists": true,
  "dev_code": "123456"
}
```

---

### POST /api/auth/login-with-otp/

Login with OTP for existing users.

**Request Body:**
```json
{
  "phone": "251911234567",
  "code": "123456"
}
```

**Backend Action:**
- Verifies OTP with device binding
- Finds user by phone number
- Returns DRF token on success

**Response (200 OK):**
```json
{
  "user": {
    "id": 1,
    "username": "john_doe"
  },
  "token": "9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b"
}
```

---

### POST /api/auth/reset-password/

Reset password for a user by email (admin recovery).

**Request Body:**
```json
{
  "email": "john@example.com",
  "new_password": "123456"
}
```

**Backend Action:**
- Finds user by email
- Sets new password using Django's set_password
- Invalidates all existing auth tokens
- Clears throttle cache for the IP

**Response (200 OK):**
```json
{
  "message": "Password reset successful. You can now login."
}
```

---

### POST /api/auth/change-password/

Change password for authenticated user.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "current_password": "123456",
  "new_password": "654321"
}
```

**Backend Action:**
- Verifies current password
- Validates new password is 6 digits (PIN format)
- Checks PIN is not weak (no sequential/repeating patterns)
- Sets new password
- Deletes old token to force re-login

**Response (200 OK):**
```json
{
  "message": "Password changed successfully. Please login again."
}
```

---

### POST /api/auth/delete-account/

Delete authenticated user's account and all associated data.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Backend Action:**
- Deletes user's profile photo files from storage
- Deletes all reel media files (video, thumbnail, image)
- Deletes message media files
- Deletes authentication token
- Deletes user (cascades to all related objects)

**Response (200 OK):**
```json
{
  "message": "Account john_doe has been deleted successfully.",
  "deleted_summary": {
    "reels": 15,
    "messages_sent": 42
  }
}
```

---

### GET /api/auth/download-data/

Download all user data as JSON (GDPR compliance).

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Backend Action:**
- Collects all user data from multiple models
- Returns as downloadable JSON file

**Response (200 OK):**
```
Content-Disposition: attachment; filename="flipstar-data-john_doe.json"
```

---

## Onevas SMS Subscription Flow

### POST /api/onevas/subscription/

Webhook endpoint for Onevas subscription notifications (called by Onevas, not frontend).

**Webhook Payload:**
```json
{
  "phone_number": "251911234567",
  "product_number": "10000302850",
  "password": "1",
  "params": [
    {
      "name": "keyword",
      "value": "1"
    }
  ]
}
```

**Backend Action:**
- Receives subscription notification from Onevas
- Normalizes phone number (handles 251... and 09... formats)
- Finds tier by product_number or SMS code (1=daily, 2=weekly, 3=monthly, 4=ondemand)
- Checks if user already has active subscription (prevents duplicate subs)
- If user not registered: creates SMS-first subscription with setup_otp
- If user registered: links subscription to existing user
- Generates 6-digit OTP for account setup (valid 30 minutes)
- Sends SMS with app link and OTP code
- Records subscription payment and history

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Subscription created"
}
```

---

### POST /api/onevas/unsubscription/

Webhook endpoint for Onevas unsubscription notifications.

**Webhook Payload:**
```json
{
  "phone_number": "251911234567",
  "product_number": "10000302850"
}
```

**Backend Action:**
- Cancels active subscription for phone number
- Invalidates user PIN for security
- Records cancellation in SubscriptionHistory
- Sends confirmation SMS

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Subscription cancelled"
}
```

---

### POST /api/onevas/renewal/

Webhook endpoint for Onevas renewal notifications.

**Webhook Payload:**
```json
{
  "phone_number": "251911234567",
  "product_number": "10000302850"
}
```

**Backend Action:**
- Extends subscription end date
- Records renewal payment
- Updates subscription history

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Subscription renewed"
}
```

---

### POST /api/onevas/stop/

Webhook endpoint for STOP command (user cancels via SMS).

**Webhook Payload:**
```json
{
  "phone_number": "251911234567",
  "product_number": "10000302850",
  "params": [
    {
      "name": "keyword",
      "value": "STOP1"
    }
  ]
}
```

**Backend Action:**
- Handles STOP, STOP1 (daily), STOP2 (weekly), STOP3 (monthly) commands
- Cancels all matching active subscriptions
- Invalidates user PIN for security
- Sends SMS with resubscribe instructions

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "1 subscription(s) cancelled via STOP command"
}
```

---

## Telebirr SuperApp Authentication

### POST /api/wallet/telebirr/auth/

Telebirr SuperApp auto-login endpoint.

**Request Body:**
```json
{
  "access_token": "token_from_superapp"
}
```

**Backend Action:**
- Exchanges access_token with Telebirr API for user info
- Extracts phone number from Telebirr response
- Normalizes phone number (handles different formats)
- If user exists: auto-login with existing account
- If user doesn't exist: creates minimal account for onboarding
- Generates DRF authentication token

**Response (200 OK):**
```json
{
  "user": {
    "id": 1,
    "username": "251911234567",
    "phone_number": "251911234567"
  },
  "token": "9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b"
}
```

---

## User & Profile

### GET /api/profile/me/

Get current authenticated user's profile.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "id": 1,
  "user": {
    "id": 1,
    "username": "john_doe",
    "email": "john@example.com"
  },
  "username": "john_doe",
  "profile_photo": "https://cloudinary.com/...",
  "bio": "Content creator",
  "xp": 5000,
  "level": 5,
  "streak": 10,
  "coins": 1000,
  "phone_number": "251911234567"
}
```

---

### PATCH /api/profile/me/

Update current user's profile.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "bio": "Updated bio",
  "phone_number": "251911234567"
}
```

**Response (200 OK):**
```json
{
  "id": 1,
  "bio": "Updated bio",
  "phone_number": "251911234567"
}
```

---

### POST /api/profile-photo/upload/

Upload profile photo.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
Content-Type: multipart/form-data
```

**Request Body:**
```
profile_photo: <file>
```

**Backend Action:**
- Validates image file (JPEG, PNG, WEBP)
- Strips EXIF metadata
- Uploads to Cloudinary
- Updates UserProfile

**Response (200 OK):**
```json
{
  "profile_photo": "https://cloudinary.com/...",
  "message": "Profile photo uploaded successfully"
}
```

---

### GET /api/search/users/

Search users by username.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Query Parameters:**
- `q`: Search query

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 1,
      "username": "john_doe",
      "profile_photo": "https://...",
      "is_following": false
    }
  ]
}
```

---

## Reels & Content

### GET /api/reels/

List all reels (paginated feed).

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "count": 500,
  "results": [
    {
      "id": 1,
      "user": {
        "id": 1,
        "username": "john_doe",
        "profile_photo": "https://...",
        "is_following": true
      },
      "media": "https://cloudinary.com/video.mp4",
      "thumbnail": "https://cloudinary.com/thumb.jpg",
      "caption": "My awesome reel",
      "hashtags": "#dance #trending",
      "votes": 150,
      "view_count": 1000,
      "comment_count": 25,
      "is_liked": true,
      "is_saved": false
    }
  ]
}
```

---

### POST /api/reels/

Create a new reel.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
Content-Type: multipart/form-data
```

**Request Body:**
```
media: <video file>
caption: "My caption"
hashtags: "#dance #trending"
category: 1
```

**Backend Action:**
- Validates file types and sizes
- Strips metadata from video (privacy)
- Uploads to Cloudinary
- Creates Reel record
- Processes video (generate thumbnail, blurhash, duration)
- Awards XP to user

**Response (201 Created):**
```json
{
  "id": 1,
  "media": "https://cloudinary.com/video.mp4",
  "caption": "My caption",
  "processed": false
}
```

---

### POST /api/reels/<int:pk>/vote/

Like/unlike a reel.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Backend Action:**
- Toggles Vote record for user/reel
- Awards XP to reel owner on like
- Creates notification for reel owner

**Response (200 OK):**
```json
{
  "liked": true,
  "votes": 151
}
```

---

### POST /api/reels/<int:pk>/save/

Save/unsave a reel to bookmarks.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "saved": true
}
```

---

### GET /api/reels/following/

Get reels from followed users.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [...]
}
```

---

### GET /api/reels/saved/

Get user's saved reels.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [...]
}
```

---

### GET /api/reels/trending/

Get trending reels.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Backend Action:**
- Returns reels sorted by engagement score
- Algorithm: (views * 0.5 + votes * 2 + comments * 3 + shares * 5)

**Response (200 OK):**
```json
{
  "results": [...]
}
```

---

## Comments

### POST /api/comments/

Create a new comment.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "reel": 1,
  "text": "Great video!"
}
```

**Backend Action:**
- Creates Comment record
- Creates notification for reel owner
- Awards XP

**Response (201 Created):**
```json
{
  "id": 1,
  "user": {
    "username": "john_doe"
  },
  "text": "Great video!",
  "created_at": "2024-01-15T10:05:00Z"
}
```

---

### POST /api/comments/<int:pk>/like/

Like a comment.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "liked": true
}
```

---

### POST /api/comments/<int:pk>/reply/

Reply to a comment.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "text": "Reply text"
}
```

**Response (201 Created):**
```json
{
  "id": 1,
  "text": "Reply text",
  "created_at": "2024-01-15T10:10:00Z"
}
```

---

## Social Features

### POST /api/follows/

Follow a user.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "following": 2
}
```

**Backend Action:**
- Creates Follow record
- Creates notification for followed user
- Awards XP

**Response (201 Created):**
```json
{
  "id": 1,
  "following": {
    "username": "jane_doe"
  }
}
```

---

### POST /api/follows/toggle/

Toggle follow status.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "following": 2
}
```

**Response (200 OK):**
```json
{
  "following": true
}
```

---

### DELETE /api/follows/<int:pk>/

Unfollow a user.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (204 No Content)**

---

### POST /api/blocks/block/

Block a user.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "blocked": 5
}
```

**Backend Action:**
- Creates Block record
- Removes any existing follow relationship

**Response (201 Created):**
```json
{
  "id": 1,
  "blocked": {
    "username": "spam_user"
  }
}
```

---

## Notifications

### GET /api/notifications/

Get user's notifications.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "count": 50,
  "results": [
    {
      "id": 1,
      "sender": {
        "username": "jane_doe"
      },
      "notification_type": "like",
      "message": "jane_doe liked your reel",
      "is_read": false,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### POST /api/notifications/read/

Mark all notifications as read.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "marked_read": 5
}
```

---

## Campaigns & Contests

### GET /api/campaigns/

List all campaigns.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 1,
      "title": "Summer Dance Challenge",
      "description": "Show your best dance moves",
      "campaign_type": "video",
      "prize_title": "iPhone 15",
      "prize_value": "1000.00",
      "status": "active",
      "start_date": "2024-01-01T00:00:00Z",
      "entry_deadline": "2024-01-31T23:59:59Z",
      "winner_count": 3
    }
  ]
}
```

---

### POST /api/campaigns/<int:campaign_id>/enter/

Enter a campaign with a reel.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "reel": 1
}
```

**Backend Action:**
- Creates CampaignEntry record
- Validates reel ownership
- Checks campaign entry rules

**Response (201 Created):**
```json
{
  "id": 1,
  "campaign": 1,
  "reel": 1,
  "status": "pending"
}
```

---

### POST /api/campaigns/entries/<int:entry_id>/vote/

Vote for a campaign entry.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Backend Action:**
- Creates CampaignVote record
- Prevents duplicate votes per entry
- Increments entry vote count

**Response (200 OK):**
```json
{
  "voted": true,
  "vote_count": 10
}
```

---

### GET /api/campaigns/<int:campaign_id>/leaderboard/

Get campaign leaderboard.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "rank": 1,
      "entry": {
        "vote_count": 150
      },
      "user": {
        "username": "john_doe"
      }
    }
  ]
}
```

---

## Subscriptions & Payments

### GET /api/subscription/status/

Get user's subscription status.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "has_subscription": true,
  "tier": {
    "id": 1,
    "name": "Premium",
    "features": ["HD uploads", "No ads"]
  },
  "status": "active",
  "end_date": "2024-02-01T00:00:00Z",
  "days_remaining": 15,
  "auto_renew": true
}
```

---

### GET /api/subscriptions/tiers/

Get available subscription tiers.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 1,
      "name": "Basic",
      "duration_type": "monthly",
      "price_birr": 50,
      "price_coins": 500,
      "features": ["Standard uploads"]
    },
    {
      "id": 2,
      "name": "Premium",
      "duration_type": "monthly",
      "price_birr": 100,
      "price_coins": 1000,
      "features": ["HD uploads", "No ads"]
    }
  ]
}
```

---

### POST /api/subscriptions/subscribe/

Subscribe to a tier.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "tier_id": 2,
  "payment_method": "telebirr",
  "duration_type": "monthly"
}
```

**Backend Action:**
- Initiates payment via Telebirr
- Creates pending SubscriptionPlan
- Returns payment URL

**Response (200 OK):**
```json
{
  "subscription_id": 1,
  "payment_url": "https://telebirr.et/pay/...",
  "amount": 100,
  "currency": "ETB"
}
```

---

## Wallet & Coins

### GET /api/wallet/

Get wallet summary.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "balance": {
    "total": 1000,
    "earned": 500,
    "purchased": 500,
    "points": 2000
  },
  "recent_transactions": [
    {
      "id": 1,
      "type": "purchase",
      "coins": 100,
      "description": "Coin purchase"
    }
  ]
}
```

---

### GET /api/wallet/transactions/

Get transaction history.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "count": 100,
  "results": [
    {
      "id": 1,
      "type": "gift_sent",
      "coins": -50,
      "description": "Sent Rose to jane_doe"
    }
  ]
}
```

---

### POST /api/wallet/withdraw/

Request a withdrawal.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "coin_amount": 1000,
  "payout_method": "telebirr",
  "payout_account": "251911234567"
}
```

**Backend Action:**
- Validates balance and minimum withdrawal
- Calculates fee and net amount
- Creates WithdrawalRequest with status 'pending'
- Subtracts coins from balance

**Response (201 Created):**
```json
{
  "id": 1,
  "coin_amount": 1000,
  "gross_birr": 100,
  "fee_birr": 5,
  "net_birr": 95,
  "status": "pending"
}
```

---

### POST /api/wallet/telebirr/initiate/

Initiate Telebirr payment for coin purchase.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "coin_package_id": 1,
  "amount_birr": 10
}
```

**Backend Action:**
- Calls Telebirr API to initiate payment
- Creates pending transaction
- Returns payment URL

**Response (200 OK):**
```json
{
  "transaction_id": "TXN123",
  "payment_url": "https://telebirr.et/pay/...",
  "amount": 10,
  "coins": 100
}
```

---

## Virtual Gifts

### GET /api/gifts/

Get available gifts (public).

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 1,
      "name": "Rose",
      "icon_name": "Flower2",
      "icon_color": "#EC4899",
      "category": "flowers",
      "coin_value": 10,
      "rarity": "common"
    },
    {
      "id": 2,
      "name": "Heart",
      "icon_name": "Heart",
      "icon_color": "#EF4444",
      "category": "hearts",
      "coin_value": 50,
      "rarity": "common"
    }
  ]
}
```

---

### POST /api/gifts/send/

Send a gift to a user.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "gift_id": 1,
  "recipient_id": 2,
  "quantity": 1,
  "message": "For you!",
  "reel_id": 10
}
```

**Backend Action:**
- Validates user has sufficient coins
- Deducts coins from sender
- Creates GiftTransaction record
- Awards coins to recipient (minus platform fee)
- Creates notification for recipient
- Checks for gift combo bonuses

**Response (201 Created):**
```json
{
  "id": 1,
  "gift": {
    "name": "Rose",
    "coin_value": 10
  },
  "sender": {
    "username": "john_doe"
  },
  "recipient": {
    "username": "jane_doe"
  },
  "quantity": 1,
  "total_coins": 10
}
```

---

### GET /api/gifts/leaderboard/

Get gift leaderboard.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "rank": 1,
      "user": {
        "username": "jane_doe"
      },
      "total_gifts_received": 100,
      "total_coins_received": 5000
    }
  ]
}
```

---

## Messaging

### GET /api/messages/conversations/

List user's conversations.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Backend Action:**
- Returns conversations with last message preview
- Annotates with unread count
- Optimized to avoid N+1 queries

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 1,
      "participants": [
        {
          "id": 1,
          "username": "john_doe"
        },
        {
          "id": 2,
          "username": "jane_doe"
        }
      ],
      "last_message": {
        "text": "Hey there!",
        "sender_id": 2,
        "created_at": "2024-01-15T10:00:00Z"
      },
      "unread_count": 2,
      "last_message_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### POST /api/messages/conversations/

Create or fetch a 1-on-1 conversation.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "user_id": 2
}
```

**Backend Action:**
- Checks if conversation exists between users
- Creates new conversation if not
- Returns conversation details

**Response (200 OK):**
```json
{
  "id": 1,
  "participants": [
    {
      "username": "john_doe"
    },
    {
      "username": "jane_doe"
    }
  ]
}
```

---

### GET /api/messages/conversations/<int:conversation_id>/messages/

Get messages in a conversation.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 1,
      "sender": {
        "username": "john_doe"
      },
      "text": "Hey there!",
      "media_type": null,
      "created_at": "2024-01-15T10:00:00Z",
      "is_deleted": false
    }
  ]
}
```

---

### POST /api/messages/conversations/<int:conversation_id>/messages/

Send a message.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
Content-Type: multipart/form-data
```

**Request Body:**
```
text: "Hello"
media: <file>  // Optional
```

**Backend Action:**
- Creates Message record
- Handles file upload if provided
- Updates conversation last_message_at
- Creates notification for recipient

**Response (201 Created):**
```json
{
  "id": 1,
  "text": "Hello",
  "created_at": "2024-01-15T10:00:00Z"
}
```

---

### PATCH /api/messages/<int:message_id>/

Edit a message (within 15 minutes).

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "text": "Updated message"
}
```

**Backend Action:**
- Checks message ownership
- Validates edit window (15 minutes)
- Updates message text and edited_at

**Response (200 OK):**
```json
{
  "id": 1,
  "text": "Updated message",
  "edited_at": "2024-01-15T10:10:00Z"
}
```

---

### DELETE /api/messages/<int:message_id>/

Soft-delete a message.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Backend Action:**
- Sets is_deleted=true
- Keeps record for audit trail

**Response (204 No Content)**

---

### POST /api/messages/conversations/<int:conversation_id>/read/

Mark conversation as read.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Backend Action:**
- Creates or updates MessageRead record
- Sets last_read_at to now

**Response (200 OK):**
```json
{
  "message": "Conversation marked as read"
}
```

---

### GET /api/messages/unread-count/

Get total unread DM count.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "unread_count": 5
}
```

---

### GET /api/messages/users/search/

Search users to start a conversation.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Query Parameters:**
- `q`: Search query

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 2,
      "username": "jane_doe",
      "profile_photo": "https://..."
    }
  ]
}
```

---

## Admin & Management

### GET /api/admin/dashboard/

Get admin dashboard stats.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Permission:** IsAdminUser

**Response (200 OK):**
```json
{
  "total_users": 10000,
  "total_reels": 50000,
  "active_subscriptions": 500,
  "revenue_this_month": 50000
}
```

---

### GET /api/admin/users/

List all users (admin).

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Permission:** IsAdminUser

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 1,
      "username": "john_doe",
      "email": "john@example.com",
      "is_staff": false,
      "date_joined": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### GET /api/admin/reels/

List all reels (admin).

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Permission:** IsAdminUser

**Response (200 OK):**
```json
{
  "results": [...]
}
```

---

### DELETE /api/admin/reels/<int:reel_id>/delete/

Delete a reel (admin).

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Permission:** IsAdminUser

**Response (204 No Content)**

---

### GET /api/admin/settings/

Get platform settings (admin).

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Permission:** IsAdminUser

**Response (200 OK):**
```json
{
  "content_moderation": {
    "auto_approve": false
  },
  "notifications": {
    "enabled": true
  }
}
```

---

### PUT /api/admin/settings/update/

Update platform settings (admin).

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Permission:** IsAdminUser

**Request Body:**
```json
{
  "content_moderation": {
    "auto_approve": true
  }
}
```

**Response (200 OK):**
```json
{
  "message": "Settings updated"
}
```

---

## Legal & Privacy

### GET /api/legal/

Get all legal documents.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "document_type": "privacy_policy",
      "title": "Privacy Policy",
      "version": "1.0",
      "published_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### GET /api/legal/<str:document_type>/

Get specific legal document.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "document_type": "privacy_policy",
  "title": "Privacy Policy",
  "content": "...",
  "version": "1.0"
}
```

---

### POST /api/legal/<str:document_type>/accept/

Accept a legal document.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:** (empty)

**Backend Action:**
- Creates UserLegalAcceptance record
- Records timestamp and IP

**Response (200 OK):**
```json
{
  "message": "Document accepted"
}
```

---

### GET /api/privacy/consents/

Get user consent status.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "marketing": true,
  "analytics": true,
  "personalization": false
}
```

---

### POST /api/privacy/consents/update/

Update consent preferences.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "marketing": false,
  "analytics": true
}
```

**Response (200 OK):**
```json
{
  "message": "Consents updated"
}
```

---

## Support

### GET /api/support/requests/

Get user's support requests.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 1,
      "category": "billing",
      "subject": "Payment issue",
      "description": "I was charged twice",
      "status": "pending",
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### POST /api/support/requests/

Create a support request.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "category": "billing",
  "subject": "Payment issue",
  "description": "I was charged twice"
}
```

**Response (201 Created):**
```json
{
  "id": 1,
  "status": "pending"
}
```

---

## Boost System

### GET /api/boost/config/

Get boost configuration.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "rate_per_impression": 0.01,
  "min_impressions": 1000,
  "max_daily_impressions": 10000,
  "platform_fee_percent": 20
}
```

---

### POST /api/boost/campaigns/

Create a boost campaign.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "reel_id": 1,
  "impressions": 5000,
  "target_audience": {
    "age_range": "18-35",
    "interests": ["dance", "music"]
  }
}
```

**Backend Action:**
- Calculates cost based on impressions
- Validates user has sufficient coins
- Creates BoostCampaign record
- Deducts coins from balance

**Response (201 Created):**
```json
{
  "id": 1,
  "reel": 1,
  "impressions": 5000,
  "cost": 50,
  "status": "active",
  "end_time": "2024-01-16T10:00:00Z"
}
```

---

### GET /api/boost/campaigns/my/

Get user's boost campaigns.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [...]
}
```

---

## Gamification

### GET /api/gamification/status/

Get gamification status.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "xp": 5000,
  "level": 5,
  "streak": 10,
  "daily_bonus_claimed": false,
  "available_quests": [
    {
      "id": 1,
      "title": "Upload 3 reels",
      "xp_reward": 100,
      "completed": false
    }
  ]
}
```

---

### POST /api/gamification/login-bonus/

Claim daily login bonus.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Backend Action:**
- Awards coins and XP
- Updates streak
- Records in UserProfile

**Response (200 OK):**
```json
{
  "coins_awarded": 10,
  "xp_awarded": 5,
  "streak": 11
}
```

---

### POST /api/gamification/checkin/

Daily check-in.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "coins_awarded": 5,
  "streak": 11
}
```

---

## System & Health

### GET /api/

API root endpoint.

**Response (200 OK):**
```json
{
  "message": "FlipStar API",
  "version": "1.0",
  "status": "active"
}
```

---

### GET /api/health/

Health check (liveness probe).

**Response (200 OK):**
```json
{
  "status": "ok"
}
```

---

### GET /api/health/deep/

Deep health check (includes DB counts).

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Permission:** IsAdminUser

**Response (200 OK):**
```json
{
  "status": "ok",
  "database": {
    "engine": "django.db.backends.postgresql",
    "name": "flipstar_db"
  },
  "counts": {
    "users": 10000,
    "reels": 50000,
    "campaigns": 50
  }
}
```

---

## Categories

### GET /api/categories/

Get all content categories.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 1,
      "name": "Dance",
      "slug": "dance",
      "description": "Dance videos",
      "icon": "music",
      "order": 1,
      "is_active": true
    }
  ]
}
```

---

## Search

### GET /api/search/

Search across reels, users, hashtags.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Query Parameters:**
- `q`: Search query
- `type`: Search type (all, reels, users, hashtags)

**Response (200 OK):**
```json
{
  "reels": [...],
  "users": [...],
  "hashtags": [...]
}
```

---

## Reports

### POST /api/reports/create/

Create a report.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "target_type": "reel",
  "reported_reel_id": 1,
  "report_type": "inappropriate_content",
  "description": "This content violates community guidelines"
}
```

**Backend Action:**
- Creates Report record
- Links to target (user, reel, or comment)
- Sets status to 'pending'
- Notifies admins

**Response (201 Created):**
```json
{
  "id": 1,
  "status": "pending",
  "created_at": "2024-01-15T10:00:00Z"
}
```

---

## Web Push

### GET /api/push/public-key/

Get VAPID public key for web push.

**Response (200 OK):**
```json
{
  "public_key": "BC_kK..."
}
```

---

### POST /api/push/subscribe/

Subscribe to web push notifications.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "endpoint": "https://...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}
```

**Response (200 OK):**
```json
{
  "message": "Subscribed successfully"
}
```

---

### POST /api/push/unsubscribe/

Unsubscribe from web push notifications.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Request Body:**
```json
{
  "endpoint": "https://..."
}
```

**Response (200 OK):**
```json
{
  "message": "Unsubscribed successfully"
}
```

---

## CRM Integration (Admin)

### GET /api/admin/crm/packages/

Get CRM gift packages.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Permission:** IsAdminUser

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": 1,
      "name": "Welcome Package",
      "coin_value": 100,
      "external_package_id": "PKG001"
    }
  ]
}
```

---

### POST /api/admin/crm/award/

Award CRM gift to user.

**Headers:**
```
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
```

**Permission:** IsAdminUser

**Request Body:**
```json
{
  "user_id": 1,
  "package_id": 1,
  "reason": "Welcome bonus"
}
```

**Backend Action:**
- Creates CRMGiftTransaction record
- Credits coins to user
- Logs in audit trail

**Response (200 OK):**
```json
{
  "id": 1,
  "coins_awarded": 100,
  "status": "completed"
}
```

---

## Notes

- All authenticated endpoints require `Authorization: Token <token>` header
- Rate limiting applies to sensitive endpoints (login, OTP, password reset)
- File uploads use `multipart/form-data` content type
- Pagination uses `page` and `page_size` query parameters
- Datetimes are in ISO 8601 format
- All monetary values are in Ethiopian Birr (ETB) unless specified
