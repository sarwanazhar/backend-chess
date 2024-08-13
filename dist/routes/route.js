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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
dotenv_1.default.config();
const router = express_1.default.Router();
if (process.env.NODE_ENV === 'development') {
    router.post('/test', (req, res) => {
        res.send("server in dev");
    });
}
router.get('/', (req, res) => {
    res.send("chess backend");
});
router.post('/fetch-games', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.body;
    const games = yield prisma.game.findMany({
        where: {
            OR: [
                { whitePlayerId: id },
                { blackPlayerId: id }
            ]
        },
        include: {
            WhitePlayer: true,
            BlackPlayer: true,
            moves: true,
        }
    });
    res.status(200).json(games);
}));
router.post('/fetch-user', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.body;
    const user = yield prisma.user.findUnique({
        where: {
            userId: id
        },
        include: {
            blackGames: true,
            whiteGames: true
        }
    });
    if (!user) {
        return null;
    }
    const a = user === null || user === void 0 ? void 0 : user.blackGames.length;
    const b = user === null || user === void 0 ? void 0 : user.whiteGames.length;
    res.status(200).json(a + b);
}));
exports.default = router;
