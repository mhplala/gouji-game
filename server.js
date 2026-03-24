const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ============ CARD DEFINITIONS ============
const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const RANK_ORDER = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14,'2':15,'小王':16,'大王':17 };
const STRAIGHT_RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A'];

function createDeck() {
  const deck = [];
  for (let d = 0; d < 4; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank, id: uuidv4().slice(0,8) });
      }
    }
    deck.push({ suit: 'joker', rank: '小王', id: uuidv4().slice(0,8) });
    deck.push({ suit: 'joker', rank: '大王', id: uuidv4().slice(0,8) });
  }
  return deck; // 4 * (52+2) = 216
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const rd = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (rd !== 0) return rd;
    return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  });
}

// ============ PLAY TYPE DETECTION ============
function getRankCounts(cards) {
  const counts = {};
  for (const c of cards) {
    counts[c.rank] = (counts[c.rank] || 0) + 1;
  }
  return counts;
}

function detectPlayType(cards) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  const counts = getRankCounts(cards);
  const ranks = Object.keys(counts);
  const vals = Object.values(counts);

  // Single
  if (n === 1) return { type: 'single', rank: cards[0].rank, size: 1 };

  // Pair
  if (n === 2 && ranks.length === 1 && vals[0] === 2)
    return { type: 'pair', rank: ranks[0], size: 2 };

  // Triple
  if (n === 3 && ranks.length === 1 && vals[0] === 3)
    return { type: 'triple', rank: ranks[0], size: 3 };

  // Full House (三带二)
  if (n === 5 && ranks.length === 2) {
    const sorted = vals.sort((a,b) => b - a);
    if (sorted[0] === 3 && sorted[1] === 2) {
      const tripleRank = Object.entries(counts).find(([,v]) => v === 3)[0];
      return { type: 'fullhouse', rank: tripleRank, size: 5 };
    }
  }

  // Bomb (4+ same rank)
  if (ranks.length === 1 && vals[0] >= 4)
    return { type: 'bomb', rank: ranks[0], count: vals[0], size: n };

  // Straight (5+ consecutive singles)
  if (n >= 5 && ranks.length === n && vals.every(v => v === 1)) {
    const indices = ranks.map(r => STRAIGHT_RANKS.indexOf(r)).filter(i => i >= 0);
    if (indices.length === n) {
      indices.sort((a,b) => a - b);
      let isConsecutive = true;
      for (let i = 1; i < indices.length; i++) {
        if (indices[i] !== indices[i-1] + 1) { isConsecutive = false; break; }
      }
      if (isConsecutive) {
        const highRank = STRAIGHT_RANKS[indices[indices.length - 1]];
        return { type: 'straight', rank: highRank, length: n, size: n };
      }
    }
  }

  // Pair Straight (连对, 3+ consecutive pairs)
  if (n >= 6 && n % 2 === 0 && vals.every(v => v === 2)) {
    const indices = ranks.map(r => STRAIGHT_RANKS.indexOf(r)).filter(i => i >= 0);
    if (indices.length === ranks.length) {
      indices.sort((a,b) => a - b);
      let isConsecutive = true;
      for (let i = 1; i < indices.length; i++) {
        if (indices[i] !== indices[i-1] + 1) { isConsecutive = false; break; }
      }
      if (isConsecutive && indices.length >= 3) {
        const highRank = STRAIGHT_RANKS[indices[indices.length - 1]];
        return { type: 'pairstraight', rank: highRank, length: indices.length, size: n };
      }
    }
  }

  return null;
}

// ============ 够级 DETECTION ============
function isGouji(play) {
  if (!play) return false;
  const { type, rank, count } = play;
  if (type === 'bomb') {
    // bombs of enough count at any rank are always 够级
    const threshold = getGoujiThreshold(rank);
    return count >= threshold;
  }
  // For non-bomb types, check if the total same-rank count meets threshold
  // Actually 够级 is about the number of same-rank cards played
  // Re-check: 够级 applies when you play enough cards of the same rank
  // For single/pair/triple they can't reach threshold, only bomb can
  // But also consider: playing 5 threes as a bomb is 够级
  return false;
}

function getGoujiThreshold(rank) {
  // 标准够级牌门槛（维基百科/青岛标准规则）
  // 3-9 不是够级牌
  if (['3','4','5','6','7','8','9'].includes(rank)) return Infinity;
  if (rank === '10') return 5;
  if (rank === 'J') return 4;
  if (rank === 'Q') return 3;
  if (rank === 'K' || rank === 'A') return 2;
  if (rank === '2') return 1;
  if (rank === '小王' || rank === '大王') return 1;
  return Infinity;
}

function isGoujiPlay(cards) {
  // 挂王的任何牌都是够级牌
  if (cards.some(c => c.rank === '小王' || c.rank === '大王')) return true;
  const counts = getRankCounts(cards);
  for (const [rank, count] of Object.entries(counts)) {
    const threshold = getGoujiThreshold(rank);
    if (count >= threshold) return true;
  }
  return false;
}

// ============ PLAY COMPARISON ============
function getOpposite(seat) {
  return (seat + 3) % 6;
}

function canBeat(newPlay, oldPlay, rules) {
  if (!oldPlay) return true;
  const r = rules || DEFAULT_RULES;
  
  // Bomb beats non-bomb
  if (newPlay.type === 'bomb' && oldPlay.type !== 'bomb') {
    return r.bombBeatsAll !== false;
  }
  if (newPlay.type !== 'bomb' && oldPlay.type === 'bomb') return false;
  
  // Both bombs
  if (newPlay.type === 'bomb' && oldPlay.type === 'bomb') {
    if (r.bombCompare === 'same-count') {
      // 传统够级: 只有相同张数的炸弹才能比较
      if (newPlay.count !== oldPlay.count) return false;
      return RANK_ORDER[newPlay.rank] > RANK_ORDER[oldPlay.rank];
    } else {
      // 斗地主式: 张数优先，同张数比点数
      if (newPlay.count !== oldPlay.count) return newPlay.count > oldPlay.count;
      return RANK_ORDER[newPlay.rank] > RANK_ORDER[oldPlay.rank];
    }
  }
  
  // Same type comparison
  if (newPlay.type !== oldPlay.type) return false;
  if (newPlay.size !== oldPlay.size) return false;
  
  return RANK_ORDER[newPlay.rank] > RANK_ORDER[oldPlay.rank];
}

// ============ ROOM & GAME STATE ============
const rooms = new Map();

const DEFAULT_RULES = {
  bombCompare: 'same-count',   // 'count-first' = 张数优先(斗地主式), 'same-count' = 同张数才能比(传统够级)
  goujiThreshold: 'standard',  // 'standard' = 标准门槛, 'relaxed' = 降低门槛
  nonDuiTouCanPlay: false,     // true = 非对头也可以普通接牌(不强制烧牌), false = 传统规则
  bombBeatsAll: true,          // true = 炸弹可以压非炸弹牌型, false = 只能同类型比较
  allowStraightBomb: false,    // true = 允许连炸(如44445555), false = 不允许
  jinGong: false,              // true = 开启进贡, false = 关闭
  geming: true,                // true = 允许革命(无2/王/A可弃牌), false = 不允许
  firstPlay: 'club3',          // 'club3' = 梅花3先出, 'random' = 随机, 'daluo' = 上局大落先出
  biSan: false,                // true = 最后一手必须是3, false = 不限制
  passLock: true,              // true = 过牌后本轮不能再出(严格), false = 可以再出(宽松)
};

function createRoom(roomId) {
  return {
    id: roomId,
    players: Array(6).fill(null), // {ws, name, id, isBot}
    state: 'waiting', // waiting, playing, finished
    hands: Array(6).fill(null),
    currentTurn: 0,
    lastPlay: null, // {cards, seat, playType}
    lastPlaySeat: -1,
    passCount: 0,
    consecutivePasses: 0,
    outOrder: [], // seats in order they went out
    isGoujiActive: false,
    goujiSeat: -1, // who played the 够级
    roundStarter: 0,
    messages: [],
    rules: { ...DEFAULT_RULES },
    roundPlays: [], // all plays in current round [{cards, seat, playType, action}]
    passedThisRound: new Set(), // seats that passed this round (for passLock)
    lastGameOutOrder: [],       // previous game's outOrder (for daluo first play)
    revolutionSeats: [],        // seats that declared revolution
    spectators: [],             // [{ws, name, id}]
  };
}

function broadcastRoom(room) {
  for (let i = 0; i < 6; i++) {
    const p = room.players[i];
    if (p && p.ws && p.ws.readyState === 1) {
      sendGameState(room, i);
    }
  }
  // Broadcast to spectators
  for (const spec of room.spectators) {
    if (spec.ws && spec.ws.readyState === 1) {
      sendSpectatorState(room, spec);
    }
  }
}

function sendGameState(room, seat) {
  const p = room.players[seat];
  if (!p || !p.ws || p.ws.readyState !== 1) return;

  const otherPlayers = room.players.map((pl, idx) => ({
    seat: idx,
    name: pl ? pl.name : null,
    cardCount: room.hands[idx] ? room.hands[idx].length : 0,
    isBot: pl ? pl.isBot : false,
    isOut: room.outOrder.includes(idx),
    outRank: room.outOrder.indexOf(idx),
    team: idx % 2 === 0 ? 'A' : 'B',
    isConnected: pl ? (!pl.isBot && pl.ws && pl.ws.readyState === 1 || pl.isBot) : false,
  }));

  const state = {
    type: 'gameState',
    roomId: room.id,
    seat: seat,
    state: room.state,
    hand: room.hands[seat] ? sortCards(room.hands[seat]) : [],
    players: otherPlayers,
    currentTurn: room.currentTurn,
    lastPlay: room.lastPlay,
    lastPlaySeat: room.lastPlaySeat,
    roundPlays: (room.roundPlays || []).filter(rp => rp.action === 'play'),
    isGoujiActive: room.isGoujiActive,
    goujiSeat: room.goujiSeat,
    outOrder: room.outOrder,
    messages: room.messages.slice(-20),
    myTeam: seat % 2 === 0 ? 'A' : 'B',
    rules: room.rules,
    spectatorCount: room.spectators.length,
  };

  p.ws.send(JSON.stringify(state));
}

function sendSpectatorState(room, spec) {
  if (!spec.ws || spec.ws.readyState !== 1) return;

  const otherPlayers = room.players.map((pl, idx) => ({
    seat: idx,
    name: pl ? pl.name : null,
    cardCount: room.hands[idx] ? room.hands[idx].length : 0,
    isBot: pl ? pl.isBot : false,
    isOut: room.outOrder.includes(idx),
    outRank: room.outOrder.indexOf(idx),
    team: idx % 2 === 0 ? 'A' : 'B',
    isConnected: pl ? (!pl.isBot && pl.ws && pl.ws.readyState === 1 || pl.isBot) : false,
  }));

  const state = {
    type: 'gameState',
    roomId: room.id,
    seat: -1, // spectator marker
    state: room.state,
    hand: [], // spectators don't see any hand
    players: otherPlayers,
    currentTurn: room.currentTurn,
    lastPlay: room.lastPlay,
    lastPlaySeat: room.lastPlaySeat,
    roundPlays: (room.roundPlays || []).filter(rp => rp.action === 'play'),
    isGoujiActive: room.isGoujiActive,
    goujiSeat: room.goujiSeat,
    outOrder: room.outOrder,
    messages: room.messages.slice(-20),
    myTeam: 'spectator',
    rules: room.rules,
    isSpectator: true,
    spectatorCount: room.spectators.length,
  };

  spec.ws.send(JSON.stringify(state));
}

function addMessage(room, msg) {
  room.messages.push({ text: msg, time: Date.now() });
  if (room.messages.length > 50) room.messages.shift();
}

// ============ AI BOT ============
function botPlay(room, seat) {
  setTimeout(() => {
    if (room.state !== 'playing') return;
    if (room.currentTurn !== seat) return;
    if (room.outOrder.includes(seat)) return;

    const hand = room.hands[seat];
    if (!hand || hand.length === 0) return;

    // Check if bot is pass-locked (safety check, advanceTurn should skip too)
    if (room.rules.passLock && room.passedThisRound && room.passedThisRound.has(seat)) {
      const isNewRound = !room.lastPlay || room.lastPlaySeat === seat;
      if (!isNewRound) {
        handlePass(room, seat);
        return;
      }
    }

    // Check if bot should pass due to 够级 rules
    if (room.isGoujiActive && room.goujiSeat >= 0) {
      const opposite = getOpposite(room.goujiSeat);
      if (seat !== opposite) {
        // Non-对头 must play higher 够级 or pass
        // Simple bot: just pass
        handlePass(room, seat);
        return;
      }
    }

    const lastPlay = room.lastPlay;
    const lastPlayType = lastPlay ? detectPlayType(lastPlay.cards) : null;

    // Try to find a valid play
    let cardsToPlay = null;

    if (!lastPlay || room.lastPlaySeat === seat) {
      // Free play - play smallest single
      cardsToPlay = [hand[0]]; // hand is sorted, smallest first
    } else {
      // Must beat
      cardsToPlay = findBotPlay(hand, lastPlayType, room.rules);
    }

    if (cardsToPlay) {
      handlePlay(room, seat, cardsToPlay.map(c => c.id));
    } else {
      handlePass(room, seat);
    }
  }, 1000 + Math.random() * 1500);
}

function findBotPlay(hand, targetPlay, rules) {
  if (!targetPlay) return [hand[0]];
  const r = rules || DEFAULT_RULES;

  const counts = {};
  for (const c of hand) {
    if (!counts[c.rank]) counts[c.rank] = [];
    counts[c.rank].push(c);
  }

  switch (targetPlay.type) {
    case 'single': {
      for (const c of hand) {
        if (RANK_ORDER[c.rank] > RANK_ORDER[targetPlay.rank]) return [c];
      }
      break;
    }
    case 'pair': {
      for (const [rank, cards] of Object.entries(counts)) {
        if (cards.length >= 2 && RANK_ORDER[rank] > RANK_ORDER[targetPlay.rank])
          return cards.slice(0, 2);
      }
      break;
    }
    case 'triple': {
      for (const [rank, cards] of Object.entries(counts)) {
        if (cards.length >= 3 && RANK_ORDER[rank] > RANK_ORDER[targetPlay.rank])
          return cards.slice(0, 3);
      }
      break;
    }
    case 'bomb': {
      if (r.bombCompare === 'same-count') {
        // 传统够级: 只能用相同张数的炸弹压
        for (const [rank, cards] of Object.entries(counts)) {
          if (cards.length === targetPlay.count && RANK_ORDER[rank] > RANK_ORDER[targetPlay.rank])
            return cards.slice(0, targetPlay.count);
        }
      } else {
        // 斗地主式: 张数多或同张数点数大
        for (const [rank, cards] of Object.entries(counts)) {
          if (cards.length >= targetPlay.count && RANK_ORDER[rank] > RANK_ORDER[targetPlay.rank])
            return cards.slice(0, targetPlay.count);
          if (cards.length > targetPlay.count)
            return cards.slice(0, cards.length);
        }
      }
      break;
    }
    case 'fullhouse': {
      for (const [rank, cards] of Object.entries(counts)) {
        if (cards.length >= 3 && RANK_ORDER[rank] > RANK_ORDER[targetPlay.rank]) {
          // Find a pair
          for (const [r2, c2] of Object.entries(counts)) {
            if (r2 !== rank && c2.length >= 2)
              return [...cards.slice(0, 3), ...c2.slice(0, 2)];
          }
        }
      }
      break;
    }
    case 'straight': {
      const needed = targetPlay.length;
      const targetHigh = STRAIGHT_RANKS.indexOf(targetPlay.rank);
      for (let start = targetHigh - needed + 2; start <= STRAIGHT_RANKS.length - needed; start++) {
        if (start < 0) continue;
        const seq = [];
        let ok = true;
        for (let i = 0; i < needed; i++) {
          const r = STRAIGHT_RANKS[start + i];
          if (counts[r] && counts[r].length >= 1) {
            seq.push(counts[r][0]);
          } else { ok = false; break; }
        }
        if (ok && RANK_ORDER[STRAIGHT_RANKS[start + needed - 1]] > RANK_ORDER[targetPlay.rank])
          return seq;
      }
      break;
    }
    case 'pairstraight': {
      const needed = targetPlay.length;
      const targetHigh = STRAIGHT_RANKS.indexOf(targetPlay.rank);
      for (let start = targetHigh - needed + 2; start <= STRAIGHT_RANKS.length - needed; start++) {
        if (start < 0) continue;
        const seq = [];
        let ok = true;
        for (let i = 0; i < needed; i++) {
          const r = STRAIGHT_RANKS[start + i];
          if (counts[r] && counts[r].length >= 2) {
            seq.push(counts[r][0], counts[r][1]);
          } else { ok = false; break; }
        }
        if (ok && RANK_ORDER[STRAIGHT_RANKS[start + needed - 1]] > RANK_ORDER[targetPlay.rank])
          return seq;
      }
      break;
    }
  }

  // Try bomb to beat non-bomb
  if (targetPlay.type !== 'bomb') {
    for (const [rank, cards] of Object.entries(counts)) {
      if (cards.length >= 4) return cards.slice(0, cards.length);
    }
  }

  return null;
}

// ============ GAME LOGIC ============
function startGame(room) {
  room.state = 'playing';
  room.outOrder = [];
  room.lastPlay = null;
  room.lastPlaySeat = -1;
  room.isGoujiActive = false;
  room.goujiSeat = -1;
  room.consecutivePasses = 0;
  room.messages = [];

  const deck = shuffle(createDeck());
  for (let i = 0; i < 6; i++) {
    room.hands[i] = sortCards(deck.slice(i * 36, (i + 1) * 36));
  }

  // Determine who goes first based on rules
  room.passedThisRound = new Set();
  room.revolutionSeats = [];
  let firstSeat = 0;
  if (room.rules.firstPlay === 'club3') {
    // 持梅花3的玩家先出
    for (let i = 0; i < 6; i++) {
      if (room.hands[i].some(c => c.rank === '3' && c.suit === '♣')) {
        firstSeat = i;
        break;
      }
    }
  } else if (room.rules.firstPlay === 'daluo' && room.lastGameOutOrder.length > 0) {
    // 上局大落先出
    firstSeat = room.lastGameOutOrder[room.lastGameOutOrder.length - 1];
  } else {
    // random
    firstSeat = Math.floor(Math.random() * 6);
  }
  room.currentTurn = firstSeat;
  room.roundStarter = firstSeat;

  addMessage(room, '🎴 游戏开始！每人36张牌');
  const firstPlayDesc = room.rules.firstPlay === 'club3' ? '(持♣3先出)' : room.rules.firstPlay === 'daluo' ? '(上局大落先出)' : '(随机)';
  addMessage(room, `轮到 ${room.players[firstSeat].name} 出牌 ${firstPlayDesc}`);
  broadcastRoom(room);

  // If first player is bot, trigger bot play
  if (room.players[firstSeat].isBot) {
    botPlay(room, firstSeat);
  }
}

function handlePlay(room, seat, cardIds) {
  if (room.state !== 'playing') return;
  if (room.currentTurn !== seat) return;
  if (room.outOrder.includes(seat)) return;

  const hand = room.hands[seat];
  const playedCards = [];
  for (const id of cardIds) {
    const card = hand.find(c => c.id === id);
    if (!card) return; // invalid card
    playedCards.push(card);
  }

  const playType = detectPlayType(playedCards);
  if (!playType) {
    sendError(room, seat, '无效的出牌组合');
    return;
  }

  // Check against last play
  const isNewRound = !room.lastPlay || room.lastPlaySeat === seat;

  // passLock: if player passed this round, they can't play again (unless new round)
  if (room.rules.passLock && !isNewRound && room.passedThisRound.has(seat)) {
    sendError(room, seat, '本轮已过牌，不能再出牌');
    return;
  }
  
  if (!isNewRound) {
    const lastPlayType = detectPlayType(room.lastPlay.cards);
    if (!canBeat(playType, lastPlayType, room.rules)) {
      sendError(room, seat, '打不过上家的牌');
      return;
    }

    // 够级 rules
    if (room.isGoujiActive && room.goujiSeat >= 0 && !room.rules.nonDuiTouCanPlay) {
      const opposite = getOpposite(room.goujiSeat);
      if (seat !== opposite) {
        // Non-对头 must play 够级 level to burn
        if (!isGoujiPlay(playedCards)) {
          sendError(room, seat, '够级牌局中，非对头只能用够级牌烧牌');
          return;
        }
      }
    }
  }

  // 憋三 check: if this would empty the hand and rule is on, last card(s) must all be 3
  const remainingAfter = hand.filter(c => !cardIds.includes(c.id));
  if (room.rules.biSan && remainingAfter.length === 0) {
    const allThrees = playedCards.every(c => c.rank === '3');
    if (!allThrees) {
      // Check if player has any 3s left - if so, must save them for last
      const has3s = hand.some(c => c.rank === '3' && !cardIds.includes(c.id));
      // Actually: if going out, last hand must be 3(s)
      if (!allThrees) {
        sendError(room, seat, '憋三规则：最后一手必须是3！');
        return;
      }
    }
  }

  // Remove cards from hand
  room.hands[seat] = remainingAfter;

  const isGouji = isGoujiPlay(playedCards);
  room.lastPlay = { cards: playedCards, seat, playType };
  room.lastPlaySeat = seat;
  room.consecutivePasses = 0;

  // If this was a new round start, clear round plays and pass locks
  if (isNewRound) {
    room.roundPlays = [];
    room.passedThisRound = new Set();
  }
  // Add this play to the round history
  room.roundPlays.push({ cards: playedCards, seat, playType, action: 'play' });

  if (isGouji) {
    room.isGoujiActive = true;
    room.goujiSeat = seat;
    addMessage(room, `🔥 ${room.players[seat].name} 打出够级牌！`);
  } else {
    room.isGoujiActive = false;
    room.goujiSeat = -1;
  }

  const rankNames = ['', '头科🏆', '二科', '三科', '四科', '五科', '大落💀'];
  
  // Check if player is out
  if (room.hands[seat].length === 0) {
    room.outOrder.push(seat);
    const rank = room.outOrder.length;
    addMessage(room, `🎉 ${room.players[seat].name} 出完了！${rankNames[rank]}`);

    // Check game end
    if (room.outOrder.length >= 5) {
      // Find last player
      for (let i = 0; i < 6; i++) {
        if (!room.outOrder.includes(i)) {
          room.outOrder.push(i);
          break;
        }
      }
      addMessage(room, '🏁 游戏结束！');
      // Calculate team results
      const teamA = room.outOrder.filter((s, idx) => s % 2 === 0).map((s, idx) => room.outOrder.indexOf(s) + 1);
      const teamB = room.outOrder.filter((s, idx) => s % 2 === 1).map((s, idx) => room.outOrder.indexOf(s) + 1);
      addMessage(room, `A队名次: ${teamA.join(',')}, B队名次: ${teamB.join(',')}`);
      room.lastGameOutOrder = [...room.outOrder]; // save for daluo-first rule
      room.state = 'finished';
      broadcastRoom(room);
      return;
    }
  }

  const cardDesc = playedCards.map(c => c.rank === '小王' || c.rank === '大王' ? c.rank : c.rank + c.suit).join(' ');
  addMessage(room, `${room.players[seat].name}: ${cardDesc} (${playType.type})`);

  // Next turn
  advanceTurn(room, seat);
  broadcastRoom(room);

  // Bot play
  if (room.players[room.currentTurn] && room.players[room.currentTurn].isBot) {
    botPlay(room, room.currentTurn);
  }
}

function handlePass(room, seat) {
  if (room.state !== 'playing') return;
  if (room.currentTurn !== seat) return;

  addMessage(room, `${room.players[seat].name}: 过`);
  room.roundPlays.push({ cards: [], seat, action: 'pass' });
  room.consecutivePasses++;
  if (room.rules.passLock) {
    room.passedThisRound.add(seat);
  }

  // 够级中对头过牌 = 够级成功，直接新一轮，发起者获得出牌权
  if (room.isGoujiActive && room.goujiSeat >= 0) {
    const opposite = getOpposite(room.goujiSeat);
    if (seat === opposite) {
      // 对头压不住，够级成功！
      addMessage(room, `✅ 够级成功！${room.players[room.goujiSeat].name} 开点`);
      const goujiStarter = room.goujiSeat;
      room.lastPlay = null;
      room.lastPlaySeat = -1;
      room.consecutivePasses = 0;
      room.isGoujiActive = false;
      room.goujiSeat = -1;
      room.passedThisRound = new Set();
      room.roundPlays = [];
      addMessage(room, '--- 新一轮 ---');
      // 够级发起者获得出牌权
      room.currentTurn = goujiStarter;
      broadcastRoom(room);
      if (room.players[room.currentTurn] && room.players[room.currentTurn].isBot) {
        botPlay(room, room.currentTurn);
      }
      return;
    }
  }

  // Count active (non-out) players
  const activePlayers = [];
  for (let i = 0; i < 6; i++) {
    if (!room.outOrder.includes(i)) activePlayers.push(i);
  }

  // If all active players except last player passed, new round
  if (room.consecutivePasses >= activePlayers.length - 1) {
    room.lastPlay = null;
    room.lastPlaySeat = -1;
    room.consecutivePasses = 0;
    room.isGoujiActive = false;
    room.goujiSeat = -1;
    room.passedThisRound = new Set(); // clear pass lock
    room.roundPlays = []; // clear round plays for new round
    // The last player who played starts new round
    addMessage(room, '--- 新一轮 ---');
  }

  advanceTurn(room, seat);
  broadcastRoom(room);

  if (room.players[room.currentTurn] && room.players[room.currentTurn].isBot) {
    botPlay(room, room.currentTurn);
  }
}

function advanceTurn(room, currentSeat) {
  const isNewRound = !room.lastPlay;

  // 够级核心规则: 够级激活时，出牌权在够级发起者和对头之间来回跳
  if (room.isGoujiActive && room.goujiSeat >= 0) {
    const goujiPlayer = room.goujiSeat;
    const opposite = getOpposite(goujiPlayer);
    
    if (currentSeat === goujiPlayer) {
      // 够级发起者刚出牌 → 轮到对头
      if (!room.outOrder.includes(opposite) && room.players[opposite]) {
        room.currentTurn = opposite;
        return;
      }
      // 对头已出完，够级结束
      room.isGoujiActive = false;
      room.goujiSeat = -1;
    } else if (currentSeat === opposite) {
      // 对头刚出牌 → 轮回够级发起者
      if (!room.outOrder.includes(goujiPlayer) && room.players[goujiPlayer]) {
        room.currentTurn = goujiPlayer;
        return;
      }
      // 够级发起者已出完，够级结束
      room.isGoujiActive = false;
      room.goujiSeat = -1;
    }
    // 其他情况（烧牌等），够级结束，恢复正常轮转
  }

  // 正常顺序轮转
  let next = currentSeat;
  for (let i = 0; i < 6; i++) {
    next = (next + 1) % 6;
    if (room.outOrder.includes(next) || !room.players[next]) continue;

    // Auto-skip pass-locked players (they already passed this round)
    if (!isNewRound && room.rules.passLock && room.passedThisRound.has(next)) {
      room.consecutivePasses++;
      // Check if all remaining active players have passed → new round
      const activeCount = room.players.filter((p, idx) => p && !room.outOrder.includes(idx)).length;
      if (room.consecutivePasses >= activeCount - 1) {
        room.lastPlay = null;
        room.lastPlaySeat = -1;
        room.consecutivePasses = 0;
        room.isGoujiActive = false;
        room.goujiSeat = -1;
        room.passedThisRound = new Set();
        addMessage(room, '--- 新一轮 ---');
        // All unlocked now, continue to find next player
      }
      continue;
    }

    room.currentTurn = next;
    return;
  }
}

function sendError(room, seat, msg) {
  const p = room.players[seat];
  if (p && p.ws && p.ws.readyState === 1) {
    p.ws.send(JSON.stringify({ type: 'error', message: msg }));
  }
}

function fillBots(room) {
  for (let i = 0; i < 6; i++) {
    if (!room.players[i]) {
      room.players[i] = {
        ws: null,
        name: `电脑${i + 1}`,
        id: `bot-${i}`,
        isBot: true,
      };
    }
  }
}

// ============ WEBSOCKET HANDLING ============
wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerSeat = -1;
  let playerId = uuidv4();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'createRoom': {
        const roomId = uuidv4().slice(0, 6).toUpperCase();
        const room = createRoom(roomId);
        rooms.set(roomId, room);
        ws.send(JSON.stringify({ type: 'roomCreated', roomId }));
        break;
      }

      case 'joinRoom': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
          return;
        }
        if (room.state !== 'waiting') {
          ws.send(JSON.stringify({ type: 'error', message: '游戏已开始' }));
          return;
        }
        const seat = room.players.findIndex(p => p === null);
        if (seat === -1) {
          ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
          return;
        }
        room.players[seat] = {
          ws,
          name: msg.name || `玩家${seat + 1}`,
          id: playerId,
          isBot: false,
        };
        playerRoom = room;
        playerSeat = seat;

        ws.send(JSON.stringify({ type: 'joined', roomId: room.id, seat, name: room.players[seat].name }));
        addMessage(room, `${room.players[seat].name} 加入了房间 (座位 ${seat})`);
        broadcastRoom(room);
        break;
      }

      case 'addBots': {
        if (!playerRoom || playerRoom.state !== 'waiting') return;
        fillBots(playerRoom);
        addMessage(playerRoom, '🤖 已添加电脑玩家');
        broadcastRoom(playerRoom);
        // Auto start
        const playerCount = playerRoom.players.filter(p => p !== null).length;
        if (playerCount === 6 && playerRoom.state === 'waiting') {
          startGame(playerRoom);
        }
        break;
      }

      case 'startGame': {
        if (!playerRoom || playerRoom.state !== 'waiting') return;
        const count = playerRoom.players.filter(p => p !== null).length;
        if (count < 6) {
          fillBots(playerRoom);
        }
        startGame(playerRoom);
        break;
      }

      case 'play': {
        if (!playerRoom) return;
        handlePlay(playerRoom, playerSeat, msg.cardIds);
        break;
      }

      case 'pass': {
        if (!playerRoom) return;
        handlePass(playerRoom, playerSeat);
        break;
      }

      case 'spectate': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
          return;
        }
        const specName = msg.name || '观众';
        const spec = { ws, name: specName, id: playerId };
        room.spectators.push(spec);
        playerRoom = room;
        playerSeat = -1; // mark as spectator

        ws.send(JSON.stringify({ type: 'joined', roomId: room.id, seat: -1, name: specName, isSpectator: true }));
        addMessage(room, `👀 ${specName} 加入观战 (观众: ${room.spectators.length}人)`);
        broadcastRoom(room);
        break;
      }

      case 'geming': {
        // 革命: 手牌无2/王/A时可声明
        if (!playerRoom || playerRoom.state !== 'playing') return;
        if (playerRoom.outOrder.includes(playerSeat)) return;
        if (playerRoom.revolutionSeats.includes(playerSeat)) return;
        if (!playerRoom.rules.geming) {
          sendError(playerRoom, playerSeat, '当前规则不允许革命');
          return;
        }
        const hand = playerRoom.hands[playerSeat];
        const hasHighCards = hand.some(c => 
          c.rank === '2' || c.rank === '小王' || c.rank === '大王' || c.rank === 'A'
        );
        if (hasHighCards) {
          sendError(playerRoom, playerSeat, '手牌有2/王/A，不能革命');
          return;
        }
        // Revolution: discard all cards, count as special out
        playerRoom.revolutionSeats.push(playerSeat);
        playerRoom.hands[playerSeat] = [];
        addMessage(playerRoom, `🏳️ ${playerRoom.players[playerSeat].name} 宣布革命！手牌全弃`);
        // Revolution counts as out (position determined later)
        // Don't add to outOrder yet - they get 三科 or 四科 depending on team
        // For simplicity: treat as immediately out in a special position
        playerRoom.outOrder.push(playerSeat);
        addMessage(playerRoom, `${playerRoom.players[playerSeat].name} 革命退出`);
        // If it was their turn, advance
        if (playerRoom.currentTurn === playerSeat) {
          advanceTurn(playerRoom, playerSeat);
        }
        // Check game end
        const activeLeft = [];
        for (let i = 0; i < 6; i++) {
          if (!playerRoom.outOrder.includes(i)) activeLeft.push(i);
        }
        if (activeLeft.length <= 1) {
          if (activeLeft.length === 1) playerRoom.outOrder.push(activeLeft[0]);
          addMessage(playerRoom, '🏁 游戏结束！');
          playerRoom.state = 'finished';
        }
        broadcastRoom(playerRoom);
        if (playerRoom.state === 'playing' && playerRoom.players[playerRoom.currentTurn]?.isBot) {
          botPlay(playerRoom, playerRoom.currentTurn);
        }
        break;
      }

      case 'updateRules': {
        if (!playerRoom || playerRoom.state !== 'waiting') {
          ws.send(JSON.stringify({ type: 'error', message: '只能在等待阶段修改规则' }));
          return;
        }
        if (msg.rules && typeof msg.rules === 'object') {
          // Only accept known rule keys
          for (const [k, v] of Object.entries(msg.rules)) {
            if (k in DEFAULT_RULES) {
              playerRoom.rules[k] = v;
            }
          }
          addMessage(playerRoom, `⚙️ ${playerRoom.players[playerSeat]?.name || '玩家'} 更新了规则设置`);
          broadcastRoom(playerRoom);
        }
        break;
      }

      case 'restart': {
        if (!playerRoom) return;
        playerRoom.state = 'waiting';
        addMessage(playerRoom, '🔄 准备新一局...');
        // Keep players, clear hands
        for (let i = 0; i < 6; i++) {
          playerRoom.hands[i] = null;
        }
        playerRoom.lastPlay = null;
        playerRoom.outOrder = [];
        broadcastRoom(playerRoom);
        break;
      }

      case 'listRooms': {
        const list = [];
        rooms.forEach((r, id) => {
          const humanCount = r.players.filter(p => p && !p.isBot).length;
          list.push({ id, players: humanCount, state: r.state });
        });
        ws.send(JSON.stringify({ type: 'roomList', rooms: list }));
        break;
      }
    }
  });

  ws.on('close', () => {
    // Remove spectator if applicable
    if (playerRoom && playerSeat === -1) {
      playerRoom.spectators = playerRoom.spectators.filter(s => s.ws !== ws);
      broadcastRoom(playerRoom);
    }
    if (playerRoom && playerSeat >= 0) {
      const p = playerRoom.players[playerSeat];
      if (p && !p.isBot) {
        addMessage(playerRoom, `${p.name} 断开连接`);
        // Replace with bot
        playerRoom.players[playerSeat] = {
          ws: null,
          name: p.name + '(离线)',
          id: `bot-${playerSeat}`,
          isBot: true,
        };
        broadcastRoom(playerRoom);
        // If it was their turn, bot plays
        if (playerRoom.currentTurn === playerSeat && playerRoom.state === 'playing') {
          botPlay(playerRoom, playerSeat);
        }
      }
    }
  });
});

// Cleanup empty rooms periodically
setInterval(() => {
  rooms.forEach((room, id) => {
    const hasHumans = room.players.some(p => p && !p.isBot);
    if (!hasHumans && room.state !== 'waiting') {
      rooms.delete(id);
    }
  });
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`够级游戏服务器运行在 http://localhost:${PORT}`);
});
