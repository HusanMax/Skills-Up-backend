import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('lessons')
export class Lesson {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ type: Number }) groupId: number;
  @Column({ type: String }) title: string;
  @Column({ type: String, default: '' }) description: string;
  @Column({ type: Date }) startsAt: Date;
  @Column({ type: Number, default: 45 }) durationMin: number;
  @Column({ type: String, nullable: true }) videoUrl: string | null;
  @Column({ type: Number, nullable: true }) videoFileId: number | null;
  @Column({ type: Boolean, default: false }) isExam: boolean;
  @Column({ type: Boolean, default: false }) attendanceSaved: boolean;
  @Column({ type: Number }) createdById: number;
  @CreateDateColumn() createdAt: Date;
}

/** How much of the video a student watched (only ever grows). */
@Entity('lesson_progress')
export class LessonProgress {
  @PrimaryColumn({ type: Number }) lessonId: number;
  @PrimaryColumn({ type: Number }) studentId: number;
  @Column({ type: Number, default: 0 }) percent: number;
  @Column({ type: Date, nullable: true }) completedAt: Date | null;
  @Column({ type: Date }) updatedAt: Date;
}

/** The teacher's attendance mark; it wins over "finished the video". */
@Entity('attendance')
export class Attendance {
  @PrimaryColumn({ type: Number }) lessonId: number;
  @PrimaryColumn({ type: Number }) studentId: number;
  @Column({ type: Boolean }) present: boolean;
  @Column({ type: Number }) markedById: number;
  @Column({ type: Date }) markedAt: Date;
}

@Entity('exam_results')
export class ExamResult {
  @PrimaryColumn({ type: Number }) lessonId: number; // the exam lesson
  @PrimaryColumn({ type: Number }) studentId: number;
  @Column({ type: Number }) ball: number;
  @Column({ type: Number }) enteredById: number;
  @Column({ type: Date }) enteredAt: Date;
}
