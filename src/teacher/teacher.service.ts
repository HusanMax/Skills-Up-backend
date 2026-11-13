import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { iso } from '../common/dates';
import { HwStatus, hwApi } from '../common/enums';
import { Group, Lesson, Submission } from '../entities';
import { ExamsService } from '../exams/exams.service';
import { GroupsService } from '../groups/groups.service';
import { HomeworkService } from '../homework/homework.service';
import { LessonsService } from '../lessons/lessons.service';
import { GroupData, RewardsService } from '../rewards/rewards.service';

const avg = (nums: number[]) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);

/** Everything the teacher panel reads. Every method first checks that the group/lesson belongs to the teacher. */
@Injectable()
export class TeacherService {
  constructor(
    private groupsSvc: GroupsService,
    private rewards: RewardsService,
    private exams: ExamsService,
    private lessonsSvc: LessonsService,
    private homeworkSvc: HomeworkService,
    @InjectRepository(Group) private groups: Repository<Group>,
    @InjectRepository(Submission) private submissions: Repository<Submission>,
  ) {}

  private myGroups(teacherId: number) {
    return this.groups.find({ where: { teacherId, isActive: true }, order: { id: 'ASC' } });
  }

  private async load(teacherId: number, groupId: number) {
    const group = await this.groupsSvc.assertTeaches(teacherId, groupId);
    return this.rewards.loadGroup(group);
  }

  /** Counts of one lesson: attendance and homework states of every student. */
  private summary(d: GroupData, l: Lesson) {
    const s = { students: d.members.length, attended: 0, handedIn: 0, pending: 0, done: 0, returned: 0, notDone: 0 };
    for (const id of d.members) {
      if (this.rewards.attended(d, l.id, id)) s.attended++;
      const sh = this.rewards.shOf(d, l.id, id);
      if (!sh) continue;
      if (sh.status === HwStatus.PENDING) s.pending++;
      if (sh.status === HwStatus.DONE) s.done++;
      if (sh.status === HwStatus.RETURNED) s.returned++;
      if (sh.status === HwStatus.NOT_DONE) s.notDone++;
    }
    s.handedIn = s.pending + s.done + s.returned;
    return s;
  }

  async groupList(teacherId: number) {
    const groups = await this.myGroups(teacherId);
    const described = await this.groupsSvc.describe(groups);
    const out = [];
    for (const g of groups) {
      const d = await this.rewards.loadGroup(g);
      const waiting = d.lessons.reduce((n, l) => n + this.summary(d, l).pending, 0);
      out.push({ ...described.find((x) => x.id === g.id)!, waitingCount: waiting });
    }
    return out;
  }

  async dashboard(teacherId: number) {
    const groups = await this.groupList(teacherId);
    const upcoming: { lessonId: number; title: string; groupName: string; startsAt: string; isExam: boolean }[] = [];
    for (const g of await this.myGroups(teacherId)) {
      for (const l of await this.lessonsSvc.lessonsOfGroups([g.id])) if (this.lessonsSvc.isUpcoming(l)) upcoming.push({ lessonId: l.id, title: l.title, groupName: g.name, startsAt: l.startsAt.toISOString(), isExam: l.isExam });
    }
    return {
      groups,
      waitingReview: groups.reduce((n, g) => n + g.waitingCount, 0),
      upcomingLessons: upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 8),
      stats: { groups: groups.length, students: groups.reduce((n, g) => n + g.members, 0) },
    };
  }

  /** Ranking and per-student numbers of one group (docs 7.6). */
  async groupStudents(teacherId: number, groupId: number) {
    const d = await this.load(teacherId, groupId);
    const board = await this.rewards.ranking(d);
    const held = d.lessons.filter((l) => !this.lessonsSvc.isUpcoming(l));
    return board.map((e) => {
      let attended = 0;
      let assigned = 0;
      let done = 0;
      let pending = 0;
      const balls: number[] = [];
      for (const l of d.lessons) {
        const r = this.rewards.lessonReward(d, l, e.studentId);
        if (!this.lessonsSvc.isUpcoming(l) && r.attended) attended++;
        const sh = this.rewards.shOf(d, l.id, e.studentId);
        if (sh) assigned++;
        if (sh?.status === HwStatus.DONE) done++;
        if (sh?.status === HwStatus.PENDING) pending++;
        if (r.ball !== null) balls.push(r.ball);
      }
      return { rank: e.rank, studentId: e.studentId, name: e.name, xp: e.xp, gems: e.gems, avgBall: avg(balls), held: held.length, attended, assigned, done, pending };
    });
  }

  async groupLessons(teacherId: number, groupId: number, q: { order?: string; q?: string }) {
    const d = await this.load(teacherId, groupId);
    const exams = this.exams.examsOf(d);
    const needle = (q.q ?? '').trim().toLowerCase();
    let lessons = d.lessons.filter((l) => !needle || l.title.toLowerCase().includes(needle)).map((l) => {
      const hw = d.homework.get(l.id);
      return {
        id: l.id, title: l.title, startsAt: iso(l.startsAt), isExam: l.isExam, upcoming: this.lessonsSvc.isUpcoming(l), attendanceSaved: l.attendanceSaved,
        summary: this.summary(d, l),
        homework: hw ? { given: true, dueAt: hw.dueAt.toISOString(), timeLimitHours: hw.timeLimitHours } : { given: false },
      };
    });
    const held = lessons.filter((l) => !l.upcoming).sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
    const upcoming = lessons.filter((l) => l.upcoming).sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
    lessons = [...((q.order ?? 'newest') === 'oldest' ? held : held.reverse()), ...upcoming];
    return {
      lessons,
      exams: exams.map((e) => {
        const states = d.members.map((id) => this.exams.stateOf(d, e, id).state);
        return { id: e.lessonId, number: e.number, title: e.title, date: iso(e.startsAt), admitted: states.filter((s) => s !== 'blocked').length, total: states.length, graded: states.filter((s) => s === 'done').length };
      }),
      sinceLastExam: this.exams.sinceLastExam(d),
    };
  }

  /** The lesson management page: video, homework, attendance and every student's homework state. */
  async lessonDetail(teacherId: number, lessonId: number) {
    const { lesson, group } = await this.lessonsSvc.ownedByTeacher(teacherId, lessonId);
    const d = await this.rewards.loadGroup(group);
    const hw = d.homework.get(lessonId);
    const names = await this.rewards.names(d.members);
    const students = [];
    for (const id of d.members) {
      const sh = this.rewards.shOf(d, lessonId, id);
      const r = this.rewards.lessonReward(d, lesson, id);
      const sub = hw && sh && sh.status !== HwStatus.NOT_DONE ? await this.homeworkSvc.lastSubmission(hw.id, id) : null;
      students.push({
        studentId: id,
        name: names.get(id) ?? '',
        attended: r.attended,
        homework: { status: hwApi(sh?.status as HwStatus | undefined), submittedAt: sub?.submittedAt ?? null, late: sub?.late ?? false, ball: r.ball, rawBall: r.rawBall },
        canReview: !!sub,
      });
    }
    return {
      lesson: { id: lesson.id, title: lesson.title, description: lesson.description, startsAt: iso(lesson.startsAt), durationMin: lesson.durationMin, isExam: lesson.isExam, upcoming: this.lessonsSvc.isUpcoming(lesson), groupId: group.id, groupName: group.name },
      video: { url: lesson.videoUrl, fileId: lesson.videoFileId },
      homework: hw ? { task: hw.task, steps: hw.steps, assignedAt: hw.assignedAt.toISOString(), dueAt: hw.dueAt.toISOString(), timeLimitHours: hw.timeLimitHours, attachments: await this.homeworkSvc.attachmentsOf(hw.id) } : null,
      attendanceSaved: lesson.attendanceSaved,
      students,
      sameGroupLessons: d.lessons.map((l) => ({ id: l.id, title: l.title, startsAt: iso(l.startsAt), isExam: l.isExam, pending: this.summary(d, l).pending, homeworkGiven: d.homework.has(l.id) })),
    };
  }

  /** Work waiting for review (status PENDING) across the teacher's groups, optionally one group. */
  async review(teacherId: number, groupId?: number) {
    const groups = groupId ? [await this.groupsSvc.assertTeaches(teacherId, groupId)] : await this.myGroups(teacherId);
    const out = [];
    for (const g of groups) {
      const d = await this.rewards.loadGroup(g);
      const names = await this.rewards.names(d.members);
      for (const l of d.lessons) {
        const hw = d.homework.get(l.id);
        if (!hw) continue;
        for (const id of d.members) {
          const sh = this.rewards.shOf(d, l.id, id);
          if (sh?.status !== HwStatus.PENDING) continue;
          const sub = await this.homeworkSvc.lastSubmission(hw.id, id);
          out.push({ groupId: g.id, groupName: g.name, lessonId: l.id, lessonTitle: l.title, studentId: id, studentName: names.get(id) ?? '', submittedAt: sub?.submittedAt ?? null, late: sub?.late ?? false });
        }
      }
    }
    return out.sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  }

  /** Attendance journal: students x lessons, an exam column after every exam lesson (docs 7.7). */
  async journal(teacherId: number, groupId: number) {
    const d = await this.load(teacherId, groupId);
    const exams = this.exams.examsOf(d);
    const names = await this.rewards.names(d.members);
    const columns: unknown[] = [];
    d.lessons.forEach((l, i) => {
      columns.push({ kind: 'lesson', lessonId: l.id, index: i + 1, title: l.title, startsAt: iso(l.startsAt), isExam: l.isExam, attendanceSaved: l.attendanceSaved });
      const ex = exams.find((e) => e.lessonId === l.id);
      if (ex) columns.push({ kind: 'exam', examId: ex.lessonId, number: ex.number, date: iso(ex.startsAt) });
    });
    const rows = d.members.map((id) => {
      const cells: Record<number, 'present' | 'absent' | 'upcoming'> = {};
      let held = 0;
      let attended = 0;
      for (const l of d.lessons) {
        if (this.lessonsSvc.isUpcoming(l)) {
          cells[l.id] = 'upcoming';
          continue;
        }
        held++;
        const a = this.rewards.attended(d, l.id, id);
        if (a) attended++;
        cells[l.id] = a ? 'present' : 'absent';
      }
      return {
        studentId: id,
        name: names.get(id) ?? '',
        lessonCells: cells,
        examCells: Object.fromEntries(exams.map((e) => [e.lessonId, this.exams.stateOf(d, e, id)])),
        held,
        attended,
        percent: held ? Math.round((attended / held) * 100) : 0,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { columns, rows };
  }

  /** The window where the teacher enters exam balls. */
  async examDetail(teacherId: number, examLessonId: number) {
    const { lesson, group } = await this.lessonsSvc.ownedByTeacher(teacherId, examLessonId);
    const d = await this.rewards.loadGroup(group);
    const exam = this.exams.examsOf(d).find((e) => e.lessonId === lesson.id);
    if (!exam) return { exam: null, students: [] };
    const names = await this.rewards.names(d.members);
    return {
      exam: { id: exam.lessonId, number: exam.number, title: exam.title, date: iso(exam.startsAt), coveredLessons: exam.lessonIds.map((id) => ({ id, title: d.lessons.find((l) => l.id === id)?.title ?? '' })) },
      students: d.members.map((id) => ({ studentId: id, name: names.get(id) ?? '', ...this.exams.stateOf(d, exam, id) })),
    };
  }

  /** Used by the controller to load the group data for exam ball entry. */
  async dataFor(lessonId: number, teacherId: number) {
    const { lesson, group } = await this.lessonsSvc.ownedByTeacher(teacherId, lessonId);
    return { lesson, d: await this.rewards.loadGroup(group) };
  }
}

