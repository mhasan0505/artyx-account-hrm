'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { updateChartOfAccountName } from '@/lib/actions/master-setup'
import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import * as z from 'zod'

const schema = z.object({
  name: z.string().min(1, 'Account name is required'),
})

type FormValues = z.infer<typeof schema>

interface EditChartOfAccountDialogProps {
  account: {
    id: string
    code: string
    name: string
  }
}

export function EditChartOfAccountDialog({
  account,
}: EditChartOfAccountDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const form = useForm<FormValues>({
    resolver: (zodResolver as any)(schema) as Resolver<FormValues>,
    defaultValues: { name: account.name },
  })

  useEffect(() => {
    if (open) {
      form.reset({ name: account.name })
    }
  }, [open, account.name, form])

  async function onSubmit(values: FormValues) {
    const result = await updateChartOfAccountName(account.id, values.name)
    if (!result.success) {
      toast.error(result.error)
      return
    }

    toast.success(`Account renamed to "${result.data.name}"`)
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-foreground hover:bg-muted/60"
        >
          <Pencil className="mr-1 h-3 w-3" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Account Name ({account.code})</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 pt-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter account name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
