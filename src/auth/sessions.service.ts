import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { LessThan, Not, Repository } from 'typeorm';
import { Role } from '../common/enums';
import { Session, User } from '../entities';
import { addHours } from '../common/dates';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Sign-in sessions. Logging in creates a random token; only its hash is stored, together with an expiry time.
 * The token is sent as `Authorization: Bearer <token>`. Logging out, changing the password or an expired time ends it.
 */
@Injectable()
export class SessionsService {
  private hours: number;

  constructor(
    config: ConfigService,
    @InjectRepository(Session) private sessions: Repository<Session>,
    @InjectRepository(User) private users: Repository<User>,
  ) {
    this.hours = Number(config.get('SESSION_HOURS', '12')) || 12;
  }

  /** Starts a session and returns the token (the only time it is visible). */
  async start(userId: number) {
    await this.sessions.delete({ userId, expiresAt: LessThan(new Date()) }); // tidy this user's old sessions
    const token = randomBytes(32).toString('hex');
    await this.sessions.save(this.sessions.create({ userId, tokenHash: hashToken(token), expiresAt: addHours(new Date(), this.hours) }));
    return token;
  }

  /** The user behind a token, or null when the token is unknown, expired, or the user was deactivated. */
  async authenticate(token: string): Promise<{ id: number; role: Role; sessionId: number } | null> {
    const s = await this.sessions.findOneBy({ tokenHash: hashToken(token) });
    if (!s || s.expiresAt <= new Date()) return null;
    const user = await this.users.findOneBy({ id: s.userId });
    if (!user || !user.isActive) return null;
    return { id: user.id, role: user.role as Role, sessionId: s.id };
  }

  end(sessionId: number) {
    return this.sessions.delete({ id: sessionId });
  }

  /** Ends all of a user's sessions (optionally keeping the current one), e.g. after a password change. */
  endAll(userId: number, exceptSessionId?: number) {
    return this.sessions.delete(exceptSessionId ? { userId, id: Not(exceptSessionId) } : { userId });
  }
}
