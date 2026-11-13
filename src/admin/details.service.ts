import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '../common/enums';
import { iso } from '../common/dates';
import { Group, GroupMember, Lesson, Payment, Room, User } from '../entities';
import { GroupsService } from '../groups/groups.service';
import { ReportsService } from '../payments/reports.service';

const notFound = (what: string) => new NotFoundException({ code: 'NOT_FOUND', message: `${what} topilmadi.` });

/**
 * "Open one" pages of the admin panel. Each answer carries the linked records (id + name), so the screen can link
 * teacher -> groups -> students -> payments and back, however many-to-many the data is.
 */
@Injectable()
export class DetailsService {
  constructor(
    private groupsSvc: GroupsService,
    private reports: ReportsService,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Group) private groups: Repository<Group>,
    @InjectRepository(GroupMember) private members: Repository<GroupMember>,
    @InjectRepository(Lesson) private lessons: Repository<Lesson>,
    @InjectRepository(Payment) private payments: Repository<Payment>,
    @InjectRepository(Room) private rooms: Repository<Room>,
  ) {}

  private async person(role: Role, id: number) {
    const u = await this.users.findOneBy({ id, role });
    if (!u) throw notFound(role === Role.TEACHER ? 'Ustoz' : "O'quvchi");
    return { id: u.id, fullName: u.fullName, phone: u.phone, login: u.login, isActive: u.isActive, createdAt: iso(u.createdAt), passwordChangedAt: iso(u.passwordChangedAt) };
  }

  /** A group row with teacher, schedule and counts; `lessons` is the number of lessons held. */
  private async groupRows(list: Group[]) {
    const described = await this.groupsSvc.describe(list);
    const counts = list.length ? await this.lessons.createQueryBuilder('l').select('l.groupId', 'groupId').addSelect('COUNT(*)', 'n').where('l.groupId IN (:...ids)', { ids: list.map((g) => g.id) }).groupBy('l.groupId').getRawMany<{ groupId: number | string; n: number | string }>() : [];
    return described.map((d) => ({ ...d, isActive: list.find((g) => g.id === d.id)!.isActive, lessons: Number(counts.find((c) => Number(c.groupId) === d.id)?.n ?? 0) }));
  }

  async teacher(id: number) {
    const person = await this.person(Role.TEACHER, id);
    const list = await this.groups.find({ where: { teacherId: id }, order: { isActive: 'DESC', id: 'ASC' } });
    const rows = await this.groupRows(list);
    const links = list.length ? await this.members.findBy({ groupId: In(list.map((g) => g.id)) }) : [];
    const active = rows.filter((g) => g.isActive);
    return {
      ...person,
      groups: rows,
      totals: { groups: active.length, archivedGroups: rows.length - active.length, students: new Set(links.filter((l) => active.some((g) => g.id === l.groupId)).map((l) => l.studentId)).size, weeklySessions: active.reduce((s, g) => s + g.schedule.length, 0), lessons: rows.reduce((s, g) => s + g.lessons, 0) },
    };
  }

  async student(id: number) {
    const person = await this.person(Role.STUDENT, id);
    const links = await this.members.findBy({ studentId: id });
    const list = links.length ? await this.groups.findBy({ id: In(links.map((l) => l.groupId)) }) : [];
    const invoices = await this.reports.rows({ studentId: id });
    const payments = await this.payments.find({ where: { studentId: id }, order: { paidAt: 'DESC', id: 'DESC' } });
    const names = new Map((await this.groups.find({ select: { id: true, name: true } })).map((g) => [g.id, g.name]));
    return {
      ...person,
      groups: await this.groupRows(list),
      invoices,
      payments: payments.map((p) => ({ id: p.id, invoiceId: p.invoiceId, groupId: p.groupId, groupName: names.get(p.groupId) ?? '', paidAt: p.paidAt, amount: p.amount, method: p.method, description: p.description })),
      totals: this.reports.summarize(invoices),
    };
  }

  async group(id: number) {
    const g = await this.groups.findOneBy({ id });
    if (!g) throw notFound('Guruh');
    const [row] = await this.groupRows([g]);
    const links = await this.members.findBy({ groupId: id });
    const students = links.length ? await this.users.find({ where: { id: In(links.map((l) => l.studentId)) }, order: { fullName: 'ASC' } }) : [];
    const invoices = await this.reports.rows({ groupId: id });
    return {
      ...row,
      teacher: { id: g.teacherId, fullName: row!.teacher.fullName },
      students: students.map((s) => ({ id: s.id, fullName: s.fullName, phone: s.phone, isActive: s.isActive, ...this.reports.summarize(invoices.filter((i) => i.studentId === s.id)) })),
      totals: this.reports.summarize(invoices),
      recentInvoices: invoices.slice(0, 20),
    };
  }

  async room(id: number) {
    const room = await this.rooms.findOneBy({ id });
    if (!room) throw notFound('Xona');
    const all = await this.groups.find({ where: { isActive: true }, order: { id: 'ASC' } });
    const described = await this.groupsSvc.describe(all);
    const used = described.filter((g) => g.schedule.some((s) => s.roomId === id));
    return {
      id: room.id, name: room.name, capacity: room.capacity,
      groups: used.map((g) => ({ id: g.id, name: g.name, teacher: g.teacher, members: g.members, slots: g.schedule.filter((s) => s.roomId === id) })),
      weeklySlots: used.reduce((s, g) => s + g.schedule.filter((x) => x.roomId === id).length, 0),
    };
  }
}
