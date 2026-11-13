import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { SessionsService } from './sessions.service';

const WRONG = "Login yoki parol noto'g'ri.";
// compared against when the login does not exist, so the answer takes the same time either way
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.0r8nQp6bQ0s5QzEw1gGkqgQmQe7e';

@Injectable()
export class AuthService {
  constructor(private users: UsersService, private sessions: SessionsService) {}

  async login(login: string, password: string) {
    const user = await this.users.findForLogin(login);
    const ok = this.users.verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.isActive || !ok) throw new UnauthorizedException(WRONG); // never say which of the two was wrong
    return this.open(user);
  }

  /** Starts a session for the user: the answer carries the token the client sends from now on. */
  async open(user: { id: number; role: string; fullName: string }) {
    return { token: await this.sessions.start(user.id), user: { id: user.id, role: user.role, fullName: user.fullName } };
  }
}
