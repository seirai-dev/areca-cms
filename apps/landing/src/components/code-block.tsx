import { useState } from 'react'
import { Check, Copy } from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'

export type Token = { t: string; c?: 'k' | 's' | 'f' | 'c' }

/** Tiny static code sample. Tokens are pre-coloured; no highlighter ships. */
export function CodeBlock({
  lines,
  title,
  prompt = false,
  className = '',
}: {
  lines: Token[][]
  title?: string
  prompt?: boolean
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const text = lines
    .map((l) => l.map((t) => t.t).join(''))
    .filter(
      (l) => !l.trimStart().startsWith('#') && !l.trimStart().startsWith('//'),
    )
    .join('\n')
  return (
    <div
      className={`min-w-0 max-w-full overflow-hidden rounded-[14px] border border-line bg-raised ${className}`}
    >
      {title ? (
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-micro text-muted">{title}</span>
          <CopyButton text={text} copied={copied} setCopied={setCopied} />
        </div>
      ) : null}
      <div className="relative">
        <pre className="overflow-x-auto px-4 py-3.5 text-[0.8125rem] leading-[1.75]">
          <code>
            {lines.map((line, i) => (
              <span key={i} className="block">
                {prompt ? (
                  <span className="text-faint select-none">$ </span>
                ) : null}
                {line.map((tok, j) => (
                  <span key={j} className={tok.c ? `tok-${tok.c}` : undefined}>
                    {tok.t}
                  </span>
                ))}
              </span>
            ))}
          </code>
        </pre>
        {!title ? (
          <div className="absolute top-2 right-2">
            <CopyButton text={text} copied={copied} setCopied={setCopied} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CopyButton({
  text,
  copied,
  setCopied,
}: {
  text: string
  copied: boolean
  setCopied: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      aria-label={copied ? m.code_copied() : m.code_copy()}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
      className="grid size-7 place-items-center rounded-md text-faint transition-colors hover:bg-line/60 hover:text-fg"
    >
      {copied ? <Check size={14} className="text-live" /> : <Copy size={14} />}
    </button>
  )
}
