import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '../common/enums';
import { conflict, unprocessable } from '../common/errors';
import { Group, GroupMember, User } from '../entities';
import { SessionsService } from '../auth/sessions.service';
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
    private sessions: SessionsService,
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
    const [students, teachers, groups] = await Promise.all([this.userRepo.countBy({ role: Role.STUDENT, isActive: true }), this.userRepo.countBy({ role: Role.TEACHER, isActive: true }), this.groupsSvc.allGroups()]);
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
    const students = await this.userRepo.find({ where: { role: Role.STUDENT, isActive: true }, order: { fullName: 'ASC' } });
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
    const teachers = await this.userRepo.find({ where: { role: Role.TEACHER, isActive: true }, order: { fullName: 'ASC' } });
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

  // ---------- edit / remove people ----------

  private checkPerson(dto: { fullName?: string; phone?: string }) {
    const out: { fullName?: string; phone?: string } = {};
    if (dto.fullName !== undefined) {
      if (dto.fullName.trim().split(/\s+/).length < 2 || dto.fullName.trim().length < 5) throw unprocessable("Ism va familiyani to'liq yozing.", 'fullName');
      out.fullName = dto.fullName.trim();
    }
    if (dto.phone !== undefined) {
      const phone = normalizePhone(dto.phone);
      if (!phone) throw unprocessable("Telefon raqam +998 90 123 45 67 ko'rinishida bo'lsin.", 'phone');
      out.phone = phone;
    }
    return out;
  }

  private async person(role: Role, id: number) {
    const u = await this.userRepo.findOneBy({ id, role, isActive: true });
    if (!u) throw unprocessable('Foydalanuvchi topilmadi.');
    return u;
  }

  /** Name and phone of a student, teacher or admin. */
  async updatePerson(role: Role, id: number, dto: { fullName?: string; phone?: string }) {
    const u = await this.person(role, id);
    Object.assign(u, this.checkPerson(dto));
    await this.userRepo.save(u);
  }

  /**
   * "Deleting" a person switches the account off (isActive = false): they can no longer sign in, disappear from lists and
   * lose their sessions, while their lessons, marks and history stay intact.
   */
  private async deactivate(u: User) {
    u.isActive = false;
    await this.userRepo.save(u);
    await this.sessions.endAll(u.id);
  }

  /** A student leaves: their seats in groups are freed too. */
  async removeStudent(id: number) {
    const u = await this.person(Role.STUDENT, id);
    await this.members.delete({ studentId: id });
    await this.deactivate(u);
  }

  /** A teacher with active groups cannot be removed (409): move those groups to another teacher first. */
  async removeTeacher(id: number) {
    const u = await this.person(Role.TEACHER, id);
    const groups = await this.groups.find({ where: { teacherId: id, isActive: true } });
    if (groups.length) throw conflict(`Ustozning guruhlari bor: ${groups.map((g) => g.name).join(', ')}. Avval guruhlarni boshqa ustozga o'tkazing.`);
    await this.deactivate(u);
  }

  // ---------- administrators ----------

  async listAdmins() {
    const admins = await this.userRepo.find({ where: { role: Role.ADMIN, isActive: true }, order: { fullName: 'ASC' } });
    return admins.map((a) => this.personRow(a, []));
  }

  async createAdmin(dto: { fullName: string; phone?: string; login: string; password: string }) {
    const checked = this.checkPerson({ fullName: dto.fullName, phone: dto.phone });
    const user = await this.users.create({ role: Role.ADMIN, login: dto.login, password: dto.password, fullName: checked.fullName!, phone: checked.phone ?? null });
    return this.personRow(user, []);
  }

  /** An administrator cannot remove themselves, and the last administrator can never be removed. */
  async removeAdmin(currentId: number, id: number) {
    if (currentId === id) throw conflict("O'zingizni o'chira olmaysiz.");
    const u = await this.person(Role.ADMIN, id);
    if ((await this.userRepo.countBy({ role: Role.ADMIN, isActive: true })) <= 1) throw conflict("Oxirgi administratorni o'chirib bo'lmaydi.");
    await this.deactivate(u);
  }

  // ---------- groups and rooms are served by GroupsService / RoomsService ----------

  today() {
    return dateStr(new Date());
  }
}
