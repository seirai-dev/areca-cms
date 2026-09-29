import { Button } from '#/components/ui/button'
import { FloatingBar, FloatingBarLabel } from '#/components/ui/floating-bar'
import { m } from '#/paraglide/messages'

/**
 * The settings save pill (brief §2.2): "Unsaved changes · Discard · Save",
 * springing up while a form is dirty. `saveTestId` keeps old test anchors
 * (`save-deployment-target`).
 */
export function SettingsSaveBar({
  dirty,
  saving,
  onDiscard,
  formId,
  saveTestId,
  disabled,
}: {
  dirty: boolean
  saving: boolean
  onDiscard: () => void
  /** The form the Save button submits. */
  formId: string
  saveTestId?: string
  disabled?: boolean
}) {
  return (
    <FloatingBar open={dirty || saving} label={m.settings_unsaved()} data-testid="settings-save-bar">
      <FloatingBarLabel>{m.settings_unsaved()}</FloatingBarLabel>
      <Button
        type="button"
        variant="quiet"
        size="sm"
        onClick={onDiscard}
        disabled={saving}
        className="rounded-full"
      >
        {m.settings_discard()}
      </Button>
      <Button
        type="submit"
        form={formId}
        size="sm"
        loading={saving}
        disabled={disabled}
        className="rounded-full px-4"
        data-testid={saveTestId}
      >
        {m.settings_save()}
      </Button>
    </FloatingBar>
  )
}
