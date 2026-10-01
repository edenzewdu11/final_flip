# FlipStar Admin API Reference

Auto-generated from `frontend/admin/` JSX/JS files. Lists the admin panel's backend calls.

Base URL: `config.API_BASE_URL`

## GET `/admin/analytics/export/?type=reels`
- **Source:** `frontend/admin/pages/analytics/AnalyticsPage.jsx`
- **Payload:** (none)

## GET `/admin/analytics/export/?type=users`
- **Source:** `frontend/admin/pages/analytics/AnalyticsPage.jsx`
- **Payload:** (none)

## GET `/admin/api-keys/`
- **Source:** `frontend/admin/pages/system/APIKeysPage.jsx`
- **Payload:** (none)

## POST `/admin/api-keys/create/`
- **Source:** `frontend/admin/pages/system/APIKeysPage.jsx`
- **Payload:** JSON.stringify({ name, expires_days: expiryDays })

## POST `/admin/campaigns/create/`
- **Source:** `frontend/admin/pages/campaign/CampaignManagementPage.jsx`
- **Payload:** formDataToSend

## GET `/admin/contest/dashboard/`
- **Source:** `frontend/admin/pages/campaign/ContestDashboardPage.jsx`
- **Payload:** (none)

## POST `/admin/contest/flash-toggle/`
- **Source:** `frontend/admin/pages/campaign/ContestDashboardPage.jsx`
- **Payload:** JSON.stringify({
          active: !flashActive,
          multiplier: flashMultiplier,
          start_time: '18:00',
          end_time: '20:00',
        })

## POST `/admin/crm/award-campaign-winners/`
- **Source:** `frontend/admin/pages/campaign/CRMWinnersPage.jsx`
- **Payload:** JSON.stringify({
            selection_type: activeTab,
            package_id: parseInt(selectedPackage)
          })

## POST `/admin/crm/award/`
- **Source:** `frontend/admin/pages/campaign/CRMWinnersPage.jsx`
- **Payload:** JSON.stringify({
          user_id: userId,
          package_id: parseInt(selectedPackage),
          trigger_source: `crm_${activeTab}_winners`
        })

## POST `/admin/crm/award/`
- **Source:** `frontend/admin/pages/campaign/CRMWinnersPage.jsx`
- **Payload:** JSON.stringify({
              user_id: winner.user_id,
              package_id: parseInt(selectedPackage),
              trigger_source: `crm_${activeTab}_winners_selected`
            })

## GET `/admin/crm/packages/active/`
- **Source:** `frontend/admin/pages/campaign/CRMWinnersPage.jsx`
- **Payload:** (none)

## GET `/admin/crm/transactions/`
- **Source:** `frontend/admin/pages/campaign/CRMWinnersPage.jsx`
- **Payload:** (none)

## GET `/admin/dashboard/`
- **Source:** `frontend/admin/pages/analytics/AnalyticsPage.jsx`
- **Payload:** (none)

## GET `/admin/dashboard/`
- **Source:** `frontend/admin/pages/general/AdminDashboard.jsx`
- **Payload:** (none)

## GET `/admin/dashboard/`
- **Source:** `frontend/admin/pages/system/MobileAppPage.jsx`
- **Payload:** (none)

## GET `/admin/gifts/`
- **Source:** `frontend/admin/pages/content/GiftManagementPage.jsx`
- **Payload:** (none)

## POST `/admin/gifts/`
- **Source:** `frontend/admin/pages/content/GiftManagementPage.jsx`
- **Payload:** data

## POST `/admin/legal/create/`
- **Source:** `frontend/admin/pages/legal/LegalDocumentsPage.jsx`
- **Payload:** JSON.stringify(formData)

## GET `/admin/legal/stats/`
- **Source:** `frontend/admin/pages/legal/LegalDocumentsPage.jsx`
- **Payload:** (none)

## POST `/admin/logs/`
- **Source:** `frontend/admin/pages/security/SecurityPage.jsx`
- **Payload:** JSON.stringify({
        log_type: 'security',
        message: `IP ${ip} blocked by admin`,
      })

## POST `/admin/logs/clear/`
- **Source:** `frontend/admin/pages/system/SystemLogsPage.jsx`
- **Payload:** JSON.stringify({ log_type: filter })

## GET `/admin/master-campaigns/`
- **Source:** `frontend/admin/pages/campaign/CampaignManagementPage.jsx`
- **Payload:** (none)

## GET `/admin/master-campaigns/`
- **Source:** `frontend/admin/pages/campaign/EditCampaignModal.jsx`
- **Payload:** (none)

## POST `/admin/mobile-config/`
- **Source:** `frontend/admin/pages/system/MobileAppPage.jsx`
- **Payload:** JSON.stringify({ mobile_features: features, force_update: forceUpdate })

## GET `/admin/notifications/`
- **Source:** `frontend/admin/pages/system/NotificationsPage.jsx`
- **Payload:** (none)

## POST `/admin/notifications/send/`
- **Source:** `frontend/admin/pages/system/NotificationsPage.jsx`
- **Payload:** JSON.stringify(payload)

## GET `/admin/notifications/sent/`
- **Source:** `frontend/admin/pages/system/NotificationsPage.jsx`
- **Payload:** (none)

## GET `/admin/performance/`
- **Source:** `frontend/admin/pages/analytics/PerformancePage.jsx`
- **Payload:** (none)

## GET `/admin/privilege-audit/`
- **Source:** `frontend/admin/pages/user/AdminManagementPage.jsx`
- **Payload:** (none)

## GET `/admin/privilege-audit/`
- **Source:** `frontend/admin/pages/user/UserManagement.jsx`
- **Payload:** (none)

## POST `/admin/push-notifications/send/`
- **Source:** `frontend/admin/pages/system/MobileAppPage.jsx`
- **Payload:** JSON.stringify(notif)

## GET `/admin/reports/stats/`
- **Source:** `frontend/admin/pages/support/ReportsPage.jsx`
- **Payload:** (none)

## POST `/admin/security-events/log/`
- **Source:** `frontend/admin/AdminApp.jsx`
- **Payload:** JSON.stringify({
          event_type: eventType,
          severity: severity,
          page: page,
          details: `Unauthorized access attempt to ${page}`
        })

## POST `/admin/security-events/mark-all-read/`
- **Source:** `frontend/admin/pages/security/SecurityMonitoringPage.jsx`
- **Payload:** (none)

## GET `/admin/security-stats/`
- **Source:** `frontend/admin/components/layout/AdminSidebar.jsx`
- **Payload:** (none)

## GET `/admin/security-stats/`
- **Source:** `frontend/admin/pages/security/SecurityMonitoringPage.jsx`
- **Payload:** (none)

## GET `/admin/security/`
- **Source:** `frontend/admin/pages/security/SecurityPage.jsx`
- **Payload:** (none)

## POST `/admin/security/ban-ip/`
- **Source:** `frontend/admin/pages/security/SecurityPage.jsx`
- **Payload:** JSON.stringify({ ip_address: ip })

## GET `/admin/settings/`
- **Source:** `frontend/admin/pages/general/SettingsPage.jsx`
- **Payload:** (none)

## POST `/admin/settings/update/`
- **Source:** `frontend/admin/pages/general/SettingsPage.jsx`
- **Payload:** JSON.stringify(settings)

## GET `/admin/subscriptions/analytics/?type=subscription`
- **Source:** `frontend/admin/pages/financial/SubscriptionManagement.jsx`
- **Payload:** (none)

## GET `/admin/subscriptions/charging/?type=subscription`
- **Source:** `frontend/admin/pages/financial/SubscriptionManagement.jsx`
- **Payload:** (none)

## POST `/admin/wallet/adjust-balance/`
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** JSON.stringify({
          user_id: parseInt(user_id),
          amount: parseInt(amount),
          bucket,
          reason,
        })

## GET `/admin/wallet/config/`
- **Source:** `frontend/admin/pages/content/GiftManagementPage.jsx`
- **Payload:** (none)

## GET `/admin/wallet/config/`
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** (none)

## PATCH `/admin/wallet/config/`
- **Source:** `frontend/admin/pages/content/GiftManagementPage.jsx`
- **Payload:** JSON.stringify({
          gift_min_points_per_transaction: restrictions.min_points_per_transaction,
          gift_max_points_per_transaction: restrictions.max_points_per_transaction,
          gift_max_points_to_recipient_per_day: restrictions.max_points_to_recipient_per_day,
          gift_max_total_points_sent_per_day: restrictions.max_total_points_sent_per_day,
        })

## PATCH `/admin/wallet/config/`
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** JSON.stringify(flat)

## GET `/admin/withdrawal-analytics/`
- **Source:** `frontend/admin/pages/analytics/WithdrawalAnalyticsPage.jsx`
- **Payload:** (none)

## POST `/auth/login/`
- **Source:** `frontend/admin/pages/user/AdminManagementPage.jsx`
- **Payload:** JSON.stringify({
            username: currentAdmin.username,
            password: superadminPassword
          })

## POST `/auth/login/`
- **Source:** `frontend/admin/pages/user/AdminManagementPage.jsx`
- **Payload:** JSON.stringify({
            username: currentAdmin.email,
            password: superadminPassword
          })

## GET `/gifts/`
- **Source:** `frontend/admin/pages/content/GiftManagementPage.jsx`
- **Payload:** (none)

## GET `/settings/public/`
- **Source:** `frontend/admin/AdminApp.jsx`
- **Payload:** (none)

## GET `/settings/public/`
- **Source:** `frontend/admin/pages/system/MobileAppPage.jsx`
- **Payload:** (none)

## GET `/subscriptions/tiers/active/`
- **Source:** `frontend/admin/pages/financial/SubscriptionManagement.jsx`
- **Payload:** (none)

## DELETE ``/admin/api-keys/${keyId}/delete/``
- **Source:** `frontend/admin/pages/system/APIKeysPage.jsx`
- **Payload:** (none)

## POST ``/admin/api-keys/${keyId}/toggle/``
- **Source:** `frontend/admin/pages/system/APIKeysPage.jsx`
- **Payload:** (none)

## GET ``/admin/campaigns/${campaign.id}/analytics/``
- **Source:** `frontend/admin/pages/campaign/CampaignManagementPage.jsx`
- **Payload:** (none)

## POST ``/admin/campaigns/${campaign.id}/announce-winners/``
- **Source:** `frontend/admin/pages/campaign/CampaignManagementPage.jsx`
- **Payload:** (none)

## GET ``/admin/campaigns/${campaign.id}/entries/``
- **Source:** `frontend/admin/pages/campaign/CampaignManagementPage.jsx`
- **Payload:** (none)

## PATCH ``/admin/campaigns/${campaign.id}/update/``
- **Source:** `frontend/admin/pages/campaign/EditCampaignModal.jsx`
- **Payload:** fd

## GET ``/admin/campaigns/${campaignId}/posts/pending/``
- **Source:** `frontend/admin/pages/campaign/CampaignPostModeration.jsx`
- **Payload:** (none)

## GET ``/admin/campaigns/${campaignId}/scoring-config/``
- **Source:** `frontend/admin/pages/campaign/TypeSpecificScoringConfig.jsx`
- **Payload:** (none)

## PUT ``/admin/campaigns/${campaignId}/scoring-config/update/``
- **Source:** `frontend/admin/pages/campaign/TypeSpecificScoringConfig.jsx`
- **Payload:** JSON.stringify(payload)

## GET ``/admin/campaigns/${campaignId}/themes/``
- **Source:** `frontend/admin/pages/campaign/CampaignThemeManagement.jsx`
- **Payload:** (none)

## POST ``/admin/campaigns/${campaignId}/themes/``
- **Source:** `frontend/admin/pages/campaign/CampaignThemeManagement.jsx`
- **Payload:** JSON.stringify(payload)

## PATCH ``/admin/campaigns/${campaignId}/update/``
- **Source:** `frontend/admin/pages/campaign/CampaignManagementPage.jsx`
- **Payload:** JSON.stringify({ status: newStatus })

## GET ``/admin/campaigns/${filterParam}``
- **Source:** `frontend/admin/pages/campaign/CampaignManagementPage.jsx`
- **Payload:** (none)

## POST ``/admin/campaigns/posts/${scoreId}/moderate/``
- **Source:** `frontend/admin/pages/campaign/CampaignPostModeration.jsx`
- **Payload:** JSON.stringify({ action, ...scores })

## DELETE ``/admin/campaigns/themes/${deletingId}/``
- **Source:** `frontend/admin/pages/campaign/CampaignThemeManagement.jsx`
- **Payload:** (none)

## PUT ``/admin/campaigns/themes/${theme.id}/``
- **Source:** `frontend/admin/pages/campaign/CampaignThemeManagement.jsx`
- **Payload:** JSON.stringify(payload)

## POST ``/admin/campaigns/themes/${themeId}/activate/``
- **Source:** `frontend/admin/pages/campaign/CampaignThemeManagement.jsx`
- **Payload:** (none)

## GET ``/admin/contest/anti-cheat/?status=${filter}``
- **Source:** `frontend/admin/pages/security/AntiCheatPage.jsx`
- **Payload:** (none)

## POST ``/admin/contest/judge/${selectedPost.reel_id}/``
- **Source:** `frontend/admin/pages/legal/JudgingPortalPage.jsx`
- **Payload:** JSON.stringify({
          creativity: parseInt(scores.creativity),
          quality: parseInt(scores.quality),
          theme_relevance: parseInt(scores.theme),
        })

## GET ``/admin/contest/judging/?status=${filter}``
- **Source:** `frontend/admin/pages/legal/JudgingPortalPage.jsx`
- **Payload:** (none)

## POST ``/admin/contest/review-flag/${selectedFlag.id}/``
- **Source:** `frontend/admin/pages/security/AntiCheatPage.jsx`
- **Payload:** JSON.stringify({ status })

## GET ``/admin/crm/campaign-winners/?selection_type=${activeTab}``
- **Source:** `frontend/admin/pages/campaign/CRMWinnersPage.jsx`
- **Payload:** (none)

## PATCH ``/admin/gifts/${editingGift.id}/``
- **Source:** `frontend/admin/pages/content/GiftManagementPage.jsx`
- **Payload:** data

## DELETE ``/admin/gifts/${giftToDelete}/``
- **Source:** `frontend/admin/pages/content/GiftManagementPage.jsx`
- **Payload:** (none)

## POST ``/admin/legal/${docId}/archive/``
- **Source:** `frontend/admin/pages/legal/LegalDocumentsPage.jsx`
- **Payload:** (none)

## DELETE ``/admin/legal/${docId}/delete/``
- **Source:** `frontend/admin/pages/legal/LegalDocumentsPage.jsx`
- **Payload:** (none)

## POST ``/admin/legal/${docId}/publish/``
- **Source:** `frontend/admin/pages/legal/LegalDocumentsPage.jsx`
- **Payload:** (none)

## GET ``/admin/legal/${document.id}/``
- **Source:** `frontend/admin/pages/legal/LegalDocumentsPage.jsx`
- **Payload:** (none)

## GET ``/admin/legal/${document.id}/acceptances/``
- **Source:** `frontend/admin/pages/legal/LegalDocumentsPage.jsx`
- **Payload:** (none)

## PUT ``/admin/legal/${document.id}/update/``
- **Source:** `frontend/admin/pages/legal/LegalDocumentsPage.jsx`
- **Payload:** JSON.stringify(formData)

## GET ``/admin/legal/?${params}``
- **Source:** `frontend/admin/pages/legal/LegalDocumentsPage.jsx`
- **Payload:** (none)

## GET ``/admin/logs/?${params}``
- **Source:** `frontend/admin/pages/system/SystemLogsPage.jsx`
- **Payload:** (none)

## DELETE ``/admin/master-campaigns/${campaign.id}/``
- **Source:** `frontend/admin/pages/campaign/MasterCampaignManagementPage.jsx`
- **Payload:** (none)

## PUT ``/admin/master-campaigns/${campaign.id}/config/``
- **Source:** `frontend/admin/components/modal/GenerationConfigModal.jsx`
- **Payload:** JSON.stringify(config)

## POST ``/admin/master-campaigns/${campaign.id}/generate/``
- **Source:** `frontend/admin/components/modal/GenerationConfigModal.jsx`
- **Payload:** JSON.stringify({
          generate_daily: config.auto_generate_daily,
          generate_weekly: config.auto_generate_weekly,
          generate_monthly: config.auto_generate_monthly,
          generate_grand: config.auto_generate_grand,
          cleanup_excess: true  // New flag to remove excess campaigns
        })

## GET ``/admin/master-campaigns/${campaign.id}/stats/``
- **Source:** `frontend/admin/pages/campaign/MasterCampaignManagementPage.jsx`
- **Payload:** (none)

## GET ``/admin/master-campaigns/${filterParam}``
- **Source:** `frontend/admin/pages/campaign/MasterCampaignManagementPage.jsx`
- **Payload:** (none)

## POST ``/admin/moderation-actions/${undoingActionId}/undo/``
- **Source:** `frontend/admin/pages/support/ReportsPage.jsx`
- **Payload:** (none)

## POST ``/admin/notifications/${id}/read/``
- **Source:** `frontend/admin/pages/system/NotificationsPage.jsx`
- **Payload:** (none)

## GET ``/admin/reels/${reelId}/``
- **Source:** `frontend/admin/components/modal/ContentDetailModal.jsx`
- **Payload:** (none)

## POST ``/admin/reels/${reelId}/boost/``
- **Source:** `frontend/admin/pages/content/ContentModeration.jsx`
- **Payload:** JSON.stringify({ amount: parseInt(amount) })

## DELETE ``/admin/reels/${reelId}/delete/``
- **Source:** `frontend/admin/pages/content/ContentModeration.jsx`
- **Payload:** (none)

## POST ``/admin/reels/${reelId}/moderate/``
- **Source:** `frontend/admin/components/modal/ContentDetailModal.jsx`
- **Payload:** JSON.stringify({ action })

## GET ``/admin/reels/?page=${page}&search=${search}${statusFilter}``
- **Source:** `frontend/admin/pages/content/ContentModeration.jsx`
- **Payload:** (none)

## GET ``/admin/reports/${qs}``
- **Source:** `frontend/admin/pages/support/ReportsPage.jsx`
- **Payload:** (none)

## GET ``/admin/reports/${reportId}/``
- **Source:** `frontend/admin/pages/support/ReportsPage.jsx`
- **Payload:** (none)

## PUT ``/admin/reports/${reportId}/``
- **Source:** `frontend/admin/pages/support/ReportsPage.jsx`
- **Payload:** JSON.stringify({ status: 'reviewing' })

## POST ``/admin/reports/${selectedReport.id}/moderate/``
- **Source:** `frontend/admin/pages/support/ReportsPage.jsx`
- **Payload:** JSON.stringify({ action_taken: selectedAction, reason_details: resolutionNotes })

## POST ``/admin/security-events/${eventId}/resolve/``
- **Source:** `frontend/admin/pages/security/SecurityMonitoringPage.jsx`
- **Payload:** (none)

## GET ``/admin/security-events/?${params}``
- **Source:** `frontend/admin/pages/security/SecurityMonitoringPage.jsx`
- **Payload:** (none)

## GET ``/admin/users/${adminUser.id}/admin-role/``
- **Source:** `frontend/admin/hooks/usePermission.js`
- **Payload:** (none)

## PATCH ``/admin/users/${editModal.userId}/update/``
- **Source:** `frontend/admin/pages/user/AdminManagementPage.jsx`
- **Payload:** JSON.stringify(body)

## POST ``/admin/users/${grantAdminModal.userId}/grant-admin/``
- **Source:** `frontend/admin/pages/user/UserManagement.jsx`
- **Payload:** JSON.stringify({
          action: 'grant',
          role: grantAdminModal.role,
          permission_level: grantAdminModal.permissionLevel
        })

## GET ``/admin/users/${response.user.id}/admin-role/``
- **Source:** `frontend/admin/AdminApp.jsx`
- **Payload:** (none)

## GET ``/admin/users/${searchQuery}/``
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** (none)

## GET ``/admin/users/${selectedUserId}/logs/``
- **Source:** `frontend/admin/pages/user/AdminManagementPage.jsx`
- **Payload:** (none)

## GET ``/admin/users/${u.id}/admin-role/``
- **Source:** `frontend/admin/pages/user/AdminManagementPage.jsx`
- **Payload:** (none)

## DELETE ``/admin/users/${userId}/delete/``
- **Source:** `frontend/admin/pages/user/UserManagement.jsx`
- **Payload:** (none)

## POST ``/admin/users/${userId}/grant-admin/``
- **Source:** `frontend/admin/pages/user/AdminManagementPage.jsx`
- **Payload:** JSON.stringify({ action: currentStatus ? 'revoke' : 'grant' })

## POST ``/admin/users/${userId}/grant-admin/``
- **Source:** `frontend/admin/pages/user/UserManagement.jsx`
- **Payload:** JSON.stringify({ action: 'revoke' })

## PATCH ``/admin/users/${userId}/update/``
- **Source:** `frontend/admin/pages/user/AdminManagementPage.jsx`
- **Payload:** JSON.stringify({ is_active: !currentStatus })

## PATCH ``/admin/users/${userId}/update/``
- **Source:** `frontend/admin/pages/user/AdminManagementPage.jsx`
- **Payload:** JSON.stringify({ is_superuser: !currentStatus })

## PATCH ``/admin/users/${userId}/update/``
- **Source:** `frontend/admin/pages/user/UserManagement.jsx`
- **Payload:** JSON.stringify({ is_active: !currentStatus })

## GET ``/admin/users/?page=${page}&search=${search}``
- **Source:** `frontend/admin/pages/user/UserManagement.jsx`
- **Payload:** (none)

## GET ``/admin/users/?search=${searchQuery}``
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** (none)

## GET ``/admin/users/?search=${search}``
- **Source:** `frontend/admin/pages/user/AdminManagementPage.jsx`
- **Payload:** (none)

## GET ``/admin/users/?search=${variant}``
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** (none)

## GET ``/admin/wallet/transactions/?user_id=${userId}&page_size=50``
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** (none)

## GET ``/admin/wallet/user/${user.id}/``
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** (none)

## GET ``/admin/wallet/user/${userData.id}/``
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** (none)

## POST ``/admin/wallet/withdrawals/${withdrawalId}/action/``
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** JSON.stringify({
          action,
          notes,
          payout_reference: payoutReference,
        })

## GET ``/admin/wallet/withdrawals/?${params.toString()}``
- **Source:** `frontend/admin/pages/analytics/WithdrawalAnalyticsPage.jsx`
- **Payload:** (none)

## GET ``/admin/wallet/withdrawals/?${params}``
- **Source:** `frontend/admin/pages/financial/CoinManagementPage.jsx`
- **Payload:** (none)

## GET ``/campaigns/${campaignId}/``
- **Source:** `frontend/admin/pages/campaign/CampaignPostModeration.jsx`
- **Payload:** (none)

## GET ``/campaigns/${campaignId}/``
- **Source:** `frontend/admin/pages/campaign/CampaignThemeManagement.jsx`
- **Payload:** (none)

## GET ``/charging/on-demand/analytics/?period=${analyticsPeriod}``
- **Source:** `frontend/admin/pages/financial/ChargingDashboard.jsx`
- **Payload:** (none)

## GET ``/charging/on-demand/statistics/?days=3650``
- **Source:** `frontend/admin/pages/financial/ChargingDashboard.jsx`
- **Payload:** (none)

## GET ``/charging/on-demand/transactions/?days=3650&page=${page}&page_size=50``
- **Source:** `frontend/admin/pages/financial/ChargingDashboard.jsx`
- **Payload:** (none)

## DELETE `deleteUrl`
- **Source:** `frontend/admin/pages/campaign/CampaignManagementPage.jsx`
- **Payload:** (none)

## GET `url`
- **Source:** `frontend/admin/pages/campaign/MasterCampaignManagementPage.jsx`
- **Payload:** JSON.stringify(formData)

## GET `url`
- **Source:** `frontend/admin/pages/financial/ChargingDashboard.jsx`
- **Payload:** (none)

## GET `url`
- **Source:** `frontend/admin/pages/legal/LeaderboardPage.jsx`
- **Payload:** (none)
