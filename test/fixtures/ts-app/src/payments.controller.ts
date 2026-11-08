import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentDto } from './payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(@Body() dto: PaymentDto) {
    return this.paymentsService.process(dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Payment> {
    return this.paymentsService.find(id);
  }
}
