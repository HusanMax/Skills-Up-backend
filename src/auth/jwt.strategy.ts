import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/decorators';
import { Role } from '../common/enums';
import { User } from '../entities';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, @InjectRepository(User) private users: Repository<User>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /** The role is read from the database, so a deactivated user or a changed role takes effect immediately. */
  async validate(payload: { sub: number }): Promise<AuthUser> {
    const user = await this.users.findOneBy({ id: payload.sub });
    if (!user || !user.isActive) throw new UnauthorizedException("Tizimga qayta kiring.");
    return { id: user.id, role: user.role as Role };
  }
}
