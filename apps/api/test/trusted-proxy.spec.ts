import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import express = require('express');
import { parseTrustedProxy } from '../src/common/trusted-proxy';

function requestIp(config: string | undefined, peer: string, forwarded?: string) {
  const app = express(); app.set('trust proxy', parseTrustedProxy(config));
  const req = Object.assign(Object.create(express.request), {
    app, socket: { remoteAddress: peer }, headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
  }) as express.Request;
  return { ip: req.ip, ips: req.ips };
}

test('默认不信任XFF；直接请求不能伪造来源，即使启用loopback', () => {
  assert.deepEqual(parseTrustedProxy(undefined), false);
  assert.deepEqual(parseTrustedProxy('false'), false);
  assert.equal(requestIp(undefined, '198.51.100.10', '203.0.113.99').ip, '198.51.100.10');
  assert.equal(requestIp('loopback', '198.51.100.10', '203.0.113.99').ip, '198.51.100.10');
});

test('同机Nginx按真实候选人独立计额；忽略候选人预置的伪造XFF前缀', () => {
  assert.equal(requestIp('loopback', '127.0.0.1', '198.51.100.10').ip, '198.51.100.10');
  assert.equal(requestIp('loopback', '::ffff:127.0.0.1', '198.51.100.11').ip, '198.51.100.11');
  assert.deepEqual(requestIp('loopback', '127.0.0.1', '203.0.113.99, 198.51.100.10'), { ip: '198.51.100.10', ips: ['198.51.100.10'] });
});

test('仅信任指定代理IP/CIDR链，未知中间代理处停止解析', () => {
  assert.equal(requestIp('10.0.0.12/32,10.0.1.0/24', '10.0.0.12', '198.51.100.10, 10.0.1.20').ip, '198.51.100.10');
  assert.equal(requestIp('10.0.0.12/32', '10.0.0.12', '198.51.100.10, 10.9.0.12').ip, '10.9.0.12');
  assert.deepEqual(parseTrustedProxy('::1/128, 10.0.0.12'), ['::1/128', '10.0.0.12']);
});

test('拒绝无条件信任、跳数、全网网段及拼写错误', () => {
  for (const input of ['true', '1', '0', '*', '0.0.0.0/0', '::/0', '127.0.0.1/33', '::1/129', 'loopback,', '10.0.0.1/not-mask', 'proxy.example.com']) {
    assert.throws(() => parseTrustedProxy(input), /TRUST_PROXY/);
  }
});
