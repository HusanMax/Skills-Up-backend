import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { addHours } from '../common/dates';
import { HwStatus, hwApi } from '../common/enums';
import { conflict, unprocessable } from '../common/errors';
import { RULES } from '../config/rules';
import { Homework, HomeworkAttachment, Lesson, StudentHomework, Submission, SubmissionFile } from '../entities';
import { FilesService } from '../files/files.service';
import { GroupsService } from '../groups/groups.service';
import { LessonsService } from '../lessons/lessons.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class HomeworkService {
  constructor(
    private ds: DataSource,
    private groupsSvc: GroupsService,
    private lessonsSvc: LessonsService,
    private files: FilesService,
    private notifications: NotificationsService,
    @InjectRepository(Homework) private homeworks: Repository<Homework>,
    @InjectRepository(HomeworkAttachment) private attachments: Repository<HomeworkAttachment>,
    @InjectRepository(StudentHomework) private shRepo: Repository<StudentHomework>,
    @InjectRepository(Submission) private submissions: Repository<Submission>,
    @InjectRepository(SubmissionFile) private submissionFiles: Repository<SubmissionFile>,
  ) {}

  homeworkOf(lessonId: number) {
    return this.homeworks.findOneBy({ lessonId });
  }

  async attachmentsOf(homeworkId: number) {
    const rows = await this.attachments.findBy({ homeworkId });
    return this.files.infoOf(rows.map((r) => r.fileId));
  }

  // ---------- teacher gives or updates the task (docs 6.4) ----------

  async assign(teacherId: number, lessonId: number, dto: { task: string; steps: string[]; limitHours: number; attachmentIds?: number[] }) {
    const { lesson } = await this.lessonsSvc.ownedByTeacher(teacherId, lessonId);
    const task = dto.task.trim();
    const steps = dto.steps.map((s) => s.trim()).filter(Boolean);
    if (task.length < 10) throw unprocessable("Vazifa tavsifi kamida 10 ta belgidan iborat bo'lsin.", 'task');
    if (!steps.length) throw unprocessable("Kamida bitta qadam yozing: vazifa qanday bajarilishini ko'rsating.", 'steps');
    if (!(RULES.HOMEWORK_LIMITS as readonly number[]).includes(dto.limitHours)) throw unprocessable("Topshirish muddati: 1, 3, 24, 72 yoki 168 soat.", 'limitHours');
    const attachmentIds = [...new Set(dto.attachmentIds ?? [])];
    await this.files.assertOwned(teacherId, attachmentIds, 'task');

    const now = new Date();
    const dueAt = addHours(now, dto.limitHours);
    const members = await this.groupsSvc.memberIds(lesson.groupId);
    const existing = await this.homeworkOf(lessonId);
    const hw = await this.ds.transaction(async (em) => {
      const row = existing ?? em.create(Homework, { lessonId });
      Object.assign(row, { task, steps, assignedAt: now, dueAt, timeLimitHours: dto.limitHours });
      const saved = await em.save(Homework, row);
      await em.delete(HomeworkAttachment, { homeworkId: saved.id });
      for (const fileId of attachmentIds) await em.save(HomeworkAttachment, em.create(HomeworkAttachment, { homeworkId: saved.id, fileId }));
      // Updating only affects students who have not handed anything in; handed-in / returned / graded work keeps its own state.
      for (const studentId of members) {
        const sh = await em.findOneBy(StudentHomework, { homeworkId: saved.id, studentId });
        if (!sh) {
          await em.save(StudentHomework, em.create(StudentHomework, { homeworkId: saved.id, studentId, status: HwStatus.NOT_DONE, assignedAt: now, dueAt, grade: null, feedback: null, gradedAt: null, gradedById: null }));
        } else if (sh.status === HwStatus.NOT_DONE) {
          sh.assignedAt = now;
          sh.dueAt = dueAt;
          await em.save(StudentHomework, sh);
        }
      }
      return saved;
    });
    if (!existing) await this.notifications.notifyMany(members, { type: 'new_homework', title: `Yangi uyga vazifa: ${lesson.title}`, link: `/lessons/${lessonId}` });
    return { id: hw.id, task, steps, assignedAt: now.toISOString(), dueAt: dueAt.toISOString(), timeLimitHours: dto.limitHours, attachments: await this.attachmentsOf(hw.id) };
  }

  // ---------- student hands in work ----------

  async submit(studentId: number, lessonId: number, dto: { text?: string; fileIds?: number[] }) {
    const lesson = await this.lessonsSvc.visibleToStudent(studentId, lessonId);
    const hw = await this.homeworkOf(lessonId);
    if (!hw) throw conflict('Bu dars uchun uyga vazifa berilmagan.');
    const sh = await this.shRepo.findOneBy({ homeworkId: hw.id, studentId });
    if (!sh || (sh.status !== HwStatus.NOT_DONE && sh.status !== HwStatus.RETURNED)) throw conflict('Vazifa allaqachon topshirilgan.');
    const text = (dto.text ?? '').trim();
    const fileIds = [...new Set(dto.fileIds ?? [])];
    if (!text && !fileIds.length) throw unprocessable('Javob yozing yoki kamida bitta fayl biriktiring.', 'text');
    if (text.length > 2000) throw unprocessable("Javob matni 2000 belgidan oshmasin.", 'text');
    await this.files.assertOwned(studentId, fileIds, 'answer');
    const now = new Date();
    // handed in after the deadline (even by a minute) is late: the ball loses LATE_PENALTY when counted
    const isLate = now > sh.dueAt;
    const sub = await this.ds.transaction(async (em) => {
      const s = await em.save(Submission, em.create(Submission, { homeworkId: hw.id, studentId, text, submittedAt: now, isLate }));
      for (const fileId of fileIds) await em.save(SubmissionFile, em.create(SubmissionFile, { submissionId: s.id, fileId }));
      sh.status = HwStatus.PENDING;
      await em.save(StudentHomework, sh);
      return s;
    });
    return { id: sub.id, text, files: await this.files.infoOf(fileIds), submittedAt: now.toISOString(), late: isLate, lesson: lesson.title };
  }

  async lastSubmission(homeworkId: number, studentId: number) {
    const sub = await this.submissions.findOne({ where: { homeworkId, studentId }, order: { submittedAt: 'DESC', id: 'DESC' } });
    if (!sub) return null;
    const files = await this.submissionFiles.findBy({ submissionId: sub.id });
    return { text: sub.text, files: await this.files.infoOf(files.map((f) => f.fileId)), submittedAt: sub.submittedAt.toISOString(), late: sub.isLate };
  }

  // ---------- teacher reviews ----------

  private async shFor(teacherId: number, lessonId: number, studentId: number) {
    const { lesson } = await this.lessonsSvc.ownedByTeacher(teacherId, lessonId);
    const hw = await this.homeworkOf(lessonId);
    const sh = hw ? await this.shRepo.findOneBy({ homeworkId: hw.id, studentId }) : null;
    if (!hw || !sh) throw new NotFoundException("Bu o'quvchi uchun vazifa topilmadi.");
    return { lesson, hw, sh };
  }

  /** Submission of one student plus the current state (what the teacher sees in the review window). */
  async reviewView(teacherId: number, lessonId: number, studentId: number) {
    const { hw, sh } = await this.shFor(teacherId, lessonId, studentId);
    return { status: hwApi(sh.status as HwStatus), grade: sh.grade, feedback: sh.feedback, dueAt: sh.dueAt.toISOString(), submission: await this.lastSubmission(hw.id, studentId) };
  }

  /** The ball is a whole number from 1 to 100. Only work that was handed in can be graded. */
  async grade(teacherId: number, lessonId: number, studentId: number, ball: number) {
    const { lesson, hw, sh } = await this.shFor(teacherId, lessonId, studentId);
    if (!Number.isInteger(ball) || ball < RULES.MIN_BALL || ball > RULES.MAX_BALL) throw unprocessable(`Ball ${RULES.MIN_BALL}–${RULES.MAX_BALL} orasida butun son bo'lsin.`, 'ball');
    if (!(await this.lastSubmission(hw.id, studentId)) || sh.status === HwStatus.RETURNED) throw conflict("O'quvchi hali ish topshirmagan (yoki qayta topshirishi kutilyapti).");
    sh.status = HwStatus.DONE;
    sh.grade = ball;
    sh.feedback = null;
    sh.gradedAt = new Date();
    sh.gradedById = teacherId;
    await this.shRepo.save(sh);
    await this.notifications.notifyMany([studentId], { type: 'homework_graded', title: `“${lesson.title}” vazifangiz baholandi: ${ball} ball`, link: `/lessons/${lessonId}` });
  }

  /** Sends the work back with a comment; the student gets a new time limit (+24 hours). */
  async returnWork(teacherId: number, lessonId: number, studentId: number, feedback: string) {
    const { lesson, hw, sh } = await this.shFor(teacherId, lessonId, studentId);
    if (!feedback.trim()) throw unprocessable('Izoh yozing: nimani tuzatish kerakligini ayting.', 'feedback');
    if (!(await this.lastSubmission(hw.id, studentId))) throw conflict("O'quvchi hali ish topshirmagan.");
    const now = new Date();
    sh.status = HwStatus.RETURNED;
    sh.feedback = feedback.trim();
    sh.grade = null;
    sh.assignedAt = now;
    sh.dueAt = addHours(now, RULES.RETURN_EXTENSION_HOURS);
    await this.shRepo.save(sh);
    await this.notifications.notifyMany([studentId], { type: 'homework_returned', title: `“${lesson.title}” vazifangiz qaytarildi: izohni o'qing`, link: `/lessons/${lessonId}` });
  }

  /** All homework rows of the given lessons for the given students (bulk reading for lists). */
  rowsFor(homeworkIds: number[]) {
    return homeworkIds.length ? this.shRepo.findBy({ homeworkId: In(homeworkIds) }) : Promise.resolve([]);
  }
}

export type { Lesson };
