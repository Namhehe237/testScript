/**
 * Unit test cho context-auth.controller.js
 * Dùng user token thay vì admin token
 */

const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const app = require("../app");

const User = require("../models/user.model");
const UserContext = require("../models/context.model");
const SuspiciousLogin = require("../models/suspiciousLogin.model");

let userToken;
let testUserId;
let contextId;

beforeAll(async () => {
  // 1. Tạo user test với mật khẩu đã hash
  const hashedPassword = await bcrypt.hash("123456", 10);

  const user = new User({
    name: "Test Context User",
    email: "test.context@example.com",
    password: hashedPassword,
  });
  await user.save();
  testUserId = user._id;

  // 2. Đăng nhập để lấy access token
  const res = await request(app).post("/users/signin").send({
    email: "test.context@example.com",
    password: "123456",
  });

  expect(res.statusCode).toBe(200);
  userToken = `Bearer ${res.body.accessToken}`;

  // 3. Tạo context device ban đầu cho user
  const context = new UserContext({
    user: testUserId,
    email: "test.context@example.com",
    ip: "127.0.0.1",
    country: "VN",
    city: "Hanoi",
    browser: "Chrome 100",
    platform: "Windows",
    os: "Windows NT",
    device: "Laptop",
    deviceType: "Desktop",
  });
  await context.save();
});

afterAll(async () => {
  await User.deleteOne({ _id: testUserId });
  await UserContext.deleteMany({ user: testUserId });
  await SuspiciousLogin.deleteMany({ user: testUserId });
  await mongoose.connection.close();
});

describe("Context Auth Controller", () => {
  // TC-CONTEXT-001
  it("TC-CONTEXT-001 - GET /auth/context-data/primary - should get user context", async () => {
    const res = await request(app)
      .get("/auth/context-data/primary")
      .set("Authorization", userToken);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("ip");
    expect(res.body).toHaveProperty("browser");
  });

  // TC-CONTEXT-002
  it("TC-CONTEXT-002 - GET /auth/context-data/trusted - should return empty array (no trusted yet)", async () => {
    const res = await request(app)
      .get("/auth/context-data/trusted")
      .set("Authorization", userToken);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  // TC-CONTEXT-003
  it("TC-CONTEXT-003 - GET /auth/context-data/blocked - should return empty array (no blocked yet)", async () => {
    const res = await request(app)
      .get("/auth/context-data/blocked")
      .set("Authorization", userToken);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  // TC-CONTEXT-004
  it("TC-CONTEXT-004 - GET /auth/context-data/blocked - should return blocked data", async () => {
    const blocked = new SuspiciousLogin({
      user: testUserId,
      email: "test.context@example.com",
      ip: "192.168.1.1",
      country: "VN",
      city: "Hanoi",
      browser: "Firefox 90",
      platform: "Linux",
      os: "Ubuntu",
      device: "PC",
      deviceType: "Desktop",
      isBlocked: true,
      isTrusted: false,
    });
    const saved = await blocked.save();
    contextId = saved._id;

    const res = await request(app)
      .get("/auth/context-data/blocked")
      .set("Authorization", userToken);

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  // TC-CONTEXT-005
  it("TC-CONTEXT-005 - DELETE /auth/context-data/:id - should delete context", async () => {
    const res = await request(app)
      .delete(`/auth/context-data/${contextId}`)
      .set("Authorization", userToken);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Data deleted successfully");
  });
});
