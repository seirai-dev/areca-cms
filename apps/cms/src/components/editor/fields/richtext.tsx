import { useState } from 'react'

import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { m } from '#/paraglide/messages'

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
    <RichTextEditor
      value={value}
      onChange={onChange}
      organizationId={organizationId}
      previewing={mode === 'preview'}
      preview={
        <div className="py-4">
          <RichTextPreview value={value} />
        </div>
      }
      toolbarEnd={
        <Tabs value={mode} onValueChange={setMode}>
          <TabsList variant="segmented" className="h-7">
            <TabsTrigger value="edit" className="px-2.5 text-xs">
              {m.editor_edit()}
            </TabsTrigger>
            <TabsTrigger
              value="preview"
              data-testid="rich-text-preview-tab"
              className="px-2.5 text-xs"
            >
              {m.editor_preview()}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
    />
  )
}
