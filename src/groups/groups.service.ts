import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { dateStr, dayOf, endTime } from '../common/dates';
import { Day, Role } from '../common/enums';
import { conflict, unprocessable } from '../common/errors';
import { RULES } from '../config/rules';
import { Activity, Group, GroupMember, GroupSchedule, Homework, Lesson, PaymentPlan, Room, StudentHomework, User } from '../entities';
import { NotificationsService } from '../notifications/notifications.service';
import { RoomsService } from '../rooms/rooms.service';

export interface NewGroupInput {
  name: string;
  course: string;
  teacherId: number;
  days: Day[];
  start: string;
  roomId: number;
  amount: number;
  dueDate: string;
}

const key = (roomId: number, day: string, start: string) => `${roomId}|${day}|${start}`;

@Injectable()
export class GroupsService {
  constructor(
    private ds: DataSource,
    private roomsSvc: RoomsService,
    private notifications: NotificationsService,
    @InjectRepository(Group) private groups: Repository<Group>,
    @InjectRepository(GroupSchedule) private schedule: Repository<GroupSchedule>,
    @InjectRepository(GroupMember) private members: Repository<GroupMember>,
    @InjectRepository(PaymentPlan) private plans: Repository<PaymentPlan>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Room) private rooms: Repository<Room>,
  ) {}

  // ---------- reading ----------

  async memberIds(groupId: number) {
    return (await this.members.findBy({ groupId })).map((m) => m.studentId);
  }

  async groupIdsOfStudent(studentId: number) {
    return (await this.members.findBy({ studentId })).map((m) => m.groupId);
  }

  async byId(id: number) {
    const g = await this.groups.findOneBy({ id });
    if (!g) throw new NotFoundException('Guruh topilmadi.');
    return g;
  }

  /** A teacher may only work with the groups they teach (403 otherwise). */
  async assertTeaches(teacherId: number, groupId: number) {
    const g = await this.byId(groupId);
    if (g.teacherId !== teacherId) throw new ForbiddenException("Bu guruh sizniki emas.");
    return g;
  }

  async assertMember(studentId: number, groupId: number) {
    if (!(await this.members.findOneBy({ groupId, studentId }))) throw new ForbiddenException("Siz bu guruhda emassiz.");
  }

  /** Capacity: the smallest room of the group's schedule; online-only groups use the default. */
  capacityOf(schedules: GroupSchedule[], rooms: Room[]) {
    const caps = schedules.map((s) => rooms.find((r) => r.id === s.roomId)?.capacity).filter((n): n is number => n !== undefined);
    return caps.length ? Math.min(...caps) : RULES.DEFAULT_ONLINE_CAPACITY;
  }

  /** Groups with teacher, schedule (room names), member count, capacity and payment plan. */
  async describe(groupList: Group[]) {
    if (!groupList.length) return [];
    const ids = groupList.map((g) => g.id);
    const [schedules, members, rooms, plans, teachers] = await Promise.all([
      this.schedule.find({ where: { groupId: In(ids) }, order: { id: 'ASC' } }),
      this.members.find({ where: { groupId: In(ids) } }),
      this.roomsSvc.all(),
      this.plans.find({ where: { groupId: In(ids) } }),
      this.users.findBy({ id: In([...new Set(groupList.map((g) => g.teacherId))]) }),
    ]);
    const order: Day[] = [Day.MON, Day.TUE, Day.WED, Day.THU, Day.FRI, Day.SAT, Day.SUN];
    return groupList.map((g) => {
      const sch = schedules.filter((s) => s.groupId === g.id).sort((a, b) => order.indexOf(a.day as Day) - order.indexOf(b.day as Day));
      const count = members.filter((m) => m.groupId === g.id).length;
      const plan = plans.find((p) => p.groupId === g.id);
      const teacher = teachers.find((t) => t.id === g.teacherId);
      return {
        id: g.id,
        name: g.name,
        course: g.course,
        teacher: { id: g.teacherId, fullName: teacher?.fullName ?? '' },
        members: count,
        capacity: this.capacityOf(sch, rooms),
        schedule: sch.map((s) => ({ day: s.day, start: s.startTime, end: s.endTime, roomId: s.roomId, room: rooms.find((r) => r.id === s.roomId)?.name ?? 'Onlayn' })),
        plan: plan ? { amount: plan.amount, dueDate: plan.dueDate } : null,
      };
    });
  }

  allGroups() {
    return this.groups.find({ where: { isActive: true }, order: { id: 'ASC' } });
  }

  /** Next session of a group counting from now (for "next lesson" cards). */
  nextSession(schedule: { day: string; start: string; end: string; room: string }[], now = new Date()) {
    let best: { day: string; start: string; end: string; room: string; at: Date } | null = null;
    for (const s of schedule) {
      for (let off = 0; off < 8; off++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
        if (dayOf(d) !== s.day) continue;
        const [h, m] = s.start.split(':').map(Number);
        d.setHours(h!, m!, 0, 0);
        if (d < now) continue;
        if (!best || d < best.at) best = { ...s, at: d };
        break;
      }
    }
    return best ? { day: best.day, start: best.start, end: best.end, room: best.room, at: best.at.toISOString() } : null;
  }

  // ---------- rooms: who sits where ----------

  /** (room, day, start) -> group, for every active group. Online sessions and odd times take no room. */
  async occupancy() {
    const [groups, schedules] = await Promise.all([this.allGroups(), this.schedule.find()]);
    const byId = new Map(groups.map((g) => [g.id, g]));
    const map = new Map<string, Group>();
    for (const s of schedules) {
      const g = byId.get(s.groupId);
      if (g && s.roomId !== null && RULES.LESSON_SLOTS.includes(s.startTime as never)) map.set(key(s.roomId, s.day, s.startTime), g);
    }
    return map;
  }

  /** Rooms that are free at this start time on ALL the given days. */
  async freeRooms(days: Day[], start: string) {
    const [occ, rooms] = await Promise.all([this.occupancy(), this.roomsSvc.all()]);
    return rooms.filter((r) => days.every((d) => !occ.has(key(r.id, d, start)))).map((r) => r.id);
  }

  /** Rooms x 2-hour slots for one weekday. */
  async timetable(day: Day) {
    const [occ, rooms, groups, teachers] = await Promise.all([this.occupancy(), this.roomsSvc.all(), this.allGroups(), this.users.findBy({ role: Role.TEACHER })]);
    return {
      day,
      slots: RULES.LESSON_SLOTS,
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        capacity: r.capacity,
        cells: Object.fromEntries(
          RULES.LESSON_SLOTS.map((s) => {
            const g = occ.get(key(r.id, day, s));
            return [s, g ? { groupId: g.id, groupName: g.name, teacher: teachers.find((t) => t.id === g.teacherId)?.fullName ?? '' } : null];
          }),
        ),
      })),
      freeCount: rooms.reduce((n, r) => n + RULES.LESSON_SLOTS.filter((s) => !occ.has(key(r.id, day, s))).length, 0),
      groups: groups.length,
    };
  }

  // ---------- opening a group ----------

  /** 409 when the room is busy or the teacher already teaches another group at that time. */
  async assertSlotFree(input: { days: Day[]; start: string; roomId: number | null; teacherId: number }) {
    const [occ, rooms, allGroups, schedules] = await Promise.all([this.occupancy(), this.roomsSvc.all(), this.allGroups(), this.schedule.find()]);
    if (input.roomId !== null) {
      for (const d of input.days) {
        const other = occ.get(key(input.roomId, d, input.start));
        if (other) throw conflict(`${rooms.find((r) => r.id === input.roomId)?.name} ${d} kuni ${input.start} da band: ${other.name}.`);
      }
    }
    const mine = new Set(allGroups.filter((g) => g.teacherId === input.teacherId).map((g) => g.id));
    for (const s of schedules) {
      if (mine.has(s.groupId) && input.days.includes(s.day as Day) && s.startTime === input.start) {
        const g = allGroups.find((x) => x.id === s.groupId)!;
        throw conflict(`Ustoz shu vaqtda “${g.name}” guruhida dars o'tadi.`);
      }
    }
  }

  async createGroup(input: NewGroupInput) {
    if (!RULES.LESSON_SLOTS.includes(input.start as never)) throw unprocessable("Dars vaqti 2 soatlik kataklardan biri bo'lsin.", 'start');
    if (input.amount < RULES.MIN_PAYMENT) throw unprocessable("To'lov so'mda, kamida 10 000.", 'amount');
    if (input.dueDate < dateStr(new Date())) throw unprocessable("To'lov sanasi o'tib ketgan bo'lmasin.", 'dueDate');
    const teacher = await this.users.findOneBy({ id: input.teacherId, role: Role.TEACHER });
    if (!teacher) throw unprocessable('Ustoz topilmadi.', 'teacherId');
    if (!(await this.rooms.findOneBy({ id: input.roomId }))) throw unprocessable('Xona topilmadi.', 'roomId');
    const days = [...new Set(input.days)];
    await this.assertSlotFree({ days, start: input.start, roomId: input.roomId, teacherId: input.teacherId });
    const id = await this.ds.transaction(async (em) => {
      const g = await em.save(Group, em.create(Group, { name: input.name.trim(), course: input.course.trim(), teacherId: input.teacherId, isActive: true }));
      for (const day of days) {
        await em.save(GroupSchedule, em.create(GroupSchedule, { groupId: g.id, day, startTime: input.start, endTime: endTime(input.start), roomId: input.roomId }));
      }
      await em.save(PaymentPlan, em.create(PaymentPlan, { groupId: g.id, amount: input.amount, dueDate: input.dueDate }));
      return g.id;
    });
    return (await this.describe([await this.byId(id)]))[0]!;
  }

  // ---------- members ----------

  /** Adds a student to a group: seat check, duplicates, and the homework already given in the group. */
  async enrol(studentId: number, groupId: number, em = this.ds.manager) {
    const g = await this.byId(groupId);
    if (await em.findOneBy(GroupMember, { groupId, studentId })) throw conflict("O'quvchi bu guruhda allaqachon bor.");
    const [desc] = await this.describe([g]);
    if (desc!.members >= desc!.capacity) throw conflict(`“${g.name}” guruhida bo'sh joy qolmagan.`);
    await em.save(GroupMember, em.create(GroupMember, { groupId, studentId }));
    // homework that was given before the student joined is waiting for them too
    const lessons = await em.findBy(Lesson, { groupId });
    const hws = lessons.length ? await em.findBy(Homework, { lessonId: In(lessons.map((l) => l.id)) }) : [];
    for (const h of hws) {
      await em.save(StudentHomework, em.create(StudentHomework, { homeworkId: h.id, studentId, status: 'NOT_DONE', assignedAt: h.assignedAt, dueAt: h.dueAt, grade: null, feedback: null, gradedAt: null, gradedById: null }));
    }
    await em.save(Activity, em.create(Activity, { studentId, type: 'group', text: `“${g.name}” guruhiga qo'shildingiz`, xp: null }));
    await this.notifications.notifyMany([studentId], { type: 'group_added', title: `Siz “${g.name}” guruhiga qo'shildingiz`, link: '/groups' });
  }
}
