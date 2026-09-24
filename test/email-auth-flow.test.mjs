import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("email-auth.js contains ensureFb and applyUser wiring", () => {
  const code = fs.readFileSync("email-auth.js", "utf8");
  assert.ok(code.includes("function applyUser(u)"), "applyUser must be defined in email-auth.js");
  assert.ok(code.includes("function ensureFb()"), "ensureFb must be defined in email-auth.js");
  assert.ok(code.includes("applyUser(user);"), "submitEmail must call applyUser");
  assert.ok(code.includes("smd_last_email_login"), "email-auth must remember last email login");
});

test("account.js recognizes email provider and exposes SMD_applyEmailUser", () => {
  const code = fs.readFileSync("account.js", "utf8");
  assert.ok(code.includes("window.SMD_applyEmailUser = window.SMD_applyGoogleUser;"), "account.js must expose SMD_applyEmailUser");
  assert.ok(code.includes('a.type === "email" || a.providerType === "email"'), "account.js profile() must recognize email accounts");
});

test("home.js recognizes email accounts in signedIn check and sidebar", () => {
  const code = fs.readFileSync("home.js", "utf8");
  assert.ok(code.includes('a.type === "email" || a.providerType === "email"'), "home.js must recognize email accounts as signed in");
});

test("index.html boot splash recognizes email accounts", () => {
  const code = fs.readFileSync("index.html", "utf8");
  assert.ok(code.includes('a.type==="email"||a.providerType==="email"'), "index.html boot splash must recognize email accounts");
});

test("app.js continue check and case syncing allow email accounts", () => {
  const code = fs.readFileSync("app.js", "utf8");
  assert.ok(code.includes('"email"===e.type'), "app.js startup check must allow email accounts");
  assert.ok(code.includes('function a(e){return!!(e&&("google"===e.type||"email"===e.type||"apple"===e.type||!!e.email))}'), "app.js case sync must allow email accounts");
});
