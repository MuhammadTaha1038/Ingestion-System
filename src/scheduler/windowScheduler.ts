import { DateTime } from "luxon";
import { loadConfig } from "../config/config.js";

export interface SendingWindowState {
  windowKey: string;
  windowStart: string;
  windowEnd: string;
  nextWindowStart: string;
  nextWindowEnd: string;
  isActive: boolean;
}

export const getSendingWindowState = (now = new Date()): SendingWindowState => {
  const config = loadConfig();
  const zone = config.sendingWindowTz;
  const durationHours = config.sendingWindowHours;
  const intervalHours = config.sendingWindowIntervalHours;
  const startHour = config.sendingWindowStartHour;
  const startMinute = config.sendingWindowStartMinute;

  const nowZoned = DateTime.fromJSDate(now, { zone });
  let anchor = nowZoned.startOf("day").plus({
    hours: startHour,
    minutes: startMinute
  });

  if (nowZoned < anchor) {
    anchor = anchor.minus({ days: 1 });
  }

  const diffHours = nowZoned.diff(anchor, "hours").hours;
  const windowIndex = Math.floor(diffHours / intervalHours);
  const windowStart = anchor.plus({ hours: windowIndex * intervalHours });
  const windowEnd = windowStart.plus({ hours: durationHours });

  const isActive = nowZoned >= windowStart && nowZoned < windowEnd;
  const nextWindowStart = windowStart.plus({ hours: intervalHours });
  const nextWindowEnd = nextWindowStart.plus({ hours: durationHours });

  const windowKey = windowStart.toUTC().toISO({ suppressMilliseconds: true }) ?? "";

  return {
    windowKey,
    windowStart: windowStart.toISO() ?? "",
    windowEnd: windowEnd.toISO() ?? "",
    nextWindowStart: nextWindowStart.toISO() ?? "",
    nextWindowEnd: nextWindowEnd.toISO() ?? "",
    isActive
  };
};
