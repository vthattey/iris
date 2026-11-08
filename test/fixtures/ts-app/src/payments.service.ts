import { Injectable } from '@nestjs/common';
import { AccountsRepository } from './accounts.repository';
import { PaymentDto } from './payment.dto';

export interface Payment { id: string; amount: number; }

export abstract class BaseService {
  protected log(msg: string): void {}
}

@Injectable()
export class PaymentsService extends BaseService implements Auditable {
  private retries = 3;
  constructor(private accounts: AccountsRepository) { super(); }

  async process(dto: PaymentDto): Promise<Payment> {
    const account = await this.accounts.findByNumber(dto.accountNumber);
    this.validate(dto);
    this.log('processed');
    return this.accounts.save({ id: '1', amount: dto.amount });
  }

  find(id: string): Promise<Payment> { return this.accounts.findOne(id); }

  private validate(dto: PaymentDto): void {}
}

export enum PaymentStatus { Pending = 'PENDING', Settled = 'SETTLED' }
export interface Auditable { audit?(): void; }
