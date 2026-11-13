/**
 * Business-rule constants (docs/backend_structure.txt, section 6.1).
 * Keep every rule number here, never inline them in services.
 */
export const RULES = {
  ATTENDANCE_BALL: 10, // attending a lesson is worth 10 balls; they become XP and kumush with the same rates as any ball
  MIN_BALL: 1,
  MAX_BALL: 100,
  XP_PER_BALL: 1, // 1 ball = 1 XP
  BALL_PER_GEM: 2, // every 2 balls = 1 kumush (rounded)
  LATE_PENALTY: 10, // balls taken off for late homework
  XP_PER_LEVEL: 250,
  HOMEWORK_LIMITS: [1, 3, 24, 72, 168], // hours
  RETURN_EXTENSION_HOURS: 24, // new time limit for returned homework
  LESSON_SLOTS: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'], // 2-hour room slots
  SLOT_HOURS: 2,
  DEFAULT_ONLINE_CAPACITY: 15,
  MIN_PAYMENT: 10_000, // so'm
  ROOM_MIN_CAPACITY: 1,
  ROOM_MAX_CAPACITY: 60,
  DEFAULT_LESSON_MINUTES: 45,
} as const;

/** File rules by purpose (section 8). */
export interface FileRule {
  maxFiles: number;
  maxBytes: number;
  extensions: string[];
}
const MB = 1024 * 1024;
export const FILE_RULES: Record<'answer' | 'task' | 'video', FileRule> = {
  answer: {
    maxFiles: 3,
    maxBytes: 5 * MB,
    extensions: ['.pdf', '.zip', '.doc', '.docx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.html', '.css', '.js', '.ts', '.tsx', '.jsx', '.json'],
  },
  task: {
    maxFiles: 5,
    maxBytes: 20 * MB,
    extensions: ['.pdf', '.zip', '.rar', '.7z', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.json', '.html', '.css', '.js', '.ts', '.tsx'],
  },
  video: { maxFiles: 1, maxBytes: 300 * MB, extensions: ['.mp4', '.webm', '.mov', '.m4v'] },
};

/** Demo logins for accounts that never changed their password (development only). */
export const DEMO_PASSWORDS = { ADMIN: 'admin123', TEACHER: 'ustoz123', STUDENT: 'oquvchi123' } as const;
