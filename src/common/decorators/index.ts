import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '../enums';

export const IS_PUBLIC = 'isPublic';
/** Skips the session-token guard (only the login endpoint uses it). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
/** Only these roles may call the endpoint (checked by RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: number;
  role: Role;
  /** the session this request belongs to (used by logout and "keep me signed in here" after a password change) */
  sessionId: number;
}

/** The signed-in user taken from the token. Student endpoints always use THIS id, never one from the URL. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
