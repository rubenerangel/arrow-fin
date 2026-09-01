import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TokenService } from '../common/auth/token.service';
import { TenantContext, TenantPrincipal } from '../common/tenant/tenant-context';
import { SnapshotService } from '../snapshot/application/snapshot.service';
import { SnapshotDto } from '../snapshot/application/snapshot.dto';

/** What a client is told about a fill. Compare against the Fill model - most of it is gone. */
export interface FillEventDto {
  readonly seq: number;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantity: number;
  readonly price: number;
  readonly filledAt: string;
}

interface AuthenticatedSocket extends Socket {
  principal?: TenantPrincipal;
}

@WebSocketGateway({
  namespace: '/rt',
  cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true },
})
export class FillsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Server;

  private readonly logger = new Logger(FillsGateway.name);

  /**
   * Monotonic per trader stream. The client keeps the last seq it saw; a gap after a
   * reconnect tells it that it missed fills and must refetch rather than trust what is on
   * screen. See the reconnect section of the README - the detection is implemented, the
   * server-side replay buffer is not.
   */
  private readonly sequences = new Map<string, number>();

  constructor(
    private readonly tokens: TokenService,
    private readonly snapshots: SnapshotService,
  ) {}

  /**
   * Authentication happens HERE, at connection time, and not per message.
   *
   * The socket is placed into rooms derived from verified claims. There is no `subscribe`
   * event in this gateway, by design: a client cannot ask for a stream, so it cannot ask
   * for someone else's. Room membership is a server decision made once, from a signed
   * token, before a single byte is emitted. A fill delivered to the wrong tenant is the
   * worst outcome in this exercise, and the way to make it impossible is to remove the
   * client's ability to influence routing at all.
   */
  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    let principal: TenantPrincipal;
    try {
      principal = this.tokens.verify(tokenFrom(client));
    } catch {
      // Disconnect before joining any room and before emitting anything. An unauthenticated
      // socket never reaches a state where a broadcast could find it.
      client.emit('unauthorized', { message: 'Invalid or missing token' });
      client.disconnect(true);
      return;
    }

    client.principal = principal;
    await client.join(roomFor(principal.traderId));

    // Deliberately logging ids only - no email, no name, no token, not even the raw
    // handshake object. Ids are the minimum needed to debug a routing problem.
    this.logger.log(`socket connected trader=${principal.traderId} broker=${principal.brokerId}`);

    client.emit('connected', {
      traderId: principal.traderId,
      seq: this.sequences.get(principal.traderId) ?? 0,
    });
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    if (client.principal) {
      this.logger.log(`socket disconnected trader=${client.principal.traderId}`);
    }
  }

  /**
   * Push a fill and the recomputed snapshot to one trader.
   *
   * The recomputation runs inside TenantContext.run for that principal, so the same
   * isolation that protects the REST path protects the socket path - there is not a second,
   * weaker set of rules for real-time.
   *
   * Note what crosses the wire: symbol, side, qty, price, time, and the same DTO the REST
   * endpoint already returns. No trader record, no account number, no balance delta.
   */
  async publishFill(
    principal: TenantPrincipal,
    fill: Omit<FillEventDto, 'seq'>,
  ): Promise<{ seq: number; snapshot: SnapshotDto }> {
    const seq = (this.sequences.get(principal.traderId) ?? 0) + 1;
    this.sequences.set(principal.traderId, seq);

    const snapshot = await TenantContext.run(principal, () =>
      this.snapshots.forTrader(principal.traderId),
    );

    this.server.to(roomFor(principal.traderId)).emit('fill', { ...fill, seq } satisfies FillEventDto);
    this.server.to(roomFor(principal.traderId)).emit('snapshot', { seq, snapshot });

    return { seq, snapshot };
  }
}

function roomFor(traderId: string): string {
  return `trader:${traderId}`;
}

/**
 * Token from the Socket.IO handshake `auth` payload, with the Authorization header as a
 * fallback. Not from the query string: query strings land in access logs, proxy logs and
 * browser history, and a bearer token in a log file is a credential at rest.
 */
function tokenFrom(client: Socket): string {
  const fromAuth = (client.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7);
  }
  return '';
}
