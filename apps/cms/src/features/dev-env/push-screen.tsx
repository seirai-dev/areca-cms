import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowsClockwise, CaretDown } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import type { SegmentedOption } from '#/components/ui/segmented-control'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { Skeleton } from '#/components/ui/skeleton'
import { errorMessage } from '#/lib/admin/helpers'
import { contentRoute } from '#/lib/content-route'
import { PLAN_CHANGED_MESSAGE } from '#/lib/dev-env'
import type { MeSite } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import type { PlanItem } from '#/server/dev-env/plan'
import type { pushToProductionFn } from '#/server/fn/dev-env'

import {
  NO_PUSH_DECISIONS,
  attentionReasonOf,
  carryPushDecisions,
  decisionOf,
  groupPushItems,
  planItemLabel,
  pluralForm,
  pushDetailsOf,
  pushSelection,
  schemaActionOf,
  summarizePushItem,
  withId,
} from './push-model'
import type {
  AttentionReason,
  PushDecisions,
  PushGroup,
  PushGroupKey,
  PushSummary,
  ScopeKind,
} from './push-model'
import {
  detailText,
  entriesText,
  planTitleText,
  scheduledReasonText,
  schemaActionText,
  slugTakenText,
  valuesText,
  warningText,
} from './plan-text'
import { usePushPlan, usePushToProduction } from './use-push'

type PushOutcome = Awaited<ReturnType<typeof pushToProductionFn>>

/**
 * The push screen (docs/design/dev-environments.md, "Push screen"). One list
 * of everything changed in development. Needs-attention rows default to Skip
 * and carry their own Skip | Apply switch. The push button pushes directly:
 * no confirm dialog. Only a stale session asks for a code (`useStepUp`).
 */
/**
 * The decisions bound to the plan they were made on. `items` is that plan
 * (null before the first one is reviewed). `changed` lists the items the
 * latest refresh changed, which the screen highlights.
 */
type Review = {
  items: PlanItem[] | null
  decisions: PushDecisions
  changed: string[]
}

const NO_REVIEW: Review = {
  items: null,
  decisions: NO_PUSH_DECISIONS,
  changed: [],
}

export function PushScreen({
  devSite,
  productionName,
  userId,
}: {
  devSite: MeSite
  productionName: string
  userId: string
}) {
  const plan = usePushPlan(devSite.id)
  const push = usePushToProduction(devSite.id, devSite.parentSiteId ?? '')
  const [review, setReview] = React.useState<Review>(NO_REVIEW)
  const [planChanged, setPlanChanged] = React.useState(false)
  /** The result, with the items it was pushed from: a push refetches the plan. */
  const [outcome, setOutcome] = React.useState<{
    result: PushOutcome
    items: PlanItem[]
  } | null>(null)
  const [goLive, setGoLive] = useGoLiveChoice(userId)

  const items = React.useMemo(() => plan.data?.items ?? [], [plan.data])
  // A refreshed plan keeps the decisions on items it did not change. Done
  // while rendering, so the screen never shows old decisions on new items.
  if (plan.data && review.items !== plan.data.items) {
    const carried = carryPushDecisions(
      review.items,
      plan.data.items,
      review.decisions,
    )
    setReview({
      items: plan.data.items,
      decisions: carried.decisions,
      changed: carried.changed,
    })
  }
  const { decisions, changed } = review
  const highlighted = new Set(changed)
  const groups = React.useMemo(() => groupPushItems(items), [items])
  const selection = pushSelection(items, decisions)

  async function onPush() {
    if (!plan.data) return
    try {
      const result = await push.mutateAsync({
        planHash: plan.data.planHash,
        exclude: selection.exclude,
        apply: selection.apply,
        goLive,
      })
      setPlanChanged(false)
      setOutcome({ result, items })
    } catch (error) {
      if (errorMessage(error) === PLAN_CHANGED_MESSAGE) {
        setPlanChanged(true)
      } else {
        toast.error(errorMessage(error))
      }
    }
  }

  function onReviewAgain() {
    setPlanChanged(false)
    void plan.refetch()
  }

  /**
   * Refetches the plan. A changed plan is carried over while rendering (see
   * `carryPushDecisions`): decisions on unchanged items stay, the others
   * reset and are highlighted. An identical plan keeps its reference, so
   * nothing is reset.
   */
  function onRefresh() {
    setPlanChanged(false)
    void plan.refetch()
  }

  /** A decision on a row is a review of it: its highlight goes. */
  const decide = (id: string, change: (prev: PushDecisions) => PushDecisions) =>
    setReview((prev) => ({
      ...prev,
      decisions: change(prev.decisions),
      changed: prev.changed.filter((entry) => entry !== id),
    }))

  const toggle = (id: string, taken: boolean) =>
    decide(id, (prev) => ({
      ...prev,
      unticked: withId(prev.unticked, id, !taken),
    }))

  const setApply = (id: string, apply: boolean) =>
    decide(id, (prev) => ({
      ...prev,
      applied: withId(prev.applied, id, apply),
    }))

  const one = pluralForm(selection.push) === 'one'
  const pushLabel = !plan.data
    ? m.dev_env_push_button()
    : selection.skipped === 0
      ? one
        ? m.dev_push_button_plain_one()
        : m.dev_push_button_plain_other({ count: selection.push })
      : one
        ? m.dev_push_button_one({ skipped: selection.skipped })
        : m.dev_push_button_other({
            count: selection.push,
            skipped: selection.skipped,
          })

  return (
    <div data-testid="push-screen" className="grid gap-6">
      <PageHeader
        title={m.dev_push_title({ name: productionName })}
        description={m.dev_push_subtitle()}
        actions={
          outcome ? null : (
            <>
              <Button asChild variant="outline" size="md">
                <Link
                  to="/sites/$siteId"
                  params={{ siteId: devSite.id }}
                  data-testid="push-cancel"
                >
                  {m.dev_push_cancel()}
                </Link>
              </Button>
              <Button
                type="button"
                variant="quiet"
                size="md"
                loading={plan.isFetching}
                onClick={onRefresh}
                data-testid="push-refresh"
              >
                <ArrowsClockwise aria-hidden="true" />
                {m.dev_push_refresh()}
              </Button>
              <Button
                type="button"
                size="md"
                loading={push.isPending}
                disabled={!plan.data || selection.push === 0}
                onClick={() => void onPush()}
                data-testid="push-submit"
              >
                {pushLabel}
              </Button>
            </>
          )
        }
      />

      {outcome ? (
        <PushResultView
          outcome={outcome.result}
          items={outcome.items}
          devSite={devSite}
          productionSiteId={devSite.parentSiteId}
        />
      ) : (
        <>
          {planChanged ? (
            <div
              role="alert"
              data-testid="push-plan-changed"
              className="flex flex-wrap items-center gap-3 rounded-card border border-border-default bg-status-warning-bg px-4 py-3 text-callout text-text-warning"
            >
              <p className="min-w-0 flex-1">{m.dev_push_plan_changed()}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onReviewAgain}
                data-testid="push-review-again"
              >
                {m.dev_push_review_again()}
              </Button>
            </div>
          ) : null}

          {changed.length > 0 ? (
            <p
              role="status"
              data-testid="push-plan-highlight"
              className="rounded-card border border-border-default bg-status-warning-bg px-4 py-3 text-callout text-text-warning"
            >
              {m.dev_push_plan_highlight()}
            </p>
          ) : null}

          {plan.isPending ? (
            <Skeleton className="h-48 rounded-card" />
          ) : plan.isError ? (
            <QueryError
              error={plan.error}
              onRetry={() => void plan.refetch()}
              retrying={plan.isFetching}
            />
          ) : items.length === 0 ? (
            <EmptyState title={m.dev_push_empty()} data-testid="push-empty" />
          ) : (
            <div className="grid gap-6">
              {groups.map((group) => (
                <PushGroupSection
                  key={group.key}
                  group={group}
                  decisions={decisions}
                  highlighted={highlighted}
                  onToggle={toggle}
                  onDecide={setApply}
                />
              ))}
              <div className="surface-card flex items-start gap-3 px-4 py-3">
                <Checkbox
                  id="push-go-live"
                  checked={goLive}
                  onCheckedChange={(next) => setGoLive(next === true)}
                  className="mt-0.5"
                  data-testid="push-go-live"
                />
                <div className="grid min-w-0 gap-0.5">
                  <label
                    htmlFor="push-go-live"
                    className="cursor-pointer text-[14px] leading-5 font-medium text-text-primary"
                  >
                    {m.dev_push_go_live()}
                  </label>
                  <span className="text-callout text-text-secondary">
                    {m.dev_push_go_live_hint()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** The go-live choice, remembered per user in this browser. */
function useGoLiveChoice(userId: string) {
  const key = `areca.dev-env.push.go-live.${userId}`
  const [value, setValue] = React.useState(false)
  React.useEffect(() => {
    try {
      setValue(window.localStorage.getItem(key) === 'true')
    } catch {
      // Storage can be blocked (private mode). The option then starts off.
    }
  }, [key])
  const update = React.useCallback(
    (next: boolean) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, String(next))
      } catch {
        // Not remembered when storage is blocked. The choice still applies.
      }
    },
    [key],
  )
  return [value, update] as const
}

function groupTitle(key: PushGroupKey) {
  switch (key) {
    case 'attention':
      return m.dev_push_group_attention()
    case 'schema':
      return m.dev_push_group_schema()
    case 'languages':
      return m.dev_push_group_languages()
    case 'new':
      return m.dev_push_group_new()
    case 'changed':
      return m.dev_push_group_changed()
    case 'archived':
      return m.dev_push_group_archived()
  }
}

function PushGroupSection({
  group,
  decisions,
  highlighted,
  onToggle,
  onDecide,
}: {
  group: PushGroup
  decisions: PushDecisions
  highlighted: ReadonlySet<string>
  onToggle: (id: string, taken: boolean) => void
  onDecide: (id: string, apply: boolean) => void
}) {
  const [open, setOpen] = React.useState(true)
  const listId = `push-group-${group.key}`
  return (
    <section className="grid gap-2" data-testid={`push-group-${group.key}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-fit items-center gap-2 rounded-control px-1 py-1 text-callout font-medium text-text-secondary transition-colors outline-none hover:text-text-primary focus-visible:outline-2 focus-visible:outline-border-focus"
      >
        <CaretDown
          weight="bold"
          aria-hidden="true"
          className={cn(
            'size-3.5 transition-transform duration-150',
            !open && '-rotate-90',
          )}
        />
        <span>{groupTitle(group.key)}</span>
        <span className="text-text-muted tabular-nums">
          {group.items.length}
        </span>
      </button>
      {open ? (
        <InsetList id={listId}>
          {group.items.map((item) =>
            group.key === 'attention' ? (
              <AttentionRow
                key={item.id}
                item={item}
                decision={decisionOf(item, decisions)}
                highlighted={highlighted.has(item.id)}
                onDecide={onDecide}
              />
            ) : (
              <PushRow
                key={item.id}
                item={item}
                taken={!decisions.unticked.includes(item.id)}
                highlighted={highlighted.has(item.id)}
                onToggle={onToggle}
              />
            ),
          )}
        </InsetList>
      ) : null}
    </section>
  )
}

/** A row's title, translated when the item's title is a fixed label. */
function itemTitle(item: PlanItem): string {
  return item.titleCode ? planTitleText(item.titleCode) : item.title
}

/**
 * The row's title. A schema row names what it does first:
 * `Remove field 'excerpt' · Posts`. Entries and sections show their collection.
 */
function rowTitle(item: PlanItem): string {
  const action = schemaActionOf(item)
  return action
    ? `${schemaActionText(action)} · ${itemTitle(item)}`
    : planItemLabel(item, itemTitle(item))
}

/** The secondary lines of a row: one per detail, each on its own line. */
function DetailLines({ item }: { item: PlanItem }) {
  return pushDetailsOf(item).map((detail, index) => (
    <span
      key={`${detail.kind}-${index}`}
      data-testid="push-row-detail"
      className="break-words text-callout text-text-secondary"
    >
      {detailText(detail)}
    </span>
  ))
}

function PushRow({
  item,
  taken,
  highlighted,
  onToggle,
}: {
  item: PlanItem
  taken: boolean
  highlighted: boolean
  onToggle: (id: string, taken: boolean) => void
}) {
  const id = `push-item-${item.id}`
  return (
    <li
      data-testid="push-row"
      data-highlighted={highlighted || undefined}
      className={cn(
        'flex items-start gap-3 px-4 py-3',
        highlighted && 'bg-status-warning-bg',
      )}
    >
      <Checkbox
        id={id}
        checked={taken}
        onCheckedChange={(next) => onToggle(item.id, next === true)}
        className="mt-0.5"
      />
      <label
        htmlFor={id}
        className="grid min-w-0 flex-1 cursor-pointer gap-0.5"
      >
        <span className="break-words text-[14px] leading-5 font-medium text-text-primary">
          {rowTitle(item)}
        </span>
        <span className="text-callout text-text-secondary">
          {summaryText(summarizePushItem(item))}
        </span>
        <DetailLines item={item} />
      </label>
    </li>
  )
}

function AttentionRow({
  item,
  decision,
  highlighted,
  onDecide,
}: {
  item: PlanItem
  decision: ReturnType<typeof decisionOf>
  highlighted: boolean
  onDecide: (id: string, apply: boolean) => void
}) {
  const reason = attentionReasonOf(item)
  const options: SegmentedOption<'skip' | 'apply'>[] = [
    {
      value: 'skip',
      label: m.dev_push_skip(),
      testId: `push-skip-${item.id}`,
    },
    {
      value: 'apply',
      label: m.dev_push_apply(),
      // A row that cannot be applied (scheduled, or a URL another entry holds) shows Apply disabled.
      disabled: decision.applyDisabled,
      testId: `push-apply-${item.id}`,
    },
  ]
  return (
    <li
      data-testid="push-attention-row"
      data-highlighted={highlighted || undefined}
      className={cn(
        'flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4',
        highlighted && 'bg-status-warning-bg',
      )}
    >
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="break-words text-[14px] leading-5 font-medium text-text-primary">
          {rowTitle(item)}
        </span>
        {reason ? (
          <span className="break-words text-callout text-text-warning">
            {reasonText(reason)}
          </span>
        ) : null}
        <DetailLines item={item} />
      </div>
      <SegmentedControl
        size="sm"
        value={decision.value}
        onValueChange={(next) => onDecide(item.id, next === 'apply')}
        options={options}
        aria-label={m.dev_push_decision_label({
          label: rowTitle(item),
        })}
        className="w-full shrink-0 sm:w-auto"
        data-testid={`push-decision-${item.id}`}
      />
    </li>
  )
}

function scopeText(scope: ScopeKind) {
  switch (scope) {
    case 'both':
      return m.dev_push_scope_both()
    case 'ready':
      return m.dev_push_scope_ready()
    case 'draft':
      return m.dev_push_scope_draft()
  }
}

function fieldsChangedText(count: number) {
  return pluralForm(count) === 'one'
    ? m.dev_push_sum_fields_one()
    : m.dev_push_sum_fields_other({ count })
}

function summaryText(summary: PushSummary): string {
  switch (summary.kind) {
    case 'fields': {
      const fields =
        summary.fields > 0
          ? fieldsChangedText(summary.fields)
          : m.dev_push_sum_plain()
      return summary.scope
        ? m.dev_push_sum_fields_scope({
            fields,
            scope: scopeText(summary.scope),
          })
        : fields
    }
    case 'plain':
      return m.dev_push_sum_plain()
    case 'archive':
      return m.dev_push_sum_archive()
    case 'new':
      return m.dev_push_sum_new()
    case 'schema-add':
      return m.dev_push_sum_schema_add()
    case 'schema-remove':
      return m.dev_push_sum_schema_remove()
    case 'drops':
      return m.dev_push_sum_drop({ values: valuesText(summary.values) })
    case 'languages':
      return m.dev_push_sum_languages()
  }
}

function reasonText(reason: AttentionReason): string {
  switch (reason.kind) {
    case 'conflict':
      return m.dev_push_reason_conflict()
    case 'drops': {
      const fields =
        reason.fields.length === 1
          ? m.dev_push_field_name({ key: reason.fields[0] ?? '' })
          : m.dev_push_fields_many({ count: reason.fields.length })
      return m.dev_push_reason_drops({ fields })
    }
    case 'remove-collection':
      return m.dev_push_reason_remove_collection()
    case 'main-language':
      return m.dev_push_reason_main_language({
        entries: entriesText(reason.entries),
      })
    case 'scheduled':
      return scheduledReasonText(reason.titles)
    case 'deleted-in-production':
      return m.dev_push_reason_deleted()
    case 'slug-taken': {
      // Always set for this reason: the item is flagged with its collisions.
      const first = reason.collisions.at(0)
      return first ? slugTakenText(first) : ''
    }
  }
}

function PushResultView({
  outcome,
  items,
  devSite,
  productionSiteId,
}: {
  outcome: PushOutcome
  items: PlanItem[]
  devSite: MeSite
  productionSiteId: string | null
}) {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const { counts } = outcome
  const written = outcome.written.filter((row) => row.productionId !== null)
  // Only the non-zero counts. Nothing at all says so.
  const countRows = [
    { label: m.dev_push_group_schema(), value: counts.schema },
    { label: m.dev_push_group_new(), value: counts.new },
    { label: m.dev_push_group_changed(), value: counts.changed },
    { label: m.dev_push_group_archived(), value: counts.archived },
    { label: m.dev_push_result_skipped(), value: counts.skipped },
  ].filter((row) => row.value > 0)
  return (
    <div data-testid="push-result" className="grid gap-6">
      <section className="grid gap-2">
        <h2 className="px-1 text-headline text-text-primary">
          {m.dev_push_done_title()}
        </h2>
        {countRows.length > 0 ? (
          <InsetList data-testid="push-result-counts">
            {countRows.map((row) => (
              <CountRow key={row.label} label={row.label} value={row.value} />
            ))}
          </InsetList>
        ) : (
          <p
            data-testid="push-result-nothing"
            className="px-1 text-callout text-text-secondary"
          >
            {m.dev_push_result_nothing()}
          </p>
        )}
      </section>

      {outcome.publication ? (
        <InsetList data-testid="push-result-publication">
          <InsetRow
            title={
              outcome.publication.ok
                ? m.dev_push_publication_queued()
                : m.dev_push_publication_failed({
                    reason: outcome.publication.errors.join('; '),
                  })
            }
          />
        </InsetList>
      ) : null}

      {outcome.warnings.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="px-1 text-callout font-medium text-text-secondary">
            {m.dev_push_result_warnings()}
          </h3>
          <InsetList data-testid="push-result-warnings">
            {outcome.warnings.map((warning, index) => (
              <InsetRow
                key={`${warning.itemId ?? 'warning'}-${index}`}
                title={warningText(warning)}
                wrapSubtitle
              />
            ))}
          </InsetList>
        </section>
      ) : null}

      {written.length > 0 && productionSiteId ? (
        <section className="grid gap-2">
          <h3 className="px-1 text-callout font-medium text-text-secondary">
            {m.dev_push_result_written()}
          </h3>
          <InsetList data-testid="push-result-written">
            {written.map((row) => {
              const item = itemById.get(row.itemId)
              if (!item?.collectionKey || !row.productionId) return null
              const title = rowTitle(item)
              // A section opens its page; a collection entry opens in the editor.
              return (
                <InsetRow
                  key={row.itemId}
                  asChild
                  chevron
                  title={title}
                  subtitle={m.dev_push_open_in_production()}
                >
                  <Link
                    {...contentRoute({
                      siteId: productionSiteId,
                      collectionKey: item.collectionKey,
                      entryId: row.productionId,
                      global: row.collectionKind === 'global',
                    })}
                  />
                </InsetRow>
              )
            })}
          </InsetList>
        </section>
      ) : null}

      <div>
        <Button asChild variant="outline" size="md">
          <Link
            to="/sites/$siteId"
            params={{ siteId: devSite.id }}
            data-testid="push-back-to-dev"
          >
            <ArrowLeft />
            {m.dev_push_back_to_dev()}
          </Link>
        </Button>
      </div>
    </div>
  )
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <InsetRow
      title={label}
      trailing={<span className="tabular-nums">{value}</span>}
    />
  )
}
