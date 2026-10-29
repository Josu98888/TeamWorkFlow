import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { envs } from '../config';
import { NatsClientService } from '../nats/nats-client.service';
import type { SiteSummary } from './dto';

function extractToken(client: Socket): string | null {
  const authHeader = client.handshake.headers?.authorization;
  if (
    authHeader &&
    typeof authHeader === 'string' &&
    authHeader.startsWith('Bearer ')
  ) {
    return authHeader.slice(7).trim();
  }

  const authToken = client.handshake.auth?.token;
  if (authToken && typeof authToken === 'string') {
    return authToken.trim();
  }

  const cookieHeader = client.handshake.headers?.cookie;
  if (cookieHeader && typeof cookieHeader === 'string') {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith('access_token=')) {
        return decodeURIComponent(c.slice('access_token='.length));
      }
    }
  }

  return null;
}

@WebSocketGateway({
  path: '/ws',
  cors: {
    origin: envs.webOrigin,
    credentials: true,
  },
})
export class TowerGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TowerGateway.name);

  @WebSocketServer()
  server?: Server;

  constructor(private readonly natsClient: NatsClientService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = extractToken(client);
    if (!token) {
      this.logger.debug(
        `WS connection rejected for client ${client.id}: missing token`,
      );
      client.disconnect(true);
      return;
    }

    try {
      const actor = await this.natsClient.verifyToken(token);

      // Only supervisors, admins, and owners can access the Control Tower
      const allowedRoles = ['supervisor', 'admin', 'owner'];
      if (!allowedRoles.includes(actor.role)) {
        this.logger.debug(
          `WS connection rejected for user ${actor.userId}: role ${actor.role} not allowed in tower`,
        );
        client.disconnect(true);
        return;
      }

      // Pro plan feature gating for Control Tower
      if (!actor.features?.tower) {
        this.logger.debug(
          `WS connection rejected for user ${actor.userId}: plan lacks tower feature`,
        );
        client.disconnect(true);
        return;
      }

      // Check tenant suspension
      if (
        actor.tenantStatus === 'suspended' ||
        actor.tenantStatus === 'cancelled'
      ) {
        this.logger.debug(
          `WS connection rejected for user ${actor.userId}: tenant is ${actor.tenantStatus}`,
        );
        client.disconnect(true);
        return;
      }

      client.data.actor = actor;

      // Join multitenant rooms based on actor authorization
      if (actor.role === 'supervisor') {
        for (const siteId of actor.siteIds) {
          const room = `${actor.tenantId}:${siteId}`;
          await client.join(room);
        }
      } else {
        // Admin or owner joins the global tenant room
        const tenantRoom = `${actor.tenantId}:all`;
        await client.join(tenantRoom);
      }

      // Schedule disconnection upon token expiration
      if (actor.exp) {
        const expiresInMs = actor.exp * 1000 - Date.now();
        if (expiresInMs > 0) {
          const timer = setTimeout(() => {
            this.logger.debug(
              `Disconnecting WS client ${client.id}: JWT expired`,
            );
            client.disconnect(true);
          }, expiresInMs);
          client.data.expiryTimer = timer;
        } else {
          client.disconnect(true);
          return;
        }
      }

      this.logger.debug(
        `WS client ${client.id} connected for user ${actor.userId} (tenant: ${actor.tenantId})`,
      );
    } catch (err) {
      this.logger.warn(
        `WS connection verification failed for client ${client.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    if (client.data?.expiryTimer) {
      clearTimeout(client.data.expiryTimer);
    }
    this.logger.debug(`WS client ${client.id} disconnected`);
  }

  /**
   * Broadcasts real-time site summary update to authorized socket rooms.
   */
  broadcastSiteSummary(
    tenantId: string,
    siteId: string,
    summary: SiteSummary,
  ): void {
    if (!this.server) return;
    const siteRoom = `${tenantId}:${siteId}`;
    const allRoom = `${tenantId}:all`;
    this.server.to(siteRoom).to(allRoom).emit('site_summary_updated', summary);
  }
}
