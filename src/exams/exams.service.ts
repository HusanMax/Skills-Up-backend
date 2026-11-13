import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HwStatus } from '../common/enums';
import { conflict, unprocessable } from '../common/errors';
import { RULES } from '../config/rules';
import { ExamResult, Lesson } from '../entities';
import { NotificationsService } from '../notifications/notifications.service';
import { GroupData, RewardsService, ballToGems, ballToXp, key } from '../rewards/rewards.service';

export interface ExamInfo {
  lessonId: number; // an exam IS a lesson the teacher marked as an exam
  number: number;
  title: string;
  startsAt: Date;
  lessonIds: number[]; // the regular lessons since the previous exam
}

export type ExamState =
  | { state: 'done'; ball: number; xp: number; gems: number }
  | { state: 'ready' }
  | { state: 'blocked'; missing: { lessonId: number; title: string }[] };

@Injectable()
export class ExamsService {
  constructor(
    private rewards: RewardsService,
    private notifications: NotificationsService,
    @InjectRepository(ExamResult) private results: Repository<ExamResult>,
  ) {}

  /**
   * Exams of a group: every lesson marked as an exam. An exam covers the regular lessons held since the previous exam
   * (docs 6.6, 7.5). There is no fixed "every 13 lessons" rule.
   */
  examsOf(d: GroupData): ExamInfo[] {
    const out: ExamInfo[] = [];
    let block: number[] = [];
    for (const l of d.lessons) {
      if (l.isExam) {
        out.push({ lessonId: l.id, number: out.length + 1, title: l.title, startsAt: l.startsAt, lessonIds: block });
        block = [];
      } else block.push(l.id);
    }
    return out;
  }

  /** Regular lessons held since the last exam. */
  sinceLastExam(d: GroupData) {
    const last = d.lessons.map((l) => l.isExam).lastIndexOf(true);
    return d.lessons.length - last - 1;
  }

  /**
   * done = ball entered, ready = may sit the exam, blocked = homework missing.
   * Missing = homework was given, the student has not handed it in AND its deadline has passed.
   */
  stateOf(d: GroupData, exam: ExamInfo, studentId: number, now = new Date()): ExamState {
    const ball = d.exam.get(key(exam.lessonId, studentId));
    if (ball !== undefined) return { state: 'done', ball, xp: ballToXp(ball), gems: ballToGems(ball) };
    const missing = exam.lessonIds.filter((id) => {
      const sh = this.rewards.shOf(d, id, studentId);
      return sh?.status === HwStatus.NOT_DONE && sh.dueAt < now;
    });
    if (!missing.length) return { state: 'ready' };
    return { state: 'blocked', missing: missing.map((id) => ({ lessonId: id, title: d.lessons.find((l) => l.id === id)?.title ?? '' })) };
  }

  /** The teacher enters an exam ball. A student who has no admission cannot get one (409). */
  async setBall(teacherId: number, lesson: Lesson, d: GroupData, studentId: number, ball: number) {
    const exam = this.examsOf(d).find((e) => e.lessonId === lesson.id);
    if (!exam) throw conflict('Bu dars imtihon emas.');
    if (!d.members.includes(studentId)) throw unprocessable("O'quvchi bu guruhda emas.");
    if (!Number.isInteger(ball) || ball < RULES.MIN_BALL || ball > RULES.MAX_BALL) throw unprocessable(`Ball ${RULES.MIN_BALL}–${RULES.MAX_BALL} orasida butun son bo'lsin.`, 'ball');
    const st = this.stateOf(d, exam, studentId);
    if (st.state === 'blocked') throw conflict("Ruxsat yo'q: o'quvchi imtihonga kirish uchun oldingi vazifalarni topshirmagan.");
    await this.results.save(this.results.create({ lessonId: lesson.id, studentId, ball, enteredById: teacherId, enteredAt: new Date() }));
    await this.notifications.notifyMany([studentId], { type: 'exam_graded', title: `${exam.number}-imtihon bali: ${ball}`, link: '/lessons' });
  }
}
