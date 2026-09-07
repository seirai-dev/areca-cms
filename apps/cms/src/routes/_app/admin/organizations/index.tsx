import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'

import {
  adminQueryKeys,
  errorMessage,
  suggestSlug,
} from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { EmptyState } from '#/components/empty-state'
import { FormField } from '#/components/form-field'
import { PageHeader } from '#/components/page-header'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { createOrganizationFn, listOrganizationsFn } from '#/server/fn/admin'

export const Route = createFileRoute('/_app/admin/organizations/')({
  component: OrganizationsPage,
})

function OrganizationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const listOrganizations = useServerFn(listOrganizationsFn)
  const createOrganization = useServerFn(createOrganizationFn)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  const orgsQuery = useQuery({
    queryKey: adminQueryKeys.organizations,
    queryFn: () => listOrganizations(),
  })

  const createMutation = useMutation({
    mutationFn: () => createOrganization({ data: { name, slug } }),
    onSuccess: async (org) => {
      toast.success('Organization created')
      setOpen(false)
      setName('')
      setSlug('')
      setSlugTouched(false)
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.organizations,
      })
      await navigate({
        to: '/admin/organizations/$orgId',
        params: { orgId: org.id },
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  function onNameChange(value: string) {
    setName(value)
    if (!slugTouched) {
      setSlug(suggestSlug(value))
    }
  }

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="grid gap-6">
        <PageHeader
          title="Organizations"
          description="Agency customers and their sites."
          actions={
            <DialogTrigger asChild>
              <Button type="button" data-testid="new-organization">
                New organization
              </Button>
            </DialogTrigger>
          }
        />
        {orgsQuery.isLoading ? (
          <TableSkeleton />
        ) : orgsQuery.data?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Sites</TableHead>
                <TableHead>Members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgsQuery.data.map((org) => (
                <TableRow key={org.id}>
                  <TableCell>
                    <Link
                      to="/admin/organizations/$orgId"
                      params={{ orgId: org.id }}
                      className="font-medium hover:underline"
                    >
                      {org.name}
                    </Link>
                  </TableCell>
                  <TableCell>{org.slug}</TableCell>
                  <TableCell>{org.siteCount}</TableCell>
                  <TableCell>{org.memberCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No organizations"
            description="Create an organization to add sites and members."
            action={
              <DialogTrigger asChild>
                <Button type="button">New organization</Button>
              </DialogTrigger>
            }
          />
        )}

        <DialogContent>
          <form className="grid gap-4" onSubmit={onCreate}>
            <DialogHeader>
              <DialogTitle>New organization</DialogTitle>
              <DialogDescription>
                Slug is suggested from the name and must be unique.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Name" htmlFor="org-name">
              <Input
                id="org-name"
                data-testid="org-name"
                required
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
              />
            </FormField>
            <FormField label="Slug" htmlFor="org-slug">
              <Input
                id="org-slug"
                data-testid="org-slug"
                required
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(event.target.value)
                }}
              />
            </FormField>
            <DialogFooter>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create organization'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </div>
    </Dialog>
  )
}
