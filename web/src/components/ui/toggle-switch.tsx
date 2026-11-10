import { Switch } from '@heroui/react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** PayByBot's on/off switch: HeroUI's Switch, in the app's teal. It never flips by itself: `checked` says its state and
 *  a press calls onPress (which opens a window, asks to confirm…), the parent then sets `checked`. */
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
      {/* Switch.Content is the pressable part (React Aria's SwitchButton): the control goes inside it. */}
      <Switch.Content>
        <Switch.Control className="[--switch-control-bg-checked-hover:#458e94] [--switch-control-bg-checked:#4e9aa0] [--switch-control-bg:rgb(17_17_17_/0.15)]">
          <Switch.Thumb>{busy && <Loader2 className="m-auto size-3 animate-spin text-ink/50" />}</Switch.Thumb>
        </Switch.Control>
      </Switch.Content>
    </Switch>
  )
}
