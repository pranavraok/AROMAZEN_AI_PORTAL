import { LoginForm } from '@/components/auth/login-form'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/20 mb-4"><span className="text-xl font-bold text-primary">AZ</span></div>
          <h1 className="text-3xl font-bold text-foreground mb-2">AROMAZEN AI</h1>
          <p className="text-muted-foreground text-sm">Enterprise AI Platform</p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
