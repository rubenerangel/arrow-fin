import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { TenantPrincipal } from '../tenant/tenant-context';

/**
 * The ONLY sanctioned way a handler learns who is calling. Note what it is not: a
 * `@Param('traderId')`. Identity comes from a signed claim, so "fetch someone else's
 * snapshot" is not a request an attacker can construct.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantPrincipal => {
    const request = ctx.switchToHttp().getRequest<{ principal?: TenantPrincipal }>();
    if (!request.principal) {
      throw new Error('CurrentUser used on a route that is not behind JwtAuthGuard');
    }
    return request.principal;
  },
);
