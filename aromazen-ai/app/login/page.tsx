import { LoginForm } from '@/components/auth/login-form'
import { BrandMark } from '@/components/brand-mark'
import { BookOpenCheck, LockKeyhole, Sparkles } from 'lucide-react'

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-6 sm:px-6 lg:p-8">
      <div className="pointer-events-none absolute -right-52 -top-52 h-[540px] w-[540px] rounded-full bg-white/[0.035] blur-3xl" />
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_40px_100px_rgba(0,0,0,.35)] lg:grid-cols-[1.08fr_.92fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-[#101111] p-12 lg:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,.06),transparent_30%),linear-gradient(145deg,transparent_55%,rgba(255,255,255,.025))]" />
          <div className="relative flex items-center gap-3"><BrandMark size="md" /><div><p className="text-sm font-semibold tracking-[0.12em]">AROMAZEN</p><p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">AI workspace</p></div></div>
          <div className="relative max-w-xl">
            <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">A portal to smarter business</p>
            <h1 className="text-5xl font-medium leading-[1.05] tracking-[-0.055em]">Intelligence, shaped around how Aromazen works.</h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">One private place to explore company knowledge, create polished work, and move every team forward.</p>
          </div>
          <div className="relative grid grid-cols-3 gap-3">
            {[[LockKeyhole, 'Private by design'], [BookOpenCheck, 'Company knowledge'], [Sparkles, 'Built for every team']].map(([Icon, label]) => { const Mark = Icon as typeof LockKeyhole; return <div key={String(label)} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><Mark className="mb-3 h-4 w-4 text-muted-foreground" /><p className="text-xs text-foreground/80">{String(label)}</p></div> })}
          </div>
        </section>
        <section className="flex items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-[430px]">
            <div className="mb-9 lg:hidden"><BrandMark size="lg" /></div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Welcome back</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">Sign in to Aromazen AI</h2>
            <p className="mb-8 mt-3 text-sm leading-6 text-muted-foreground">Continue to your secure company workspace.</p>
            <LoginForm />
          </div>
        </section>
      </div>
    </div>
  )
}
