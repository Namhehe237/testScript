/**
 * Unit test cho các chức năng của admin.controller.js
 * Mã TC theo mục 2.3 của báo cáo
 */

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app"); // Đảm bảo app.js không chứa app.listen
const Log = require("../models/log.model");
const Admin = require("../models/admin.model");
const Config = require("../models/config.model");

let token = null;
let testAdminId = null;

beforeAll(async () => {
  // ✅ Tạo tài khoản admin hợp lệ (để schema tự hash password)
  const admin = new Admin({
    username: "admin123", // hợp lệ theo /^[a-zA-Z0-9]+$/
    password: "password123",
  });
  await admin.save();
  testAdminId = admin._id;

  // ✅ Đăng nhập để lấy accessToken
  const res = await request(app).post("/admin/signin").send({
    username: "admin123",
    password: "password123",
  });

  // ✅ Nếu login thành công, lấy token
  expect(res.statusCode).toBe(200);
  expect(res.body).toHaveProperty("accessToken");
  token = `Bearer ${res.body.accessToken}`;
});

afterAll(async () => {
  // ✅ Xoá dữ liệu test và đóng kết nối DB
  await Admin.deleteOne({ _id: testAdminId });
  await Log.deleteMany({ email: "admin@test.com" });
  await Config.deleteMany({});
  await mongoose.connection.close();
});

describe("Admin Controller - Log Management", () => {
  // TC-ADM-LOG-001: Xem danh sách log
  it("TC-ADM-LOG-001 - GET /admin/logs - should return logs", async () => {
    const res = await request(app)
      .get("/admin/logs")
      .set("Authorization", token);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // TC-ADM-LOG-002: Xoá log
  it("TC-ADM-LOG-002 - DELETE /admin/logs - should delete all logs", async () => {
    await Log.create({
      type: "general",
      email: "admin@test.com",
      message: "Test log",
      level: "info",
      timestamp: new Date(),
    });

    const res = await request(app)
      .delete("/admin/logs")
      .set("Authorization", token);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("All logs deleted!");

    const logs = await Log.find({});
    expect(logs.length).toBe(0);
  });
});

describe("Admin Controller - Auth & Config", () => {
  // TC-ADM-AUTH-001: Đăng nhập admin
  it("TC-ADM-AUTH-001 - POST /admin/signin - should sign in with valid credentials", async () => {
    const res = await request(app).post("/admin/signin").send({
      username: "admin123",
      password: "password123",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
  });

  // TC-ADM-CONFIG-001: Lấy config
  it("TC-ADM-CONFIG-001 - GET /admin/preferences - should retrieve preferences", async () => {
    const res = await request(app)
      .get("/admin/preferences")
      .set("Authorization", token);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("usePerspectiveAPI");
  });

  // TC-ADM-CONFIG-002: Cập nhật config
  it("TC-ADM-CONFIG-002 - PUT /admin/preferences - should update preferences", async () => {
    const res = await request(app)
      .put("/admin/preferences")
      .set("Authorization", token)
      .send({
        usePerspectiveAPI: true,
        categoryFilteringServiceProvider: "TextRazor",
        categoryFilteringRequestTimeout: 3000,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.usePerspectiveAPI).toBe(true);
  });
});
