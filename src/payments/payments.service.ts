import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { dateStr } from '../common/dates';
import { conflict, unprocessable } from '../common/errors';
import { RULES } from '../config/rules';
import { Group, GroupMember, Invoice, Payment, PaymentClaim, PaymentNotice, PaymentPlan, User } from '../entities';
import { ReportsService } from './reports.service';
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
    private reports: ReportsService,
    @InjectRepository(Invoice) private invoices: Repository<Invoice>,
    @InjectRepository(PaymentClaim) private claims: Repository<PaymentClaim>,
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
    const myInvoices = await this.reports.rows({ studentId });
    const myClaims = await this.claims.find({ where: { studentId }, order: { id: 'DESC' }, take: 50 });
    const pending = new Map(myClaims.filter((c) => c.status === 'PENDING').map((c) => [c.invoiceId, c]));
    return {
      // only what the administrator has billed: the student pays against these and nothing else
      invoices: myInvoices.filter((i) => i.debt > 0).map((i) => ({ ...i, pendingClaim: pending.get(i.id) ? { id: pending.get(i.id)!.id, amount: pending.get(i.id)!.amount } : null })),
      claims: myClaims.map((c) => ({ id: c.id, invoiceId: c.invoiceId, amount: c.amount, method: c.method, status: c.status, rejectReason: c.rejectReason, createdAt: c.createdAt.toISOString(), decidedAt: c.decidedAt?.toISOString() ?? null })),
      total: rows.reduce((s, r) => s + r.amount, 0),
      count: rows.length,
      last: last ? { paidAt: last.paidAt, groupName: gname(last.groupId), amount: last.amount } : null,
      upcoming: plans
        .map((p) => ({ groupId: p.groupId, groupName: nameOf(p.groupId), dueDate: p.dueDate, amount: p.amount, daysLeft: daysLeft(p.dueDate) }))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      items: rows.map((r) => ({ id: r.id, date: r.paidAt, groupId: r.groupId, groupName: gname(r.groupId), description: r.description, method: r.method, amount: r.amount })),
    };
  }

  /**
   * One sale (invoice) for EVERY student of a group for one period. Students that already have an invoice for that
   * group and period are skipped, so pressing the button twice never bills anyone twice.
   */
  async createInvoices(input: { groupId: number; period?: string; amount?: number; issuedAt?: string; dueDate: string }) {
    const group = await this.groupsSvc.byId(input.groupId);
    const today = dateStr(new Date());
    const issuedAt = input.issuedAt ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt) || Number.isNaN(Date.parse(issuedAt))) throw unprocessable("Savdo sanasi noto'g'ri.", 'issuedAt');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || Number.isNaN(Date.parse(input.dueDate))) throw unprocessable("To'lov muddatini tanlang.", 'dueDate');
    if (input.dueDate < issuedAt) throw unprocessable("To'lov muddati savdo sanasidan oldin bo'lmasin.", 'dueDate');
    const period = input.period ?? issuedAt.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw unprocessable("Davr YYYY-MM ko'rinishida bo'lsin.", 'period');
    const plan = await this.plans.findOneBy({ groupId: group.id });
    const amount = input.amount ?? plan?.amount;
    if (amount === undefined || !Number.isInteger(amount) || amount < RULES.MIN_PAYMENT) throw unprocessable("Summa so'mda, kamida 10 000.", 'amount');
    const studentIds = await this.groupsSvc.memberIds(group.id);
    if (!studentIds.length) throw unprocessable("Guruhda o'quvchi yo'q.", 'groupId');
    const existing = new Set((await this.invoices.findBy({ groupId: group.id, period })).map((i) => i.studentId));
    const fresh = studentIds.filter((id) => !existing.has(id));
    if (fresh.length) {
      await this.ds.transaction(async (em) => {
        await em.insert(Invoice, fresh.map((studentId) => ({ studentId, groupId: group.id, period, issuedAt, dueDate: input.dueDate, amount })));
        // sending the bill is what opens the payment for the student, so they are told right away
        await em.insert('notifications', fresh.map((userId) => ({ userId, type: 'payment_notice', link: '/payments', readAt: null, title: `To'lov: ${group.name}, ${som(amount)}, ${uzDay(input.dueDate)} gacha` })));
      });
    }
    return { group: group.name, period, amount, created: fresh.length, skipped: studentIds.length - fresh.length };
  }

  /** A student's payment against one invoice; it can never be more than what is still owed. */
  async addPayment(invoiceId: number, input: { amount: number; paidAt?: string; method: string; description?: string }) {
    const invoice = await this.invoices.findOneBy({ id: invoiceId });
    if (!invoice) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Savdo topilmadi.' });
    const paidAt = input.paidAt ?? dateStr(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt) || Number.isNaN(Date.parse(paidAt))) throw unprocessable("To'lov sanasi noto'g'ri.", 'paidAt');
    if (paidAt > dateStr(new Date())) throw unprocessable("To'lov sanasi kelajakda bo'lmasin.", 'paidAt');
    if (!Number.isInteger(input.amount) || input.amount < 1) throw unprocessable("Summa musbat butun son bo'lsin.", 'amount');
    // one transaction: the remaining debt is read and the payment written together
    await this.ds.transaction(async (em) => {
      const { paid } = (await em.createQueryBuilder(Payment, 'p').select('COALESCE(SUM(p.amount), 0)', 'paid').where('p.invoiceId = :id', { id: invoiceId }).getRawOne<{ paid: number | string }>())!;
      const left = invoice.amount - Number(paid);
      if (input.amount > left) throw unprocessable(left > 0 ? `Qolgan qarz ${som(left)}: undan ko'p kiritib bo'lmaydi.` : "Bu savdo to'liq to'langan.", 'amount');
      await em.save(Payment, em.create(Payment, { invoiceId, studentId: invoice.studentId, groupId: invoice.groupId, amount: input.amount, paidAt, method: input.method, description: input.description?.trim() || "Standart to'lov" }));
    });
    return (await this.reports.rows({ studentId: invoice.studentId, groupId: invoice.groupId })).find((r) => r.id === invoiceId);
  }

  /** The student says "I paid <amount>". Only for their own, still unpaid invoices; one open message per invoice. */
  async submitClaim(studentId: number, invoiceId: number, input: { amount: number; method?: string }) {
    const row = (await this.reports.rows({ studentId })).find((r) => r.id === invoiceId);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Hisob topilmadi.' });
    if (row.debt <= 0) throw conflict("Bu hisob to'liq to'langan.");
    if (!Number.isInteger(input.amount) || input.amount < 1) throw unprocessable("Summa musbat butun son bo'lsin.", 'amount');
    if (input.amount > row.debt) throw unprocessable(`Qolgan qarz ${som(row.debt)}: undan ko'p yozib bo'lmaydi.`, 'amount');
    if (await this.claims.findOneBy({ invoiceId, status: 'PENDING' })) throw conflict("Oldingi to'lov xabaringiz hali tekshirilmoqda.");
    const claim = await this.claims.save(this.claims.create({ invoiceId, studentId, amount: input.amount, method: input.method?.trim() || 'Karta', status: 'PENDING' }));
    return { id: claim.id, status: claim.status, amount: claim.amount };
  }

  /** Admin list of student messages (default: those waiting for approval). */
  async listClaims(status = 'PENDING') {
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) throw unprocessable("Holat PENDING, APPROVED yoki REJECTED bo'lsin.", 'status');
    const list = await this.claims.find({ where: { status }, order: { id: status === 'PENDING' ? 'ASC' : 'DESC' }, take: 200 });
    const rows = new Map((await this.reports.rows({})).map((r) => [r.id, r]));
    return list.map((c) => {
      const r = rows.get(c.invoiceId);
      return { id: c.id, invoiceId: c.invoiceId, studentId: c.studentId, studentName: r?.studentName ?? '', groupName: r?.groupName ?? '', period: r?.period ?? '', amount: c.amount, method: c.method, status: c.status, debt: r?.debt ?? 0, rejectReason: c.rejectReason, createdAt: c.createdAt.toISOString() };
    });
  }

  private async decide(claimId: number) {
    const claim = await this.claims.findOneBy({ id: claimId });
    if (!claim) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Xabar topilmadi.' });
    if (claim.status !== 'PENDING') throw conflict('Bu xabar allaqachon ko\'rib chiqilgan.');
    return claim;
  }

  /** Approve: the money becomes a real Payment, in one transaction with the paid-sum check. The student is told. */
  async approveClaim(adminId: number, claimId: number) {
    const claim = await this.decide(claimId);
    const invoice = await this.invoices.findOneBy({ id: claim.invoiceId });
    if (!invoice) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Hisob topilmadi.' });
    await this.ds.transaction(async (em) => {
      const { paid } = (await em.createQueryBuilder(Payment, 'p').select('COALESCE(SUM(p.amount), 0)', 'paid').where('p.invoiceId = :id', { id: invoice.id }).getRawOne<{ paid: number | string }>())!;
      const left = invoice.amount - Number(paid);
      if (claim.amount > left) throw conflict(`Qolgan qarz ${som(Math.max(left, 0))}: xabardagi summa undan ko'p. Rad eting.`);
      await em.save(Payment, em.create(Payment, { invoiceId: invoice.id, studentId: invoice.studentId, groupId: invoice.groupId, amount: claim.amount, paidAt: dateStr(new Date()), method: claim.method, description: "O'quvchi xabari, admin tasdiqladi" }));
      await em.update(PaymentClaim, claim.id, { status: 'APPROVED', decidedById: adminId, decidedAt: new Date() });
      await em.insert('notifications', [{ userId: claim.studentId, type: 'payment_approved', link: '/payments', readAt: null, title: `To'lovingiz tasdiqlandi: ${som(claim.amount)}` }]);
    });
    return { id: claim.id, status: 'APPROVED' };
  }

  async rejectClaim(adminId: number, claimId: number, reason?: string) {
    const claim = await this.decide(claimId);
    const why = reason?.trim() || null;
    await this.ds.transaction(async (em) => {
      await em.update(PaymentClaim, claim.id, { status: 'REJECTED', rejectReason: why, decidedById: adminId, decidedAt: new Date() });
      await em.insert('notifications', [{ userId: claim.studentId, type: 'payment_rejected', link: '/payments', readAt: null, title: `To'lov xabaringiz rad etildi: ${som(claim.amount)}${why ? ` (${why})` : ''}` }]);
    });
    return { id: claim.id, status: 'REJECTED' };
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
