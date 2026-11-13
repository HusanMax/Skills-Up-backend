import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

/** 409: the request is fine but clashes with the current state (room busy, attendance saved, no admission...). */
export const conflict = (message: string) => new ConflictException({ code: 'CONFLICT', message });

/** 422: a value is not acceptable. `field` (optional) names the form field. */
export const unprocessable = (message: string, field?: string) =>
  new UnprocessableEntityException({ code: 'VALIDATION_ERROR', message, ...(field ? { fields: { [field]: message } } : {}) });
