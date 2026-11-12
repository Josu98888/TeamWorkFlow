import { Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../http/decorators/public.decorator';
import { BillingService } from '../billing.service';

@Controller('webhooks')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Post('mercadopago')
  async handleMercadoPago(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: Request,
  ): Promise<{ ok: boolean }> {
    const rawBody = (req as any).rawBody ?? req.body;
    return this.billing.webhookMercadopago(headers, rawBody);
  }
}
