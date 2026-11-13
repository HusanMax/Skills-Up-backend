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

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ type: Number }) studentId: number;
  @Column({ type: Number }) groupId: number;
  @Column({ type: Number }) amount: number;
  @Column({ type: String }) paidAt: string; // YYYY-MM-DD
  @Column({ type: String }) method: string;
  @Column({ type: String }) description: string;
}
