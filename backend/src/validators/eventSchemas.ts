import { z } from 'zod';
import { EVENT_NAMES, allowedProps, isEventName } from '../analytics/events';

/**
 * A payload is accepted only if its name is in the catalogue and every property is whitelisted for
 * that name. Unknown keys are rejected rather than dropped: a silently ignored field is how a
 * tracker ends up carrying something nobody reviewed.
 */
export const eventBody = z
  .object({
    name: z.string().max(60),
    path: z.string().max(120).optional(),
    props: z
      .record(z.union([z.string().max(60), z.number(), z.boolean()]))
      .refine((p) => Object.keys(p).length <= 8, 'at most 8 properties')
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!isEventName(value.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: `unknown event; expected one of ${EVENT_NAMES.join(', ')}`,
      });
      return;
    }
    const allowed = new Set(allowedProps(value.name));
    for (const key of Object.keys(value.props ?? {})) {
      if (!allowed.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['props', key],
          message: `"${key}" is not recorded for ${value.name}`,
        });
      }
    }
  });
