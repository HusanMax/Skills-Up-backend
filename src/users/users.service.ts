import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Role } from '../common/enums';
import { User, UserSettings } from '../entities';

export const LOGIN_RE = /^[a-z0-9._-]{4,30}$/;
export const PHONE_RE = /^\+998[ -]?\d{2}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}$/;

export function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  if (!PHONE_RE.test(t)) return null;
  const d = t.replace(/\D/g, '');
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(UserSettings) private settings: Repository<UserSettings>,
  ) {}

  hash(password: string) {
    return bcrypt.hashSync(password, 10);
  }

  /** The login is looked up in lower case; the password hash is selected explicitly (it is hidden by default). */
  findForLogin(login: string) {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.login = :login', { login: login.trim().toLowerCase() })
      .getOne();
  }

  verifyPassword(password: string, hash: string) {
    return bcrypt.compareSync(password, hash);
  }

  async byId(id: number) {
    const u = await this.users.findOneBy({ id });
    if (!u) throw new NotFoundException('Foydalanuvchi topilmadi.');
    return u;
  }

  async isLoginTaken(login: string, exceptId?: number) {
    const u = await this.users.findOneBy({ login: login.trim().toLowerCase() });
    return !!u && u.id !== exceptId;
  }

  /** Creates a user. Throws 422 when the login is taken or invalid. */
  async create(input: { role: Role; login: string; password: string; fullName: string; phone?: string | null }) {
    const login = input.login.trim().toLowerCase();
    if (!LOGIN_RE.test(login)) throw new UnprocessableEntityException({ code: 'VALIDATION_ERROR', message: "Login 4–30 ta belgi: kichik lotin harflari, raqam, nuqta, chiziq.", fields: { login: 'Noto\'g\'ri login.' } });
    if (await this.isLoginTaken(login)) throw new UnprocessableEntityException({ code: 'VALIDATION_ERROR', message: 'Bunday login band. Boshqa login tanlang.', fields: { login: 'Bunday login band.' } });
    const user = await this.users.save(
      this.users.create({
        role: input.role,
        login,
        passwordHash: this.hash(input.password),
        fullName: input.fullName.trim(),
        phone: input.phone ?? null,
        email: null,
        bio: null,
        passwordChangedAt: null,
        isActive: true,
      }),
    );
    await this.settings.save(this.settings.create({ userId: user.id }));
    return user;
  }

  /** Admin changes someone's login and/or password. */
  async changeAccount(userId: number, input: { login?: string; password?: string }) {
    const user = await this.byId(userId);
    if (input.login !== undefined) {
      const login = input.login.trim().toLowerCase();
      if (!LOGIN_RE.test(login)) throw new UnprocessableEntityException({ code: 'VALIDATION_ERROR', message: "Login 4–30 ta belgi: kichik lotin harflari, raqam, nuqta, chiziq.", fields: { login: 'Noto\'g\'ri login.' } });
      if (await this.isLoginTaken(login, userId)) throw new UnprocessableEntityException({ code: 'VALIDATION_ERROR', message: 'Bunday login band. Boshqa login tanlang.', fields: { login: 'Bunday login band.' } });
      user.login = login;
    }
    if (input.password) {
      user.passwordHash = this.hash(input.password);
      user.passwordChangedAt = new Date();
    }
    await this.users.save(user);
  }

  /** The signed-in user changes their own password. */
  async changeOwnPassword(userId: number, current: string, next: string) {
    const u = await this.users.createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :userId', { userId }).getOneOrFail();
    if (!this.verifyPassword(current, u.passwordHash)) throw new UnprocessableEntityException({ code: 'VALIDATION_ERROR', message: "Joriy parol noto'g'ri.", fields: { current: "Joriy parol noto'g'ri." } });
    if (current === next) throw new UnprocessableEntityException({ code: 'VALIDATION_ERROR', message: "Yangi parol joriy paroldan farq qilishi kerak.", fields: { next: 'Farq qilishi kerak.' } });
    u.passwordHash = this.hash(next);
    u.passwordChangedAt = new Date();
    await this.users.save(u);
  }

  async getSettings(userId: number) {
    return (await this.settings.findOneBy({ userId })) ?? (await this.settings.save(this.settings.create({ userId })));
  }

  async updateSettings(userId: number, patch: Partial<Pick<UserSettings, 'notifyEmail' | 'notifyPush' | 'notifyReminders' | 'theme'>>) {
    const s = await this.getSettings(userId);
    Object.assign(s, patch);
    return this.settings.save(s);
  }

  /** Names for a list of ids. */
  async namesOf(ids: number[]): Promise<Map<number, User>> {
    if (!ids.length) return new Map();
    const rows = await this.users.createQueryBuilder('u').where('u.id IN (:...ids)', { ids }).getMany();
    return new Map(rows.map((u) => [u.id, u]));
  }
}
