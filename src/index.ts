import express, { Application } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { Chess } from 'chess.js';

dotenv.config();

const port = process.env.PORT || 8080;
const app: Application = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());
app.post('/fetch-games', async (req, res) => {
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
app.post('/fetch-user', async (req, res) => {
  const { id } = req.body;

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

interface WaitingListProps {
  userId: string;
  socketId: string;
}

const prisma = new PrismaClient();
let waitingList: WaitingListProps[] = [];
const userSockets = new Map<string, string>();


io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinGame', async (userId) => {
    try {
      if (!userId) {
        return socket.emit('error', "userId required to start game");
      }
  
      console.log('User ID:', userId);

      userSockets.set(userId, socket.id)
      
      const user = await prisma.user.findUnique({
        where: { userId: userId }
      });
  
      if (!user) {
        return socket.emit('error', 'User not found');
      }
  
      const ongoingGame = await prisma.game.findFirst({
        where: {
            OR: [
                { whitePlayerId: user.id, result: "ongoing" },
                { blackPlayerId: user.id, result: "ongoing" }
            ]
        }
      });
  
      if (ongoingGame) {
          return socket.emit('error', "You are already in an ongoing game.");
      }
  
      // Prevent the same user from being added twice
      if (waitingList.some(entry => entry.userId === user.userId)) {
        return socket.emit('error', "You are already in the waiting list.");
      }
  
      if (waitingList.length > 0) {
        const opponentId = waitingList.shift();
        if (!opponentId || opponentId.userId === user.userId) {
          return;
        }
  
        console.log('Opponent ID:', opponentId.userId);
  
        const opponent = await prisma.user.findUnique({
          where: { userId: opponentId.userId }
        });
  
        if (!opponent) {
          return socket.emit('error', 'Opponent not found');
        }
  
        const chess = new Chess();
        const game = await prisma.game.create({
          data: {
            result: 'ongoing',
            pgn: chess.pgn(),
            fen: chess.fen(),
            whitePlayerId: user.id,
            blackPlayerId: opponent.id,
            player1SocketId: socket.id,
            player2SocketId: opponentId.socketId,
            turn: 'w'
          },
        });
  
        io.to(socket.id).emit('gameStarted', {
          gameId: game.id,
          color: 'white',
          pgn: game.pgn,
          fen: game.fen,
          opponent: {
            name: opponent.name,
            imageUrl: opponent.imageUrl,
          }
        });
  
        io.to(opponentId.socketId).emit('gameStarted', {
          gameId: game.id,
          color: 'black',
          fen: game.fen,
          pgn: game.pgn,
          opponentId: game.whitePlayerId,
          opponent: {
            name: user.name,
            imageUrl: user.imageUrl,
          }
        });
  
        console.log(`Game has started between ${user.id} and ${opponent.id}`);
      } else {
        waitingList.push({ socketId: socket.id, userId: user.userId });
        console.log('Waiting List:', waitingList);
        return socket.emit('waitingList', 'You have been added to the waiting list. Please wait.');
      }
    } catch (error) {
      console.error('Error handling joinGame event:', error);
      socket.emit('error', 'An error occurred');
    }
  });
  
  socket.on('leaveGame', (userId) => {
    waitingList = waitingList.filter( user => user.userId !== userId)
  })

  socket.on('makeMove', async (gameId, userId, move) => {
    try {
        if (!gameId) {
            return socket.emit('error', 'game id required');
        }

        if (!move || !move.from || !move.to) {
            return socket.emit('error', 'complete move data required');
        }

        const game = await prisma.game.findUnique({
            where: { id: gameId },
        });

        if (!game) {
            return socket.emit('error', 'Game not found');
        }

        const isWhite = game.whitePlayerId === userId;
        const isBlack = game.blackPlayerId === userId;

        if ((game.turn === 'w' && !isWhite) || (game.turn === 'b' && !isBlack)) {
            return socket.emit('error', "It's not your turn.");
        }

        const chess = new Chess(game.fen);
        const validMove = chess.move({ from: move.from, to: move.to, promotion: 'q' }); // Promotion can be adjusted as needed

        if (!validMove) {
            return socket.emit('invalidMove', 'Invalid Move');
        }

        const nextTurn = game.turn === 'w' ? 'b' : 'w';

        const updatedGame = await prisma.game.update({
            where: { id: gameId },
            data: { pgn: chess.pgn(), fen: chess.fen(), turn: nextTurn },
        });

        await prisma.move.create({
            data: {
                gameId: gameId,
                move: `${move.from}-${move.to}`, // Save the move
            },
        });

        io.to(game.player1SocketId).emit('moveMade', {
            fen: updatedGame.fen,
            pgn: updatedGame.pgn,
        });

        io.to(game.player2SocketId).emit('moveMade', {
            fen: updatedGame.fen,
            pgn: updatedGame.pgn,
        });

        if (chess.isGameOver()) {
            let result;
            if (chess.isCheckmate()) {
                result = chess.turn() === 'w' ? '0-1' : '1-0';
            } else if (chess.isDraw() || chess.isStalemate() || chess.isInsufficientMaterial()) {
                result = '1/2-1/2';
            }

            await prisma.game.update({
                where: { id: game.id },
                data: { result: result },
            });

            io.to(game.player1SocketId).emit('gameOver', result);
            io.to(game.player2SocketId).emit('gameOver', result);
        }
    } catch (error) {
        console.error('Error handling makeMove event:', error);
        socket.emit('error', 'An error occurred');
    }
});


  const disconnectionTimeouts = new Map<string, NodeJS.Timeout>();

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);

    const userId = [...userSockets.entries()].find(([, id]) => id === socket.id)?.[0];

    const timeout = setTimeout(async() => {
      const game = await prisma.game.findFirst({
        where: {
          result: 'ongoing',
          OR: [
            {player1SocketId: socket.id},
            {player2SocketId: socket.id}
          ]
        }
      });
      if (game) {
        const winner = game.player1SocketId === socket.id ? 'black' : 'white';
        await prisma.game.update({
          where: { id: game.id },
          data: { result: winner === 'black' ? '0-1' : '1-0' },
        });
  
        io.to(game.player1SocketId).emit('gameEnd', `${winner === 'black' ? 'BlackWon Opponent resings' : 'WhiteWon Opponent resigns'}`);
        io.to(game.player2SocketId).emit('gameEnd', `${winner === 'black' ? 'BlackWon Opponent resings' : 'WhiteWon Opponent resigns'}`);
      }
    }, 30000)

    disconnectionTimeouts.set(userId as string, timeout)
  });

  socket.on('reconnect', (userId) => {
    if (disconnectionTimeouts.has(userId)) {
      clearTimeout(disconnectionTimeouts.get(userId))
      disconnectionTimeouts.delete(userId)
      console.log(`user reconnected ${userId}`)
      socket.emit('reconnected', )
    }
  })
});

server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
