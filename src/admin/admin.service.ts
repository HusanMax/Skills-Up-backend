import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '../common/enums';
import { conflict, unprocessable } from '../common/errors';
import { Group, GroupMember, User } from '../entities';
import { GroupsService } from '../groups/groups.service';
import { PaymentsService } from '../payments/payments.service';
import { RoomsService } from '../rooms/rooms.service';
import { UsersService, normalizePhone } from '../users/users.service';
import { dateStr, dayOf, iso } from '../common/dates';

const NEW_DAYS = 14;

@Injectable()
export class AdminService {
  constructor(
    private users: UsersService,
    private groupsSvc: GroupsService,
    private roomsSvc: RoomsService,
    private payments: PaymentsService,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(GroupMember) private members: Repository<GroupMember>,
    @InjectRepository(Group) private groups: Repository<Group>,
  ) {}

  private personRow(u: User, groupNames: { id: number; name: string }[]) {
    return {
      id: u.id,
      fullName: u.fullName,
      phone: u.phone,
      login: u.login,
      groups: groupNames,
      passwordChangedAt: iso(u.passwordChangedAt),
      isNew: Date.now() - u.createdAt.getTime() < NEW_DAYS * 86_400_000,
    };
  }

  async dashboard() {
    const [students, teachers, groups] = await Promise.all([this.userRepo.countBy({ role: Role.STUDENT }), this.userRepo.countBy({ role: Role.TEACHER }), this.groupsSvc.allGroups()]);
    const today = await this.groupsSvc.timetable(dayOf(new Date()));
    const described = await this.groupsSvc.describe(groups);
    const overview = await this.payments.overview();
    return {
      studentsCount: students,
      teachersCount: teachers,
      groupsCount: groups.length,
      freeSlotsToday: today.freeCount,
      upcomingPayments: described.filter((g) => g.plan).map((g) => ({ groupId: g.id, name: g.name, members: g.members, amount: g.plan!.amount, dueDate: g.plan!.dueDate })).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      lastNotices: overview.notices.slice(0, 5),
    };
  }

  // ---------- students ----------

  async listStudents(q?: string, groupId?: number) {
    const students = await this.userRepo.find({ where: { role: Role.STUDENT }, order: { fullName: 'ASC' } });
    const links = students.length ? await this.members.findBy({ studentId: In(students.map((s) => s.id)) }) : [];
    const groups = await this.groups.find();
    const rows = students
      .filter((s) => (!groupId || links.some((l) => l.studentId === s.id && l.groupId === groupId)) && (!q || `${s.fullName} ${s.phone ?? ''} ${s.login}`.toLowerCase().includes(q.toLowerCase())))
      .map((s) => this.personRow(s, links.filter((l) => l.studentId === s.id).map((l) => ({ id: l.groupId, name: groups.find((g) => g.id === l.groupId)?.name ?? '' }))));
    return rows;
  }

  /** New student: validation, then the account, then the groups (seat check first, so nothing is half-created). */
  async createStudent(dto: { fullName: string; phone: string; login: string; password: string; groupIds?: number[] }) {
    if (dto.fullName.trim().split(/\s+/).length < 2 || dto.fullName.trim().length < 5) throw unprocessable("Ism va familiyani to'liq yozing.", 'fullName');
    const phone = normalizePhone(dto.phone);
    if (!phone) throw unprocessable("Telefon raqam +998 90 123 45 67 ko'rinishida bo'lsin.", 'phone');
    const groupIds = [...new Set(dto.groupIds ?? [])];
    const described = await this.groupsSvc.describe(await this.groups.findBy({ id: In(groupIds) }));
    if (described.length !== groupIds.length) throw unprocessable('Guruh topilmadi.', 'groupIds');
    for (const g of described) if (g.members >= g.capacity) throw conflict(`“${g.name}” guruhida bo'sh joy qolmagan.`);
    const user = await this.users.create({ role: Role.STUDENT, login: dto.login, password: dto.password, fullName: dto.fullName, phone });
    for (const id of groupIds) await this.groupsSvc.enrol(user.id, id);
    return this.personRow(user, described.map((g) => ({ id: g.id, name: g.name })));
  }

  async enrol(studentId: number, groupId: number) {
    const u = await this.users.byId(studentId);
    if (u.role !== Role.STUDENT) throw unprocessable("Bu foydalanuvchi o'quvchi emas.");
    await this.groupsSvc.enrol(studentId, groupId);
  }

  /** Login / password of a student or a teacher; the target must have the role the route is about. */
  async changeAccount(role: Role, userId: number, input: { login?: string; password?: string }) {
    const u = await this.users.byId(userId);
    if (u.role !== role) throw unprocessable('Foydalanuvchi topilmadi.');
    if (input.login === undefined && !input.password) throw unprocessable('Login yoki yangi parolni kiriting.');
    await this.users.changeAccount(userId, input);
  }

  // ---------- teachers ----------

  async listTeachers() {
    const teachers = await this.userRepo.find({ where: { role: Role.TEACHER }, order: { fullName: 'ASC' } });
    const groups = await this.groups.find({ where: { isActive: true } });
    return teachers.map((t) => this.personRow(t, groups.filter((g) => g.teacherId === t.id).map((g) => ({ id: g.id, name: g.name }))));
  }

  async createTeacher(dto: { fullName: string; phone: string; login: string; password: string }) {
    if (dto.fullName.trim().split(/\s+/).length < 2 || dto.fullName.trim().length < 5) throw unprocessable("Ism va familiyani to'liq yozing.", 'fullName');
    const phone = normalizePhone(dto.phone);
    if (!phone) throw unprocessable("Telefon raqam +998 90 123 45 67 ko'rinishida bo'lsin.", 'phone');
    const user = await this.users.create({ role: Role.TEACHER, login: dto.login, password: dto.password, fullName: dto.fullName, phone });
    return this.personRow(user, []);
  }

  // ---------- groups and rooms are served by GroupsService / RoomsService ----------

  today() {
    return dateStr(new Date());
  }
}
