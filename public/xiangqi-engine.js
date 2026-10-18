/*
 * 中国象棋规则引擎（Xiangqi）— UMD 单份共用
 * 服务端 (require) 与浏览器 (<script>) 加载同一份代码，前后端规则零分歧。
 *
 * 棋盘坐标系：board[r][c]，r:0..9（0=顶部=黑方底线，9=底部=红方底线），c:0..8。
 * 每格为 null 或 { t, c }：
 *   t ∈ { G=帅/将, A=仕/士, E=相/象, H=马, R=车, C=炮, P=兵/卒 }
 *   c ∈ { 'r'=红, 'b'=黑 }  （红方在下、黑方在上）
 * 红方前进方向 row-1（向上），黑方前进方向 row+1（向下）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Xiangqi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROWS = 10, COLS = 9;
  var CN_COL = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']; // 红方列名（左→右 1-9）
  var PIECE_NAME = {
    r: { G: '帅', A: '仕', E: '相', H: '马', R: '车', C: '炮', P: '兵' },
    b: { G: '将', A: '士', E: '象', H: '马', R: '车', C: '炮', P: '卒' }
  };

  function opp(color) { return color === 'r' ? 'b' : 'r'; }
  function inBoard(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
  function isRed(p) { return p && p.c === 'r'; }

  // 是否在己方九宫：黑 row∈[0,2] col∈[3,5]；红 row∈[7,9] col∈[3,5]
  function inPalace(p, r, c) {
    if (c < 3 || c > 5) return false;
    return p.c === 'b' ? (r >= 0 && r <= 2) : (r >= 7 && r <= 9);
  }
  // 是否过河：红兵 row<=4；黑卒 row>=5
  function crossedRiver(p, r) {
    return p.c === 'r' ? r <= 4 : r >= 5;
  }

  function initial() {
    var b = [];
    for (var r = 0; r < ROWS; r++) { b.push(new Array(COLS).fill(null)); }
    var back = ['R', 'H', 'E', 'A', 'G', 'A', 'E', 'H', 'R'];
    for (var c = 0; c < COLS; c++) {
      b[0][c] = { t: back[c], c: 'b' };
      b[9][c] = { t: back[c], c: 'r' };
    }
    b[2][1] = { t: 'C', c: 'b' }; b[2][7] = { t: 'C', c: 'b' };
    b[7][1] = { t: 'C', c: 'r' }; b[7][7] = { t: 'C', c: 'r' };
    [0, 2, 4, 6, 8].forEach(function (cc) {
      b[3][cc] = { t: 'P', c: 'b' };
      b[6][cc] = { t: 'P', c: 'r' };
    });
    return {
      board: b, turn: 'r', moveCount: 0,
      status: 'playing', winner: null, result: null, inCheck: null,
      lastMove: null, history: []
    };
  }

  function cloneState(s) {
    var nb = s.board.map(function (row) { return row.slice(); });
    return {
      board: nb, turn: s.turn, moveCount: s.moveCount,
      status: s.status, winner: s.winner, result: s.result, inCheck: s.inCheck,
      lastMove: s.lastMove, history: s.history
    };
  }

  // 纯几何：位于 (r,c) 的棋子能否走/吃到 (tr,tc)。不判断己方/将军合法性。
  function canReach(board, r, c, tr, tc) {
    var p = board[r][c];
    if (!p || (tr === r && tc === c)) return false;
    var dr = tr - r, dc = tc - c;
    var target = board[tr][tc];
    switch (p.t) {
      case 'G':
        if (!inPalace(p, tr, tc)) return false;
        return Math.abs(dr) + Math.abs(dc) === 1;
      case 'A':
        if (!inPalace(p, tr, tc)) return false;
        return Math.abs(dr) === 1 && Math.abs(dc) === 1;
      case 'E': {
        if (Math.abs(dr) !== 2 || Math.abs(dc) !== 2) return false;
        if (p.c === 'r' ? tr <= 4 : tr >= 5) return false; // 相/象不能过河
        var er = r + dr / 2, ec = c + dc / 2; // 象眼
        return board[er][ec] === null;
      }
      case 'H': {
        var ad = Math.abs(dr), ac = Math.abs(dc);
        if (!((ad === 2 && ac === 1) || (ad === 1 && ac === 2))) return false;
        // 蹩马腿：纵向日腿在 (r±1,c)，横向日腿在 (r,c±1)
        if (ad === 2) { var lr = r + dr / 2; return board[lr][c] === null; }
        else { var lc = c + dc / 2; return board[r][lc] === null; }
      }
      case 'R': {
        if (dr !== 0 && dc !== 0) return false;
        var stepR = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
        var stepC = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
        var rr = r + stepR, cc = c + stepC;
        while (rr !== tr || cc !== tc) {
          if (board[rr][cc] !== null) return false;
          rr += stepR; cc += stepC;
        }
        return true; // 空格或敌子均可（落点合法性在生成处用目标子判断）
      }
      case 'C': {
        if (dr !== 0 && dc !== 0) return false;
        var sr = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
        var sc = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
        var q = r + sr, w = c + sc, jump = 0;
        while (q !== tr || w !== tc) {
          if (board[q][w] !== null) jump++;
          if (jump > 1) return false;
          q += sr; w += sc;
        }
        if (jump === 0) return target === null;        // 不吃子：仅空格
        if (jump === 1) return target !== null;         // 隔一炮架：仅能吃
        return false;
      }
      case 'P': {
        var fwd = p.c === 'r' ? -1 : 1;
        if (dc === 0 && dr === fwd) return true;        // 向前（含吃子）
        if (dr === 0 && Math.abs(dc) === 1 && crossedRiver(p, r)) return true; // 过河横走
        return false;                                   // 不能后退/斜走
      }
    }
    return false;
  }

  // 仅按颜色枚举所有子的纯几何攻击（用于将军/被攻击检测；飞将不算将军，单独处理）
  function attacksSquare(board, tr, tc, byColor) {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var p = board[r][c];
        if (!p || p.c !== byColor) continue;
        if (canReach(board, r, c, tr, tc)) return true;
      }
    }
    return false;
  }

  // 两将是否同列且中间无子（飞将局面）
  function generalsFacing(board) {
    var g1 = null, g2 = null;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var q = board[r][c];
      if (q && q.t === 'G') { if (!g1) g1 = [r, c]; else g2 = [r, c]; }
    }
    if (!g1 || !g2 || g1[1] !== g2[1]) return false;
    var lo = Math.min(g1[0], g2[0]) + 1, hi = Math.max(g1[0], g2[0]);
    for (r = lo; r < hi; r++) if (board[r][g1[1]] !== null) return false;
    return true;
  }

  // 飞将违规：走子后两将照面即违规；但若走前已照面（保持），仅当移动的是"将"本身才违规
  function flyViolation(beforeBoard, afterBoard, movedPiece) {
    if (!generalsFacing(afterBoard)) return false;
    if (!generalsFacing(beforeBoard)) return true; // 制造照面
    return movedPiece.t === 'G';                    // 保持照面且动将
  }

  function findGeneral(board, color) {
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var p = board[r][c];
      if (p && p.t === 'G' && p.c === color) return [r, c];
    }
    return null;
  }

  function inCheck(board, color) {
    var g = findGeneral(board, color);
    if (!g) return true; // 将不在盘上（理论上已结束）
    return attacksSquare(board, g[0], g[1], opp(color));
  }

  // 生成某子的伪合法着法（仅排除"落点为己方子"）
  function pseudoMovesFrom(state, r, c) {
    var p = state.board[r][c];
    if (!p) return [];
    var out = [];
    for (var tr = 0; tr < ROWS; tr++) for (var tc = 0; tc < COLS; tc++) {
      if (!canReach(state.board, r, c, tr, tc)) continue;
      var tgt = state.board[tr][tc];
      if (tgt && tgt.c === p.c) continue; // 不能吃己方
      out.push({ from: [r, c], to: [tr, tc], piece: { t: p.t, c: p.c }, captured: tgt ? tgt.t : null });
    }
    return out;
  }

  function legalMovesFrom(state, r, c) {
    var pseudo = pseudoMovesFrom(state, r, c);
    var side = state.turn, moved = state.board[r][c];
    var out = [];
    for (var i = 0; i < pseudo.length; i++) {
      var nb = doApply(state.board, pseudo[i]);
      if (inCheck(nb, side)) continue;
      if (flyViolation(state.board, nb, moved)) continue;
      out.push(pseudo[i]);
    }
    return out;
  }

  function legalMoves(state) {
    var side = state.turn, out = [];
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var p = state.board[r][c];
      if (!p || p.c !== side) continue;
      var ms = pseudoMovesFrom(state, r, c);
      for (var i = 0; i < ms.length; i++) {
        var nb = doApply(state.board, ms[i]);
        if (inCheck(nb, side)) continue;
        if (flyViolation(state.board, nb, p)) continue;
        out.push(ms[i]);
      }
    }
    return out;
  }

  function doApply(board, mv) {
    var nb = board.map(function (row) { return row.slice(); });
    nb[mv.to[0]][mv.to[1]] = nb[mv.from[0]][mv.from[1]];
    nb[mv.from[0]][mv.from[1]] = null;
    return nb;
  }

  function findMove(state, from, to) {
    var ms = legalMovesFrom(state, from[0], from[1]);
    for (var i = 0; i < ms.length; i++) {
      if (ms[i].to[0] === to[0] && ms[i].to[1] === to[1]) return ms[i];
    }
    return null;
  }

  function moveToSan(piece, from, to) {
    var name = PIECE_NAME[piece.c][piece.t];
    var colFrom = piece.c === 'r' ? CN_COL[from[1] + 1] : String(from[1] + 1);
    var colTo = piece.c === 'r' ? CN_COL[to[1] + 1] : String(to[1] + 1);
    var dir;
    if (piece.c === 'r') {
      if (to[0] < from[0]) dir = '进'; else if (to[0] > from[0]) dir = '退'; else dir = '平';
    } else {
      if (to[0] > from[0]) dir = '进'; else if (to[0] < from[0]) dir = '退'; else dir = '平';
    }
    if (piece.t === 'P' && dir === '进') return name + colFrom + dir + (piece.c === 'r' ? '一' : '1');
    return name + colFrom + dir + colTo;
  }

  function apply(state, mv) {
    var ns = cloneState(state);
    var piece = state.board[mv.from[0]][mv.from[1]];
    var captured = state.board[mv.to[0]][mv.to[1]];
    ns.board = doApply(state.board, mv);
    ns.turn = opp(state.turn);
    ns.moveCount = state.moveCount + 1;
    ns.lastMove = { from: mv.from.slice(), to: mv.to.slice() };
    var san = moveToSan(piece, mv.from, mv.to);
    ns.history = state.history.concat([{ san: san, by: state.turn, from: mv.from.slice(), to: mv.to.slice(), captured: captured ? captured.t : null }]);

    var nextLegal = legalMoves(ns);
    var chk = inCheck(ns.board, ns.turn);
    if (nextLegal.length === 0) {
      if (chk) { ns.status = 'over'; ns.winner = state.turn; ns.result = 'checkmate'; } // 将死
      else { ns.status = 'over'; ns.winner = state.turn; ns.result = 'stalemate'; }      // 困毙（判负）
    } else {
      ns.status = 'playing'; ns.winner = null; ns.result = null;
      ns.inCheck = chk ? ns.turn : null;
    }
    return ns;
  }

  // 终局（认输/和棋）由调用方设置
  function setResign(state, loser) {
    var ns = cloneState(state);
    ns.status = 'over'; ns.winner = opp(loser); ns.result = 'resign';
    return ns;
  }
  function setDraw(state) {
    var ns = cloneState(state);
    ns.status = 'over'; ns.winner = null; ns.result = 'draw';
    return ns;
  }

  return {
    ROWS: ROWS, COLS: COLS, opp: opp, inBoard: inBoard,
    initial: initial, cloneState: cloneState,
    canReach: canReach, attacksSquare: attacksSquare, findGeneral: findGeneral,
    generalsFacing: generalsFacing,
    inCheck: inCheck, pseudoMovesFrom: pseudoMovesFrom, legalMovesFrom: legalMovesFrom,
    legalMoves: legalMoves, findMove: findMove, apply: apply,
    moveToSan: moveToSan, setResign: setResign, setDraw: setDraw,
    CN_COL: CN_COL, PIECE_NAME: PIECE_NAME
  };
});
