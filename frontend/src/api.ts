export interface DeviceRecord {
  retail_branding: string;
  marketing_name: string;
  device: string;
  model: string;
}

export interface DeviceLookupResponse {
  total_matches: number;
  limit: number;
  page: number;
  total_pages: number;
  results: DeviceRecord[];
}

export const DEFAULT_LIMIT = 25;

const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "") as string;
const apiBaseUrl = rawBaseUrl ? rawBaseUrl.replace(/\/$/, "") : "/api";

function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "") {
      return;
    }
    search.set(key, String(value));
  });
  return search.toString();
}

export async function lookupDevices(params: {
  brand?: string;
  marketing_name?: string;
  device?: string;
  model?: string;
  limit?: number;
  page?: number;
}) {
  const query = buildQuery({ limit: DEFAULT_LIMIT, page: 1, ...params });
  const url = `${apiBaseUrl}/check?${query}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  const data: DeviceLookupResponse = await response.json();
  return data;
}
