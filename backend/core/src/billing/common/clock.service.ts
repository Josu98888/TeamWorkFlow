import { Injectable } from '@nestjs/common';

export interface ClockService {
  now(): Date;
}

export const CLOCK_SERVICE = Symbol('CLOCK_SERVICE');

@Injectable()
export class SystemClockService implements ClockService {
  now(): Date {
    return new Date();
  }
}

export class TestClockService implements ClockService {
  private currentTime: Date;

  constructor(initialTime: Date | string = new Date()) {
    this.currentTime =
      typeof initialTime === 'string'
        ? new Date(initialTime)
        : new Date(initialTime.getTime());
  }

  now(): Date {
    return new Date(this.currentTime.getTime());
  }

  setTime(time: Date | string): void {
    this.currentTime =
      typeof time === 'string' ? new Date(time) : new Date(time.getTime());
  }

  advanceByDays(days: number): void {
    this.currentTime = new Date(
      this.currentTime.getTime() + days * 24 * 60 * 60 * 1000,
    );
  }

  advanceByHours(hours: number): void {
    this.currentTime = new Date(
      this.currentTime.getTime() + hours * 60 * 60 * 1000,
    );
  }

  advanceByMs(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}
