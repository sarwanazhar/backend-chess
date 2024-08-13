import express from 'express';
import dotenv from 'dotenv';
import { Game, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

dotenv.config();

const router = express.Router();

if (process.env.NODE_ENV === 'development') {
    router.post('/test', (req, res) => {
        res.send("server in dev");
    });
}

router.get('/', (req, res) => {
    res.send("chess backend");
});

router.post('/fetch-games', async (req, res) => {
    const { id } = req.body;

    const games = await prisma.game.findMany({
        where: {
            OR: [
                {whitePlayerId: id},
                {blackPlayerId: id}
            ]
        },
        include: {
            WhitePlayer: true,
            BlackPlayer: true,
            moves: true,
        }
    })
    res.status(200).json(games)

})

router.post('/fetch-user', async (req, res) => {
    const { id } = req.body

    const user = await prisma.user.findUnique({
        where: {
            userId: id
        },
        include: {
            blackGames: true,
            whiteGames: true
        }
    })

    if (!user) {
        return null
    }
    
    const a = user?.blackGames.length
    const b = user?.whiteGames.length

    
    res.status(200).json(a+b)
})



export default router;
