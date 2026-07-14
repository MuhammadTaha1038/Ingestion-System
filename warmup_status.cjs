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
require("dotenv/config");
var pool_js_1 = require("./src/db/pool.js");
var windowSettings_js_1 = require("./src/db/repositories/windowSettings.js");
var getWarmupDailyLimit = function (daysActive) {
    if (daysActive <= 3)
        return 50;
    if (daysActive <= 7)
        return 200;
    if (daysActive <= 10)
        return 500;
    if (daysActive <= 14)
        return 1000;
    if (daysActive <= 18)
        return 2000;
    if (daysActive <= 21)
        return 4000;
    return 9000;
};
function run() {
    return __awaiter(this, void 0, void 0, function () {
        var pool, settingsRepo, settings, windowsPerDay, res, _i, _a, acc, daysActive, maxDaily, effectiveMaxPerWindow, e_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    pool = (0, pool_js_1.getDatabasePool)();
                    settingsRepo = new windowSettings_js_1.WindowSettingsRepository(pool);
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 4, 5, 6]);
                    return [4 /*yield*/, settingsRepo.getSettings()];
                case 2:
                    settings = _b.sent();
                    windowsPerDay = 24 / settings.sending_window_interval_hours;
                    return [4 /*yield*/, pool.query("\n      SELECT sa.username, sa.status, sa.created_at, ea.address \n      FROM smtp_accounts sa\n      LEFT JOIN email_accounts ea ON sa.email_account_id = ea.id\n      WHERE sa.status = 'active'\n    ")];
                case 3:
                    res = _b.sent();
                    console.log("| SMTP Account | Age (Days) | Daily Limit | Per-Window Limit |");
                    console.log("|---|---|---|---|");
                    for (_i = 0, _a = res.rows; _i < _a.length; _i++) {
                        acc = _a[_i];
                        daysActive = Math.floor((Date.now() - new Date(acc.created_at).getTime()) / 86400000) + 1;
                        maxDaily = getWarmupDailyLimit(daysActive);
                        effectiveMaxPerWindow = Math.ceil(maxDaily / windowsPerDay);
                        console.log("| ".concat(acc.username, " | ").concat(daysActive, " | ").concat(maxDaily, " | ").concat(effectiveMaxPerWindow, " |"));
                    }
                    return [3 /*break*/, 6];
                case 4:
                    e_1 = _b.sent();
                    console.error(e_1);
                    return [3 /*break*/, 6];
                case 5:
                    pool.end();
                    return [7 /*endfinally*/];
                case 6: return [2 /*return*/];
            }
        });
    });
}
run();
