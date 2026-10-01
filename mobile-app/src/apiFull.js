// Full API surface mirroring the FlipStar Backend API - Staging Postman collection.
// Every endpoint defined in the collection has a corresponding wrapper here,
// grouped by the same folder names used in Postman. All requests go through
// the shared `api.request` helper in `./api` so auth, encryption, retries and
// base-URL failover behave identically to the rest of the app.
import api from './api';

// ─────────────────────────────────────────────────────────────────────────
// Admin / Campaigns
// ─────────────────────────────────────────────────────────────────────────
export const adminCampaignsApi = {
  list: () => api.request('/admin/campaigns/'),
  analytics: (campaignId) => api.request(`/admin/campaigns/${campaignId}/analytics/`),
  announceWinners: (campaignId, data = {}) =>
    api.request(`/admin/campaigns/${campaignId}/announce-winners/`, { method: 'POST', body: JSON.stringify(data) }),
  delete: (campaignId) => api.request(`/admin/campaigns/${campaignId}/delete/`, { method: 'DELETE' }),
  entries: (campaignId) => api.request(`/admin/campaigns/${campaignId}/entries/`),
  calculateFinalScores: (campaignId, data = {}) =>
    api.request(`/admin/campaigns/${campaignId}/final-scores/calculate/`, { method: 'POST', body: JSON.stringify(data) }),
  getFinalists: (campaignId) => api.request(`/admin/campaigns/${campaignId}/finalists/`),
  qualifyFinalists: (campaignId, percentage = 20) =>
    api.request(`/admin/campaigns/${campaignId}/finalists/qualify/`, { method: 'POST', body: JSON.stringify({ percentage }) }),
  submitJudgeScore: (campaignId, data) =>
    api.request(`/admin/campaigns/${campaignId}/judge-score/`, { method: 'POST', body: JSON.stringify(data) }),
  generateLeaderboard: (campaignId, data = {}) =>
    api.request(`/admin/campaigns/${campaignId}/leaderboard/generate/`, { method: 'POST', body: JSON.stringify(data) }),
  postsPending: (campaignId) => api.request(`/admin/campaigns/${campaignId}/posts/pending/`),
  getScoringConfig: (campaignId) => api.request(`/admin/campaigns/${campaignId}/scoring-config/`),
  updateScoringConfig: (campaignId, data = {}) =>
    api.request(`/admin/campaigns/${campaignId}/scoring-config/update/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replaceScoringConfig: (campaignId, data = {}) =>
    api.request(`/admin/campaigns/${campaignId}/scoring-config/update/`, { method: 'PUT', body: JSON.stringify(data) }),
  calculateScores: (campaignId, data = {}) =>
    api.request(`/admin/campaigns/${campaignId}/scoring/calculate/`, { method: 'POST', body: JSON.stringify(data) }),
  saveScores: (campaignId, data = {}) =>
    api.request(`/admin/campaigns/${campaignId}/scoring/save/`, { method: 'POST', body: JSON.stringify(data) }),
  getThemes: (campaignId) => api.request(`/admin/campaigns/${campaignId}/themes/`),
  createTheme: (campaignId, data = {}) =>
    api.request(`/admin/campaigns/${campaignId}/themes/`, { method: 'POST', body: JSON.stringify(data) }),
  update: (campaignId, data = {}) =>
    api.request(`/admin/campaigns/${campaignId}/update/`, { method: 'PATCH', body: JSON.stringify(data) }),
  selectWinners: (campaignId, data = {}) =>
    api.request(`/admin/campaigns/${campaignId}/winners/select/`, { method: 'POST', body: JSON.stringify(data) }),
  create: (data) => api.request('/admin/campaigns/create/', { method: 'POST', body: JSON.stringify(data) }),
  moderatePost: (scoreId, data = {}) =>
    api.request(`/admin/campaigns/posts/${scoreId}/moderate/`, { method: 'POST', body: JSON.stringify(data) }),
  updatePostScores: (scoreId, data = {}) =>
    api.request(`/admin/campaigns/posts/${scoreId}/scores/`, { method: 'POST', body: JSON.stringify(data) }),
  deleteTheme: (themeId) => api.request(`/admin/campaigns/themes/${themeId}/`, { method: 'DELETE' }),
  updateTheme: (themeId, data = {}) => api.request(`/admin/campaigns/themes/${themeId}/`, { method: 'PUT', body: JSON.stringify(data) }),
  activateTheme: (themeId) =>
    api.request(`/admin/campaigns/themes/${themeId}/activate/`, { method: 'POST', body: JSON.stringify({}) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Admin / Contest
// ─────────────────────────────────────────────────────────────────────────
export const adminContestApi = {
  antiCheatFlags: () => api.request('/admin/contest/anti-cheat/'),
  dashboard: () => api.request('/admin/contest/dashboard/'),
  flashToggle: (data) => api.request('/admin/contest/flash-toggle/', { method: 'POST', body: JSON.stringify(data) }),
  judgePost: (reelId, data) => api.request(`/admin/contest/judge/${reelId}/`, { method: 'POST', body: JSON.stringify(data) }),
  judging: () => api.request('/admin/contest/judging/'),
  reviewFlag: (flagId, data) => api.request(`/admin/contest/review-flag/${flagId}/`, { method: 'POST', body: JSON.stringify(data) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Admin / Core
// ─────────────────────────────────────────────────────────────────────────
export const adminCoreApi = {
  analyticsExport: () => api.request('/admin/analytics/export/'),
  commentsList: () => api.request('/admin/comments/'),
  deleteComment: (commentId) => api.request(`/admin/comments/${commentId}/delete/`, { method: 'DELETE' }),
  dashboard: () => api.request('/admin/dashboard/'),
  reelsList: () => api.request('/admin/reels/'),
  boostReel: (reelId, data = {}) => api.request(`/admin/reels/${reelId}/boost/`, { method: 'POST', body: JSON.stringify(data) }),
  deleteReel: (reelId) => api.request(`/admin/reels/${reelId}/delete/`, { method: 'DELETE' }),
  usersList: () => api.request('/admin/users/'),
  userDetail: (userId) => api.request(`/admin/users/${userId}/`),
  deleteUser: (userId) => api.request(`/admin/users/${userId}/delete/`, { method: 'DELETE' }),
  updateUser: (userId, data) => api.request(`/admin/users/${userId}/update/`, { method: 'PATCH', body: JSON.stringify(data) }),
  bulkUserAction: (userIds, action) =>
    api.request('/admin/users/bulk/', { method: 'POST', body: JSON.stringify({ user_ids: userIds, action }) }),
  wipeAllPosts: () => api.request('/admin/wipe-all-posts/', { method: 'DELETE' }),
};

// ─────────────────────────────────────────────────────────────────────────
// Admin / Gifts
// ─────────────────────────────────────────────────────────────────────────
export const adminGiftsApi = {
  list: () => api.request('/admin/gifts/'),
  create: (data) => api.request('/admin/gifts/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/admin/gifts/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/admin/gifts/${pk}/`),
  update: (pk, data) => api.request(`/admin/gifts/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/admin/gifts/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  active: () => api.request('/admin/gifts/active/'),
  byCategory: () => api.request('/admin/gifts/by_category/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Admin / Legal
// ─────────────────────────────────────────────────────────────────────────
export const adminLegalApi = {
  list: () => api.request('/admin/legal/'),
  detail: (documentId) => api.request(`/admin/legal/${documentId}/`),
  acceptances: (documentId) => api.request(`/admin/legal/${documentId}/acceptances/`),
  archive: (documentId) => api.request(`/admin/legal/${documentId}/archive/`, { method: 'POST', body: JSON.stringify({}) }),
  delete: (documentId) => api.request(`/admin/legal/${documentId}/delete/`, { method: 'DELETE' }),
  publish: (documentId) => api.request(`/admin/legal/${documentId}/publish/`, { method: 'POST', body: JSON.stringify({}) }),
  update: (documentId, data = {}) => api.request(`/admin/legal/${documentId}/update/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (documentId, data = {}) => api.request(`/admin/legal/${documentId}/update/`, { method: 'PUT', body: JSON.stringify(data) }),
  create: (data) => api.request('/admin/legal/create/', { method: 'POST', body: JSON.stringify(data) }),
  stats: () => api.request('/admin/legal/stats/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Admin / Master Campaigns
// ─────────────────────────────────────────────────────────────────────────
export const adminMasterCampaignsApi = {
  list: () => api.request('/admin/master-campaigns/'),
  create: (data) => api.request('/admin/master-campaigns/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/admin/master-campaigns/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/admin/master-campaigns/${pk}/`),
  update: (pk, data) => api.request(`/admin/master-campaigns/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  updateGenerationConfig: (pk, data) => api.request(`/admin/master-campaigns/${pk}/config/`, { method: 'PUT', body: JSON.stringify(data) }),
  generateSubCampaigns: (pk, confirm = true) =>
    api.request(`/admin/master-campaigns/${pk}/generate/`, { method: 'POST', body: JSON.stringify({ confirm }) }),
  participants: (pk) => api.request(`/admin/master-campaigns/${pk}/participants/`),
  stats: (pk) => api.request(`/admin/master-campaigns/${pk}/stats/`),
  test: (pk) => api.request(`/admin/master-campaigns/${pk}/test/`),
};

// ─────────────────────────────────────────────────────────────────────────
// Admin / Moderation
// ─────────────────────────────────────────────────────────────────────────
export const adminModerationApi = {
  undoAction: (actionId) => api.request(`/admin/moderation-actions/${actionId}/undo/`, { method: 'POST', body: JSON.stringify({}) }),
  reportsList: () => api.request('/admin/reports/'),
  reportDetail: (reportId) => api.request(`/admin/reports/${reportId}/`),
  updateReport: (reportId, data = {}) => api.request(`/admin/reports/${reportId}/`, { method: 'PUT', body: JSON.stringify(data) }),
  moderateReport: (reportId, data) => api.request(`/admin/reports/${reportId}/moderate/`, { method: 'POST', body: JSON.stringify(data) }),
  reportsStats: () => api.request('/admin/reports/stats/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Admin / Platform Settings
// ─────────────────────────────────────────────────────────────────────────
export const adminPlatformApi = {
  apiKeys: () => api.request('/admin/api-keys/'),
  deleteApiKey: (keyId) => api.request(`/admin/api-keys/${keyId}/delete/`, { method: 'DELETE' }),
  toggleApiKey: (keyId) => api.request(`/admin/api-keys/${keyId}/toggle/`, { method: 'POST', body: JSON.stringify({}) }),
  createApiKey: (name) => api.request('/admin/api-keys/create/', { method: 'POST', body: JSON.stringify({ name }) }),
  database: () => api.request('/admin/database/'),
  logs: () => api.request('/admin/logs/'),
  clearLogs: () => api.request('/admin/logs/clear/', { method: 'POST', body: JSON.stringify({}) }),
  notifications: () => api.request('/admin/notifications/'),
  readNotification: (notificationId) => api.request(`/admin/notifications/${notificationId}/read/`, { method: 'POST', body: JSON.stringify({}) }),
  sendNotification: (data) => api.request('/admin/notifications/send/', { method: 'POST', body: JSON.stringify(data) }),
  performance: () => api.request('/admin/performance/'),
  security: () => api.request('/admin/security/'),
  settings: () => api.request('/admin/settings/'),
  updateSettings: (data) => api.request('/admin/settings/update/', { method: 'POST', body: JSON.stringify(data) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Admin / Subscriptions
// ─────────────────────────────────────────────────────────────────────────
export const adminSubscriptionsApi = {
  list: () => api.request('/admin/subscriptions/'),
  upgradeUser: (userId, tier, durationDays = 30) =>
    api.request(`/admin/subscriptions/${userId}/upgrade/`, { method: 'POST', body: JSON.stringify({ tier, duration_days: durationDays }) }),
  analytics: () => api.request('/admin/subscriptions/analytics/'),
  charging: () => api.request('/admin/subscriptions/charging/'),
  revenue: () => api.request('/admin/subscriptions/revenue/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Admin / Support
// ─────────────────────────────────────────────────────────────────────────
export const adminSupportApi = {
  requests: () => api.request('/admin/support/requests/'),
  updateRequest: (requestId, data) => api.request(`/admin/support/requests/${requestId}/`, { method: 'PATCH', body: JSON.stringify(data) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Admin / Wallet
// ─────────────────────────────────────────────────────────────────────────
export const adminWalletApi = {
  adjustBalance: (data) => api.request('/admin/wallet/adjust-balance/', { method: 'POST', body: JSON.stringify(data) }),
  allTransactions: () => api.request('/admin/wallet/all-transactions/'),
  getConfig: () => api.request('/admin/wallet/config/'),
  updateConfig: (data = {}) => api.request('/admin/wallet/config/', { method: 'PATCH', body: JSON.stringify(data) }),
  userTransactions: () => api.request('/admin/wallet/transactions/'),
  userWallet: (userId) => api.request(`/admin/wallet/user/${userId}/`),
  withdrawals: () => api.request('/admin/wallet/withdrawals/'),
  withdrawalAction: (withdrawalId, data) =>
    api.request(`/admin/wallet/withdrawals/${withdrawalId}/action/`, { method: 'POST', body: JSON.stringify(data) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Authentication (endpoints not already in api.js)
// ─────────────────────────────────────────────────────────────────────────
export const authFullApi = {
  checkPhoneAccount: (phone) => api.request('/auth/check-phone-account/', { method: 'POST', body: JSON.stringify({ phone }) }),
  devCreateSubscription: (phone) => api.request('/auth/dev-create-subscription/', { method: 'POST', body: JSON.stringify({ phone }) }),
  loginWithPhone: (phone, password) =>
    api.request('/auth/login-with-phone/', { method: 'POST', body: JSON.stringify({ phone, password }) }),
  loginWithSubscriptionOtp: (phone, username, otp, password) =>
    api.request('/auth/login-with-subscription-otp/', { method: 'POST', body: JSON.stringify({ phone, username, otp, password }) }),
  resetPassword: (email, newPassword) =>
    api.request('/auth/reset-password/', { method: 'POST', body: JSON.stringify({ email, new_password: newPassword }) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Boost
// ─────────────────────────────────────────────────────────────────────────
export const boostApi = {
  calculateCost: (durationHours, hasPremiumTargeting = false) =>
    api.request('/boost/calculate-cost/', { method: 'POST', body: JSON.stringify({ duration_hours: durationHours, has_premium_targeting: hasPremiumTargeting }) }),
  create: (data) => api.request('/boost/campaigns/', { method: 'POST', body: JSON.stringify(data) }),
  detail: (campaignId) => api.request(`/boost/campaigns/${campaignId}/`),
  cancel: (campaignId) => api.request(`/boost/campaigns/${campaignId}/cancel/`, { method: 'POST', body: JSON.stringify({}) }),
  pause: (campaignId) => api.request(`/boost/campaigns/${campaignId}/pause/`, { method: 'POST', body: JSON.stringify({}) }),
  resume: (campaignId) => api.request(`/boost/campaigns/${campaignId}/resume/`, { method: 'POST', body: JSON.stringify({}) }),
  myCampaigns: () => api.request('/boost/campaigns/my/'),
  config: () => api.request('/boost/config/'),
  eligible: () => api.request('/boost/eligible/'),
  trackEngagement: (reelId, engagementType) =>
    api.request('/boost/engagement/', { method: 'POST', body: JSON.stringify({ reel_id: reelId, engagement_type: engagementType }) }),
  trackImpression: (reelId) => api.request('/boost/impression/', { method: 'POST', body: JSON.stringify({ reel_id: reelId }) }),
  pacingCheck: (data = {}) => api.request('/boost/pacing-check/', { method: 'POST', body: JSON.stringify(data) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Campaigns (public), Competitions & Winners (extra endpoints)
// ─────────────────────────────────────────────────────────────────────────
export const campaignsFullApi = {
  updateConsistencyScores: (campaignId) =>
    api.request(`/campaigns/${campaignId}/consistency/update/`, { method: 'POST', body: JSON.stringify({}) }),
  enter: (campaignId, reelId) =>
    api.request(`/campaigns/${campaignId}/enter/`, { method: 'POST', body: JSON.stringify({ reel_id: reelId }) }),
  detailExtended: (campaignId) => api.request(`/campaigns/${campaignId}/extended/`),
  finalistsVoting: (campaignId) => api.request(`/campaigns/${campaignId}/finalists/voting/`),
  castVote: (campaignId, finalistId) =>
    api.request(`/campaigns/${campaignId}/vote/`, { method: 'POST', body: JSON.stringify({ finalist_id: finalistId }) }),
  winners: (campaignId) => api.request(`/campaigns/${campaignId}/winners/`),
  active: () => api.request('/campaigns/active/'),
  notifications: () => api.request('/campaigns/notifications/'),
  createPost: (data) => api.request('/campaigns/posts/create/', { method: 'POST', body: JSON.stringify(data) }),
  myProfile: () => api.request('/campaigns/profile/'),
  profileDetail: (userId) => api.request(`/campaigns/profile/${userId}/`),
};

export const competitionsApi = {
  list: () => api.request('/competitions/'),
  create: (data) => api.request('/competitions/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/competitions/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/competitions/${pk}/`),
  update: (pk, data) => api.request(`/competitions/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/competitions/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  determineWinner: (pk) => api.request(`/competitions/${pk}/determine_winner/`, { method: 'POST', body: JSON.stringify({}) }),
};

export const winnersApi = {
  list: () => api.request('/winners/'),
  detail: (pk) => api.request(`/winners/${pk}/`),
  latest: () => api.request('/winners/latest/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Coins & Contest
// ─────────────────────────────────────────────────────────────────────────
export const coinsApi = {
  balance: () => api.request('/coins/balance/'),
  boostPost: (reelId, durationHours) =>
    api.request('/coins/boost/', { method: 'POST', body: JSON.stringify({ reel_id: reelId, duration_hours: durationHours }) }),
  extraEntry: (campaignId) => api.request('/coins/extra-entry/', { method: 'POST', body: JSON.stringify({ campaign_id: campaignId }) }),
  giftCreator: (data) => api.request('/coins/gift/', { method: 'POST', body: JSON.stringify(data) }),
  purchase: (packageId, paymentMethod = 'telebirr') =>
    api.request('/coins/purchase/', { method: 'POST', body: JSON.stringify({ package_id: packageId, payment_method: paymentMethod }) }),
  sendGift: (data) => api.request('/coins/send-gift/', { method: 'POST', body: JSON.stringify(data) }),
  transactions: () => api.request('/coins/transactions/'),
};

export const eligibilityApi = {
  verifyAge: (dateOfBirth) => api.request('/eligibility/age/', { method: 'POST', body: JSON.stringify({ date_of_birth: dateOfBirth }) }),
  verifyPhone: (phoneNumber, verificationCode) =>
    api.request('/eligibility/phone/', { method: 'POST', body: JSON.stringify({ phone_number: phoneNumber, verification_code: verificationCode }) }),
};

export const grandFinaleApi = {
  get: () => api.request('/grand-finale/'),
  vote: (entryId, coins) => api.request('/grand-finale/vote/', { method: 'POST', body: JSON.stringify({ entry_id: entryId, coins }) }),
};

export const scoresApi = {
  postScore: (reelId) => api.request(`/scores/${reelId}/`),
};

export const uploadApi = {
  check: () => api.request('/upload/check/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Comments (comment-replies & comments collections)
// ─────────────────────────────────────────────────────────────────────────
export const commentRepliesApi = {
  list: () => api.request('/comment-replies/'),
  create: (data) => api.request('/comment-replies/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/comment-replies/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/comment-replies/${pk}/`),
  update: (pk, data) => api.request(`/comment-replies/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/comment-replies/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  like: (pk) => api.request(`/comment-replies/${pk}/like/`, { method: 'POST', body: JSON.stringify({}) }),
};

export const commentsFullApi = {
  list: () => api.request('/comments/'),
  create: (data) => api.request('/comments/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/comments/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/comments/${pk}/`),
  update: (pk, data) => api.request(`/comments/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/comments/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  like: (pk) => api.request(`/comments/${pk}/like/`, { method: 'POST', body: JSON.stringify({}) }),
  reply: (pk, data) => api.request(`/comments/${pk}/reply/`, { method: 'POST', body: JSON.stringify(data) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Danger Zone
// ─────────────────────────────────────────────────────────────────────────
export const dangerZoneApi = {
  cleanupReels: () => api.request('/cleanup-reels/', { method: 'POST', body: JSON.stringify({}) }),
  setupAdmin: () => api.request('/setup-admin/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Gamification
// ─────────────────────────────────────────────────────────────────────────
export const gamificationFullApi = {
  recentActivity: () => api.request('/gamification/activity/'),
  checkIn: () => api.request('/gamification/checkin/', { method: 'POST', body: JSON.stringify({}) }),
  debug: () => api.request('/gamification/debug/'),
  sendCoinGift: (recipientUsername, amount, message) =>
    api.request('/gamification/gift/', { method: 'POST', body: JSON.stringify({ recipient_username: recipientUsername, amount, message }) }),
  giftHistory: () => api.request('/gamification/gifts/history/'),
  claimLoginBonus: () => api.request('/gamification/login-bonus/', { method: 'POST', body: JSON.stringify({}) }),
  status: () => api.request('/gamification/status/'),
};

export const questsApi = {
  list: () => api.request('/quests/'),
  create: (data) => api.request('/quests/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/quests/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/quests/${pk}/`),
  update: (pk, data) => api.request(`/quests/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/quests/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  complete: (pk) => api.request(`/quests/${pk}/complete/`, { method: 'POST', body: JSON.stringify({}) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Gifts
// ─────────────────────────────────────────────────────────────────────────
export const giftStatsApi = {
  list: () => api.request('/gift-stats/'),
  detail: (pk) => api.request(`/gift-stats/${pk}/`),
  myStats: () => api.request('/gift-stats/my_stats/'),
};

export const giftTransactionsApi = {
  list: () => api.request('/gift-transactions/'),
  create: (data) => api.request('/gift-transactions/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/gift-transactions/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/gift-transactions/${pk}/`),
  update: (pk, data) => api.request(`/gift-transactions/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/gift-transactions/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  leaderboard: () => api.request('/gift-transactions/leaderboard/'),
  myReceived: () => api.request('/gift-transactions/my_received/'),
  mySent: () => api.request('/gift-transactions/my_sent/'),
};

export const giftsFullApi = {
  list: () => api.request('/gifts/'),
  detail: (pk) => api.request(`/gifts/${pk}/`),
  send: (data) => api.request('/gifts/send/', { method: 'POST', body: JSON.stringify(data) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────
export const healthApi = {
  check: () => api.request('/health/'),
  deepCheck: () => api.request('/health/deep/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Legal (public)
// ─────────────────────────────────────────────────────────────────────────
export const legalApi = {
  all: () => api.request('/legal/'),
  document: (documentType) => api.request(`/legal/${documentType}/`),
  accept: (documentType, version) =>
    api.request(`/legal/${documentType}/accept/`, { method: 'POST', body: JSON.stringify({ version }) }),
  userHistory: () => api.request('/legal/user/history/'),
  userPending: () => api.request('/legal/user/pending/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Messaging (Direct Messages)
// ─────────────────────────────────────────────────────────────────────────
export const messagingApi = {
  deleteMessage: (messageId) => api.request(`/messages/${messageId}/`, { method: 'DELETE' }),
  editMessage: (messageId, text) => api.request(`/messages/${messageId}/`, { method: 'PATCH', body: JSON.stringify({ text }) }),
  conversations: () => api.request('/messages/conversations/'),
  startConversation: (userId) =>
    api.request('/messages/conversations/', { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  conversationMessages: (conversationId) => api.request(`/messages/conversations/${conversationId}/messages/`),
  sendMessage: (conversationId, text) =>
    api.request(`/messages/conversations/${conversationId}/messages/`, { method: 'POST', body: JSON.stringify({ text }) }),
  markConversationRead: (conversationId) =>
    api.request(`/messages/conversations/${conversationId}/read/`, { method: 'POST', body: JSON.stringify({}) }),
  unreadCount: () => api.request('/messages/unread-count/'),
  searchUsers: () => api.request('/messages/users/search/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Moderation (public report creation)
// ─────────────────────────────────────────────────────────────────────────
export const moderationApi = {
  createReport: (data) => api.request('/reports/create/', { method: 'POST', body: JSON.stringify(data) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Notifications & Push
// ─────────────────────────────────────────────────────────────────────────
export const notificationsFullApi = {
  list: () => api.request('/notifications/'),
  create: (data) => api.request('/notifications/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/notifications/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/notifications/${pk}/`),
  update: (pk, data) => api.request(`/notifications/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/notifications/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  markRead: (notificationId) => api.request(`/notifications/${notificationId}/read/`, { method: 'POST', body: JSON.stringify({}) }),
  getSettings: () => api.request('/notifications/me/'),
  updateSettings: (data) => api.request('/notifications/me/', { method: 'PATCH', body: JSON.stringify(data) }),
  replaceSettings: (data) => api.request('/notifications/me/', { method: 'PUT', body: JSON.stringify(data) }),
  patchSettingsUpdate: (settings) => api.request('/notifications/me/update/', { method: 'PATCH', body: JSON.stringify(settings) }),
  putSettingsUpdate: (settings) => api.request('/notifications/me/update/', { method: 'PUT', body: JSON.stringify(settings) }),
  markAllRead: () => api.request('/notifications/read/', { method: 'POST', body: JSON.stringify({}) }),
  unreadCount: () => api.request('/notifications/unread-count/'),
};

export const pushApi = {
  publicKey: () => api.request('/push/public-key/'),
  subscribe: (subscription) => api.request('/push/subscribe/', { method: 'POST', body: JSON.stringify(subscription) }),
  unsubscribe: (endpoint) => api.request('/push/unsubscribe/', { method: 'POST', body: JSON.stringify({ endpoint }) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Payments / Direct Debit
// ─────────────────────────────────────────────────────────────────────────
export const directDebitApi = {
  activate: (mandateId) => api.request('/direct-debit/activate/', { method: 'POST', body: JSON.stringify({ mandate_id: mandateId }) }),
  cancel: (mandateId) => api.request('/direct-debit/cancel/', { method: 'POST', body: JSON.stringify({ mandate_id: mandateId }) }),
  create: (tierId, payerMsisdn, frequency = '05') =>
    api.request('/direct-debit/create/', { method: 'POST', body: JSON.stringify({ tier_id: tierId, payer_msisdn: payerMsisdn, frequency }) }),
  initiate: (mandateId, amount) =>
    api.request('/direct-debit/initiate/', { method: 'POST', body: JSON.stringify({ mandate_id: mandateId, amount }) }),
  mandates: () => api.request('/direct-debit/mandates/'),
  oneOffCoinPurchase: (payerMsisdn, amount, coinAmount) =>
    api.request('/direct-debit/one-off-coin-purchase/', {
      method: 'POST',
      body: JSON.stringify({ payer_msisdn: payerMsisdn, amount, coin_amount: coinAmount }),
    }),
};

// ─────────────────────────────────────────────────────────────────────────
// Payments / Onevas Charging (on-demand)
// ─────────────────────────────────────────────────────────────────────────
export const chargingApi = {
  coinPurchaseOnDemand: (phoneNumber, coinAmount) =>
    api.request('/charging/coin-purchase/', { method: 'POST', body: JSON.stringify({ phone_number: phoneNumber, coin_amount: coinAmount }) }),
  onDemand: (tierId, phoneNumber) =>
    api.request('/charging/on-demand/', { method: 'POST', body: JSON.stringify({ tier_id: tierId, phone_number: phoneNumber }) }),
  onDemandAnalytics: () => api.request('/charging/on-demand/analytics/'),
  onDemandSearch: () => api.request('/charging/on-demand/search/'),
  onDemandStatistics: () => api.request('/charging/on-demand/statistics/'),
  onDemandTransactions: () => api.request('/charging/on-demand/transactions/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Profile & Social (Blocks, Follows, Profile, Search)
// ─────────────────────────────────────────────────────────────────────────
export const blocksApi = {
  list: () => api.request('/blocks/'),
  create: (data) => api.request('/blocks/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/blocks/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/blocks/${pk}/`),
  update: (pk, data) => api.request(`/blocks/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/blocks/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  block: (blockedId) => api.request('/blocks/block/', { method: 'POST', body: JSON.stringify({ blocked_id: blockedId }) }),
  unblock: () => api.request('/blocks/unblock/'),
};

export const followsFullApi = {
  list: () => api.request('/follows/'),
  create: (data) => api.request('/follows/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/follows/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/follows/${pk}/`),
  update: (pk, data) => api.request(`/follows/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/follows/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  suggestions: () => api.request('/follows/suggestions/'),
  toggle: (followingId) => api.request('/follows/toggle/', { method: 'POST', body: JSON.stringify({ following_id: followingId }) }),
};

export const profileFullApi = {
  uploadPhoto: (formData) => api.request('/profile-photo/upload/', { method: 'POST', body: formData, isFormData: true }),
  list: () => api.request('/profile/'),
  create: (data) => api.request('/profile/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/profile/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/profile/${pk}/`),
  update: (pk, data) => api.request(`/profile/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/profile/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  addXp: (data = {}) => api.request('/profile/add_xp/', { method: 'POST', body: JSON.stringify(data) }),
  dailyCheckin: () => api.request('/profile/daily_checkin/', { method: 'POST', body: JSON.stringify({}) }),
  me: () => api.request('/profile/me/'),
  getPrivacy: () => api.request('/profile/privacy/'),
  updatePrivacyPatch: (settings) => api.request('/profile/privacy/update/', { method: 'PATCH', body: JSON.stringify(settings) }),
  updatePrivacyPut: (settings) => api.request('/profile/privacy/update/', { method: 'PUT', body: JSON.stringify(settings) }),
  updatePrivacyLegacy: (data = {}) => api.request('/profile/update_privacy/', { method: 'POST', body: JSON.stringify(data) }),
  updateProfileLegacy: (data = {}) => api.request('/profile/update_profile/', { method: 'PATCH', body: JSON.stringify(data) }),
};

export const searchApi = {
  search: (query) => api.request(`/search/?q=${encodeURIComponent(query || '')}`),
  userSearch: (query) => api.request(`/user-search/search/?q=${encodeURIComponent(query || '')}`),
};

// ─────────────────────────────────────────────────────────────────────────
// Reels & Feed (Explorer, Posts, Reels, Saved)
// ─────────────────────────────────────────────────────────────────────────
export const explorerApi = {
  hashtag: (tag) => api.request(`/explorer/hashtag/?tag=${encodeURIComponent(tag || '')}`),
  trendingHashtags: () => api.request('/explorer/trending-hashtags/'),
  trending: () => api.request('/explorer/trending/'),
};

export const postsApi = {
  create: (data) => api.request('/posts/create/', { method: 'POST', body: JSON.stringify(data) }),
};

export const reelsFullApi = {
  list: () => api.request('/reels/'),
  create: (data) => api.request('/reels/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/reels/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/reels/${pk}/`),
  update: (pk, data) => api.request(`/reels/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/reels/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  comments: (pk) => api.request(`/reels/${pk}/comments/`),
  addComment: (pk, data) => api.request(`/reels/${pk}/comments/`, { method: 'POST', body: JSON.stringify(data) }),
  save: (pk) => api.request(`/reels/${pk}/save/`, { method: 'POST', body: JSON.stringify({}) }),
  share: (pk) => api.request(`/reels/${pk}/share/`, { method: 'POST', body: JSON.stringify({}) }),
  vote: (pk) => api.request(`/reels/${pk}/vote/`, { method: 'POST', body: JSON.stringify({}) }),
  trackView: (reelId) => api.request(`/reels/${reelId}/view/`, { method: 'POST', body: JSON.stringify({}) }),
  following: () => api.request('/reels/following/'),
  markNotInterested: (reelId) => api.request('/reels/not-interested/', { method: 'POST', body: JSON.stringify({ reel_id: reelId }) }),
  undoNotInterested: (reelId) => api.request('/reels/not-interested/undo/', { method: 'POST', body: JSON.stringify({ reel_id: reelId }) }),
  saved: () => api.request('/reels/saved/'),
  trending: () => api.request('/reels/trending/'),
};

export const savedApi = {
  list: () => api.request('/saved/'),
  create: (data) => api.request('/saved/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/saved/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/saved/${pk}/`),
  update: (pk, data) => api.request(`/saved/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/saved/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  toggle: (reelId) => api.request('/saved/toggle/', { method: 'POST', body: JSON.stringify({ reel_id: reelId }) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Reference Data
// ─────────────────────────────────────────────────────────────────────────
export const referenceDataApi = {
  apiRoot: () => api.request('/'),
  categories: () => api.request('/categories/'),
  cryptoPublicKey: () => api.request('/crypto/public-key/'),
  publicSettings: () => api.request('/settings/public/'),
};

// ─────────────────────────────────────────────────────────────────────────
// Subscriptions (singular `subscription/` + plural `subscriptions/`)
// ─────────────────────────────────────────────────────────────────────────
export const subscriptionFullApi = {
  list: () => api.request('/subscription/'),
  create: (data) => api.request('/subscription/', { method: 'POST', body: JSON.stringify(data) }),
  delete: (pk) => api.request(`/subscription/${pk}/`, { method: 'DELETE' }),
  detail: (pk) => api.request(`/subscription/${pk}/`),
  update: (pk, data) => api.request(`/subscription/${pk}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  replace: (pk, data) => api.request(`/subscription/${pk}/`, { method: 'PUT', body: JSON.stringify(data) }),
  details: () => api.request('/subscription/details/'),
  status: () => api.request('/subscription/status/'),
  upgrade: (tier, paymentMethod = 'telebirr') =>
    api.request('/subscription/upgrade/', { method: 'POST', body: JSON.stringify({ tier, payment_method: paymentMethod }) }),
};

export const subscriptionsFullApi = {
  list: () => api.request('/subscriptions/'),
  create: (data) => api.request('/subscriptions/', { method: 'POST', body: JSON.stringify(data) }),
  history: () => api.request('/subscriptions/history/'),
  subscribe: (data) => api.request('/subscriptions/subscribe/', { method: 'POST', body: JSON.stringify(data) }),
  tiers: () => api.request('/subscriptions/tiers/'),
  tiersActive: () => api.request('/subscriptions/tiers/active/'),
  unsubscribe: () => api.request('/subscriptions/unsubscribe/', { method: 'POST', body: JSON.stringify({}) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Support
// ─────────────────────────────────────────────────────────────────────────
export const supportApi = {
  requests: () => api.request('/support/requests/'),
  createRequest: (category, subject, message) =>
    api.request('/support/requests/', { method: 'POST', body: JSON.stringify({ category, subject, message }) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Wallet
// ─────────────────────────────────────────────────────────────────────────
export const walletFullApi = {
  summary: () => api.request('/wallet/'),
  config: () => api.request('/wallet/config/'),
  reinvest: (points) => api.request('/wallet/reinvest/', { method: 'POST', body: JSON.stringify({ points }) }),
  telebirrCallback: (data) => api.request('/wallet/telebirr-callback/', { method: 'POST', body: JSON.stringify(data) }),
  telebirrInitiate: (packageId, phoneNumber) =>
    api.request('/wallet/telebirr/initiate/', { method: 'POST', body: JSON.stringify({ package_id: packageId, phone_number: phoneNumber }) }),
  transactions: () => api.request('/wallet/transactions/'),
  withdraw: (data) => api.request('/wallet/withdraw/', { method: 'POST', body: JSON.stringify(data) }),
  withdrawalInfo: () => api.request('/wallet/withdrawal-info/'),
  myWithdrawals: () => api.request('/wallet/withdrawals/'),
  cancelWithdrawal: (withdrawalId) =>
    api.request(`/wallet/withdrawals/${withdrawalId}/cancel/`, { method: 'POST', body: JSON.stringify({}) }),
};

// ─────────────────────────────────────────────────────────────────────────
// Webhooks (Onevas & Telebirr) — server-to-server callbacks, exposed for
// completeness / QA testing from the app if ever needed.
// ─────────────────────────────────────────────────────────────────────────
export const webhooksApi = {
  onevasRenewal: (phoneNumber, productNumber) =>
    api.request('/onevas/renewal/', { method: 'POST', body: JSON.stringify({ phone_number: phoneNumber, product_number: productNumber }) }),
  onevasStop: (phoneNumber, productNumber, params = []) =>
    api.request('/onevas/stop/', { method: 'POST', body: JSON.stringify({ phone_number: phoneNumber, product_number: productNumber, params }) }),
  onevasSubscription: (phoneNumber, productNumber, password) =>
    api.request('/onevas/subscription/', { method: 'POST', body: JSON.stringify({ phone_number: phoneNumber, product_number: productNumber, password }) }),
  onevasUnsubscription: (phoneNumber, productNumber) =>
    api.request('/onevas/unsubscription/', { method: 'POST', body: JSON.stringify({ phone_number: phoneNumber, product_number: productNumber }) }),
  telebirrDirectDebit: (data = {}) =>
    api.request('/webhooks/telebirr-direct-debit/', { method: 'POST', body: JSON.stringify(data) }),
};

// Consolidated namespace export mirroring every Postman collection folder,
// for callers that prefer a single import.
const apiFull = {
  adminCampaigns: adminCampaignsApi,
  adminContest: adminContestApi,
  adminCore: adminCoreApi,
  adminGifts: adminGiftsApi,
  adminLegal: adminLegalApi,
  adminMasterCampaigns: adminMasterCampaignsApi,
  adminModeration: adminModerationApi,
  adminPlatform: adminPlatformApi,
  adminSubscriptions: adminSubscriptionsApi,
  adminSupport: adminSupportApi,
  adminWallet: adminWalletApi,
  authFull: authFullApi,
  boost: boostApi,
  campaignsFull: campaignsFullApi,
  competitions: competitionsApi,
  winners: winnersApi,
  coins: coinsApi,
  eligibility: eligibilityApi,
  grandFinale: grandFinaleApi,
  scores: scoresApi,
  upload: uploadApi,
  commentReplies: commentRepliesApi,
  commentsFull: commentsFullApi,
  dangerZone: dangerZoneApi,
  gamificationFull: gamificationFullApi,
  quests: questsApi,
  giftStats: giftStatsApi,
  giftTransactions: giftTransactionsApi,
  giftsFull: giftsFullApi,
  health: healthApi,
  legal: legalApi,
  messaging: messagingApi,
  moderation: moderationApi,
  notificationsFull: notificationsFullApi,
  push: pushApi,
  directDebit: directDebitApi,
  charging: chargingApi,
  blocks: blocksApi,
  followsFull: followsFullApi,
  profileFull: profileFullApi,
  search: searchApi,
  explorer: explorerApi,
  posts: postsApi,
  reelsFull: reelsFullApi,
  saved: savedApi,
  referenceData: referenceDataApi,
  subscriptionFull: subscriptionFullApi,
  subscriptionsFull: subscriptionsFullApi,
  support: supportApi,
  walletFull: walletFullApi,
  webhooks: webhooksApi,
};

export default apiFull;
