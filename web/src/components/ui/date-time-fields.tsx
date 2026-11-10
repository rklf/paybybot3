import { Calendar, DateField, DatePicker, Label, TimeField } from '@heroui/react'
import { parseDate, parseTime } from '@internationalized/date'
import { I18nProvider } from 'react-aria-components'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'

// HeroUI's date and time fields (React Aria), in French and on 24 hours. They keep the plain strings the app already
// uses (« 20:00 », « 2026-11-14 ») so nothing else changes.

const field = 'w-full'
const group = 'h-14 rounded-xl bg-white px-4 text-lg text-ink'

/** An hour and minutes, « HH:MM ». */
export function TimeInput({ value, onChange, label, className }: { value: string; onChange: (value: string) => void; label: string; className?: string }) {
  return (
    <I18nProvider locale="fr-FR">
      <TimeField
        aria-label={label}
        hourCycle={24}
        value={value ? parseTime(value) : null}
        onChange={(t) => t && onChange(`${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`)}
        className={cn(field, className)}
      >
        <TimeField.Group className={group}>
          <TimeField.Input>{(segment) => <TimeField.Segment segment={segment} />}</TimeField.Input>
        </TimeField.Group>
      </TimeField>
    </I18nProvider>
  )
}

/** A day, « YYYY-MM-DD », typed or picked in a calendar; `min` is the first day allowed. */
export function DateInput({
  value,
  onChange,
  label,
  min,
  disabled,
  className,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  min?: string
  disabled?: boolean
  className?: string
}) {
  // One object per `min`: React Aria memoizes the calendar on its identity.
  const minValue = useMemo(() => (min ? parseDate(min) : undefined), [min])
  return (
    <I18nProvider locale="fr-FR">
      <DatePicker
        aria-label={label}
        value={value ? parseDate(value) : null}
        minValue={minValue}
        isDisabled={disabled}
        onChange={(d) => d && onChange(d.toString())}
        className={cn(field, className)}
      >
        <Label className="sr-only">{label}</Label>
        <DateField.Group fullWidth className={group}>
          <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
          <DateField.Suffix>
            <DatePicker.Trigger aria-label={`${label} : ouvrir le calendrier`}>
              <DatePicker.TriggerIndicator />
            </DatePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <DatePicker.Popover>
          {/* HeroUI's Calendar sets its own minimum (1900) over the picker's: given again here. */}
          <Calendar aria-label={label} minValue={minValue}>
            <Calendar.Header>
              <Calendar.YearPickerTrigger>
                <Calendar.YearPickerTriggerHeading />
                <Calendar.YearPickerTriggerIndicator />
              </Calendar.YearPickerTrigger>
              <Calendar.NavButton slot="previous" />
              <Calendar.NavButton slot="next" />
            </Calendar.Header>
            <Calendar.Grid>
              <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
              <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
            </Calendar.Grid>
            <Calendar.YearPickerGrid>
              <Calendar.YearPickerGridBody>{({ year }) => <Calendar.YearPickerCell year={year} />}</Calendar.YearPickerGridBody>
            </Calendar.YearPickerGrid>
          </Calendar>
        </DatePicker.Popover>
      </DatePicker>
    </I18nProvider>
  )
}
