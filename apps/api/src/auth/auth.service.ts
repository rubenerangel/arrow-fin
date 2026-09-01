import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TokenService } from '../common/auth/token.service';
import { TenantContext } from '../common/tenant/tenant-context';

export interface LoginResult {
  readonly accessToken: string;
  readonly expiresIn: number;
  /** Enough for the UI to greet someone. Deliberately not the full trader record. */
  readonly trader: { readonly id: string; readonly displayName: string; readonly brokerId: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Email-only login against the seeded traders. There is no password in the dataset and
   * inventing a hash column would have been theatre; this is a stub and the README says so.
   *
   * What is NOT a stub, and would survive into a real implementation:
   *  - brokerId is read from the trader row on the server and signed into the token. The
   *    client never states which tenant it belongs to, so it cannot claim a different one.
   *  - the response is the same shape and timing for unknown email, suspended KYC and
   *    success, so this endpoint is not a tenant membership or account enumeration oracle.
   */
  async login(email: string): Promise<LoginResult> {
    // Genuinely pre-tenant: we are resolving which tenant the caller belongs to, so there
    // is no principal to scope by yet. Named and bounded to this single lookup.
    //
    // The `await` has to happen INSIDE the callback. Prisma promises are lazy - they run
    // when something subscribes - so returning one and awaiting it outside would execute
    // the query after the async context has already unwound, and the extension would
    // (correctly) refuse it. Failing that way round is the right kind of bug to have.
    const trader = await TenantContext.runAsSystem(
      'login: resolve tenant from credentials',
      async () =>
        this.prisma.db.trader.findUnique({
          where: { email: email.toLowerCase().trim() },
          select: { id: true, brokerId: true, firstName: true, lastName: true, kycStatus: true },
        }),
    );

    if (!trader || trader.kycStatus === 'suspended') {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      accessToken: this.tokens.sign({ traderId: trader.id, brokerId: trader.brokerId }),
      expiresIn: this.tokens.ttlSeconds,
      trader: {
        id: trader.id,
        displayName: `${trader.firstName} ${trader.lastName.charAt(0)}.`,
        brokerId: trader.brokerId,
      },
    };
  }
}
