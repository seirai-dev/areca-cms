import * as React from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  ArrowUUpLeft,
  ArrowUUpRight,
  CaretDown,
  Code,
  Columns,
  ColumnsPlusRight,
  Image,
  Link as LinkIcon,
  LinkBreak,
  ListBullets,
  ListNumbers,
  Minus,
  Paragraph,
  Plus,
  Quotes,
  Rows,
  RowsPlusBottom,
  Table,
  TextB,
  TextHFour,
  TextHThree,
  TextHTwo,
  TextItalic,
  Trash,
} from '@phosphor-icons/react'
import type { Icon as IconComponent } from '@phosphor-icons/react'

import { assetFileUrl, emptyRichText } from '#/components/editor/utils'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '#/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { isAllowedLinkHref } from '#/server/richtext/allowlist'
import { richTextExtensions } from '#/server/richtext/extensions'

import { MediaPickerDialog } from '../media-picker'
import type { MediaAsset } from '../media-picker'

function useMod() {
  const [mod, setMod] = React.useState('Ctrl+')
  React.useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setMod('⌘')
  }, [])
  return mod
}

const EMPTY_STATE = {
  isEmpty: true,
  block: 'paragraph' as BlockType,
  bold: false,
  italic: false,
  link: false,
  bulletList: false,
  orderedList: false,
  table: false,
  canAddRow: false,
  canAddColumn: false,
  canDeleteRow: false,
  canDeleteColumn: false,
  canDeleteTable: false,
  canUndo: false,
  canRedo: false,
}

type BlockType = 'paragraph' | 'h2' | 'h3' | 'h4' | 'quote' | 'code'

function currentBlock(e: Editor): BlockType {
  if (e.isActive('codeBlock')) return 'code'
  if (e.isActive('heading', { level: 2 })) return 'h2'
  if (e.isActive('heading', { level: 3 })) return 'h3'
  if (e.isActive('heading', { level: 4 })) return 'h4'
  if (e.isActive('blockquote')) return 'quote'
  return 'paragraph'
}

type Command = {
  id: string
  label: () => string
  /** Accessible name when it differs from the visible label. */
  aria?: () => string
  icon: IconComponent
  keywords: string
  shortcut?: (mod: string) => string
  run: (editor: Editor) => void
}

function blockCommands(): (Command & { id: BlockType })[] {
  return [
    {
      id: 'paragraph',
      label: () => m.editor_toolbar_paragraph(),
      icon: Paragraph,
      keywords: 'paragraph text body',
      shortcut: (mod) => `${mod}⌥0`,
      run: (e) => e.chain().focus().setParagraph().run(),
    },
    {
      id: 'h2',
      label: () => m.editor_toolbar_heading_2(),
      icon: TextHTwo,
      keywords: 'heading h2 title large',
      shortcut: (mod) => `${mod}⌥2`,
      run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      id: 'h3',
      label: () => m.editor_toolbar_heading_3(),
      icon: TextHThree,
      keywords: 'heading h3 subtitle',
      shortcut: (mod) => `${mod}⌥3`,
      run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
    },
    {
      id: 'h4',
      label: () => m.editor_toolbar_heading_4(),
      icon: TextHFour,
      keywords: 'heading h4 small',
      shortcut: (mod) => `${mod}⌥4`,
      run: (e) => e.chain().focus().setHeading({ level: 4 }).run(),
    },
    {
      id: 'quote',
      label: () => m.editor_toolbar_quote(),
      icon: Quotes,
      keywords: 'quote blockquote citation',
      shortcut: (mod) => `${mod}⇧B`,
      run: (e) => {
        const chain = e.chain().focus()
        if (e.isActive('blockquote')) chain.run()
        else chain.setParagraph().toggleBlockquote().run()
      },
    },
    {
      id: 'code',
      label: () => m.editor_toolbar_code_block(),
      icon: Code,
      keywords: 'code block pre',
      shortcut: (mod) => `${mod}⌥C`,
      run: (e) => e.chain().focus().setCodeBlock().run(),
    },
  ]
}

/**
 * The writing surface for rich text fields (brief §3.5). A compact format bar
 * sticks under the editor's top bar only while the field is in use (block
 * style, bold, italic, link, lists, Insert, undo/redo), a table bar joins it
 * inside tables, the selection bubble stays, and typing `/` on an empty line
 * opens the same insert actions. Every earlier capability, shortcut and test
 * id is kept.
 */
export function RichTextEditor({
  id,
  label,
  value,
  onChange,
  organizationId,
  previewing = false,
  preview,
  invalid,
}: {
  id?: string
  label?: string
  value: unknown
  onChange: (value: unknown) => void
  organizationId: string
  /** Show `preview` instead of the editable body; the editor stays mounted. */
  previewing?: boolean
  preview?: React.ReactNode
  invalid?: boolean
}) {
  const mod = useMod()
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const [focused, setFocused] = React.useState(false)
  const [openMenus, setOpenMenus] = React.useState(0)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [linkHref, setLinkHref] = React.useState('')
  const [linkError, setLinkError] = React.useState<string | null>(null)
  const [slash, setSlash] = React.useState<SlashState | null>(null)
  const [slashIndex, setSlashIndex] = React.useState(0)
  const slashQueryRef = React.useRef<string | null>(null)
  const slashKeyRef = React.useRef<(event: KeyboardEvent) => boolean>(() => false)

  const menuOpenChange = React.useCallback((open: boolean) => {
    setOpenMenus((count) => Math.max(0, count + (open ? 1 : -1)))
  }, [])

  const editor = useEditor({
    extensions: richTextExtensions,
    content: (value as object | null) ?? emptyRichText(),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          'prose max-w-none min-h-64 pb-8 text-body-lg text-text-primary focus:outline-none',
          'prose-p:my-3 prose-headings:tracking-[-0.015em] prose-h2:mt-10 prose-h2:mb-3 prose-h3:mt-8 prose-h3:mb-2',
          '[&_img]:h-auto [&_img]:max-w-full [&_img]:min-h-16 [&_a]:underline',
        ),
        'data-testid': 'rich-text-editor',
        ...(id ? { id } : {}),
        ...(label ? { 'aria-label': label } : {}),
        'aria-multiline': 'true',
        role: 'textbox',
      },
      handleKeyDown: (_view, event) => slashKeyRef.current(event),
    },
    onUpdate: ({ editor: next }) => {
      onChange(next.getJSON())
    },
  })

  const liveState = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            isEmpty: e.isEmpty && !e.isActive('table') && !e.isActive('image'),
            block: currentBlock(e),
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            link: e.isActive('link'),
            bulletList: e.isActive('bulletList'),
            orderedList: e.isActive('orderedList'),
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

  // Keep the document in step with outside changes (restore, hydration).
  React.useEffect(() => {
    if (!editor) return
    const incoming = (value as object | null) ?? emptyRichText()
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(incoming)) return
    editor.commands.setContent(incoming, { emitUpdate: false })
  }, [editor, value])

  // Slash menu: `/query` typed at the start of an empty paragraph.
  React.useEffect(() => {
    if (!editor) return
    const update = () => {
      const { $from, empty } = editor.state.selection
      if (!empty || !editor.isFocused || $from.parent.type.name !== 'paragraph') {
        slashQueryRef.current = null
        setSlash(null)
        return
      }
      const text = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
      const match = /^\/([\p{L}\d ]{0,24})$/u.exec(text)
      if (!match) {
        slashQueryRef.current = null
        setSlash(null)
        return
      }
      const coords = editor.view.coordsAtPos($from.pos)
      if (slashQueryRef.current !== match[1]) setSlashIndex(0)
      slashQueryRef.current = match[1]
      const next = {
        query: match[1],
        from: $from.start(),
        to: $from.pos,
        left: coords.left,
        top: coords.bottom,
      }
      // Bail out when nothing moved: option updates also fire transactions.
      setSlash((current) =>
        current &&
        current.query === next.query &&
        current.from === next.from &&
        current.to === next.to &&
        current.left === next.left &&
        current.top === next.top
          ? current
          : next,
      )
    }
    const hide = () => setSlash(null)
    editor.on('transaction', update)
    editor.on('blur', hide)
    return () => {
      editor.off('transaction', update)
      editor.off('blur', hide)
    }
  }, [editor])

  const insertImage = React.useCallback(
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

  const openLinkEditor = React.useCallback(() => {
    if (!editor) return
    setLinkHref((editor.getAttributes('link').href as string | undefined) ?? '')
    setLinkError(null)
    setLinkOpen(true)
  }, [editor])

  const insertCommands: Command[] = React.useMemo(
    () => [
      {
        id: 'image',
        label: () => m.editor_insert_image_short(),
        aria: () => m.editor_toolbar_insert_image(),
        icon: Image,
        keywords: 'image picture photo media',
        run: () => setPickerOpen(true),
      },
      {
        id: 'table',
        label: () => m.editor_insert_table_short(),
        aria: () => m.editor_toolbar_insert_table(),
        icon: Table,
        keywords: 'table grid rows columns',
        run: (e) =>
          e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        id: 'divider',
        label: () => m.editor_toolbar_divider(),
        icon: Minus,
        keywords: 'divider line rule separator hr',
        run: (e) => e.chain().focus().setHorizontalRule().run(),
      },
    ],
    [],
  )

  const slashCommands: Command[] = React.useMemo(
    () => [
      ...blockCommands().filter((command) => command.id !== 'paragraph'),
      {
        id: 'bullet',
        label: () => m.editor_toolbar_bullet_list(),
        icon: ListBullets,
        keywords: 'bullet list unordered',
        run: (e) => e.chain().focus().toggleBulletList().run(),
      },
      {
        id: 'numbered',
        label: () => m.editor_toolbar_numbered_list(),
        icon: ListNumbers,
        keywords: 'numbered list ordered',
        run: (e) => e.chain().focus().toggleOrderedList().run(),
      },
      ...insertCommands,
    ],
    [insertCommands],
  )

  const slashMatches = React.useMemo(() => {
    if (!slash) return []
    const needle = slash.query.trim().toLowerCase()
    if (!needle) return slashCommands
    return slashCommands.filter(
      (command) =>
        command.label().toLowerCase().includes(needle) ||
        command.keywords.includes(needle),
    )
  }, [slash, slashCommands])

  const runSlash = React.useCallback(
    (command: Command) => {
      if (!editor || !slash) return
      editor.chain().focus().deleteRange({ from: slash.from, to: slash.to }).run()
      setSlash(null)
      command.run(editor)
    },
    [editor, slash],
  )

  slashKeyRef.current = (event) => {
    if (!slash || slashMatches.length === 0) return false
    if (event.key === 'ArrowDown') {
      setSlashIndex((index) => (index + 1) % slashMatches.length)
      return true
    }
    if (event.key === 'ArrowUp') {
      setSlashIndex((index) => (index - 1 + slashMatches.length) % slashMatches.length)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      runSlash(slashMatches[Math.min(slashIndex, slashMatches.length - 1)])
      return true
    }
    if (event.key === 'Escape') {
      setSlash(null)
      return true
    }
    return false
  }

  function applyLink(event: React.FormEvent<HTMLFormElement>) {
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
    return (
      <div className="grid gap-3 pt-14" aria-busy="true">
        <div className="h-5 w-3/4 animate-pulse rounded-[6px] bg-background-subtle" />
        <div className="h-5 w-2/3 animate-pulse rounded-[6px] bg-background-subtle" />
      </div>
    )
  }

  const state = liveState ?? EMPTY_STATE
  const chain = () => editor.chain().focus()
  const barVisible =
    !previewing && (focused || openMenus > 0 || linkOpen || pickerOpen)
  const blocks = blockCommands()
  const activeBlock = blocks.find((block) => block.id === state.block) ?? blocks[0]

  return (
    <div
      ref={wrapperRef}
      className="relative min-w-0"
      data-invalid={invalid ? 'true' : undefined}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (next && wrapperRef.current?.contains(next)) return
        setFocused(false)
      }}
    >
      {/* The format bar: a reserved 44px slot that sticks under the top bar. */}
      <div
        className="sticky top-[var(--editor-bar-h,56px)] z-20 -mx-3 -mt-5 mb-1 flex h-12 items-center"
        data-testid="rich-text-format-bar-slot"
      >
        <div
          role="toolbar"
          aria-label={m.editor_toolbar_formatting()}
          data-testid="rich-text-toolbar"
          data-visible={barVisible ? 'true' : 'false'}
          inert={!barVisible}
          className={cn(
            'flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[12px] border border-border-default bg-background-elevated/95 p-1 shadow-[0_6px_20px_-8px_rgb(0_0_0/0.16)] backdrop-blur-xl no-scrollbar',
            'transition-[opacity,transform] duration-150 ease-(--ease-standard)',
            barVisible
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none -translate-y-1 opacity-0 motion-reduce:translate-y-0',
          )}
          onMouseDown={(event) => {
            // Keep the selection in the document while using the bar.
            if ((event.target as HTMLElement).closest('input')) return
            event.preventDefault()
          }}
        >
          <DropdownMenu onOpenChange={menuOpenChange} modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="quiet"
                size="sm"
                className="w-[128px] justify-between gap-1 px-2.5 text-text-primary"
                aria-label={m.editor_text_style({ style: activeBlock.label() })}
                data-testid="rich-text-block-type"
              >
                <span className="truncate">{activeBlock.label()}</span>
                <CaretDown weight="bold" className="size-3 text-icon-muted" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-56"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {blocks.map((block) => (
                <DropdownMenuItem
                  key={block.id}
                  onSelect={() => block.run(editor)}
                  data-active={state.block === block.id ? 'true' : undefined}
                  className="data-[active=true]:bg-accent-soft data-[active=true]:text-accent-text"
                >
                  <block.icon />
                  {block.label()}
                  {block.shortcut ? (
                    <DropdownMenuShortcut>{block.shortcut(mod)}</DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <BarDivider />
          <BarButton
            label={m.editor_toolbar_bold()}
            shortcut={`${mod}B`}
            active={state.bold}
            onClick={() => chain().toggleBold().run()}
          >
            <TextB weight="bold" />
          </BarButton>
          <BarButton
            label={m.editor_toolbar_italic()}
            shortcut={`${mod}I`}
            active={state.italic}
            onClick={() => chain().toggleItalic().run()}
          >
            <TextItalic weight="bold" />
          </BarButton>
          <Popover
            open={linkOpen}
            onOpenChange={(open) => {
              setLinkOpen(open)
              if (!open) editor.commands.focus()
            }}
          >
            <PopoverAnchor asChild>
              <span className="inline-flex">
                <BarButton
                  label={state.link ? m.editor_toolbar_edit_link() : m.editor_toolbar_link()}
                  active={state.link}
                  onClick={openLinkEditor}
                  data-testid="rich-text-link"
                >
                  <LinkIcon weight="bold" />
                </BarButton>
              </span>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              className="w-80"
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                document.getElementById('rich-text-link-url')?.focus()
              }}
            >
              <form className="grid gap-3" onSubmit={applyLink}>
                <div className="grid gap-1.5">
                  <Label htmlFor="rich-text-link-url">{m.editor_link_url()}</Label>
                  <Input
                    id="rich-text-link-url"
                    placeholder="https://example.com"
                    value={linkHref}
                    onChange={(event) => {
                      setLinkHref(event.target.value)
                      setLinkError(null)
                    }}
                    aria-invalid={linkError ? true : undefined}
                  />
                  {linkError ? (
                    <p className="text-callout text-text-error" role="alert">
                      {linkError}
                    </p>
                  ) : (
                    <p className="text-caption font-normal text-text-muted">
                      {m.editor_link_opens_new_tab()}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  {state.link ? (
                    <Button
                      type="button"
                      variant="quiet"
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
          <BarDivider />
          <BarButton
            label={m.editor_toolbar_bullet_list()}
            shortcut={`${mod}⇧8`}
            active={state.bulletList}
            onClick={() => chain().toggleBulletList().run()}
          >
            <ListBullets weight="bold" />
          </BarButton>
          <BarButton
            label={m.editor_toolbar_numbered_list()}
            shortcut={`${mod}⇧7`}
            active={state.orderedList}
            onClick={() => chain().toggleOrderedList().run()}
          >
            <ListNumbers weight="bold" />
          </BarButton>
          <BarDivider />
          <DropdownMenu onOpenChange={menuOpenChange} modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="quiet"
                size="sm"
                className="gap-1 px-2 text-text-primary"
                data-testid="rich-text-insert"
              >
                <Plus weight="bold" />
                {m.editor_insert()}
                <CaretDown weight="bold" className="size-3 text-icon-muted" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-52"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <DropdownMenuLabel>{m.editor_insert()}</DropdownMenuLabel>
              {insertCommands.map((command) => (
                <DropdownMenuItem
                  key={command.id}
                  aria-label={command.aria?.()}
                  data-testid={
                    command.id === 'table'
                      ? 'rich-text-insert-table'
                      : `rich-text-insert-${command.id}`
                  }
                  onSelect={() => command.run(editor)}
                >
                  <command.icon />
                  {command.label()}
                </DropdownMenuItem>
              ))}
              <DropdownMenuLabel className="pt-1.5 pb-2 text-caption font-normal tracking-normal normal-case">
                {m.editor_slash_hint()}
              </DropdownMenuLabel>
            </DropdownMenuContent>
          </DropdownMenu>

          {state.table ? (
            <>
              <BarDivider />
              <span
                className="flex items-center gap-0.5 rounded-[9px] bg-accent-soft px-1"
                role="group"
                aria-label={m.editor_table_tools()}
                data-testid="rich-text-table-bar"
              >
                <span className="px-1 text-caption text-accent-text">
                  {m.editor_table()}
                </span>
                <BarButton
                  label={m.editor_toolbar_add_table_row()}
                  disabled={!state.canAddRow}
                  data-testid="rich-text-add-table-row"
                  onClick={() => chain().addRowAfter().run()}
                >
                  <RowsPlusBottom />
                </BarButton>
                <BarButton
                  label={m.editor_toolbar_delete_table_row()}
                  disabled={!state.canDeleteRow}
                  data-testid="rich-text-delete-table-row"
                  onClick={() => chain().deleteRow().run()}
                >
                  <Rows />
                </BarButton>
                <BarButton
                  label={m.editor_toolbar_add_table_column()}
                  disabled={!state.canAddColumn}
                  data-testid="rich-text-add-table-column"
                  onClick={() => chain().addColumnAfter().run()}
                >
                  <ColumnsPlusRight />
                </BarButton>
                <BarButton
                  label={m.editor_toolbar_delete_table_column()}
                  disabled={!state.canDeleteColumn}
                  data-testid="rich-text-delete-table-column"
                  onClick={() => chain().deleteColumn().run()}
                >
                  <Columns />
                </BarButton>
                <BarButton
                  label={m.editor_toolbar_delete_table()}
                  disabled={!state.canDeleteTable}
                  data-testid="rich-text-delete-table"
                  onClick={() => chain().deleteTable().run()}
                >
                  <Trash />
                </BarButton>
              </span>
            </>
          ) : null}

          <span className="min-w-2 flex-1" />
          <BarButton
            label={m.editor_toolbar_undo()}
            shortcut={`${mod}Z`}
            disabled={!state.canUndo}
            onClick={() => chain().undo().run()}
          >
            <ArrowUUpLeft />
          </BarButton>
          <BarButton
            label={m.editor_toolbar_redo()}
            shortcut={`${mod}⇧Z`}
            disabled={!state.canRedo}
            onClick={() => chain().redo().run()}
          >
            <ArrowUUpRight />
          </BarButton>
        </div>
      </div>

      <div className="relative">
        {state.isEmpty && !previewing ? (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute top-3 left-0 text-body-lg text-text-disabled"
          >
            {m.editor_start_writing_slash()}
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
        className="z-overlay flex items-center gap-0.5 rounded-[12px] border border-border-default bg-background-elevated p-1 shadow-float"
      >
        <BarButton
          label={m.editor_toolbar_bold()}
          active={state.bold}
          onClick={() => chain().toggleBold().run()}
        >
          <TextB weight="bold" />
        </BarButton>
        <BarButton
          label={m.editor_toolbar_italic()}
          active={state.italic}
          onClick={() => chain().toggleItalic().run()}
        >
          <TextItalic weight="bold" />
        </BarButton>
        <BarButton
          label={state.link ? m.editor_toolbar_edit_link() : m.editor_toolbar_link()}
          active={state.link}
          onClick={openLinkEditor}
        >
          <LinkIcon weight="bold" />
        </BarButton>
        <BarDivider />
        <BarButton
          label={m.editor_toolbar_heading_2()}
          active={state.block === 'h2'}
          onClick={() => chain().toggleHeading({ level: 2 }).run()}
        >
          <TextHTwo weight="bold" />
        </BarButton>
        <BarButton
          label={m.editor_toolbar_heading_3()}
          active={state.block === 'h3'}
          onClick={() => chain().toggleHeading({ level: 3 }).run()}
        >
          <TextHThree weight="bold" />
        </BarButton>
      </BubbleMenu>

      {slash && slashMatches.length > 0 && typeof document !== 'undefined'
        ? createPortal(
            <SlashMenu
              state={slash}
              items={slashMatches}
              active={Math.min(slashIndex, slashMatches.length - 1)}
              onHover={setSlashIndex}
              onPick={runSlash}
            />,
            document.body,
          )
        : null}

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        organizationId={organizationId}
        onSelect={insertImage}
        imagesOnly
      />
    </div>
  )
}

type SlashState = {
  query: string
  from: number
  to: number
  left: number
  top: number
}

function SlashMenu({
  state,
  items,
  active,
  onHover,
  onPick,
}: {
  state: SlashState
  items: Command[]
  active: number
  onHover: (index: number) => void
  onPick: (command: Command) => void
}) {
  const top = Math.min(state.top + 6, window.innerHeight - 320)
  const left = Math.min(state.left, window.innerWidth - 260)
  return (
    <div
      role="listbox"
      aria-label={m.editor_insert()}
      data-testid="rich-text-slash-menu"
      className="fixed z-overlay max-h-80 w-60 overflow-y-auto rounded-card p-1.5 surface-float animate-pop-in scroll-quiet"
      style={{ top, left }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <p className="px-2.5 pt-1.5 pb-1 text-overline text-text-muted">
        {m.editor_insert()}
      </p>
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === active}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(item)}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[14px] leading-5',
            index === active ? 'bg-surface-state-hover text-text-primary' : 'text-text-primary',
          )}
        >
          <span className="grid size-7 place-content-center rounded-[7px] border border-border-default bg-background-surface text-icon-default">
            <item.icon className="size-4" />
          </span>
          {item.label()}
        </button>
      ))}
    </div>
  )
}

function BarDivider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border-default" />
}

function BarButton({
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
          variant="quiet"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
          className={cn(
            'shrink-0 text-icon-default',
            active && 'bg-accent-soft text-accent-text hover:bg-accent-soft',
          )}
          {...rest}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut ? <span className="ml-1.5 opacity-60">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}
