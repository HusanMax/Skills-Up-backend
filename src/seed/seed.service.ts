import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, IsNull } from 'typeorm';
import { addHours, dateStr, endTime } from '../common/dates';
import { Day, HwStatus, Role } from '../common/enums';
import { DEMO_PASSWORDS } from '../config/rules';
import {
  Activity, Attendance, CareerVideo, Faq, Group, GroupMember, GroupSchedule, Guide, Homework, Invoice, Lesson, LessonProgress, Payment, PaymentPlan, Room,
  StudentHomework, Submission, User, UserSettings,
} from '../entities';
import { SessionsService } from '../auth/sessions.service';
import { UsersService } from '../users/users.service';

/** Small deterministic hash: the same demo data every time the database is created. */
function h(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return x >>> 0;
}

const loginOf = (name: string) =>
  name.toLowerCase().replace(/['‘’ʻ]/g, '').replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');

const GR1 = ['Madina Yusupova', 'Jasur Karimov', 'Dilnoza Ergasheva', 'Sardor Aliyev', 'Aziza Nurmatova', 'Otabek Qodirov', "Nilufar Toshpo'latova", 'Sherzod Mirzayev', 'Malika Ismoilova'];
const GR2 = ['Zilola Hasanova', 'Timur Sodiqov', 'Gulnoza Abdullayeva', 'Behruz Ahmedov', 'Shahzoda Qosimova', 'Doniyor Ibragimov', 'Feruza Nazarova', 'Laylo Sobirova'];
const GR3 = ['Rustam Valiyev', 'Nodira Ergasheva', 'Eldor Tursunov', 'Sevara Hamidova', "Ulug'bek Nazarov", 'Kamola Yusupova', 'Hasan Mirzaev'];

const LESSONS_GR1 = ['Semantik HTML', 'Flexbox asoslari', 'CSS Grid maketlari', "O'zgaruvchilar va turlar", 'Asinxron kod va Promise', 'TypeScript generiklari', 'Komponentlar va props', "React Hooks chuqur o'rganish", "Maxsus hook'lar", 'Holatni boshqarish', 'Vitest bilan testlash'];
const LESSONS_GR2 = ['UI/UX dizayn nima?', 'Foydalanuvchi tadqiqoti', 'Wireframe va prototiplash', 'Figma bilan ishlash'];
const LESSONS_GR3 = ['Node.js asoslari', 'Express va REST API', "SQL va ma'lumotlar bazasi", 'Autentifikatsiya'];

/**
 * Fills an EMPTY database with demo data (accounts, groups, rooms, lessons, homework in every state, payments, content).
 * Runs on start when SEED_DEMO is not "false" (development). Never use these passwords in production.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private log = new Logger('Seed');
  constructor(private ds: DataSource, private config: ConfigService, private users: UsersService, private sessions: SessionsService) {}

  async onApplicationBootstrap() {
    if (this.config.get('SEED_DEMO', 'true') !== 'false' && (await this.ds.manager.count(User)) === 0) await this.run();
    await this.backfillInvoices();
    await this.syncAdminFromEnv();
  }

  /**
   * Payments saved before invoices existed have no sale to belong to. Each student/group/month of them becomes one
   * invoice worth exactly what was paid (so it reads PAID) and the payments are linked to it. Runs only for payments
   * without an invoice, so after the first time it does nothing.
   */
  private async backfillInvoices() {
    const em = this.ds.manager;
    const legacy = await em.find(Payment, { where: { invoiceId: IsNull() }, order: { paidAt: 'ASC', id: 'ASC' } });
    if (!legacy.length) return;
    const buckets = new Map<string, Payment[]>();
    for (const p of legacy) {
      const key = `${p.studentId}|${p.groupId}|${p.paidAt.slice(0, 7)}`;
      buckets.set(key, [...(buckets.get(key) ?? []), p]);
    }
    for (const list of buckets.values()) {
      const first = list[0]!;
      const period = first.paidAt.slice(0, 7);
      const existing = await em.findOneBy(Invoice, { studentId: first.studentId, groupId: first.groupId, period });
      const invoice = existing ?? (await em.save(Invoice, em.create(Invoice, { studentId: first.studentId, groupId: first.groupId, period, issuedAt: first.paidAt, dueDate: first.paidAt, amount: list.reduce((s, p) => s + p.amount, 0) })));
      await em.update(Payment, { id: In(list.map((p) => p.id)) }, { invoiceId: invoice.id });
    }
    this.log.log(`${legacy.length} old payment(s) linked to ${buckets.size} invoice(s)`);
  }

  /**
   * The administrator's login and password live in the environment (ADMIN_LOGIN, ADMIN_PASSWORD), not in the code.
   * On every start the backend makes the database match them: it creates the admin account when it is missing and
   * replaces the password when it differs (then all sessions of that admin end). The login screen then simply checks
   * the typed password against it. Without ADMIN_PASSWORD nothing is touched.
   */
  private async syncAdminFromEnv() {
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!password) return;
    const login = (this.config.get<string>('ADMIN_LOGIN') || 'admin').trim().toLowerCase();
    if (password.length < 8) throw new Error("ADMIN_PASSWORD kamida 8 ta belgidan iborat bo'lsin.");
    const existing = await this.users.findForLogin(login);
    if (!existing) {
      await this.users.create({ role: Role.ADMIN, login, password, fullName: 'Administrator' });
      this.log.log(`Admin account "${login}" created from ADMIN_PASSWORD`);
    } else if (existing.role !== Role.ADMIN) {
      throw new Error(`ADMIN_LOGIN "${login}" boshqa rolga tegishli (${existing.role}). Boshqa login tanlang.`);
    } else if (!this.users.verifyPassword(password, existing.passwordHash)) {
      await this.ds.manager.update(User, existing.id, { passwordHash: this.users.hash(password), passwordChangedAt: new Date() });
      await this.sessions.endAll(existing.id);
      this.log.log(`Admin "${login}" password updated from ADMIN_PASSWORD (old sessions ended)`);
    }
  }

  async run() {
    const em = this.ds.manager;
    const now = new Date();
    const day = (offset: number, hour = 18) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, 0, 0);
      return d;
    };
    const pw = (p: string) => this.users.hash(p);
    const mkUser = async (role: Role, fullName: string, login: string, password: string, phoneSeed: number) =>
      em.save(User, em.create(User, {
        role, login, fullName, passwordHash: pw(password), passwordChangedAt: null, email: null, bio: null, isActive: true,
        phone: `+998 9${phoneSeed % 10} ${100 + (phoneSeed % 900)} ${String(phoneSeed % 100).padStart(2, '0')} ${String((phoneSeed >> 3) % 100).padStart(2, '0')}`,
      }));

    // ---- people ----
    const admin = await mkUser(Role.ADMIN, 'Sardor Ismoilov', 'admin', DEMO_PASSWORDS.ADMIN, 5550102);
    const t1 = await mkUser(Role.TEACHER, 'Dilnoza Rahimova', 'dilnoza.rahimova', DEMO_PASSWORDS.TEACHER, 2345678);
    const t2 = await mkUser(Role.TEACHER, 'Gulnora Saidova', 'gulnora.saidova', DEMO_PASSWORDS.TEACHER, 3112245);
    await mkUser(Role.TEACHER, 'Jasur Karimov', 'jasur.karimov', DEMO_PASSWORDS.TEACHER, 6401829); // teaches no group yet
    const me = await mkUser(Role.STUDENT, 'Bekzod Rahimov', 'bekzod.rahimov', DEMO_PASSWORDS.STUDENT, 9012345);
    const used = new Set(['bekzod.rahimov', 'jasur.karimov']);
    const student = async (name: string, i: number) => {
      let login = loginOf(name);
      if (used.has(login)) login = `${login}1`;
      used.add(login);
      return mkUser(Role.STUDENT, name, login, DEMO_PASSWORDS.STUDENT, 7000000 + i * 137);
    };
    // one after another: the file database hands out generated ids one at a time
    const create = async (names: string[], from: number) => {
      const out: User[] = [];
      for (const [i, n] of names.entries()) out.push(await student(n, from + i));
      return out;
    };
    const s1 = await create(GR1, 0);
    const s2 = await create(GR2, 20);
    const s3 = await create(GR3, 40);
    const everyone = [admin, t1, t2, me, ...s1, ...s2, ...s3];
    await em.insert(UserSettings, everyone.map((u) => ({ userId: u.id, notifyEmail: true, notifyPush: true, notifyReminders: true, theme: 'dark' })));

    // ---- rooms and groups ----
    const [A, B, C, D] = await em.save(Room, [
      em.create(Room, { name: 'A xona', capacity: 12 }), em.create(Room, { name: 'B xona', capacity: 12 }),
      em.create(Room, { name: 'C xona', capacity: 10 }), em.create(Room, { name: 'Dizayn studiyasi', capacity: 10 }),
    ]);
    void C;
    const gr1 = await em.save(Group, em.create(Group, { name: 'Fullstack dasturlash', course: 'Frontend va backend asoslari', teacherId: t1.id, isActive: true }));
    const gr2 = await em.save(Group, em.create(Group, { name: 'UI/UX dizayn', course: 'Foydalanuvchi interfeysi va tajribasi', teacherId: t2.id, isActive: true }));
    const gr3 = await em.save(Group, em.create(Group, { name: 'Backend asoslari', course: "Node.js, REST API va ma'lumotlar bazasi", teacherId: t1.id, isActive: true }));
    const slot = (groupId: number, d: Day, start: string, roomId: number | null, endOverride?: string) =>
      em.create(GroupSchedule, { groupId, day: d, startTime: start, endTime: endOverride ?? endTime(start), roomId });
    await em.save(GroupSchedule, [
      slot(gr1.id, Day.MON, '18:00', A!.id), slot(gr1.id, Day.WED, '18:00', A!.id), slot(gr1.id, Day.FRI, '17:00', null, '18:00'), // Friday is an online Q&A
      slot(gr2.id, Day.TUE, '18:00', D!.id), slot(gr2.id, Day.THU, '18:00', D!.id),
      slot(gr3.id, Day.TUE, '18:00', B!.id), slot(gr3.id, Day.SAT, '10:00', B!.id),
    ]);
    const m1 = [me, ...s1], m2 = [me, ...s2], m3 = [...s3, s1[1]!, s1[3]!];
    await em.insert(GroupMember, [...m1.map((u) => ({ groupId: gr1.id, studentId: u.id })), ...m2.map((u) => ({ groupId: gr2.id, studentId: u.id })), ...m3.map((u) => ({ groupId: gr3.id, studentId: u.id }))]);

    // ---- payments ----
    const due = (offset: number) => dateStr(day(offset));
    await em.insert(PaymentPlan, [
      { groupId: gr1.id, amount: 500_000, dueDate: due(22) }, { groupId: gr2.id, amount: 400_000, dueDate: due(25) }, { groupId: gr3.id, amount: 450_000, dueDate: due(28) },
    ]);
    const pays: Partial<Payment>[] = [];
    // sales for the last 3 months: every student of every group gets one invoice per month; some are paid in full,
    // some in part (sometimes in two instalments), some not at all
    const METHODS = ['Uzcard •• 8600', 'Humo •• 9860', 'Naqd pul', 'Payme'];
    const rest = (a: number) => a - Math.round((a * 0.4) / 1000) * 1000;
    for (const [gi, [g, amount, members]] of ([[gr1, 500_000, m1], [gr2, 400_000, m2], [gr3, 450_000, m3]] as [Group, number, User[]][]).entries()) {
      for (const [si, u] of members.entries()) {
        for (let k = 2; k >= 0; k--) {
          const base = -31 * k - 3 - (si % 7); // 31 days apart, so every invoice falls in its own calendar month
          const issuedAt = due(base);
          const invoice = await em.save(Invoice, em.create(Invoice, { studentId: u.id, groupId: g.id, period: issuedAt.slice(0, 7), issuedAt, dueDate: due(base + 10), amount }));
          const kind = u === me ? (k >= 1 || gi === 1 ? 'PAID' : 'UNPAID') : [ 'PAID', 'PAID', 'PARTIAL', 'UNPAID' ][(si + k + gi) % 4];
          const pay = (part: number, extra: number) => pays.push({ invoiceId: invoice.id, studentId: u.id, groupId: g.id, amount: part, paidAt: due(Math.min(base + extra, 0)), method: METHODS[(si + gi) % METHODS.length]!, description: "Standart to'lov" });
          if (kind === 'PAID' && si % 2 === 1 && u !== me) { pay(Math.round((amount * 0.4) / 1000) * 1000, 1); pay(rest(amount), 6); }
          else if (kind === 'PAID') pay(amount, 2 + (si % 3));
          else if (kind === 'PARTIAL') pay(Math.round((amount * 0.4) / 1000) * 1000, 3);
        }
      }
    }
    await em.insert(Payment, pays);

    // ---- lessons, homework, progress, submissions ----
    const makeLessons = async (group: Group, titles: string[], members: User[], teacher: User, hasUpcomingExam: string | null, spacing: number) => {
      const total = titles.length;
      for (let i = 0; i < total; i++) {
        const startsAt = day(-(total - i) * spacing + 2);
        const lesson = await em.save(Lesson, em.create(Lesson, {
          groupId: group.id, title: titles[i]!, startsAt, durationMin: 25 + (i % 4) * 10,
          description: `${titles[i]} mavzusi bo'yicha dars: asosiy tushunchalar va amaliy mashqlar.`,
          videoUrl: null, videoFileId: null, isExam: false, attendanceSaved: i < total - 2, createdById: teacher.id,
        }));
        const ageDays = Math.round((now.getTime() - startsAt.getTime()) / 86_400_000);
        const hasHw = i !== 3 || group.id !== gr1.id; // one lesson without homework
        const assignedAt = addHours(startsAt, 0.5);
        const limit = [24, 72, 24, 168][i % 4]!;
        const dueAt = addHours(assignedAt, limit);
        const hw = hasHw
          ? await em.save(Homework, em.create(Homework, { lessonId: lesson.id, task: `“${titles[i]}” mavzusi bo'yicha amaliy topshiriqni bajaring.`, steps: ['Mavzuni takrorlang.', 'Topshiriqni kodda yoki hujjatda bajaring.', 'Natijani fayl yoki matn sifatida yuboring.'], assignedAt, dueAt, timeLimitHours: limit }))
          : null;
        const progressRows: Partial<LessonProgress>[] = [];
        const attendanceRows: Partial<Attendance>[] = [];
        const shRows: Partial<StudentHomework>[] = [];
        const subRows: Partial<Submission>[] = [];
        for (const st of members) {
          const r = h(`${lesson.id}:${st.id}`) % 100;
          const watched = r < 82;
          progressRows.push({ lessonId: lesson.id, studentId: st.id, percent: watched ? 100 : 20 + (r % 50), completedAt: watched ? addHours(startsAt, 3) : null, updatedAt: addHours(startsAt, 3) });
          if (lesson.attendanceSaved) attendanceRows.push({ lessonId: lesson.id, studentId: st.id, present: watched, markedById: teacher.id, markedAt: addHours(startsAt, 4) });
          if (!hw) continue;
          const q = h(`hw${lesson.id}:${st.id}`) % 100;
          const recent = ageDays <= 10;
          let status: HwStatus;
          if (!recent) status = q < 88 ? HwStatus.DONE : HwStatus.NOT_DONE;
          else status = q < 35 ? HwStatus.DONE : q < 55 ? HwStatus.PENDING : q < 65 ? HwStatus.RETURNED : HwStatus.NOT_DONE;
          const late = status !== HwStatus.NOT_DONE && q % 7 === 0;
          const row: Partial<StudentHomework> = { homeworkId: hw.id, studentId: st.id, status, assignedAt, dueAt, grade: null, feedback: null, gradedAt: null, gradedById: null };
          if (status === HwStatus.DONE) {
            row.grade = 55 + (h(`g${lesson.id}:${st.id}`) % 46);
            row.gradedAt = addHours(dueAt, 6);
            row.gradedById = teacher.id;
          }
          if (status === HwStatus.RETURNED) {
            row.feedback = 'Iltimos, xatolarni tuzatib qayta yuboring.';
            row.assignedAt = addHours(now, -1);
            row.dueAt = addHours(now, 23);
          }
          shRows.push(row);
          if (status !== HwStatus.NOT_DONE) subRows.push({ homeworkId: hw.id, studentId: st.id, text: 'Topshiriq bajarildi.', submittedAt: late ? addHours(dueAt, 2) : addHours(dueAt, -5), isLate: late });
        }
        await em.insert(LessonProgress, progressRows);
        if (attendanceRows.length) await em.insert(Attendance, attendanceRows);
        if (shRows.length) await em.insert(StudentHomework, shRows);
        if (subRows.length) await em.insert(Submission, subRows);
      }
      if (hasUpcomingExam) {
        await em.save(Lesson, em.create(Lesson, { groupId: group.id, title: hasUpcomingExam, startsAt: day(7), durationMin: 60, description: '', videoUrl: null, videoFileId: null, isExam: true, attendanceSaved: false, createdById: teacher.id }));
      }
    };
    await makeLessons(gr1, LESSONS_GR1, m1, t1, "To'liq stack loyiha", 5);
    await makeLessons(gr2, LESSONS_GR2, m2, t2, null, 7);
    await makeLessons(gr3, LESSONS_GR3, m3, t1, null, 7);

    // ---- content ----
    await em.insert(CareerVideo, [
      { title: 'Rezyume yozish sirlari', topic: 'Rezyume', durationMin: 18, description: 'Ish beruvchi e\'tiborini tortadigan rezyume qanday bo\'ladi.', videoUrl: null },
      { title: 'Portfolio yaratish', topic: 'Portfolio', durationMin: 24, description: "Loyihalaringizni to'g'ri taqdim etish.", videoUrl: null },
      { title: 'Texnik suhbatga tayyorgarlik', topic: 'Suhbat', durationMin: 31, description: 'Suhbatda tez-tez beriladigan savollar va javoblar.', videoUrl: null },
    ]);
    await em.insert(Guide, [
      { title: "XP ni qanday tezroq yig'ish mumkin", category: 'Boshlash', readMin: 4, summary: "Davomat va vazifa ballari XP va kumushga qanday aylanishini bilib oling.", body: "Darsga qatnashsangiz (videoni oxirigacha ko'rsangiz) har safar 10 ball olasiz: bu 10 XP va 5 kumush. Vazifa 1 dan 100 gacha baholanadi: 1 ball = 1 XP, har 2 ball = 1 kumush. Muddatdan keyin topshirilsa, ball 10 taga kamayadi." },
      { title: "Texnik suhbatga tayyorgarlik", category: 'Karyera', readMin: 8, summary: "Ishonch bilan mashq qilish uchun oddiy haftalik reja.", body: "Asoslarni takrorlang, kuniga bitta kichik masala yeching va fikringizni ovoz chiqarib tushuntiring." },
    ]);
    await em.insert(Faq, [
      { question: "Profil ma'lumotlarimni o'zgartirsam bo'ladimi?", answer: "Yo'q. Ism, email va telefonni o'zgartirib bo'lmaydi. Faqat parolni o'zgartirish mumkin; login va parolni administrator ham o'zgartira oladi." },
      { question: "Imtihonga kirish uchun nima kerak?", answer: "Oxirgi imtihondan beri o'tilgan darslarning uyga vazifalari topshirilgan bo'lishi kerak." },
      { question: "Kechikib topshirsam nima bo'ladi?", answer: "Vazifa qabul qilinadi, lekin baholangan balldan 10 ball ayiriladi." },
    ]);
    await em.insert(Activity, [
      { studentId: me.id, type: 'group', text: "“Fullstack dasturlash” guruhiga qo'shildingiz", xp: null },
      { studentId: me.id, type: 'lesson', text: '“Semantik HTML” darsini tugatdingiz', xp: 20 },
    ]);
    this.log.log(`Demo data created. Logins: admin / ${DEMO_PASSWORDS.ADMIN}, dilnoza.rahimova / ${DEMO_PASSWORDS.TEACHER}, bekzod.rahimov / ${DEMO_PASSWORDS.STUDENT}`);
  }
}
