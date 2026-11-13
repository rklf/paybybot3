import { Switch } from '@heroui/react'
import Check from '@gravity-ui/icons/Check'
import Power from '@gravity-ui/icons/Power'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** PayByBot's on/off switch: HeroUI's Switch « with icons », as in its docs (a power sign off, a check on, green when
 *  on). It never flips by itself: `checked` says its state and a press calls onPress (which opens a window, asks to
 *  confirm…), the parent then sets `checked`. */
export function ToggleSwitch({
  checked,
  onPress,
  label,
  disabled,
  busy,
  className,
}: {
  checked: boolean
  onPress: () => void
  label: string
  disabled?: boolean
  /** A spinner in the knob while the action runs. */
  busy?: boolean
  className?: string
}) {
  return (
    <Switch isSelected={checked} onChange={() => onPress()} isDisabled={disabled} aria-label={label} size="lg" className={cn('shrink-0', className)}>
      {({ isSelected }) => (
        <Switch.Content>
          <Switch.Control className={isSelected ? 'bg-green-500/80' : ''}>
            <Switch.Thumb>
              <Switch.Icon>
                {busy ? (
                  <Loader2 className="size-3 animate-spin text-inherit" />
                ) : isSelected ? (
                  <Check className="size-3 text-inherit opacity-100" />
                ) : (
                  <Power className="size-3 text-inherit opacity-70" />
                )}
              </Switch.Icon>
            </Switch.Thumb>
          </Switch.Control>
        </Switch.Content>
      )}
    </Switch>
  )
}
