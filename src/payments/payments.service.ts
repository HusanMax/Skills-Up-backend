import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { dateStr } from '../common/dates';
import { conflict, unprocessable } from '../common/errors';
import { RULES } from '../config/rules';
import { Group, GroupMember, Payment, PaymentNotice, PaymentPlan } from '../entities';
import { GroupsService } from '../groups/groups.service';
import { NotificationsService } from '../notifications/notifications.service';

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
/** "2026-12-20" -> "20-dekabr" */
export const uzDay = (iso: string) => `${Number(iso.slice(8, 10))}-${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
/** 500000 -> "500 000 so'm" */
export const som = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
const daysLeft = (iso: string) => Math.ceil((new Date(`${iso}T00:00:00`).getTime() - Date.now()) / 86_400_000);

@Injectable()
export class PaymentsService {
  constructor(
    private ds: DataSource,
    private groupsSvc: GroupsService,
    private notifications: NotificationsService,
    @InjectRepository(Payment) private payments: Repository<Payment>,
    @InjectRepository(PaymentPlan) private plans: Repository<PaymentPlan>,
    @InjectRepository(PaymentNotice) private notices: Repository<PaymentNotice>,
    @InjectRepository(Group) private groups: Repository<Group>,
    @InjectRepository(GroupMember) private members: Repository<GroupMember>,
  ) {}

  /**
   * The administrator sets the next payment of a group. This updates the plan, records the notice and creates a
   * notification for EVERY student of the group, all in one transaction (docs 6.8).
   */
  async publish(adminId: number, groupId: number, amount: number, dueDate: string) {
    const group = await this.groupsSvc.byId(groupId);
    if (!Number.isInteger(amount) || amount < RULES.MIN_PAYMENT) throw unprocessable("To'lov so'mda, kamida 10 000.", 'amount');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate))) throw unprocessable("To'lov sanasini tanlang.", 'dueDate');
    if (dueDate < dateStr(new Date())) throw unprocessable("To'lov sanasi o'tib ketgan bo'lmasin.", 'dueDate');
    const studentIds = await this.groupsSvc.memberIds(groupId);
    if (!studentIds.length) throw unprocessable("Guruhda o'quvchi yo'q: avval o'quvchi qo'shing.", 'dueDate');
    const notice = await this.ds.transaction(async (em) => {
      await em.save(PaymentPlan, em.create(PaymentPlan, { groupId, amount, dueDate }));
      const n = await em.save(PaymentNotice, em.create(PaymentNotice, { groupId, amount, dueDate, sentById: adminId, recipients: studentIds.length }));
      await em.insert(
        'notifications',
        studentIds.map((userId) => ({
          userId, type: 'payment_notice', link: '/payments', readAt: null,
          title: `To'lov eslatmasi: keyingi to'lov ${uzDay(dueDate)} gacha, ${som(amount)}`,
        })),
      );
      return n;
    });
    return { plan: { groupId, amount, dueDate }, notice: { id: notice.id, recipients: notice.recipients }, group: group.name };
  }

  /** Student's "To'lovlarim": paid history, totals and the next payment of each of the student's groups. */
  async forStudent(studentId: number) {
    const groupIds = await this.groupsSvc.groupIdsOfStudent(studentId);
    const [rows, plans, groups] = await Promise.all([
      this.payments.find({ where: { studentId }, order: { paidAt: 'DESC', id: 'DESC' } }),
      groupIds.length ? this.plans.findBy({ groupId: In(groupIds) }) : [],
      groupIds.length ? this.groups.findBy({ id: In(groupIds) }) : [],
    ]);
    const nameOf = (id: number) => groups.find((g) => g.id === id)?.name ?? '';
    const allGroups = await this.groups.findBy({ id: In([...new Set(rows.map((r) => r.groupId))].concat(groupIds)) });
    const gname = (id: number) => nameOf(id) || allGroups.find((g) => g.id === id)?.name || '';
    const last = rows[0];
    return {
      total: rows.reduce((s, r) => s + r.amount, 0),
      count: rows.length,
      last: last ? { paidAt: last.paidAt, groupName: gname(last.groupId), amount: last.amount } : null,
      upcoming: plans
        .map((p) => ({ groupId: p.groupId, groupName: nameOf(p.groupId), dueDate: p.dueDate, amount: p.amount, daysLeft: daysLeft(p.dueDate) }))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      items: rows.map((r) => ({ id: r.id, date: r.paidAt, groupId: r.groupId, groupName: gname(r.groupId), description: r.description, method: r.method, amount: r.amount })),
    };
  }

  /** Admin writes down a payment a student made (suggested endpoint; the frontend does not have it yet). */
  async record(input: { studentId: number; groupId: number; amount: number; paidAt: string; method: string; description: string }) {
    await this.groupsSvc.assertMember(input.studentId, input.groupId).catch(() => {
      throw conflict("O'quvchi bu guruhda emas.");
    });
    if (!Number.isInteger(input.amount) || input.amount < 1) throw unprocessable("Summa musbat butun son bo'lsin.", 'amount');
    return this.payments.save(this.payments.create(input));
  }

  /** Admin payments page: every group with its plan, plus the history of sent notices. */
  async overview() {
    const groups = await this.groupsSvc.describe(await this.groupsSvc.allGroups());
    const notices = await this.notices.find({ order: { sentAt: 'DESC', id: 'DESC' }, take: 100 });
    return {
      groups: groups.map((g) => ({ groupId: g.id, name: g.name, members: g.members, plan: g.plan, daysLeft: g.plan ? daysLeft(g.plan.dueDate) : null })),
      notices: notices.map((n) => ({ id: n.id, groupId: n.groupId, groupName: groups.find((g) => g.id === n.groupId)?.name ?? '', amount: n.amount, dueDate: n.dueDate, sentAt: n.sentAt.toISOString(), recipients: n.recipients })),
    };
  }
}
