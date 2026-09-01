import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'arrowfin:isPublic';

/**
 * Opt a route OUT of authentication. The guard is registered globally (APP_GUARD), so the
 * default for every new route anyone adds is "authenticated". Forgetting the decorator
 * makes a route unreachable, not open - the safe direction to fail.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
