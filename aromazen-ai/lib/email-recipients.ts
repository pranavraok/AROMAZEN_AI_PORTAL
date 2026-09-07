export function parseEmailList(value: string): string[] {
  const seen = new Set<string>()

  return value
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter((email) => {
      const key = email.toLowerCase()
      if (!email || seen.has(key)) return false
      seen.add(key)
      return true
    })
}
