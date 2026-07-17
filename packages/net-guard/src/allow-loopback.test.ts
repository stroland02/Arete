import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isBlockedAddress } from "./index.js";

// allowLoopback opts the local self-hosted companion (Ollama) back in WITHOUT
// weakening cloud-metadata protection. Default (no flag) behavior is unchanged.

test("blocks loopback/private by default (flag off)", () => {
  assert.equal(isBlockedAddress("127.0.0.1"), true);
  assert.equal(isBlockedAddress("::1"), true);
  assert.equal(isBlockedAddress("10.1.2.3"), true);
  assert.equal(isBlockedAddress("192.168.1.5"), true);
});

test("allows loopback + RFC1918 when allowLoopback is set", () => {
  assert.equal(isBlockedAddress("127.0.0.1", true), false);
  assert.equal(isBlockedAddress("::1", true), false);
  assert.equal(isBlockedAddress("10.1.2.3", true), false);
  assert.equal(isBlockedAddress("172.16.0.9", true), false);
  assert.equal(isBlockedAddress("192.168.1.5", true), false);
  assert.equal(isBlockedAddress("::ffff:127.0.0.1", true), false);
});

test("STILL blocks cloud metadata even with allowLoopback (the critical guard)", () => {
  assert.equal(isBlockedAddress("169.254.169.254", true), true);
  assert.equal(isBlockedAddress("169.254.0.1", true), true);
  assert.equal(isBlockedAddress("::ffff:169.254.169.254", true), true);
});

test("STILL blocks the unspecified address and exotic ranges with allowLoopback", () => {
  assert.equal(isBlockedAddress("::", true), true);
  assert.equal(isBlockedAddress("0.0.0.1", true), true);
  assert.equal(isBlockedAddress("224.0.0.1", true), true);
  assert.equal(isBlockedAddress("2001:db8::1", true), true);
});

test("still allows public addresses regardless of the flag", () => {
  assert.equal(isBlockedAddress("1.1.1.1"), false);
  assert.equal(isBlockedAddress("1.1.1.1", true), false);
});
