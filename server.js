/*
 * 中国象棋 H5 服务端：静态资源 + WebSocket 房间 + 权威校验
 * 所有写操作（落子/悔棋/认输/和棋/重开）均用 xiangqi-engine 校验，前端无法作弊。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Xiangqi = require('./public/xiangqi-engine.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

const rooms = new Map(); // id -> room

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/' });

function genRoomId() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do { id = ''; for (let i = 0; i < 4; i++) id += A[Math.floor(Math.random() * A.length)]; } while (rooms.has(id));
  return id;
}

function publicState(room) {
  return {
    id: room.id,
    turn: room.state.turn,
    status: room.state.status,
    winner: room.state.winner,
    result: room.state.result,
    lastMove: room.state.lastMove,
    inCheck: room.state.inCheck,
    moveCount: room.state.moveCount,
    board: room.state.board,
    history: room.state.history.map(function (h) { return { san: h.san, by: h.by }; }),
    players: room.players.map(function (p) { return { pid: p.pid, color: p.color, name: p.name, online: p.online }; }),
    drawReq: room.drawReq,
    undoReq: room.undoReq
  };
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj) { room.players.forEach(function (p) { if (p.ws) send(p.ws, obj); }); }
function findPlayer(room, pid) { return room.players.find(function (p) { return p.pid === pid; }); }

wss.on('connection', function (ws) {
  const pid = 'p' + Math.random().toString(36).slice(2, 9);
  ws.pid = pid;
  send(ws, { t: 'welcome', pid: pid });

  ws.on('message', function (raw) {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.t === 'create') {
      const id = genRoomId();
      const room = {
        id: id, state: Xiangqi.initial(), historyStack: [], drawReq: null, undoReq: null,
        players: [{ pid: pid, color: 'r', name: msg.name || '红方', online: true, ws: ws }]
      };
      rooms.set(id, room);
      send(ws, { t: 'state', state: publicState(room), youAre: 'r' });
      return;
    }
    if (msg.t === 'join') {
      const room = rooms.get((msg.room || '').toUpperCase());
      if (!room) { send(ws, { t: 'error', msg: '房间不存在' }); return; }
      const existing = room.players.find(function (p) { return p.pid === pid; });
      if (existing) {
        existing.online = true; existing.ws = ws;
        send(ws, { t: 'state', state: publicState(room), youAre: existing.color });
        broadcast(room, { t: 'state', state: publicState(room) });
        return;
      }
      if (room.players.length >= 2) {
        const off = room.players.find(function (p) { return !p.online; }); // 断线重连：替换掉线玩家
        if (off) {
          off.pid = pid; off.online = true; off.ws = ws; if (msg.name) off.name = msg.name;
          send(ws, { t: 'state', state: publicState(room), youAre: off.color });
          broadcast(room, { t: 'state', state: publicState(room) });
          broadcast(room, { t: 'system', msg: (off.name || '对方') + ' 已重连' });
          return;
        }
        send(ws, { t: 'error', msg: '房间已满' }); return;
      }
      room.players.push({ pid: pid, color: 'b', name: msg.name || '黑方', online: true, ws: ws });
      send(ws, { t: 'state', state: publicState(room), youAre: 'b' });
      broadcast(room, { t: 'state', state: publicState(room) });
      broadcast(room, { t: 'system', msg: (msg.name || '黑方') + ' 已加入，对局开始！' });
      return;
    }
    const room = rooms.get((msg.room || '').toUpperCase());
    if (!room) return;
    const me = findPlayer(room, pid);
    if (!me) return;

    if (msg.t === 'name') {
      me.name = msg.name || me.name;
      broadcast(room, { t: 'state', state: publicState(room) });
      return;
    }
    if (msg.t === 'chat') {
      broadcast(room, { t: 'chat', from: me.color, name: me.name, text: String(msg.text || '').slice(0, 60) });
      return;
    }
    if (msg.t === 'move') {
      if (room.state.status !== 'playing') { send(ws, { t: 'error', msg: '对局已结束' }); return; }
      if (me.color !== room.state.turn) { send(ws, { t: 'error', msg: '还没轮到你' }); return; }
      const mv = Xiangqi.findMove(room.state, msg.from, msg.to);
      if (!mv) { send(ws, { t: 'error', msg: '非法着法' }); return; }
      room.historyStack.push(JSON.parse(JSON.stringify(room.state)));
      room.state = Xiangqi.apply(room.state, mv);
      room.undoReq = null; room.drawReq = null;
      broadcast(room, { t: 'state', state: publicState(room) });
      if (room.state.status === 'over') {
        const w = room.state.winner;
        const txt = w ? (w === 'r' ? '红方' : '黑方') + '胜' : '和棋';
        const why = room.state.result === 'checkmate' ? '将死' : room.state.result === 'resign' ? '认输' : room.state.result === 'draw' ? '' : '困毙';
        broadcast(room, { t: 'system', msg: txt + (why ? '（' + why + '）' : '') });
      }
      return;
    }
    if (msg.t === 'undo_req') {
      if (room.state.status !== 'playing' || room.historyStack.length === 0) return;
      room.undoReq = pid;
      broadcast(room, { t: 'state', state: publicState(room) });
      const opp = room.players.find(function (p) { return p.pid !== pid; });
      if (opp) send(opp.ws, { t: 'system', msg: (me.name || '对方') + ' 请求悔棋' });
      return;
    }
    if (msg.t === 'undo_res') {
      if (room.undoReq && msg.accept) {
        room.state = room.historyStack.pop();
        room.undoReq = null;
        broadcast(room, { t: 'state', state: publicState(room) });
        broadcast(room, { t: 'system', msg: '悔棋成功' });
      } else { room.undoReq = null; broadcast(room, { t: 'state', state: publicState(room) }); }
      return;
    }
    if (msg.t === 'draw_req') {
      if (room.state.status !== 'playing') return;
      room.drawReq = pid;
      broadcast(room, { t: 'state', state: publicState(room) });
      const opp = room.players.find(function (p) { return p.pid !== pid; });
      if (opp) send(opp.ws, { t: 'system', msg: (me.name || '对方') + ' 提议和棋' });
      return;
    }
    if (msg.t === 'draw_res') {
      if (room.drawReq && msg.accept) {
        room.state = Xiangqi.setDraw(room.state);
        room.drawReq = null;
        broadcast(room, { t: 'state', state: publicState(room) });
        broadcast(room, { t: 'system', msg: '双方同意，和棋' });
      } else { room.drawReq = null; broadcast(room, { t: 'state', state: publicState(room) }); }
      return;
    }
    if (msg.t === 'resign') {
      if (room.state.status !== 'playing') return;
      room.state = Xiangqi.setResign(room.state, me.color);
      broadcast(room, { t: 'state', state: publicState(room) });
      broadcast(room, { t: 'system', msg: (me.name || (me.color === 'r' ? '红方' : '黑方')) + ' 认输，' + (me.color === 'r' ? '黑方' : '红方') + '胜' });
      return;
    }
    if (msg.t === 'restart') {
      // 交换双方颜色，新局红先 → 原黑方（现红）先手（败方先手）
      const a = room.players[0], b = room.players[1];
      if (a && b) { const tc = a.color; a.color = b.color; b.color = tc; }
      room.state = Xiangqi.initial();
      room.historyStack = []; room.drawReq = null; room.undoReq = null;
      broadcast(room, { t: 'state', state: publicState(room), youAre: me.color });
      broadcast(room, { t: 'system', msg: '新对局开始（交换先后手）' });
      return;
    }
  });

  ws.on('close', function () {
    rooms.forEach(function (room) {
      const p = findPlayer(room, pid);
      if (p) {
        p.online = false;
        broadcast(room, { t: 'state', state: publicState(room) });
        broadcast(room, { t: 'system', msg: (p.name || (p.color === 'r' ? '红方' : '黑方')) + ' 断开' });
        // 5 分钟后无人在线则清理
        setTimeout(function () {
          if (room.players.every(function (q) { return !q.online; })) rooms.delete(room.id);
        }, 5 * 60 * 1000);
      }
    });
  });
});

server.listen(PORT, function () { console.log('中国象棋服务已启动: http://localhost:' + PORT); });
