import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TenantPrincipal } from '../tenant/tenant-context';

export interface AccessTokenClaims {
  /** traderId */
  sub: string;
  /** tenant key */
  bid: string;
}

/**
 * Single place tokens are minted and verified, so the verification options cannot drift
 * between the REST guard and the WebSocket handshake. Both call `verify()` below.
 */
@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly ttl: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('JWT_SECRET') ?? 'dev-only-not-a-production-secret';
    this.ttl = config.get<string>('JWT_TTL') ?? '1h';
  }

  sign(principal: TenantPrincipal): string {
    const claims: AccessTokenClaims = { sub: principal.traderId, bid: principal.brokerId };
    return this.jwt.sign(claims, {
      secret: this.secret,
      expiresIn: this.ttl,
      algorithm: 'HS256',
    });
  }

  /**
   * `algorithms: ['HS256']` is not boilerplate - it is the fix for the JWT downgrade class
   * of bug. Without it, a verifier will honour whatever the token's own header asks for,
   * and an attacker re-signs with `alg: none` (or swaps HS/RS) and walks in. Pinning the
   * algorithm means the header is not an input to the trust decision.
   */
  verify(token: string): TenantPrincipal {
    let claims: AccessTokenClaims;
    try {
      claims = this.jwt.verify<AccessTokenClaims>(token, {
        secret: this.secret,
        algorithms: ['HS256'],
      });
    } catch {
      // Deliberately opaque: the reason a token failed is not the caller's business, and
      // distinguishing "expired" from "bad signature" is a free oracle for an attacker.
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (typeof claims?.sub !== 'string' || typeof claims?.bid !== 'string') {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return { traderId: claims.sub, brokerId: claims.bid };
  }
}
