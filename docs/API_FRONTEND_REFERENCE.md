# FlipStar Frontend API Reference

Auto-generated from `frontend/api.js`. Lists the endpoints the web/mobile app calls.

Base URL: `config.API_BASE_URL`

## loginWithPhone
- **Endpoint:** `/auth/login-phone/`
- **Method:** POST
- **Frontend params:** `phone, pin`
- **Payload:** JSON.stringify({ phone, pin })

## login
- **Endpoint:** `/auth/login/`
- **Method:** POST
- **Frontend params:** `username, password`
- **Payload:** JSON.stringify({ username, password })

## sendPhoneOtp
- **Endpoint:** `/auth/send-phone-otp/`
- **Method:** POST
- **Frontend params:** `phone`
- **Payload:** JSON.stringify({ phone })

## verifyPhoneOtp
- **Endpoint:** `/auth/verify-phone-otp/`
- **Method:** POST
- **Frontend params:** `phone, code`
- **Payload:** JSON.stringify({ phone, code })

## forgotPasswordPhoneRequest
- **Endpoint:** `/auth/forgot-password-phone/`
- **Method:** POST
- **Frontend params:** `phone`
- **Payload:** JSON.stringify({ phone })

## forgotPasswordPhoneVerify
- **Endpoint:** `/auth/forgot-password-phone/verify/`
- **Method:** POST
- **Frontend params:** `phone, code, new_password`
- **Payload:** JSON.stringify({ phone, code, new_password })

## resendSubscriptionOtp
- **Endpoint:** `/auth/resend-subscription-otp/`
- **Method:** POST
- **Frontend params:** `phone`
- **Payload:** JSON.stringify({ phone })

## getProfile
- **Endpoint:** `/profile/me/`
- **Method:** GET
- **Payload:** (none)

## updateProfile
- **Endpoint:** `/profile/1/`
- **Method:** PATCH
- **Frontend params:** `data`
- **Payload:** `data` object

## dailyCheckIn
- **Endpoint:** `/profile/daily_checkin/`
- **Method:** POST
- **Payload:** (none)

## getReels
- **Endpoint:** `/reels/`
- **Method:** GET
- **Payload:** (none)

## getCompetitions
- **Endpoint:** `/competitions/`
- **Method:** GET
- **Payload:** (none)

## getActiveCompetitions
- **Endpoint:** `/competitions/?is_active=true`
- **Method:** GET
- **Payload:** (none)

## getWinners
- **Endpoint:** `/winners/`
- **Method:** GET
- **Payload:** (none)

## getLatestWinners
- **Endpoint:** `/winners/latest/`
- **Method:** GET
- **Payload:** (none)

## followUser
- **Endpoint:** `/follows/toggle/`
- **Method:** POST
- **Frontend params:** `userId`
- **Payload:** JSON.stringify({ following_id: userId })
- **Cache invalidation:** /follows

## unfollowUser
- **Endpoint:** `/follows/toggle/`
- **Method:** POST
- **Frontend params:** `userId`
- **Payload:** JSON.stringify({ following_id: userId })
- **Cache invalidation:** /follows

## getNotificationSettings
- **Endpoint:** `/notifications/me/`
- **Method:** GET
- **Payload:** (none)

## updateNotificationSettings
- **Endpoint:** `/notifications/me/`
- **Method:** PATCH
- **Frontend params:** `settings`
- **Payload:** `settings` object

## getPrivacySettings
- **Endpoint:** `/profile/privacy/`
- **Method:** GET
- **Payload:** (none)

## updatePrivacySettings
- **Endpoint:** `/profile/privacy/update/`
- **Method:** PATCH
- **Frontend params:** `settings`
- **Payload:** `settings` object

## getUserNotifications
- **Endpoint:** `/notifications/`
- **Method:** GET
- **Payload:** (none)

## getUnreadNotificationCount
- **Endpoint:** `/notifications/unread-count/`
- **Method:** GET
- **Payload:** (none)

## markAllNotificationsRead
- **Endpoint:** `/notifications/read/`
- **Method:** POST
- **Payload:** JSON.stringify({})

## createReport
- **Endpoint:** `/reports/create/`
- **Method:** POST
- **Frontend params:** `reportData`
- **Payload:** `reportData` object

## getAdminReportsStats
- **Endpoint:** `/admin/reports/stats/`
- **Method:** GET
- **Payload:** (none)

## getQuests
- **Endpoint:** `/quests/`
- **Method:** GET
- **Payload:** (none)

## getSubscription
- **Endpoint:** `/subscription/`
- **Method:** GET
- **Payload:** (none)

## getNotificationPrefs
- **Endpoint:** `/notifications/me/`
- **Method:** GET
- **Payload:** (none)

## updateNotificationPrefs
- **Endpoint:** `/notifications/me/`
- **Method:** PUT
- **Frontend params:** `prefs`
- **Payload:** `prefs` object

## toggleFollow
- **Endpoint:** `/follows/toggle/`
- **Method:** POST
- **Frontend params:** `userId`
- **Payload:** JSON.stringify({ following_id: userId })

## getUserSuggestions
- **Endpoint:** `/follows/suggestions/`
- **Method:** GET
- **Payload:** (none)

## getSavedPosts
- **Endpoint:** `/saved/`
- **Method:** GET
- **Payload:** (none)

## toggleSavePost
- **Endpoint:** `/saved/toggle/`
- **Method:** POST
- **Frontend params:** `reelId`
- **Payload:** JSON.stringify({ reel_id: reelId })

## updateUserProfile
- **Endpoint:** `/profile/update_profile/`
- **Method:** PATCH
- **Frontend params:** `data`
- **Payload:** FormData (multipart)

## getSavedPosts
- **Endpoint:** `/reels/?saved=true`
- **Method:** GET
- **Payload:** (none)

## getUserSavedPosts
- **Endpoint:** `/reels/?saved=true`
- **Method:** GET
- **Payload:** (none)

## checkSubscriptionStatus
- **Endpoint:** `/subscription/status/`
- **Method:** GET
- **Payload:** (none)

## changePassword
- **Endpoint:** `/auth/change-password/`
- **Method:** POST
- **Frontend params:** `currentPassword, newPassword`
- **Payload:** JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      })

## deleteAccount
- **Endpoint:** `/auth/delete-account/`
- **Method:** POST
- **Payload:** (none)

## downloadUserData
- **Endpoint:** `/auth/download-data/`
- **Method:** GET
- **Payload:** (none)

## getMySupportRequests
- **Endpoint:** `/support/requests/`
- **Method:** GET
- **Payload:** (none)

## createSupportRequest
- **Endpoint:** `/support/requests/`
- **Method:** POST
- **Frontend params:** `{ category, subject, message }`
- **Payload:** JSON.stringify({ category, subject, message })
