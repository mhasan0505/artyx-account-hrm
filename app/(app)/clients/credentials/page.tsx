import { getAllClientCredentials } from '@/lib/actions/agency-clients'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, KeyRound, Shield, Search } from 'lucide-react'
import { CredentialCategory } from '@prisma/client'

export default async function CredentialsVaultPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const resolvedParams = await searchParams
  const credentials = await getAllClientCredentials(
    resolvedParams.category as CredentialCategory | undefined
  )

  const categories = [
    { label: 'All Categories', value: '' },
    { label: 'Domain Registrars', value: 'DOMAIN' },
    { label: 'Hosting & cPanel', value: 'HOSTING' },
    { label: 'CMS Admin (WP/Shopify)', value: 'CMS_ADMIN' },
    { label: 'Databases', value: 'DATABASE' },
    { label: 'Social Media', value: 'SOCIAL_MEDIA' },
    { label: 'API Keys & Secrets', value: 'API_KEY' },
  ]

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Link href="/clients">
            <Button size="icon" variant="outline" className="border-border text-foreground hover:bg-muted">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Agency Credentials Vault
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Secure client access tokens, cPanels, domains, CMS passwords, and social logins
            </p>
          </div>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {categories.map(cat => {
          const isActive = (resolvedParams.category || '') === cat.value
          return (
            <Link key={cat.value} href={cat.value ? `/clients/credentials?category=${cat.value}` : '/clients/credentials'}>
              <Button
                size="sm"
                variant={isActive ? 'default' : 'outline'}
                className={
                  isActive
                    ? 'bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs'
                    : 'border-border text-foreground hover:bg-muted'
                }
              >
                {cat.label}
              </Button>
            </Link>
          )
        })}
      </div>

      {/* Grid of Credentials */}
      {credentials.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-3">
            <Shield className="size-12 text-muted-foreground mx-auto opacity-60" />
            <h3 className="text-lg font-semibold text-foreground">No credentials found</h3>
            <p className="text-sm text-muted-foreground">
              Store credentials directly within any client profile.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {credentials.map(cred => (
            <Card key={cred.id} className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs flex flex-col justify-between">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-muted text-[#3E7000] dark:text-[#7FFF00] border border-border">
                      {cred.client.companyName}
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-1.5">{cred.title}</h3>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase font-mono border-border text-muted-foreground">
                    {cred.category}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {cred.loginUrl && (
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase font-mono font-medium">Login URL:</span>
                    <a
                      href={cred.loginUrl.startsWith('http') ? cred.loginUrl : `https://${cred.loginUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[#3E7000] dark:text-[#7FFF00] hover:underline font-mono truncate"
                    >
                      <span className="truncate">{cred.loginUrl}</span>
                      <ExternalLink className="size-3 shrink-0" />
                    </a>
                  </div>
                )}
                {cred.username && (
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase font-mono font-medium">Username / Email:</span>
                    <p className="font-mono bg-muted px-2.5 py-1 rounded border border-border text-foreground select-all">
                      {cred.username}
                    </p>
                  </div>
                )}
                {cred.password && (
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase font-mono font-medium">Password / Secret:</span>
                    <p className="font-mono bg-muted px-2.5 py-1 rounded border border-border text-amber-600 dark:text-amber-300 font-semibold select-all tracking-wider">
                      {cred.password}
                    </p>
                  </div>
                )}
                {cred.apiKey && (
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase font-mono font-medium">API Key / Token:</span>
                    <p className="font-mono bg-muted px-2.5 py-1 rounded border border-border text-sky-600 dark:text-sky-300 text-[11px] truncate select-all">
                      {cred.apiKey}
                    </p>
                  </div>
                )}
                {cred.notes && (
                  <p className="text-muted-foreground pt-1 text-[11px] border-t border-border">
                    {cred.notes}
                  </p>
                )}
                <div className="pt-2 flex justify-end">
                  <Link href={`/clients/${cred.clientId}`}>
                    <Button size="sm" variant="ghost" className="text-[11px] text-muted-foreground hover:text-foreground">
                      View Client Profile →
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
