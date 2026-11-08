import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center space-y-4 text-center">
      <h2 className="text-4xl font-bold tracking-tight text-foreground">404</h2>
      <p className="text-lg text-muted-foreground max-w-125">
        The page you are looking for does not exist or has been moved.
      </p>
      <div className="pt-4">
        <Link href="/">
          <Button>Return to Dashboard</Button>
        </Link>
      </div>
    </div>
  )
}
