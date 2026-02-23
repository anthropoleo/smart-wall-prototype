/**
 * Shared HTTP helper for backend API calls.
 */
export async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    if (typeof detail === "string") {
      throw new Error(detail);
    }
    if (detail && typeof detail === "object") {
      const parts = [];
      if (detail.type) parts.push(detail.type);
      if (detail.message) parts.push(detail.message);
      if (detail.hint) parts.push(`Hint: ${detail.hint}`);
      throw new Error(parts.filter(Boolean).join(" - ") || `HTTP ${response.status}`);
    }
    throw new Error(`HTTP ${response.status}`);
  }

  return data;
}
