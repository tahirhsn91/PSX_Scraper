import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:4000/api/v1';

export const api = axios.create({ baseURL, timeout: 20000 });

api.interceptors.request.use((config) => {
  config.headers['x-request-id'] = crypto.randomUUID();
  return config;
});

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const apiError: ApiError = err.response?.data?.error ?? {
      code: 'NETWORK_ERROR',
      message: err.message ?? 'Network error',
    };
    return Promise.reject(apiError);
  },
);
