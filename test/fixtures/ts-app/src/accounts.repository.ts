import { Injectable } from '@nestjs/common';
@Injectable()
export class AccountsRepository {
  async findByNumber(n: string) { return null; }
  async findOne(id: string) { return null; }
  async save(p: any) { return p; }
}
