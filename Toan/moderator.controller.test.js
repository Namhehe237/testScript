// File: test/moderator.controller.test.js

const request = require("supertest");
const app = require("../app");
const Community = require("../models/community.model");
const Report = require("../models/report.model");
const User = require("../models/user.model");
const Post = require("../models/post.model");

let moderatorToken = "";
let communityId = "";
let postId = "";

// Mô phỏng đăng nhập và tạo user moderator trước mỗi test
beforeAll(async () => {
  const moderator = await User.create({
    name: "Mod Tester",
    email: "tester@mod.socialecho.com",
    password: "test1234",
    role: "moderator",
  });

  // Đăng nhập để lấy token xác thực
  const res = await request(app).post("/users/signin").send({
    email: "tester@mod.socialecho.com",
    password: "test1234",
  });

  moderatorToken = `Bearer ${res.body.accessToken}`;
});

describe("Moderator Restrictions and Management", () => {
  // Test 10: Không cho phép moderator tạo cộng đồng
  it("TC-MOD-001 - should NOT allow moderator to create community", async () => {
    const res = await request(app)
      .post("/communities")
      .set("Authorization", moderatorToken)
      .send({
        name: "mod-community",
        description: "Moderator's community",
      });

    // Nếu role check hoạt động đúng, phải bị từ chối với 401 hoặc 403
    expect([401, 403]).toContain(res.statusCode);
  });

  // Setup: Tạo community, post và report
  it("Setup community, post, and report", async () => {
    const user = await User.findOne({ email: "tester@mod.socialecho.com" });
    const community = await Community.create({
      name: "mod-check",
      description: "moderator test community",
      members: [user._id],
      moderators: [user._id],
    });
    communityId = community._id;

    const post = await Post.create({
      user: user._id,
      community: communityId,
      content: "This is an inappropriate post",
    });
    postId = post._id;

    await Report.create({
      post: postId,
      community: communityId,
      reportedBy: [user._id],
      reportReason: "Inappropriate content",
    });
  });

  // Test 10.1: Moderator lấy danh sách bài viết bị report
  it("TC-MOD-002 - GET /communities/:name/reported-posts - should get reported posts", async () => {
    const res = await request(app)
      .get("/communities/mod-check/reported-posts")
      .set("Authorization", moderatorToken);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.reportedPosts)).toBe(true);
    expect(res.body.reportedPosts.length).toBeGreaterThan(0);
  });

  // Test 10.3: Xoá bài viết bị report
  it("TC-MOD-003 - DELETE /communities/reported-posts/:postId - should remove reported post", async () => {
    const res = await request(app)
      .delete(`/communities/reported-posts/${postId}`)
      .set("Authorization", moderatorToken);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Reported post removed successfully");
  });

  // Test 10.4: Moderator ban user khỏi cộng đồng
  it("TC-MOD-004 - POST /communities/:name/ban/:id - should ban user", async () => {
    const user = await User.findOne({ email: "tester@mod.socialecho.com" });
    const res = await request(app)
      .post(`/communities/mod-check/ban/${user._id}`)
      .set("Authorization", moderatorToken);

    expect(res.statusCode).toBe(200);
    expect(res.body.bannedUsers).toContainEqual(user._id.toString());
  });

  // Test 10.4: Moderator unban user khỏi cộng đồng
  it("TC-MOD-005 - POST /communities/:name/unban/:id - should unban user", async () => {
    const user = await User.findOne({ email: "tester@mod.socialecho.com" });
    const res = await request(app)
      .post(`/communities/mod-check/unban/${user._id}`)
      .set("Authorization", moderatorToken);

    expect(res.statusCode).toBe(200);
    expect(res.body.bannedUsers).not.toContainEqual(user._id.toString());
  });
});
