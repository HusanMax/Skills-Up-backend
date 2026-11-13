import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Activity, Attendance, Group, Lesson, LessonProgress } from '../entities';
import { conflict, unprocessable } from '../common/errors';
import { RULES } from '../config/rules';
import { FilesService } from '../files/files.service';
import { GroupsService } from '../groups/groups.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RewardsService } from '../rewards/rewards.service';

const URL_RE = /^https?:\/\/\S+$/;

@Injectable()
export class LessonsService {
  constructor(
    private groupsSvc: GroupsService,
    private rewards: RewardsService,
    private files: FilesService,
    private notifications: NotificationsService,
    @InjectRepository(Lesson) private lessons: Repository<Lesson>,
    @InjectRepository(LessonProgress) private progress: Repository<LessonProgress>,
    @InjectRepository(Attendance) private attendance: Repository<Attendance>,
    @InjectRepository(Activity) private activities: Repository<Activity>,
  ) {}

  async byId(id: number) {
    const l = await this.lessons.findOneBy({ id });
    if (!l) throw new NotFoundException('Dars topilmadi.');
    return l;
  }

  /** A lesson that has not started yet (startsAt is in the future). */
  isUpcoming(l: Lesson, now = new Date()) {
    return l.startsAt > now;
  }

  /** The lesson of a teacher's own group (403 for somebody else's). */
  async ownedByTeacher(teacherId: number, lessonId: number): Promise<{ lesson: Lesson; group: Group }> {
    const lesson = await this.byId(lessonId);
    const group = await this.groupsSvc.assertTeaches(teacherId, lesson.groupId);
    return { lesson, group };
  }

  /** The lesson of a group the student belongs to (403 otherwise). */
  async visibleToStudent(studentId: number, lessonId: number) {
    const lesson = await this.byId(lessonId);
    await this.groupsSvc.assertMember(studentId, lesson.groupId);
    return lesson;
  }

  /** "Darsni boshlash": name + group (+ exam flag). The date and time are the server's current time. */
  async start(teacherId: number, input: { groupId: number; title: string; isExam?: boolean }) {
    const group = await this.groupsSvc.assertTeaches(teacherId, input.groupId);
    const lesson = await this.lessons.save(
      this.lessons.create({
        groupId: group.id, title: input.title.trim(), description: '', startsAt: new Date(), durationMin: RULES.DEFAULT_LESSON_MINUTES,
        videoUrl: null, videoFileId: null, isExam: !!input.isExam, attendanceSaved: false, createdById: teacherId,
      }),
    );
    const students = await this.groupsSvc.memberIds(group.id);
    await this.notifications.notifyMany(students, {
      type: 'new_lesson',
      title: `${lesson.isExam ? 'Imtihon' : 'Yangi dars'} boshlandi: ${lesson.title}`,
      link: `/lessons/${lesson.id}`,
    });
    return lesson;
  }

  /** Description, video (a link OR an uploaded file, never both) and length. */
  async updateInfo(teacherId: number, lessonId: number, dto: { description?: string; videoUrl?: string | null; videoFileId?: number | null; durationMin: number }) {
    const { lesson } = await this.ownedByTeacher(teacherId, lessonId);
    const description = (dto.description ?? '').trim();
    if (description && description.length < 10) throw unprocessable("Tavsif kamida 10 ta belgidan iborat bo'lsin (yoki bo'sh qoldiring).", 'description');
    const videoUrl = dto.videoUrl?.trim() || null;
    if (videoUrl && !URL_RE.test(videoUrl)) throw unprocessable('Video havolasi http:// yoki https:// bilan boshlansin.', 'videoUrl');
    if (videoUrl && dto.videoFileId) throw unprocessable("Video havola yoki fayl: bittasini tanlang.", 'videoUrl');
    if (dto.videoFileId) await this.files.assertOwned(teacherId, [dto.videoFileId], 'video');
    if (!Number.isInteger(dto.durationMin) || dto.durationMin < 10 || dto.durationMin > 240) throw unprocessable("Davomiylik 10 dan 240 daqiqagacha bo'lsin.", 'durationMin');
    lesson.description = description;
    lesson.videoUrl = videoUrl;
    lesson.videoFileId = dto.videoFileId ?? null;
    lesson.durationMin = dto.durationMin;
    return this.lessons.save(lesson);
  }

  /** The student's watch progress only ever goes up (docs 6.2). 100% completes the lesson. */
  async setProgress(studentId: number, lessonId: number, percent: number) {
    await this.visibleToStudent(studentId, lessonId);
    const next = Math.min(100, Math.max(0, Math.floor(percent)));
    const cur = await this.progress.findOneBy({ lessonId, studentId });
    const value = Math.max(cur?.percent ?? 0, next);
    const completedNow = value >= 100 && !(cur?.completedAt);
    await this.progress.save(
      this.progress.create({ lessonId, studentId, percent: value, completedAt: completedNow ? new Date() : cur?.completedAt ?? null, updatedAt: new Date() }),
    );
    if (completedNow) {
      const l = await this.byId(lessonId);
      await this.activities.save(this.activities.create({ studentId, type: 'lesson', text: `“${l.title}” darsini tugatdingiz`, xp: RULES.ATTENDANCE_XP }));
    }
    return { progress: value, completed: value >= 100 };
  }

  // ---------- attendance (docs 6.3) ----------

  private async editable(teacherId: number, lessonId: number) {
    const { lesson, group } = await this.ownedByTeacher(teacherId, lessonId);
    if (this.isUpcoming(lesson)) throw conflict("Rejalashtirilgan darsga davomat qo'yib bo'lmaydi.");
    if (lesson.attendanceSaved) throw conflict('Davomat saqlangan. Tahrirlash uchun avval qayta oching.');
    return { lesson, group };
  }

  async mark(teacherId: number, lessonId: number, studentId: number, present: boolean) {
    const { lesson } = await this.editable(teacherId, lessonId);
    await this.groupsSvc.assertMember(studentId, lesson.groupId).catch(() => {
      throw unprocessable("O'quvchi bu guruhda emas.");
    });
    await this.attendance.save(this.attendance.create({ lessonId, studentId, present, markedById: teacherId, markedAt: new Date() }));
  }

  /** "Hammasi qatnashdi": everybody who is not marked present yet becomes present. */
  async markAll(teacherId: number, lessonId: number) {
    const { group } = await this.editable(teacherId, lessonId);
    for (const id of await this.groupsSvc.memberIds(group.id)) {
      await this.attendance.save(this.attendance.create({ lessonId, studentId: id, present: true, markedById: teacherId, markedAt: new Date() }));
    }
  }

  /** Saving closes the marks. Every student's result is written explicitly, also the ones worked out from the video. */
  async save(teacherId: number, lessonId: number) {
    const { lesson, group } = await this.editable(teacherId, lessonId);
    const d = await this.rewards.loadGroup(group);
    for (const id of d.members) {
      if (d.attendance.has(`${lessonId}:${id}`)) continue;
      await this.attendance.save(this.attendance.create({ lessonId, studentId: id, present: this.rewards.attended(d, lessonId, id), markedById: teacherId, markedAt: new Date() }));
    }
    lesson.attendanceSaved = true;
    await this.lessons.save(lesson);
  }

  async reopen(teacherId: number, lessonId: number) {
    const { lesson } = await this.ownedByTeacher(teacherId, lessonId);
    lesson.attendanceSaved = false;
    await this.lessons.save(lesson);
  }

  lessonsOfGroups(groupIds: number[]) {
    return groupIds.length ? this.lessons.find({ where: { groupId: In(groupIds) }, order: { startsAt: 'ASC', id: 'ASC' } }) : Promise.resolve([]);
  }
}
