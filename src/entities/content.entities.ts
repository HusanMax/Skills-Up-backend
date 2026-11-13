import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('career_videos')
export class CareerVideo {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: String }) title: string;
  @Column({ type: String }) topic: string;
  @Column({ type: Number }) durationMin: number;
  @Column({ type: String }) description: string;
  @Column({ type: String, nullable: true }) videoUrl: string | null;
}

@Entity('guides')
export class Guide {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: String }) title: string;
  @Column({ type: String }) category: string;
  @Column({ type: Number }) readMin: number;
  @Column({ type: String }) summary: string;
  @Column({ type: String }) body: string;
}

@Entity('faqs')
export class Faq {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: String }) question: string;
  @Column({ type: String }) answer: string;
}

/** "Recent activity" on the student dashboard. */
@Entity('activities')
export class Activity {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ type: Number }) studentId: number;
  @Column({ type: String }) type: string; // lesson | badge | rank | payment | group
  @Column({ type: String }) text: string;
  @Column({ type: Number, nullable: true }) xp: number | null;
  @CreateDateColumn() at: Date;
}
