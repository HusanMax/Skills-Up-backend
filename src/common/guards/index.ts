import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionsService } from '../../auth/sessions.service';
import { AuthUser, IS_PUBLIC, ROLES_KEY } from '../decorators';
import { Role } from '../enums';

/**
 * Checks the session token (`Authorization: Bearer <token>`) on every request except the ones marked @Public().
 * 401 when it is missing, unknown or expired. On success `request.user` = { id, role, sessionId }.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private sessions: SessionsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    const user = scheme === 'Bearer' && token ? await this.sessions.authenticate(token) : null;
    if (!user) throw new UnauthorizedException('Tizimga qayta kiring.');
    req.user = user;
    return true;
  }
}

/** 403 when the user's role is not listed in @Roles(...). Endpoints without @Roles are open to every signed-in user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException("Bu amal uchun ruxsatingiz yo'q.");
    return true;
  }
}
