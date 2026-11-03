/* 旧版棋局模拟器已合并进 tools/balance.js。
   这个文件只做命令转接，保证旧的 `node tools/sim_board.js 2 200` 还能跑。

   新用法：
     node tools/balance.js board <人数> <局数> [easy|normal|hard]
*/
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const n = process.argv[2] || '2';
const games = process.argv[3] || '200';
const diff = process.argv[4] || 'normal';
execFileSync(process.execPath, [path.join(__dirname, 'balance.js'), 'board', n, String(games), diff], { stdio: 'inherit' });
