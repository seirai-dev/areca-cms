import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { Separator } from '#/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { richTextExtensions } from '#/server/richtext/extensions'
import { isAllowedLinkHref } from '#/server/richtext/allowlist'
import { m } from '#/paraglide/messages'

import { MediaPickerDialog } from './media-picker'
import type { MediaAsset } from './media-picker'
import { assetFileUrl, emptyRichText } from './utils'
import {
  TextB,
  Code,
  Columns,
  TextHTwo,
  TextHThree,
  TextHFour,
  Image,
  TextItalic,
  Link,
  LinkBreak,
  ListBullets,
  ListNumbers,
  Minus,
  Paragraph,
  Quotes,
  ArrowUUpRight,
  Rows,
  Table,
  ColumnsPlusRight,
  RowsPlusBottom,
  Trash,
  ArrowUUpLeft,
} from '@phosphor-icons/react'

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  shortcut,
  children,
  ...rest
}: {
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  label: string
  shortcut?: string
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof Button>, 'onClick' | 'children'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={active ? 'secondary' : 'ghost'}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
          {...rest}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut ? (
          <span className="ml-1.5 opacity-70">{shortcut}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

const EMPTY_TOOLBAR_STATE = {
  isEmpty: true,
  h2: false,
  h3: false,
  h4: false,
  paragraph: true,
  bold: false,
  italic: false,
  link: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  codeBlock: false,
  table: false,
  canAddRow: false,
  canAddColumn: false,
  canDeleteRow: false,
  canDeleteColumn: false,
  canDeleteTable: false,
  canUndo: false,
  canRedo: false,
}

function ToolbarSeparator() {
  return <Separator orientation="vertical" className="mx-0.5 h-5 self-center" />
}

/**
 * Tiptap-based editor. The toolbar sticks below the app header (and the entry
 * action bar) while the body scrolls; `--rich-text-toolbar-top` is set by the
 * entry editor to the combined height of whatever is stacked above.
 */
export function RichTextEditor({
  value,
  onChange,
  organizationId,
  toolbarEnd,
  previewing = false,
  preview,
}: {
  value: unknown
  onChange: (value: unknown) => void
  organizationId: string
  /** Rendered at the right end of the toolbar (the Edit | Preview switch). */
  toolbarEnd?: React.ReactNode
  /** Show `preview` instead of the editable body; the editor stays mounted. */
  previewing?: boolean
  preview?: React.ReactNode
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkHref, setLinkHref] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  const editor = useEditor({
    extensions: richTextExtensions,
    content: (value as object | null) ?? emptyRichText(),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose min-h-72 max-w-none py-4 focus:outline-none [&_img]:h-auto [&_img]:max-w-full [&_img]:min-h-16 [&_a]:underline',
        'data-testid': 'rich-text-editor',
      },
    },
    onUpdate: ({ editor: next }) => {
      onChange(next.getJSON())
    },
  })

  // Subscribe to the pieces of editor state the toolbar renders, so active
  // states update on selection changes (not only on document changes).
  const liveState = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            isEmpty: e.isEmpty && !e.isActive('table') && !e.isActive('image'),
            h2: e.isActive('heading', { level: 2 }),
            h3: e.isActive('heading', { level: 3 }),
            h4: e.isActive('heading', { level: 4 }),
            paragraph: e.isActive('paragraph'),
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            link: e.isActive('link'),
            bulletList: e.isActive('bulletList'),
            orderedList: e.isActive('orderedList'),
            blockquote: e.isActive('blockquote'),
            codeBlock: e.isActive('codeBlock'),
            table: e.isActive('table'),
            canAddRow: e.can().addRowAfter(),
            canAddColumn: e.can().addColumnAfter(),
            canDeleteRow: e.can().deleteRow(),
            canDeleteColumn: e.can().deleteColumn(),
            canDeleteTable: e.can().deleteTable(),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
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

  const openLinkEditor = useCallback(() => {
    if (!editor) return
    setLinkHref((editor.getAttributes('link').href as string | undefined) ?? '')
    setLinkError(null)
    setLinkOpen(true)
  }, [editor])

  function applyLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    let href = linkHref.trim()
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      setLinkOpen(false)
      return
    }
    if (!/^[a-z]+:/i.test(href)) href = `https://${href}`
    if (!isAllowedLinkHref(href)) {
      setLinkError(m.editor_link_invalid())
      return
    }
    const { from, to, empty } = editor.state.selection
    if (empty && !editor.isActive('link')) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: href,
          marks: [{ type: 'link', attrs: { href } }],
        })
        .run()
    } else {
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .extendMarkRange('link')
        .setLink({ href })
        .run()
    }
    setLinkOpen(false)
  }

  if (!editor) {
    return <div className="min-h-72 animate-pulse rounded-md bg-muted/40" />
  }

  // Until the first transaction the state snapshot can lag behind the editor
  // instance (e.g. a brand-new entry with default content), so fall back to a
  // neutral state instead of hiding the editor.
  const state = liveState ?? EMPTY_TOOLBAR_STATE

  const chain = () => editor.chain().focus()

  return (
    <div className="relative">
      <div
        className="sticky z-10 flex flex-wrap items-center gap-0.5 border-b border-border-subtle bg-background-default/95 py-1.5 backdrop-blur"
        style={{ top: 'var(--rich-text-toolbar-top, var(--app-header-h))' }}
        role="toolbar"
        aria-label={m.editor_toolbar_formatting()}
      >
        <ToolbarButton
          label={m.editor_toolbar_paragraph()}
          active={state.paragraph}
          onClick={() => chain().setParagraph().run()}
        >
          <Paragraph />
        </ToolbarButton>
        <ToolbarButton
          label={m.editor_toolbar_heading_2()}
          shortcut={`${mod}⌥2`}
          active={state.h2}
          onClick={() => chain().toggleHeading({ level: 2 }).run()}
        >
          <TextHTwo />
        </ToolbarButton>
        <ToolbarButton
          label={m.editor_toolbar_heading_3()}
          shortcut={`${mod}⌥3`}
          active={state.h3}
          onClick={() => chain().toggleHeading({ level: 3 }).run()}
        >
          <TextHThree />
        </ToolbarButton>
        <ToolbarButton
          label={m.editor_toolbar_heading_4()}
          shortcut={`${mod}⌥4`}
          active={state.h4}
          onClick={() => chain().toggleHeading({ level: 4 }).run()}
        >
          <TextHFour />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton
          label={m.editor_toolbar_bold()}
          shortcut={`${mod}B`}
          active={state.bold}
          onClick={() => chain().toggleBold().run()}
        >
          <TextB />
        </ToolbarButton>
        <ToolbarButton
          label={m.editor_toolbar_italic()}
          shortcut={`${mod}I`}
          active={state.italic}
          onClick={() => chain().toggleItalic().run()}
        >
          <TextItalic />
        </ToolbarButton>
        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <PopoverTrigger asChild>
            <ToolbarButton
              label={
                state.link
                  ? m.editor_toolbar_edit_link()
                  : m.editor_toolbar_link()
              }
              shortcut={`${mod}K`}
              active={state.link}
              onClick={openLinkEditor}
              data-testid="rich-text-link"
            >
              <Link />
            </ToolbarButton>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            <form className="grid gap-3" onSubmit={applyLink}>
              <div className="grid gap-1.5">
                <Label htmlFor="rich-text-link-url">
                  {m.editor_link_url()}
                </Label>
                <Input
                  id="rich-text-link-url"
                  autoFocus
                  placeholder="https://example.com"
                  value={linkHref}
                  onChange={(event) => {
                    setLinkHref(event.target.value)
                    setLinkError(null)
                  }}
                  aria-invalid={linkError ? true : undefined}
                />
                {linkError ? (
                  <p className="text-xs text-destructive" role="alert">
                    {linkError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {m.editor_link_opens_new_tab()}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                {state.link ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      chain().extendMarkRange('link').unsetLink().run()
                      setLinkOpen(false)
                    }}
                  >
                    <LinkBreak />
                    {m.editor_remove()}
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="submit" size="sm">
                  {state.link ? m.editor_update() : m.editor_add_link()}
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
        <ToolbarSeparator />
        <ToolbarButton
          label={m.editor_toolbar_bullet_list()}
          shortcut={`${mod}⇧8`}
          active={state.bulletList}
          onClick={() => chain().toggleBulletList().run()}
        >
          <ListBullets />
        </ToolbarButton>
        <ToolbarButton
          label={m.editor_toolbar_numbered_list()}
          shortcut={`${mod}⇧7`}
          active={state.orderedList}
          onClick={() => chain().toggleOrderedList().run()}
        >
          <ListNumbers />
        </ToolbarButton>
        <ToolbarButton
          label={m.editor_toolbar_quote()}
          shortcut={`${mod}⇧B`}
          active={state.blockquote}
          onClick={() => chain().toggleBlockquote().run()}
        >
          <Quotes />
        </ToolbarButton>
        <ToolbarButton
          label={m.editor_toolbar_code_block()}
          shortcut={`${mod}⌥C`}
          active={state.codeBlock}
          onClick={() => chain().toggleCodeBlock().run()}
        >
          <Code />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton
          label={m.editor_toolbar_insert_image()}
          onClick={() => setPickerOpen(true)}
        >
          <Image />
        </ToolbarButton>
        <ToolbarButton
          label={m.editor_toolbar_insert_table()}
          active={state.table}
          data-testid="rich-text-insert-table"
          onClick={() =>
            chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <Table />
        </ToolbarButton>
        {state.table ? (
          <>
            <ToolbarButton
              label={m.editor_toolbar_add_table_row()}
              disabled={!state.canAddRow}
              data-testid="rich-text-add-table-row"
              onClick={() => chain().addRowAfter().run()}
            >
              <Rows />
            </ToolbarButton>
            <ToolbarButton
              label={m.editor_toolbar_delete_table_row()}
              disabled={!state.canDeleteRow}
              data-testid="rich-text-delete-table-row"
              onClick={() => chain().deleteRow().run()}
            >
              <RowsPlusBottom />
            </ToolbarButton>
            <ToolbarButton
              label={m.editor_toolbar_add_table_column()}
              disabled={!state.canAddColumn}
              data-testid="rich-text-add-table-column"
              onClick={() => chain().addColumnAfter().run()}
            >
              <Columns />
            </ToolbarButton>
            <ToolbarButton
              label={m.editor_toolbar_delete_table_column()}
              disabled={!state.canDeleteColumn}
              data-testid="rich-text-delete-table-column"
              onClick={() => chain().deleteColumn().run()}
            >
              <ColumnsPlusRight />
            </ToolbarButton>
            <ToolbarButton
              label={m.editor_toolbar_delete_table()}
              disabled={!state.canDeleteTable}
              data-testid="rich-text-delete-table"
              onClick={() => chain().deleteTable().run()}
            >
              <Trash />
            </ToolbarButton>
          </>
        ) : null}
        <ToolbarButton
          label={m.editor_toolbar_divider()}
          onClick={() => chain().setHorizontalRule().run()}
        >
          <Minus />
        </ToolbarButton>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-0.5">
          <ToolbarButton
            label={m.editor_toolbar_undo()}
            shortcut={`${mod}Z`}
            disabled={!state.canUndo}
            onClick={() => chain().undo().run()}
          >
            <ArrowUUpLeft />
          </ToolbarButton>
          <ToolbarButton
            label={m.editor_toolbar_redo()}
            shortcut={`${mod}⇧Z`}
            disabled={!state.canRedo}
            onClick={() => chain().redo().run()}
          >
            <ArrowUUpRight />
          </ToolbarButton>
          </div>
          {toolbarEnd}
        </div>
      </div>

      <div className="relative">
        {state.isEmpty && !previewing ? (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute top-4 left-0 text-ds-body-md text-text-disabled"
          >
            {m.editor_start_writing()}
          </p>
        ) : null}
        <div className={previewing ? 'hidden' : undefined}>
          <EditorContent editor={editor} />
        </div>
        {previewing ? preview : null}
      </div>

      <BubbleMenu
        editor={editor}
        appendTo={() => document.body}
        options={{ strategy: 'fixed', placement: 'top', offset: 8 }}
        shouldShow={({ editor: e, from, to }) =>
          from !== to && !e.isActive('image') && !e.isActive('codeBlock')
        }
        className="z-40 flex items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md"
      >
        <ToolbarButton
          label={m.editor_toolbar_bold()}
          active={state.bold}
          onClick={() => chain().toggleBold().run()}
        >
          <TextB />
        </ToolbarButton>
        <ToolbarButton
          label={m.editor_toolbar_italic()}
          active={state.italic}
          onClick={() => chain().toggleItalic().run()}
        >
          <TextItalic />
        </ToolbarButton>
        <ToolbarButton
          label={
            state.link ? m.editor_toolbar_edit_link() : m.editor_toolbar_link()
          }
          active={state.link}
          onClick={openLinkEditor}
        >
          <Link />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton
          label={m.editor_toolbar_heading_2()}
          active={state.h2}
          onClick={() => chain().toggleHeading({ level: 2 }).run()}
        >
          <TextHTwo />
        </ToolbarButton>
        <ToolbarButton
          label={m.editor_toolbar_heading_3()}
          active={state.h3}
          onClick={() => chain().toggleHeading({ level: 3 }).run()}
        >
          <TextHThree />
        </ToolbarButton>
      </BubbleMenu>

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        organizationId={organizationId}
        onSelect={insertImage}
      />
    </div>
  )
}
