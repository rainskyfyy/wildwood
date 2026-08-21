#!/usr/bin/env node
// Wildwood mock Godot web export - 零依赖静态服务器
// M1.3 E2E 用,真实 Godot web build 接入后这个文件可以被替换或删除。
//
// 端口:默认 4173(和 Vite preview 一致,方便切换),可通过 PORT 环境变量覆盖
// 根目录:本文件所在目录

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '4173', 10);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.wasm': 'application/wasm',
  '.pck':  'application/octet-stream',
  '.map':  'application/json; charset=utf-8',
};

function safeJoin(root, requested) {
  // 防穿越:把请求路径 normalize,确保仍在 root 下
  const decoded = decodeURIComponent(requested.split('?')[0]);
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(root)) {
    return null;
  }
  return resolved;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url || '/');
  let pathname = parsed.pathname || '/';
  if (pathname === '/') pathname = '/index.html';

  const filePath = safeJoin(ROOT, pathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found: ' + pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-server] listening on http://${HOST}:${PORT}`);
  console.log(`[mock-server] root: ${ROOT}`);
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
