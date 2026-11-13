import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { conflict, unprocessable } from '../common/errors';
import { RULES } from '../config/rules';
import { Group, GroupSchedule, Room } from '../entities';

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(Room) private rooms: Repository<Room>,
    @InjectRepository(GroupSchedule) private schedules: Repository<GroupSchedule>,
    @InjectRepository(Group) private groups: Repository<Group>,
  ) {}

  all() {
    return this.rooms.find({ order: { id: 'ASC' } });
  }

  async nameMap() {
    return new Map((await this.all()).map((r) => [r.id, r.name]));
  }

  private async assertFree(name: string, exceptId?: number) {
    const clash = (await this.all()).find((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase());
    if (clash) throw unprocessable('Bunday nomli xona bor.', 'name');
  }

  private assertCapacity(n: number) {
    if (!Number.isInteger(n) || n < RULES.ROOM_MIN_CAPACITY || n > RULES.ROOM_MAX_CAPACITY) throw unprocessable("Sig'im 1 dan 60 gacha butun son bo'lsin.", 'capacity');
  }

  async create(name: string, capacity: number) {
    this.assertCapacity(capacity);
    await this.assertFree(name.trim());
    return this.rooms.save(this.rooms.create({ name: name.trim(), capacity }));
  }

  /** Renaming is safe: group schedules point at the room id, not at its name. */
  async update(id: number, name: string, capacity: number) {
    const room = await this.rooms.findOneBy({ id });
    if (!room) throw new NotFoundException('Xona topilmadi.');
    this.assertCapacity(capacity);
    await this.assertFree(name.trim(), id);
    room.name = name.trim();
    room.capacity = capacity;
    return this.rooms.save(room);
  }

  /**
   * Deletes a room. A room that an ACTIVE group still uses cannot be deleted (409): move or delete that group first.
   * Archived groups that pointed at it become "online" (no room).
   */
  async remove(id: number) {
    const room = await this.rooms.findOneBy({ id });
    if (!room) throw new NotFoundException('Xona topilmadi.');
    const rows = await this.schedules.findBy({ roomId: id });
    if (rows.length) {
      const active = await this.groups.find({ where: { isActive: true } });
      const using = active.filter((g) => rows.some((r) => r.groupId === g.id));
      if (using.length) throw conflict(`Xona “${room.name}” hozir ishlatilmoqda: ${using.map((g) => g.name).join(', ')}. Avval guruhni boshqa xonaga ko'chiring yoki o'chiring.`);
      await this.schedules.update({ roomId: id }, { roomId: null });
    }
    await this.rooms.delete({ id });
  }
}
