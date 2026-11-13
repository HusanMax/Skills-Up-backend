import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { iso } from '../common/dates';
import { HwStatus, hwApi } from '../common/enums';
import { Activity, Group, Lesson, User } from '../entities';
import { ExamsService } from '../exams/exams.service';
import { GroupsService } from '../groups/groups.service';
import { HomeworkService } from '../homework/homework.service';
import { LessonsService } from '../lessons/lessons.service';
import { GroupData, RewardsService, key, levelFor } from '../rewards/rewards.service';
import { Role } from '../common/enums';

const avg = (nums: number[]) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);

/** Everything the student panel reads (the student is always the signed-in user). */
@Injectable()
export class StudentService {
  constructor(
    private groupsSvc: GroupsService,
    private rewards: RewardsService,
    private exams: ExamsService,
    private lessonsSvc: LessonsService,
    private homeworkSvc: HomeworkService,
    @InjectRepository(Group) private groups: Repository<Group>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Activity) private activities: Repository<Activity>,
  ) {}

  private async myGroups(studentId: number) {
    const ids = await this.groupsSvc.groupIdsOfStudent(studentId);
    return ids.length ? this.groups.find({ where: { id: In(ids), isActive: true }, order: { id: 'ASC' } }) : [];
  }

  /** The student's row for a lesson: status, progress, own marks, homework summary and reward. */
  private lessonRow(d: GroupData, l: Lesson, studentId: number) {
    const r = this.rewards.lessonReward(d, l, studentId);
    const sh = this.rewards.shOf(d, l.id, studentId);
    const progress = d.progress.get(key(l.id, studentId)) ?? 0;
    const mark = d.attendance.get(key(l.id, studentId));
    return {
      id: l.id,
      title: l.title,
      startsAt: iso(l.startsAt),
      durationMin: l.durationMin,
      status: progress >= 100 ? 'completed' : 'in-progress',
      progress,
      isExam: l.isExam,
      upcoming: this.lessonsSvc.isUpcoming(l),
      attendance: mark === undefined ? null : mark ? 'present' : 'absent',
      homework: {
        status: hwApi(sh?.status as HwStatus | undefined),
        dueAt: sh ? sh.dueAt.toISOString() : null,
        ball: r.ball,
        rawBall: r.rawBall,
        late: r.late,
      },
      reward: r,
    };
  }

  async dashboard(studentId: number) {
    const groups = await this.myGroups(studentId);
    let xp = 0;
    let gems = 0;
    const groupRanks: { groupId: number; groupName: string; rank: number; size: number }[] = [];
    const upcoming: { type: string; title: string; at: string }[] = [];
    for (const g of groups) {
      const d = await this.rewards.loadGroup(g);
      const t = this.rewards.totalsIn(d, studentId);
      xp += t.xp;
      gems += t.gems;
      const board = await this.rewards.ranking(d);
      groupRanks.push({ groupId: g.id, groupName: g.name, rank: board.find((e) => e.studentId === studentId)?.rank ?? board.length, size: board.length });
      for (const l of d.lessons) if (this.lessonsSvc.isUpcoming(l)) upcoming.push({ type: l.isExam ? 'exam' : 'lesson', title: l.title, at: l.startsAt.toISOString() });
      for (const l of d.lessons) {
        const sh = this.rewards.shOf(d, l.id, studentId);
        if (sh && (sh.status === HwStatus.NOT_DONE || sh.status === HwStatus.RETURNED) && sh.dueAt > new Date()) upcoming.push({ type: 'deadline', title: `${l.title}: vazifa muddati`, at: sh.dueAt.toISOString() });
      }
    }
    const everyone = await this.rewards.allStudentTotals();
    const total = await this.users.countBy({ role: Role.STUDENT });
    const ranked = [...everyone.entries()].sort((a, b) => b[1].xp - a[1].xp || a[0] - b[0]).map(([id]) => id);
    const rankIndex = ranked.indexOf(studentId);
    const activities = await this.activities.find({ where: { studentId }, order: { at: 'DESC', id: 'DESC' }, take: 8 });
    return {
      xp, gems, ...levelFor(xp),
      streak: await this.rewards.streak(studentId),
      overallRank: rankIndex === -1 ? total : rankIndex + 1,
      totalStudents: total,
      groupRanks,
      activities: activities.map((a) => ({ id: a.id, type: a.type, text: a.text, xp: a.xp, at: a.at.toISOString() })),
      upcoming: upcoming.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 10),
    };
  }

  async groupList(studentId: number) {
    const described = await this.groupsSvc.describe(await this.myGroups(studentId));
    return described.map((g) => ({ ...g, nextSession: this.groupsSvc.nextSession(g.schedule) }));
  }

  async groupLessons(studentId: number, groupId: number, q: { order?: string; status?: string; homework?: string; q?: string }) {
    await this.groupsSvc.assertMember(studentId, groupId);
    const group = await this.groupsSvc.byId(groupId);
    const d = await this.rewards.loadGroup(group);
    const rows = d.lessons.map((l) => this.lessonRow(d, l, studentId));
    const held = rows.filter((r) => !r.upcoming);
    const exams = this.exams.examsOf(d).map((e) => ({
      id: e.lessonId, number: e.number, title: e.title, date: iso(e.startsAt), ...this.exams.stateOf(d, e, studentId),
    }));
    const needle = (q.q ?? '').trim().toLowerCase();
    let list = rows.filter(
      (r) => (!q.status || q.status === 'all' || r.status === q.status) && (!q.homework || q.homework === 'all' || r.homework.status === q.homework) && (!needle || r.title.toLowerCase().includes(needle)),
    );
    // held lessons first (newest or oldest first), lessons that have not been held yet always last
    const heldList = list.filter((r) => !r.upcoming).sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
    const upcomingList = list.filter((r) => r.upcoming).sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
    list = [...((q.order ?? 'newest') === 'oldest' ? heldList : heldList.reverse()), ...upcomingList];
    return {
      group: { id: group.id, name: group.name },
      stats: {
        progress: avg(rows.map((r) => r.progress)) ?? 0,
        avgBall: avg(rows.map((r) => r.homework.ball).filter((b): b is number => b !== null)),
        graded: rows.filter((r) => r.homework.ball !== null).length,
        attended: held.filter((r) => r.reward.attended).length,
        held: held.length,
        sinceLastExam: this.exams.sinceLastExam(d),
      },
      exams,
      lessons: list.map(({ reward: _reward, ...r }) => r),
    };
  }

  async lessonDetail(studentId: number, lessonId: number) {
    const lesson = await this.lessonsSvc.visibleToStudent(studentId, lessonId);
    const group = await this.groupsSvc.byId(lesson.groupId);
    const d = await this.rewards.loadGroup(group);
    const row = this.lessonRow(d, lesson, studentId);
    const hw = d.homework.get(lessonId);
    const sh = this.rewards.shOf(d, lessonId, studentId);
    return {
      lesson: { id: lesson.id, title: lesson.title, description: lesson.description, startsAt: iso(lesson.startsAt), durationMin: lesson.durationMin, isExam: lesson.isExam, groupId: group.id, groupName: group.name },
      video: { url: lesson.videoUrl, fileId: lesson.videoFileId },
      progress: row.progress,
      reward: row.reward,
      homework: hw && sh
        ? {
            status: hwApi(sh.status as HwStatus),
            task: hw.task,
            steps: hw.steps,
            attachments: await this.homeworkSvc.attachmentsOf(hw.id),
            assignedAt: sh.assignedAt.toISOString(),
            dueAt: sh.dueAt.toISOString(),
            timeLimitHours: hw.timeLimitHours,
            feedback: sh.status === HwStatus.RETURNED ? sh.feedback : null,
            submission: await this.homeworkSvc.lastSubmission(hw.id, studentId),
          }
        : { status: 'not-assigned' },
      otherLessons: d.lessons.map((l) => {
        const r = this.lessonRow(d, l, studentId);
        return { id: l.id, title: l.title, startsAt: r.startsAt, status: r.status, progress: r.progress, isExam: l.isExam, homeworkStatus: r.homework.status, current: l.id === lessonId };
      }),
    };
  }

  /** Ranking inside one group: XP earned in this group only. `delta` needs weekly snapshots (not stored yet), so it is 0. */
  async leaderboard(studentId: number, groupId: number) {
    await this.groupsSvc.assertMember(studentId, groupId);
    const d = await this.rewards.loadGroup(await this.groupsSvc.byId(groupId));
    return (await this.rewards.ranking(d)).map((e) => ({ rank: e.rank, studentId: e.studentId, name: e.name, xp: e.xp, delta: 0, isMe: e.studentId === studentId }));
  }

  async analytics(studentId: number) {
    const groups = await this.myGroups(studentId);
    let lessonsTotal = 0;
    let completed = 0;
    let minutes = 0;
    const balls: number[] = [];
    const xpByWeek = new Map<string, number>();
    const weekLabel = (date: Date) => {
      const monday = new Date(date);
      monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      return `${String(monday.getDate()).padStart(2, '0')}.${String(monday.getMonth() + 1).padStart(2, '0')}`;
    };
    for (const g of groups) {
      const d = await this.rewards.loadGroup(g);
      for (const l of d.lessons) {
        if (this.lessonsSvc.isUpcoming(l)) continue;
        lessonsTotal++;
        const p = d.progress.get(key(l.id, studentId)) ?? 0;
        if (p >= 100) completed++;
        minutes += (l.durationMin * p) / 100;
        const r = this.rewards.lessonReward(d, l, studentId);
        if (r.ball !== null) balls.push(r.ball);
        xpByWeek.set(weekLabel(l.startsAt), (xpByWeek.get(weekLabel(l.startsAt)) ?? 0) + r.xp); // by the week the lesson was held
      }
    }
    return {
      weeklyHours: [] as { label: string; value: number }[], // needs per-day watch logs (open question in the docs)
      xpByWeek: [...xpByWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([label, value]) => ({ label, value })),
      skills: [] as { name: string; value: number }[], // needs lesson topics/tags (open question in the docs)
      completionRate: lessonsTotal ? Math.round((completed / lessonsTotal) * 100) : 0,
      totalHours: Math.round((minutes / 60) * 10) / 10,
      lessonsCompleted: completed,
      avgScore: avg(balls) ?? 0,
    };
  }

  /** Lessons, exams and homework deadlines of one month (month = YYYY-MM). */
  async calendar(studentId: number, month: string) {
    const events: { id: string; date: string; time: string; title: string; type: string }[] = [];
    for (const g of await this.myGroups(studentId)) {
      const d = await this.rewards.loadGroup(g);
      for (const l of d.lessons) {
        const at = l.startsAt;
        const pad = (n: number) => String(n).padStart(2, '0');
        events.push({ id: `l${l.id}`, date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}`, title: l.title, type: l.isExam ? 'exam' : 'lesson' });
        const sh = this.rewards.shOf(d, l.id, studentId);
        if (sh && (sh.status === HwStatus.NOT_DONE || sh.status === HwStatus.RETURNED)) {
          const due = sh.dueAt;
          events.push({ id: `d${l.id}`, date: `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`, time: `${pad(due.getHours())}:${pad(due.getMinutes())}`, title: `${l.title}: vazifa muddati`, type: 'deadline' });
        }
      }
    }
    return events.filter((e) => !month || e.date.startsWith(month)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }
}

