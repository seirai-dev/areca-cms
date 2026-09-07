import { useCallback, useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Heading4,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Undo2,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { richTextExtensions } from '#/server/richtext/extensions'

import { MediaPickerDialog, type MediaAsset } from './media-picker'
import { assetFileUrl, emptyRichText } from './utils'

function ToolbarButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void
  active?: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant={active ? 'secondary' : 'ghost'}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

export function RichTextEditor({
  value,
  onChange,
  organizationId,
}: {
  value: unknown
  onChange: (value: unknown) => void
  organizationId: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const editor = useEditor({
    extensions: richTextExtensions,
    content: (value as object | null) ?? emptyRichText(),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm min-h-40 max-w-none px-3 py-2 focus:outline-none [&_img]:h-auto [&_img]:max-w-xs [&_img]:min-h-16',
        'data-testid': 'rich-text-editor',
      },
    },
    onUpdate: ({ editor: next }) => {
      onChange(next.getJSON())
    },
  })

  useEffect(() => {
    if (!editor) return
    const incoming = (value as object | null) ?? emptyRichText()
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(incoming)) return
    editor.commands.setContent(incoming, { emitUpdate: false })
  }, [editor, value])

  const insertImage = useCallback(
    (asset: MediaAsset) => {
      editor
        ?.chain()
        .focus()
        .setImage({
          src: assetFileUrl(asset.storageKey),
          alt: asset.altText ?? asset.originalFilename,
        })
        .run()
    },
    [editor],
  )

  if (!editor) {
    return <div className="min-h-40 rounded-md border" />
  }

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap gap-0.5 border-b p-1">
        <ToolbarButton
          label="Heading 2"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 3"
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 4"
          active={editor.isActive('heading', { level: 4 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        >
          <Heading4 />
        </ToolbarButton>
        <ToolbarButton
          label="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          label="Link"
          active={editor.isActive('link')}
          onClick={() => {
            const { from, to } = editor.state.selection
            const href = window.prompt(
              'Link URL',
              editor.getAttributes('link').href ?? 'https://',
            )
            if (href === null) return
            if (href === '') {
              editor.chain().focus().unsetLink().run()
              return
            }
            editor
              .chain()
              .focus()
              .setTextSelection({ from, to })
              .setLink({ href })
              .run()
          }}
        >
          <Link2 />
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          label="Ordered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </ToolbarButton>
        <ToolbarButton
          label="Code block"
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code />
        </ToolbarButton>
        <ToolbarButton label="Image" onClick={() => setPickerOpen(true)}>
          <ImageIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus />
        </ToolbarButton>
        <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        organizationId={organizationId}
        onSelect={insertImage}
      />
    </div>
  )
}
