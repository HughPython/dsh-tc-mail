/**
 * Everything the panel needs from the Host half. Relative paths keep working
 * when the Harness is served under a sub-path.
 */

const BASE = '/api/dsh-tc-mail'

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message || code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch (error) {
    if (error && error.name === 'AbortError') throw error
    throw new ApiError('network_error', `无法连接插件后端：${(error && error.message) || error}`)
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('bad_response', `后端返回了非 JSON 响应（HTTP ${response.status}）`, response.status)
  }

  if (!response.ok || !payload || payload.ok === false) {
    throw new ApiError((payload && payload.code) || 'http_error', (payload && payload.message) || `HTTP ${response.status}`, response.status)
  }
  return payload.data
}

export const api = {
  health: (force) => request(`/health${force ? '?force=1' : ''}`),
  getSettings: () => request('/settings'),
  saveSettings: (patch) => request('/settings', { method: 'PUT', body: patch }),
  resetSettings: () => request('/settings/reset', { method: 'POST' }),
  list: ({ dir, limit, cursor }) => {
    const params = new URLSearchParams({ dir, limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    return request(`/messages?${params}`)
  },
  read: (id) => request(`/messages/${encodeURIComponent(id)}`),
  search: ({ q, dir, limit, cursor }) => {
    const params = new URLSearchParams({ q, dir, limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    return request(`/search?${params}`)
  },
  send: (payload) => request('/send', { method: 'POST', body: payload }),
  reply: (payload) => request('/reply', { method: 'POST', body: payload }),
  forward: (payload) => request('/forward', { method: 'POST', body: payload }),
  trash: (ids) => request('/trash', { method: 'POST', body: { ids } }),
  remove: (payload) => request('/delete', { method: 'POST', body: payload }),
  upload: (name, dataUrl) => request('/upload', { method: 'POST', body: { name, data: dataUrl } }),
  downloadAttachment: ({ messageId, attachmentId, filename }) => {
    const params = new URLSearchParams({ msg: messageId, att: attachmentId, name: filename || '' })
    return request(`/attachment?${params}`)
  },
  loginStart: () => request('/auth/login', { method: 'POST' }),
  loginStatus: () => request('/auth/login'),
  installCli: () => request('/setup/install', { method: 'POST' }),
  installStatus: () => request('/setup/install'),
}
