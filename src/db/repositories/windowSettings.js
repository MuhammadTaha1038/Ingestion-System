"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WindowSettingsRepository = void 0;
var config_js_1 = require("../../config/config.js");
var pool_js_1 = require("../pool.js");
var WindowSettingsRepository = /** @class */ (function () {
    function WindowSettingsRepository(pool) {
        this.pool = pool !== null && pool !== void 0 ? pool : (0, pool_js_1.getDatabasePool)();
    }
    WindowSettingsRepository.prototype.ensureTable = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.pool.query("\n      CREATE TABLE IF NOT EXISTS window_settings (\n        id smallint PRIMARY KEY DEFAULT 1,\n        sending_window_hours integer NOT NULL,\n        sending_window_interval_hours integer NOT NULL,\n        sending_window_start_hour integer NOT NULL,\n        sending_window_start_minute integer NOT NULL,\n        sending_window_tz text NOT NULL,\n        updated_at timestamptz NOT NULL DEFAULT now()\n      )\n    ")];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    WindowSettingsRepository.prototype.getSettings = function () {
        return __awaiter(this, void 0, void 0, function () {
            var defaults, defaultRow, existing;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.ensureTable()];
                    case 1:
                        _a.sent();
                        defaults = (0, config_js_1.loadConfig)();
                        defaultRow = {
                            sending_window_hours: defaults.sendingWindowHours,
                            sending_window_interval_hours: defaults.sendingWindowIntervalHours,
                            sending_window_start_hour: defaults.sendingWindowStartHour,
                            sending_window_start_minute: defaults.sendingWindowStartMinute,
                            sending_window_tz: defaults.sendingWindowTz
                        };
                        return [4 /*yield*/, this.pool.query("SELECT sending_window_hours, sending_window_interval_hours, sending_window_start_hour, sending_window_start_minute, sending_window_tz FROM window_settings WHERE id = 1")];
                    case 2:
                        existing = _a.sent();
                        if (existing.rows[0]) {
                            return [2 /*return*/, existing.rows[0]];
                        }
                        return [4 /*yield*/, this.pool.query("INSERT INTO window_settings (id, sending_window_hours, sending_window_interval_hours, sending_window_start_hour, sending_window_start_minute, sending_window_tz)\n       VALUES (1, $1, $2, $3, $4, $5)\n       ON CONFLICT (id) DO NOTHING", [
                                defaultRow.sending_window_hours,
                                defaultRow.sending_window_interval_hours,
                                defaultRow.sending_window_start_hour,
                                defaultRow.sending_window_start_minute,
                                defaultRow.sending_window_tz
                            ])];
                    case 3:
                        _a.sent();
                        return [2 /*return*/, defaultRow];
                }
            });
        });
    };
    WindowSettingsRepository.prototype.updateSettings = function (patch) {
        return __awaiter(this, void 0, void 0, function () {
            var current, next;
            var _a, _b, _c, _d, _e;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0: return [4 /*yield*/, this.ensureTable()];
                    case 1:
                        _f.sent();
                        return [4 /*yield*/, this.getSettings()];
                    case 2:
                        current = _f.sent();
                        next = {
                            sending_window_hours: (_a = patch.sendingWindowHours) !== null && _a !== void 0 ? _a : current.sending_window_hours,
                            sending_window_interval_hours: (_b = patch.sendingWindowIntervalHours) !== null && _b !== void 0 ? _b : current.sending_window_interval_hours,
                            sending_window_start_hour: (_c = patch.sendingWindowStartHour) !== null && _c !== void 0 ? _c : current.sending_window_start_hour,
                            sending_window_start_minute: (_d = patch.sendingWindowStartMinute) !== null && _d !== void 0 ? _d : current.sending_window_start_minute,
                            sending_window_tz: (_e = patch.sendingWindowTz) !== null && _e !== void 0 ? _e : current.sending_window_tz
                        };
                        return [4 /*yield*/, this.pool.query("INSERT INTO window_settings (\n         id, sending_window_hours, sending_window_interval_hours, sending_window_start_hour, sending_window_start_minute, sending_window_tz, updated_at\n       ) VALUES (1, $1, $2, $3, $4, $5, now())\n       ON CONFLICT (id) DO UPDATE SET\n         sending_window_hours = EXCLUDED.sending_window_hours,\n         sending_window_interval_hours = EXCLUDED.sending_window_interval_hours,\n         sending_window_start_hour = EXCLUDED.sending_window_start_hour,\n         sending_window_start_minute = EXCLUDED.sending_window_start_minute,\n         sending_window_tz = EXCLUDED.sending_window_tz,\n         updated_at = now()", [
                                next.sending_window_hours,
                                next.sending_window_interval_hours,
                                next.sending_window_start_hour,
                                next.sending_window_start_minute,
                                next.sending_window_tz
                            ])];
                    case 3:
                        _f.sent();
                        return [2 /*return*/, next];
                }
            });
        });
    };
    return WindowSettingsRepository;
}());
exports.WindowSettingsRepository = WindowSettingsRepository;
