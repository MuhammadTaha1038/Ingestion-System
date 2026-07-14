"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabasePool = void 0;
var pg_1 = require("pg");
var config_js_1 = require("../config/config.js");
var sharedPool = null;
var getDatabasePool = function () {
    if (!sharedPool) {
        var config = (0, config_js_1.loadConfig)();
        if (!config.databaseUrl) {
            throw new Error("DATABASE_URL is required for database connections");
        }
        sharedPool = new pg_1.Pool({ connectionString: config.databaseUrl });
    }
    return sharedPool;
};
exports.getDatabasePool = getDatabasePool;
