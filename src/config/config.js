"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = void 0;
var parsePositiveInt = function (name, value, fallback) {
    if (!value) {
        return fallback;
    }
    var parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error("".concat(name, " must be a positive integer"));
    }
    return parsed;
};
var parseIntInRange = function (name, value, fallback, min, max) {
    if (!value) {
        return fallback;
    }
    var parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
        throw new Error("".concat(name, " must be between ").concat(min, " and ").concat(max));
    }
    return parsed;
};
var readString = function (name, fallback) {
    var _a;
    if (fallback === void 0) { fallback = ""; }
    return (_a = process.env[name]) !== null && _a !== void 0 ? _a : fallback;
};
var loadConfig = function () {
    var _a, _b, _c;
    var env = (_a = process.env.NODE_ENV) !== null && _a !== void 0 ? _a : "development";
    var logLevel = (_b = process.env.LOG_LEVEL) !== null && _b !== void 0 ? _b : "info";
    var port = parsePositiveInt("PORT", process.env.PORT, 3000);
    var sendingWindowHours = parsePositiveInt("SENDING_WINDOW_HOURS", process.env.SENDING_WINDOW_HOURS, 6);
    var sendingWindowTz = (_c = process.env.SENDING_WINDOW_TZ) !== null && _c !== void 0 ? _c : "UTC";
    var sendingWindowIntervalHours = parsePositiveInt("SENDING_WINDOW_INTERVAL_HOURS", process.env.SENDING_WINDOW_INTERVAL_HOURS, sendingWindowHours);
    var sendingWindowStartHour = parseIntInRange("SENDING_WINDOW_START_HOUR", process.env.SENDING_WINDOW_START_HOUR, 0, 0, 23);
    var sendingWindowStartMinute = parseIntInRange("SENDING_WINDOW_START_MINUTE", process.env.SENDING_WINDOW_START_MINUTE, 0, 0, 59);
    var databaseUrl = readString("DATABASE_URL");
    var redisUrl = readString("REDIS_URL");
    var s3 = {
        endpoint: readString("S3_ENDPOINT"),
        region: readString("S3_REGION"),
        bucket: readString("S3_BUCKET"),
        accessKeyId: readString("S3_ACCESS_KEY_ID"),
        secretAccessKey: readString("S3_SECRET_ACCESS_KEY")
    };
    var discord = {
        botToken: readString("DISCORD_BOT_TOKEN"),
        appId: readString("DISCORD_APP_ID"),
        serverId: readString("DISCORD_SERVER_ID")
    };
    return {
        env: env,
        logLevel: logLevel,
        port: port,
        sendingWindowHours: sendingWindowHours,
        sendingWindowTz: sendingWindowTz,
        sendingWindowIntervalHours: sendingWindowIntervalHours,
        sendingWindowStartHour: sendingWindowStartHour,
        sendingWindowStartMinute: sendingWindowStartMinute,
        databaseUrl: databaseUrl,
        redisUrl: redisUrl,
        s3: s3,
        discord: discord
    };
};
exports.loadConfig = loadConfig;
