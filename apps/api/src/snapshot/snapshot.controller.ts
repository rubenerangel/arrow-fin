import { Controller, Get, Inject } from '@nestjs/common';
import { SNAPSHOT_QUERY, SnapshotQuery } from './application/ports';
import { SnapshotDto } from './application/snapshot.dto';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { TenantPrincipal } from '../common/tenant/tenant-context';

@Controller('api')
export class SnapshotController {
  // Depends on the input port, not on SnapshotService. The controller's job is to turn an
  // HTTP request into a use-case call and back again; it has no business knowing that the
  // answer comes from Prisma, or from three queries, or from a cache.
  constructor(@Inject(SNAPSHOT_QUERY) private readonly snapshots: SnapshotQuery) {}

  /**
   * GET /api/snapshot
   *
   * Look at what this route does NOT have: a :traderId, a :accountId, a ?traderId=. The
   * subject is the bearer of the token, so "read someone else's snapshot" is not a request
   * that can be constructed against this API - there is nowhere to put the other id.
   *
   * That is a deliberate contrast with the PR under review in CODE_REVIEW.md, which takes
   * `@Param('accountId')` and trusts it. An ownership check on a path param would also
   * work, but it has to be remembered on every route; this shape cannot be forgotten.
   *
   * No logging of the response. The payload is a trader's financial position, and the last
   * place it should end up is a log aggregator with a different retention and access model.
   */
  @Get('snapshot')
  async snapshot(@CurrentUser() principal: TenantPrincipal): Promise<SnapshotDto> {
    return this.snapshots.forTrader(principal.traderId);
  }
}
