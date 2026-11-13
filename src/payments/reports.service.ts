import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { Between, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { dateStr } from '../common/dates';
import { unprocessable } from '../common/errors';
import { Group, Invoice, Payment, User } from '../entities';

export type InvoiceStatus = 'PAID' | 'UNPAID' | 'PARTIALLY_PAID';
export const STATUSES: InvoiceStatus[] = ['PAID', 'UNPAID', 'PARTIALLY_PAID'];

/** The status follows from the money paid so far. It is never stored, so it can never disagree with the payments. */
export const statusOf = (amount: number, paid: number): InvoiceStatus => (paid <= 0 ? 'UNPAID' : paid >= amount ? 'PAID' : 'PARTIALLY_PAID');

export interface ReportFilter { from?: string; to?: string; q?: string; status?: InvoiceStatus; groupId?: number; studentId?: number }

export interface ReportRow {
  id: number; studentId: number; studentName: string; groupId: number; groupName: string; period: string;
  issuedAt: string; dueDate: string; total: number; paid: number; debt: number; status: InvoiceStatus; overdue: boolean;
}

const DAY = 86_400_000;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((ms(a) - ms(b)) / DAY);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Invoice) private invoices: Repository<Invoice>,
    @InjectRepository(Payment) private payments: Repository<Payment>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Group) private groups: Repository<Group>,
  ) {}

  /** Checks the filter and fills in nothing: both dates or neither. */
  checkFilter(f: ReportFilter) {
    if ((f.from && !f.to) || (!f.from && f.to)) throw unprocessable("Boshlanish va tugash sanasini birga tanlang.", 'from');
    if (f.from && (!isDate(f.from) || !isDate(f.to!))) throw unprocessable("Sana YYYY-MM-DD ko'rinishida bo'lsin.", 'from');
    if (f.from && f.from > f.to!) throw unprocessable("Boshlanish sanasi tugash sanasidan keyin bo'lmasin.", 'from');
    if (f.from && diffDays(f.to!, f.from) > 3660) throw unprocessable("Oraliq 10 yildan oshmasin.", 'to');
    if (f.status && !STATUSES.includes(f.status)) throw unprocessable("Holat PAID, UNPAID yoki PARTIALLY_PAID bo'lsin.", 'status');
  }

  /** EVERY invoice that matches the filter (no paging), with the money paid so far. */
  async rows(f: ReportFilter): Promise<ReportRow[]> {
    const where: FindOptionsWhere<Invoice> = {};
    if (f.from && f.to) where.issuedAt = Between(f.from, f.to);
    else if (f.from) where.issuedAt = MoreThanOrEqual(f.from);
    else if (f.to) where.issuedAt = LessThanOrEqual(f.to);
    if (f.groupId) where.groupId = f.groupId;
    if (f.studentId) where.studentId = f.studentId;
    const [invoices, sums, users, groups] = await Promise.all([
      this.invoices.find({ where, order: { issuedAt: 'DESC', id: 'DESC' } }),
      this.payments.createQueryBuilder('p').select('p.invoiceId', 'invoiceId').addSelect('SUM(p.amount)', 'paid').where('p.invoiceId IS NOT NULL').groupBy('p.invoiceId').getRawMany<{ invoiceId: number | string; paid: number | string }>(),
      this.users.find({ select: { id: true, fullName: true } }),
      this.groups.find({ select: { id: true, name: true } }),
    ]);
    const paidBy = new Map(sums.map((s) => [Number(s.invoiceId), Number(s.paid)]));
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const today = dateStr(new Date());
    const q = f.q?.trim().toLowerCase();
    const out: ReportRow[] = [];
    for (const i of invoices) {
      const studentName = userName.get(i.studentId) ?? '';
      if (q && !studentName.toLowerCase().includes(q)) continue;
      const paid = Math.min(paidBy.get(i.id) ?? 0, i.amount); // never more than owed, so the debt is never negative
      const status = statusOf(i.amount, paid);
      if (f.status && status !== f.status) continue;
      const debt = i.amount - paid;
      out.push({ id: i.id, studentId: i.studentId, studentName, groupId: i.groupId, groupName: groupName.get(i.groupId) ?? '', period: i.period, issuedAt: i.issuedAt, dueDate: i.dueDate, total: i.amount, paid, debt, status, overdue: debt > 0 && i.dueDate < today });
    }
    return out;
  }

  /**
   * Every sum is taken from the invoices once: total = paid + debt, paid = fully paid + the paid part of partial ones,
   * debt = unpaid + the unpaid rest of partial ones. So nothing is counted twice.
   */
  summarize(rows: ReportRow[]) {
    const s = { totalSales: 0, paid: 0, debt: 0, unpaidAmount: 0, partialPaid: 0, partialRemaining: 0, paidInFull: 0, overdueDebt: 0, paymentPercent: 0, invoices: rows.length, counts: { PAID: 0, UNPAID: 0, PARTIALLY_PAID: 0 } as Record<InvoiceStatus, number> };
    for (const r of rows) {
      s.totalSales += r.total; s.paid += r.paid; s.debt += r.debt; s.counts[r.status]++;
      if (r.overdue) s.overdueDebt += r.debt;
      if (r.status === 'UNPAID') s.unpaidAmount += r.total;
      else if (r.status === 'PAID') s.paidInFull += r.paid;
      else { s.partialPaid += r.paid; s.partialRemaining += r.debt; }
    }
    s.paymentPercent = pct(s.paid, s.totalSales);
    return s;
  }

  /** Sales per bucket (1, 7 or 30 days) of the period and of the period just before it, side by side. */
  private series(current: ReportRow[], previous: ReportRow[], from: string, to: string) {
    const days = diffDays(to, from) + 1;
    const size = days <= 31 ? 1 : days <= 92 ? 7 : 30;
    const n = Math.ceil(days / size);
    const prevFrom = addDays(from, -days);
    const points = Array.from({ length: n }, (_, i) => ({ label: addDays(from, i * size), previousLabel: addDays(prevFrom, i * size), current: 0, previous: 0, paid: 0 }));
    for (const r of current) { const p = points[Math.floor(diffDays(r.issuedAt, from) / size)]; if (p) { p.current += r.total; p.paid += r.paid; } }
    for (const r of previous) { const p = points[Math.floor(diffDays(r.issuedAt, prevFrom) / size)]; if (p) p.previous += r.total; }
    return { bucketDays: size, points };
  }

  async report(f: ReportFilter, page = 1, limit = 20) {
    this.checkFilter(f);
    limit = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
    page = Math.max(Math.trunc(page) || 1, 1);
    const rows = await this.rows(f);
    const summary = this.summarize(rows);
    let comparison: unknown = null;
    let series: unknown = null;
    if (f.from && f.to) {
      const days = diffDays(f.to, f.from) + 1;
      const prev = { ...f, from: addDays(f.from, -days), to: addDays(f.from, -1) };
      const prevRows = await this.rows(prev);
      const ps = this.summarize(prevRows);
      const growth = (cur: number, before: number) => (before > 0 ? Math.round(((cur - before) / before) * 1000) / 10 : null);
      comparison = {
        previousFrom: prev.from, previousTo: prev.to, previousTotalSales: ps.totalSales, previousPaid: ps.paid,
        growthPercent: growth(summary.totalSales, ps.totalSales), paidGrowthPercent: growth(summary.paid, ps.paid),
      };
      series = this.series(rows, prevRows, f.from, f.to);
    }
    const totalRows = rows.length;
    return { filters: { from: f.from ?? null, to: f.to ?? null, q: f.q ?? '', status: f.status ?? null, groupId: f.groupId ?? null }, summary, comparison, series, rows: rows.slice((page - 1) * limit, page * limit), page, limit, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / limit)) };
  }

  /** A real .xlsx: "Summary" (filters, totals, growth), "Payments" (ALL matching sales) and "Transactions" (each payment). */
  async exportXlsx(f: ReportFilter) {
    this.checkFilter(f);
    const rows = await this.rows(f);
    const summary = this.summarize(rows);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Skills Up';
    wb.created = new Date();
    const MONEY = '#,##0';
    const head = (row: ExcelJS.Row) => { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }; row.alignment = { vertical: 'middle' }; };
    const STATUS_UZ: Record<InvoiceStatus, string> = { PAID: "To'langan", UNPAID: "To'lanmagan", PARTIALLY_PAID: "Qisman to'langan" };

    const s = wb.addWorksheet('Summary');
    s.columns = [{ width: 34 }, { width: 28 }];
    s.addRow(["To'lovlar va savdo hisoboti"]).font = { bold: true, size: 14 };
    s.addRow([]);
    s.addRow(['Filtrlar']).font = { bold: true };
    s.addRow(['Sana oralig\'i', f.from && f.to ? `${f.from} — ${f.to}` : 'Hammasi']);
    s.addRow(["Mijoz qidiruvi", f.q?.trim() || '—']);
    s.addRow(['Holat', f.status ?? 'Hammasi']);
    const gName = f.groupId ? (await this.groups.findOneBy({ id: f.groupId }))?.name : null;
    s.addRow(['Guruh', gName ?? 'Hammasi']);
    s.addRow(['Yaratilgan vaqt', new Date().toISOString()]);
    s.addRow([]);
    s.addRow(['Ko\'rsatkichlar (so\'m)']).font = { bold: true };
    const metrics: [string, number | string, boolean][] = [
      ['Jami savdo', summary.totalSales, true], ["To'langan summa", summary.paid, true], ["To'lanmagan summa", summary.unpaidAmount, true],
      ["Qisman to'langan (to'langan qismi)", summary.partialPaid, true], ["Qisman to'langan (qolgan qarz)", summary.partialRemaining, true],
      ['Jami qarz', summary.debt, true], ["To'lov foizi (%)", summary.paymentPercent, false], ['Sotuvlar soni', summary.invoices, false],
      ["To'langan / To'lanmagan / Qisman", `${summary.counts.PAID} / ${summary.counts.UNPAID} / ${summary.counts.PARTIALLY_PAID}`, false],
    ];
    for (const [k, v, money] of metrics) { const r = s.addRow([k, v]); if (money) r.getCell(2).numFmt = MONEY; r.getCell(2).alignment = { horizontal: 'right' }; }
    if (f.from && f.to) {
      const days = diffDays(f.to, f.from) + 1;
      const prev = { ...f, from: addDays(f.from, -days), to: addDays(f.from, -1) };
      const ps = this.summarize(await this.rows(prev));
      s.addRow([]);
      s.addRow(['Oldingi davr bilan solishtirish']).font = { bold: true };
      s.addRow(['Oldingi davr', `${prev.from} — ${prev.to}`]);
      const r = s.addRow(['Oldingi davr savdosi', ps.totalSales]); r.getCell(2).numFmt = MONEY;
      s.addRow(['Savdo o\'sishi (%)', ps.totalSales > 0 ? Math.round(((summary.totalSales - ps.totalSales) / ps.totalSales) * 1000) / 10 : "Oldingi davrda savdo yo'q"]).getCell(2).alignment = { horizontal: 'right' };
    }

    const p = wb.addWorksheet('Payments', { views: [{ state: 'frozen', ySplit: 1 }] });
    p.columns = [
      { header: '№', key: 'n', width: 6 }, { header: 'Mijoz', key: 'student', width: 28 }, { header: 'Guruh', key: 'group', width: 24 }, { header: 'Davr', key: 'period', width: 10 },
      { header: 'Savdo sanasi', key: 'issued', width: 14 }, { header: "To'lov muddati", key: 'due', width: 14 }, { header: 'Umumiy summa', key: 'total', width: 16 },
      { header: "To'langan", key: 'paid', width: 16 }, { header: 'Qolgan qarz', key: 'debt', width: 16 }, { header: 'Holat', key: 'status', width: 18 },
    ];
    head(p.getRow(1));
    rows.forEach((r, i) => p.addRow({ n: i + 1, student: r.studentName, group: r.groupName, period: r.period, issued: r.issuedAt, due: r.dueDate, total: r.total, paid: r.paid, debt: r.debt, status: STATUS_UZ[r.status] }));
    for (const k of ['total', 'paid', 'debt']) p.getColumn(k).numFmt = MONEY;
    p.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };
    const tot = p.addRow({ student: 'JAMI', total: summary.totalSales, paid: summary.paid, debt: summary.debt });
    tot.font = { bold: true };

    const t = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });
    t.columns = [
      { header: 'Savdo №', key: 'inv', width: 10 }, { header: 'Mijoz', key: 'student', width: 28 }, { header: 'Guruh', key: 'group', width: 24 },
      { header: "To'lov sanasi", key: 'date', width: 14 }, { header: 'Summa', key: 'amount', width: 16 }, { header: "To'lov usuli", key: 'method', width: 20 }, { header: 'Izoh', key: 'note', width: 30 },
    ];
    head(t.getRow(1));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ids = [...byId.keys()];
    const pays = ids.length ? (await this.payments.find({ order: { paidAt: 'ASC', id: 'ASC' } })).filter((x) => x.invoiceId !== null && byId.has(x.invoiceId)) : [];
    for (const x of pays) { const r = byId.get(x.invoiceId!)!; t.addRow({ inv: r.id, student: r.studentName, group: r.groupName, date: x.paidAt, amount: x.amount, method: x.method, note: x.description }); }
    t.getColumn('amount').numFmt = MONEY;

    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
