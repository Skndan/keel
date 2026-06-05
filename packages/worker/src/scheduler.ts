/**
 * Simple cron parser and scheduler.
 * Supports standard 5-field cron expressions: minute hour day month weekday.
 *
 * Fields:
 *   minute  (0-59)
 *   hour    (0-23)
 *   day     (1-31)
 *   month   (1-12)
 *   weekday (0-6, 0=Sunday)
 *
 * Special characters: * (any), , (list), - (range), / (step)
 */

export interface CronSchedule {
  expression: string;
  nextRun: Date;
}

interface CronField {
  values: Set<number>;
}

/**
 * Parse a cron expression string into its component fields.
 */
export function parseCron(expression: string): CronField[] {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: "${expression}". Expected 5 fields.`,
    );
  }

  return parts.map((part, index) => parseField(part, index));
}

/**
 * Parse a single cron field.
 */
function parseField(field: string, index: number): CronField {
  const ranges: Record<number, [number, number]> = {
    0: [0, 59], // minute
    1: [0, 23], // hour
    2: [1, 31], // day
    3: [1, 12], // month
    4: [0, 6],  // weekday
  };

  const [min, max] = ranges[index];
  const values = new Set<number>();

  if (field === '*') {
    for (let i = min; i <= max; i++) values.add(i);
    return { values };
  }

  // Split by comma for lists
  const segments = field.split(',');
  for (const segment of segments) {
    // Check for step (e.g., */5 or 1-30/5)
    const stepMatch = segment.match(/^(.+)\/(\d+)$/);
    let step = 1;
    let range = segment;

    if (stepMatch) {
      range = stepMatch[1];
      step = parseInt(stepMatch[2], 10);
    }

    // Check for range (e.g., 1-5)
    if (range.includes('-')) {
      const [start, end] = range.split('-').map(Number);
      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) values.add(i);
      }
    } else if (range === '*') {
      for (let i = min; i <= max; i += step) values.add(i);
    } else {
      const val = parseInt(range, 10);
      if (!isNaN(val) && val >= min && val <= max) {
        values.add(val);
      }
    }
  }

  return { values };
}

/**
 * Calculate the next run time for a cron expression from a given date.
 */
export function nextRun(
  expression: string,
  from: Date = new Date(),
): Date {
  const fields = parseCron(expression);
  const next = new Date(from);
  next.setSeconds(0, 0); // clear seconds and milliseconds
  next.setMinutes(next.getMinutes() + 1); // start from next minute

  // Maximum iterations to prevent infinite loops
  const MAX_ITERATIONS = 366 * 24 * 60; // 1 year of minutes
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const minute = next.getMinutes();
    const hour = next.getHours();
    const day = next.getDate();
    const month = next.getMonth() + 1; // 1-indexed
    const weekday = next.getDay();

    if (
      fields[4].values.has(weekday) &&
      fields[3].values.has(month) &&
      fields[2].values.has(day) &&
      fields[1].values.has(hour) &&
      fields[0].values.has(minute)
    ) {
      return next;
    }

    // Advance by one minute
    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error(
    `Could not find next run for cron expression: "${expression}"`,
  );
}

/**
 * Check if a cron expression should run at the current time.
 */
export function shouldRun(
  expression: string,
  now: Date = new Date(),
): boolean {
  const fields = parseCron(expression);
  const minute = now.getMinutes();
  const hour = now.getHours();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const weekday = now.getDay();

  return (
    fields[4].values.has(weekday) &&
    fields[3].values.has(month) &&
    fields[2].values.has(day) &&
    fields[1].values.has(hour) &&
    fields[0].values.has(minute)
  );
}

/**
 * Get the next scheduled run after the given time.
 * Returns null if the cron never fires.
 */
export function getNextScheduledRun(
  expression: string,
  from: Date = new Date(),
): Date | null {
  try {
    return nextRun(expression, from);
  } catch {
    return null;
  }
}

/**
 * Valid cron expressions for testing.
 */
export const VALID_CRONS: Record<string, { description: string; expr: string }> = {
  everyMinute: { description: 'Every minute', expr: '* * * * *' },
  every5Minutes: { description: 'Every 5 minutes', expr: '*/5 * * * *' },
  everyHour: { description: 'Every hour', expr: '0 * * * *' },
  everyDay: { description: 'Every day at midnight', expr: '0 0 * * *' },
  everyMonday: { description: 'Every Monday at 9 AM', expr: '0 9 * * 1' },
  weekdays9to5: { description: 'Weekdays 9-5 every hour', expr: '0 9-17 * * 1-5' },
};
