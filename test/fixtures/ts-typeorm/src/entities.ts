import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('varchar', { length: 200 })
  name: string;

  @OneToMany(() => Order, (o) => o.customer)
  orders: Order[];
}

@Entity({ name: 'orders' })
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'total_amount', nullable: false })
  total: number;

  @ManyToOne(() => Customer, (c) => c.orders)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;
}
