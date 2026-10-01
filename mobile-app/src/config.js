const getApiConfig = () => {
  const envBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  const defaultBaseUrl = 'https://api.uat.flipstar.et/api/v1';
  const primaryBaseUrl = envBaseUrl || defaultBaseUrl;

  const apiBaseUrls = [
    primaryBaseUrl,
    'https://api.uat.flipstar.et/api/v1',
    'https://api.uat.flipstar.et/api',
    'https://flipstar.et/api',
    'https://flipstar.et/api/v1',
  ].filter((url, index, list) => Boolean(url) && list.indexOf(url) === index);

  return {
    // You can override this in Expo with EXPO_PUBLIC_API_BASE_URL
    API_BASE_URL: primaryBaseUrl,
    API_BASE_URL_CANDIDATES: apiBaseUrls,
    ENVIRONMENT: 'development',
  };
};

const config = getApiConfig();

export default config;
