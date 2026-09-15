import { useState } from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'

import { RichTextEditor } from '../rich-text-editor'
import { RichTextPreview } from '../rich-text-preview'

export function RichtextFieldInput({
  value,
  onChange,
  organizationId,
}: {
  value: unknown
  onChange: (value: unknown) => void
  organizationId: string
}) {
  const [mode, setMode] = useState('edit')

  return (
    <Tabs value={mode} onValueChange={setMode} className="gap-2">
      <TabsList variant="line" className="h-8">
        <TabsTrigger value="edit">Edit</TabsTrigger>
        <TabsTrigger value="preview" data-testid="rich-text-preview-tab">
          Preview
        </TabsTrigger>
      </TabsList>
      <TabsContent value="edit" forceMount className="data-[state=inactive]:hidden">
        <RichTextEditor
          value={value}
          onChange={onChange}
          organizationId={organizationId}
        />
      </TabsContent>
      <TabsContent value="preview" className="rounded-md border bg-card">
        <RichTextPreview value={value} />
      </TabsContent>
    </Tabs>
  )
}
