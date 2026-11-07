
import axios from "axios";

const configuredApiUrl = import.meta.env.VITE_API_BASE_URL?.trim();

const apiOrigin = (
  configuredApiUrl || "http://localhost:5000"
).replace(/\/+$/, "");

const api = axios.create({
  baseURL: `${apiOrigin}/api`,
  headers: {
    "Content-Type": "application/json",
  },
});

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export default api;
