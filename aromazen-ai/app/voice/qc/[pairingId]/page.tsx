import type { Metadata } from 'next'
import { QaMobileVoice } from '@/components/qa-mobile-voice'

export const metadata: Metadata = {
  title: 'QA/QC Phone Microphone | Aromazen AI',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function QaMobileVoicePage() {
  return <QaMobileVoice />
}
