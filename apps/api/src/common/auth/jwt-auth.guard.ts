import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from './token.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TenantContext, TenantPrincipal } from '../tenant/tenant-context';

/**
 * Registered globally via APP_GUARD, so authentication is the default and `@Public()` is
 * the exception. This ordering matters more than it looks: a new endpoint written by
 * someone who has never read this file is protected by default.
 *
 * Besides authenticating, this is where the tenant principal is bound to the request's
 * async context, which is what makes the Prisma extension able to enforce isolation
 * without every repository having to pass a brokerId around.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { principal?: TenantPrincipal }>();
    const principal = this.tokens.verify(bearerFrom(request));

    request.principal = principal;
    TenantContext.enter(principal);
    return true;
  }
}

function bearerFrom(request: Request): string {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    throw new UnauthorizedException('Missing bearer token');
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedException('Missing bearer token');
  }
  return token;
}
