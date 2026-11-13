import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true }) @Column({ type: String }) name: string;
  @Column({ type: Number }) capacity: number;
}

@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: String }) name: string;
  @Column({ type: String }) course: string;
  @Index() @Column({ type: Number }) teacherId: number;
  @Column({ type: Boolean, default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}

/** One weekly session of a group. roomId = null means an online session (no room is taken). */
@Entity('group_schedule')
@Index(['roomId', 'day', 'startTime'], { unique: true })
export class GroupSchedule {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ type: Number }) groupId: number;
  @Column({ type: String }) day: string; // Day
  @Column({ type: String }) startTime: string; // HH:MM
  @Column({ type: String }) endTime: string;
  @Column({ type: Number, nullable: true }) roomId: number | null;
}

@Entity('group_members')
export class GroupMember {
  @PrimaryColumn({ type: Number }) groupId: number;
  @PrimaryColumn({ type: Number }) studentId: number;
  @CreateDateColumn() joinedAt: Date;
}

@Entity('payment_plans')
export class PaymentPlan {
  @PrimaryColumn({ type: Number }) groupId: number;
  @Column({ type: Number }) amount: number; // so'm
  @Column({ type: String }) dueDate: string; // YYYY-MM-DD
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('payment_notices')
export class PaymentNotice {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ type: Number }) groupId: number;
  @Column({ type: Number }) amount: number;
  @Column({ type: String }) dueDate: string;
  @CreateDateColumn() sentAt: Date;
  @Column({ type: Number }) sentById: number;
  @Column({ type: Number }) recipients: number;
}

/**
 * A "sale": what one student owes for one group and period (e.g. November). Payments are made against it, so its
 * status is worked out from them: PAID, UNPAID or PARTIALLY_PAID.
 */
@Entity('invoices')
@Index(['studentId', 'groupId', 'period'], { unique: true })
export class Invoice {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ type: Number }) studentId: number;
  @Index() @Column({ type: Number }) groupId: number;
  @Column({ type: String }) period: string; // YYYY-MM
  @Index() @Column({ type: String }) issuedAt: string; // YYYY-MM-DD, the sale date
  @Column({ type: String }) dueDate: string; // YYYY-MM-DD
  @Column({ type: Number }) amount: number; // so'm, the total owed
  @CreateDateColumn() createdAt: Date;
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn() id: number;
  /** the invoice this money pays for */
  @Index() @Column({ type: Number, nullable: true }) invoiceId: number | null;
  @Index() @Column({ type: Number }) studentId: number;
  @Column({ type: Number }) groupId: number;
  @Column({ type: Number }) amount: number;
  @Column({ type: String }) paidAt: string; // YYYY-MM-DD
  @Column({ type: String }) method: string;
  @Column({ type: String }) description: string;
}
