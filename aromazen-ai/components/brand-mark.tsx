import Image from 'next/image'

interface BrandMarkProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function BrandMark({ className = '', size = 'md' }: BrandMarkProps) {
  const sizes = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-14 w-14' }
  return (
    <span className={`brand-mark ${sizes[size]} ${className}`} aria-label="Aromazen">
      <Image src="/AROMAZEN_AI_LOGO.png" alt="" width={1920} height={819} priority className="brand-mark-image" />
    </span>
  )
}
