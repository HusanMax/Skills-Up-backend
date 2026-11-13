import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('homeworks')
export class Homework {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true }) @Column({ type: Number }) lessonId: number;
  @Column({ type: String }) task: string;
  @Column({ type: 'simple-json' }) steps: string[];
  @Column({ type: Date }) assignedAt: Date;
  @Column({ type: Date }) dueAt: Date;
  @Column({ type: Number }) timeLimitHours: number;
}

@Entity('homework_attachments')
export class HomeworkAttachment {
  @PrimaryColumn({ type: Number }) homeworkId: number;
  @PrimaryColumn({ type: Number }) fileId: number;
}

/** Current state of one student's homework (assigned_at / due_at change when the work is sent back). */
@Entity('student_homework')
export class StudentHomework {
  @PrimaryColumn({ type: Number }) homeworkId: number;
  @PrimaryColumn({ type: Number }) studentId: number;
  @Column({ type: String }) status: string; // HwStatus
  @Column({ type: Date }) assignedAt: Date;
  @Column({ type: Date }) dueAt: Date;
  @Column({ type: Number, nullable: true }) grade: number | null;
  @Column({ type: String, nullable: true }) feedback: string | null;
  @Column({ type: Date, nullable: true }) gradedAt: Date | null;
  @Column({ type: Number, nullable: true }) gradedById: number | null;
}

/** Every handed-in attempt is kept (history). */
@Entity('submissions')
export class Submission {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ type: Number }) homeworkId: number;
  @Index() @Column({ type: Number }) studentId: number;
  @Column({ type: String, default: '' }) text: string;
  @Column({ type: Date }) submittedAt: Date;
  @Column({ type: Boolean, default: false }) isLate: boolean;
}

@Entity('submission_files')
export class SubmissionFile {
  @PrimaryColumn({ type: Number }) submissionId: number;
  @PrimaryColumn({ type: Number }) fileId: number;
}
