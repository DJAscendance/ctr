import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat';
dayjs.extend(advancedFormat);

/**
 * Formats a date for display. Was a Vue 2 template filter; Vue 3 has no filters, so the
 * three templates that used it call it as a method now.
 */
export function dateFormatFilter(value: string): string {
  if (value) {
    return dayjs(String(value)).format('dddd, MMMM Do YYYY')
  }
};
