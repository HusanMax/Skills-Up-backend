import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: String }) role: string; // Role
  @Index({ unique: true }) @Column({ type: String }) login: string;
  /** salted bcrypt hash; never returned by the API */
  @Column({ type: String, select: false }) passwordHash: string;
  @Column({ type: Date, nullable: true }) passwordChangedAt: Date | null;
  @Column({ type: String }) fullName: string;
  @Column({ type: String, nullable: true }) phone: string | null;
  @Column({ type: String, nullable: true }) email: string | null;
  @Column({ type: String, nullable: true }) bio: string | null;
  @Column({ type: Boolean, default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('user_settings')
export class UserSettings {
  @PrimaryColumn({ type: Number }) userId: number;
  @Column({ type: Boolean, default: true }) notifyEmail: boolean;
  @Column({ type: Boolean, default: true }) notifyPush: boolean;
  @Column({ type: Boolean, default: true }) notifyReminders: boolean;
  @Column({ type: String, default: 'dark' }) theme: string; // light | dark | system
}

@Entity('stored_files')
export class StoredFile {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: Number }) ownerId: number;
  @Column({ type: String }) originalName: string;
  @Column({ type: String }) mimeType: string;
  @Column({ type: Number }) sizeBytes: number;
  @Column({ type: String }) storageKey: string;
  /** where the bytes are: the local upload folder or Cloudflare R2 */
  @Column({ type: String, default: 'local' }) storage: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ type: Number }) userId: number;
  @Column({ type: String }) type: string;
  @Column({ type: String }) title: string;
  @Column({ type: String, nullable: true }) link: string | null;
  @CreateDateColumn() createdAt: Date;
  @Column({ type: Date, nullable: true }) readAt: Date | null;
}
