/** Date helpers shared by the list and the reader. */

function parse(iso) {
  const date = new Date(String(iso || ''))
  return Number.isNaN(date.getTime()) ? null : date
}

const pad = (value) => String(value).padStart(2, '0')

export function formatRowTime(iso) {
  const date = parse(iso)
  if (!date) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  if (date.getFullYear() === now.getFullYear()) return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatFullTime(iso) {
  const date = parse(iso)
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

export function formatSize(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function displayName(person) {
  if (!person) return ''
  return person.name || person.email || ''
}

export function initials(email) {
  const value = String(email || '').trim()
  if (!value) return 'A'
  return value.slice(0, 2).toUpperCase()
}
