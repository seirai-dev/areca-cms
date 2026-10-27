import { m } from '#/paraglide/messages'

/** For technical users: the transport, header and server name. */
export function TechnicalDetails({
  endpointUrl,
  serverName,
}: {
  endpointUrl: string | undefined
  serverName: string
}) {
  return (
    <section
      className="grid gap-4 border-t border-border-default pt-6"
      aria-labelledby="connect-ai-details-heading"
      data-testid="connect-ai-details"
    >
      <h2
        id="connect-ai-details-heading"
        className="text-overline text-text-muted"
      >
        {m.connect_ai_details()}
      </h2>
      <dl className="grid gap-4 text-callout">
        <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
          <dt className="text-caption text-text-muted">
            {m.connect_ai_details_transport()}
          </dt>
          <dd className="text-text-primary">
            {m.connect_ai_details_transport_value()}
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
          <dt className="text-caption text-text-muted">
            {m.connect_ai_details_server_name()}
          </dt>
          <dd>
            <code className="font-mono text-[12.5px] text-text-primary">
              {serverName}
            </code>
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
          <dt className="text-caption text-text-muted">
            {m.connect_ai_details_server_url()}
          </dt>
          <dd>
            <code className="font-mono text-[12.5px] break-all text-text-primary">
              {endpointUrl ?? '—'}
            </code>
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
          <dt className="text-caption text-text-muted">
            {m.connect_ai_details_header()}
          </dt>
          <dd>
            <code className="font-mono text-[12.5px] break-all text-text-primary">
              {m.connect_ai_details_header_value()}
            </code>
          </dd>
        </div>
      </dl>
    </section>
  )
}
