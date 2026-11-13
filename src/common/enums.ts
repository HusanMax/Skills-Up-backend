export enum Role {
  STUDENT = 'STUDENT',
  TEACHER = 'TEACHER',
  ADMIN = 'ADMIN',
}

/** Homework state of one student. "Not assigned" has no row: it is worked out by the API. */
export enum HwStatus {
  NOT_DONE = 'NOT_DONE',
  PENDING = 'PENDING',
  RETURNED = 'RETURNED',
  DONE = 'DONE',
}

export enum Day {
  MON = 'MON',
  TUE = 'TUE',
  WED = 'WED',
  THU = 'THU',
  FRI = 'FRI',
  SAT = 'SAT',
  SUN = 'SUN',
}

/** Names the frontend uses for homework status. */
export type HwApiStatus = 'done' | 'pending' | 'returned' | 'not-done' | 'not-assigned';
export const hwApi = (s?: HwStatus | null): HwApiStatus =>
  s === HwStatus.DONE ? 'done' : s === HwStatus.PENDING ? 'pending' : s === HwStatus.RETURNED ? 'returned' : s === HwStatus.NOT_DONE ? 'not-done' : 'not-assigned';
