'use client'

// iOS only permits a new window opened directly from the user's tap. Keep that
// window while the authenticated template request is in flight.
export function beginBlobPreview(title = 'Preparing preview…'): Window | null {
  const preview = window.open('', '_blank')
  if (!preview) return null
  preview.opener = null
  preview.document.title = title
  preview.document.body.innerHTML = '<p style="font:16px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px">Preparing preview…</p>'
  return preview
}

export function showBlobPreview(preview: Window | null, blob: Blob, filename = 'document') {
  const url = URL.createObjectURL(blob)
  if (preview && !preview.closed) preview.location.replace(url)
  else {
    const link = document.createElement('a')
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.download = filename
    link.click()
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
