import { UnprocessableEntityException, ValidationError, ValidationPipe } from '@nestjs/common';

function collect(errors: ValidationError[], prefix = '', out: Record<string, string> = {}) {
  for (const e of errors) {
    const key = prefix ? `${prefix}.${e.property}` : e.property;
    if (e.constraints) out[key] = Object.values(e.constraints)[0]!;
    if (e.children?.length) collect(e.children, key, out);
  }
  return out;
}

/** Global pipe: strips unknown fields and answers 422 with a field -> message map. */
export const appValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const fields = collect(errors);
      return new UnprocessableEntityException({ code: 'VALIDATION_ERROR', message: Object.values(fields)[0] ?? "Ma'lumotlar noto'g'ri.", fields });
    },
  });
