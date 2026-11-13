import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { dateStr } from '../common/dates';
import { HwStatus } from '../common/enums';
import { RULES } from '../config/rules';
import { Attendance, ExamResult, Group, GroupMember, Homework, Lesson, LessonProgress, StudentHomework, Submission, User } from '../entities';

const k = (lessonId: number, studentId: number) => `${lessonId}:${studentId}`;
export const key = k;

/** Everything needed to work out rewards, ranking, journal and admission of ONE group. */
export interface GroupData {
  group: Group;
  lessons: Lesson[]; // oldest first
  members: number[];
  attendance: Map<string, boolean>;
  progress: Map<string, number>;
  homework: Map<number, Homework>; // by lesson id
  sh: Map<string, StudentHomework>; // by homeworkId:studentId  (see shOf)
  late: Map<string, boolean>; // latest submission was late, by homeworkId:studentId
  exam: Map<string, number>; // ball by examLessonId:studentId
}

export interface LessonReward {
  attended: boolean;
  attendanceXp: number;
  attendanceGems: number;
  ball: number | null; // counted ball (after the late penalty)
  rawBall: number | null; // the teacher's ball
  late: boolean;
  penalty: number;
  ballXp: number;
  ballGems: number;
  xp: number;
  gems: number;
}

export const ballToXp = (ball: number) => ball * RULES.XP_PER_BALL;
export const ballToGems = (ball: number) => Math.round(ball / RULES.BALL_PER_GEM);

/** XP level: every 250 XP is one level (docs 7.3). */
export function levelFor(xp: number) {
  const level = Math.floor(xp / RULES.XP_PER_LEVEL) + 1;
  const start = (level - 1) * RULES.XP_PER_LEVEL;
  const next = level * RULES.XP_PER_LEVEL;
  return { level, start, next, percent: Math.round(((xp - start) / RULES.XP_PER_LEVEL) * 100), remaining: next - xp };
}

@Injectable()
export class RewardsService {
  constructor(
    @InjectRepository(Group) private groups: Repository<Group>,
    @InjectRepository(GroupMember) private members: Repository<GroupMember>,
    @InjectRepository(Lesson) private lessons: Repository<Lesson>,
    @InjectRepository(LessonProgress) private progress: Repository<LessonProgress>,
    @InjectRepository(Attendance) private attendance: Repository<Attendance>,
    @InjectRepository(Homework) private homeworks: Repository<Homework>,
    @InjectRepository(StudentHomework) private shRepo: Repository<StudentHomework>,
    @InjectRepository(Submission) private submissions: Repository<Submission>,
    @InjectRepository(ExamResult) private examResults: Repository<ExamResult>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  /** Loads the lessons, members, marks, homework and exam balls of one group in a few queries. */
  async loadGroup(group: Group): Promise<GroupData> {
    const lessons = await this.lessons.find({ where: { groupId: group.id }, order: { startsAt: 'ASC', id: 'ASC' } });
    const lessonIds = lessons.map((l) => l.id);
    const members = (await this.members.findBy({ groupId: group.id })).map((m) => m.studentId);
    const data: GroupData = { group, lessons, members, attendance: new Map(), progress: new Map(), homework: new Map(), sh: new Map(), late: new Map(), exam: new Map() };
    if (!lessonIds.length) return data;
    const [att, prog, hws, exams] = await Promise.all([
      this.attendance.findBy({ lessonId: In(lessonIds) }),
      this.progress.findBy({ lessonId: In(lessonIds) }),
      this.homeworks.findBy({ lessonId: In(lessonIds) }),
      this.examResults.findBy({ lessonId: In(lessonIds) }),
    ]);
    att.forEach((a) => data.attendance.set(k(a.lessonId, a.studentId), a.present));
    prog.forEach((p) => data.progress.set(k(p.lessonId, p.studentId), p.percent));
    hws.forEach((h) => data.homework.set(h.lessonId, h));
    exams.forEach((e) => data.exam.set(k(e.lessonId, e.studentId), e.ball));
    if (hws.length) {
      const hwIds = hws.map((h) => h.id);
      const [shs, subs] = await Promise.all([
        this.shRepo.findBy({ homeworkId: In(hwIds) }),
        this.submissions.find({ where: { homeworkId: In(hwIds) }, order: { submittedAt: 'ASC', id: 'ASC' } }),
      ]);
      shs.forEach((s) => data.sh.set(k(s.homeworkId, s.studentId), s));
      subs.forEach((s) => data.late.set(k(s.homeworkId, s.studentId), s.isLate)); // the last one wins
    }
    return data;
  }

  /** The student's StudentHomework row for a lesson, if homework was given. */
  shOf(d: GroupData, lessonId: number, studentId: number) {
    const h = d.homework.get(lessonId);
    return h ? d.sh.get(k(h.id, studentId)) : undefined;
  }

  /** Did the student attend? The teacher's mark wins; without one, finishing the video counts (docs 6.3). */
  attended(d: GroupData, lessonId: number, studentId: number) {
    const mark = d.attendance.get(k(lessonId, studentId));
    return mark !== undefined ? mark : (d.progress.get(k(lessonId, studentId)) ?? 0) >= 100;
  }

  /** XP and kumush of one lesson for one student (docs 7.1, 6.5). */
  lessonReward(d: GroupData, lesson: Lesson, studentId: number): LessonReward {
    const attended = this.attended(d, lesson.id, studentId);
    const sh = this.shOf(d, lesson.id, studentId);
    const hw = d.homework.get(lesson.id);
    const raw = sh && sh.status === HwStatus.DONE && sh.grade !== null ? sh.grade : null;
    const late = !!(hw && d.late.get(k(hw.id, studentId)));
    const ball = raw === null ? null : late ? Math.max(RULES.MIN_BALL, raw - RULES.LATE_PENALTY) : raw;
    // the 10 balls of attendance are converted like every other ball: 1 ball = 1 XP, 2 balls = 1 kumush
    const attendanceXp = attended ? ballToXp(RULES.ATTENDANCE_BALL) : 0;
    const attendanceGems = attended ? ballToGems(RULES.ATTENDANCE_BALL) : 0;
    const ballXp = ball === null ? 0 : ballToXp(ball);
    const ballGems = ball === null ? 0 : ballToGems(ball);
    return {
      attended, attendanceXp, attendanceGems, ball, rawBall: raw, late: raw !== null && late,
      penalty: raw !== null && ball !== null ? raw - ball : 0,
      ballXp, ballGems, xp: attendanceXp + ballXp, gems: attendanceGems + ballGems,
    };
  }

  /** XP and kumush a student earned in this group: lessons plus exams. */
  totalsIn(d: GroupData, studentId: number) {
    let xp = 0;
    let gems = 0;
    for (const l of d.lessons) {
      const r = this.lessonReward(d, l, studentId);
      xp += r.xp;
      gems += r.gems;
      const ex = d.exam.get(k(l.id, studentId));
      if (ex !== undefined) {
        xp += ballToXp(ex);
        gems += ballToGems(ex);
      }
    }
    return { xp, gems };
  }

  /** Ranking of one group: XP earned in THIS group only, highest first (docs 7.4). */
  async ranking(d: GroupData) {
    const names = await this.names(d.members);
    return d.members
      .map((id) => ({ studentId: id, name: names.get(id) ?? '', ...this.totalsIn(d, id) }))
      .sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name))
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }

  async names(ids: number[]) {
    if (!ids.length) return new Map<number, string>();
    const rows = await this.users.findBy({ id: In(ids) });
    return new Map(rows.map((u) => [u.id, u.fullName]));
  }

  /** Total XP and kumush of every student over all their groups (for the overall rank). */
  async allStudentTotals() {
    const out = new Map<number, { xp: number; gems: number }>();
    for (const g of await this.groups.findBy({ isActive: true })) {
      const d = await this.loadGroup(g);
      for (const id of d.members) {
        const t = this.totalsIn(d, id);
        const cur = out.get(id) ?? { xp: 0, gems: 0 };
        out.set(id, { xp: cur.xp + t.xp, gems: cur.gems + t.gems });
      }
    }
    return out;
  }

  /** Consecutive days (ending today, or yesterday) on which the student did something: watched, handed in work or attended. */
  async streak(studentId: number) {
    const days = new Set<string>();
    (await this.progress.findBy({ studentId })).forEach((p) => days.add(dateStr(p.updatedAt)));
    (await this.submissions.findBy({ studentId })).forEach((s) => days.add(dateStr(s.submittedAt)));
    (await this.attendance.findBy({ studentId, present: true })).forEach((a) => days.add(dateStr(a.markedAt)));
    let day = new Date();
    if (!days.has(dateStr(day))) day = new Date(day.getTime() - 86_400_000);
    let n = 0;
    while (days.has(dateStr(day))) {
      n++;
      day = new Date(day.getTime() - 86_400_000);
    }
    return n;
  }
}
