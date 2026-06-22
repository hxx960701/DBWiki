import axios from 'axios';

const client = axios.create({
  baseURL: '/api',
  timeout: 300000,  // 5 minutes — sync on large schemas can take a while
});

// Request interceptor: attach JWT
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('dbwiki_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const requestUrl = error.config?.url || '';
      const isAuthRequest = requestUrl.includes('/auth/login');
      const isOnLoginPage = window.location.pathname === '/login';

      if (!isAuthRequest && !isOnLoginPage) {
        localStorage.removeItem('dbwiki_token');
        window.location.href = '/login';
      } else if (isOnLoginPage) {
        localStorage.removeItem('dbwiki_token');
      }
    }
    return Promise.reject(error);
  }
);

export default client;
