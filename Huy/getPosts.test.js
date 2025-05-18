const request = require('supertest'); // Import supertest
const express = require('express'); // Import express
const mongoose = require('mongoose'); // Import mongoose
const jwt = require('jsonwebtoken'); // Import jwt
const http = require('http'); // Import http module
const fs = require('fs'); // Import fs module

const formatCreatedAt = require("../utils/timeConverter"); // Import formatCreatedAt

require('dotenv').config(); // Load biến môi trường

// Import models
const Post = require('../models/post.model');
const Community = require('../models/community.model');
const Comment = require('../models/comment.model');
const User = require('../models/user.model');
const Relationship = require('../models/relationship.model');
const Report = require('../models/report.model');
const PendingPost = require('../models/pendingPost.model');

// Import routes (chỉ cần postRoutes vì test getPosts)
const postRoutes = require('../routes/post.route');

// Mock middleware và services cần thiết cho route
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => next(), // Mock passport để bỏ qua xác thực thực
}));
jest.mock('../middlewares/auth/decodeToken', () => (req, res, next) => {
  // Mock decodeToken để lấy userId từ header hoặc gán mặc định nếu cần
  req.userId = req.headers['user-id'] || 'defaultTestUserId';
  next();
});
jest.mock('../middlewares/limiter/limiter', () => ({
  followLimiter: (req, res, next) => next(), // Mock giới hạn tốc độ cho follow
  signUpSignInLimiter: (req, res, next) => next(), // Mock giới hạn tốc độ cho signin/signup
  createPostLimiter: (req, res, next) => next(), // Thêm mock cho createPostLimiter
  likeSaveLimiter: (req, res, next) => next(), // Thêm mock cho likeSaveLimiter
  commentLimiter: (req, res, next) => next(), // Thêm mock cho commentLimiter
}));
jest.mock('express-useragent', () => ({
  express: () => (req, res, next) => {
    // Mock useragent để cung cấp dữ liệu user-agent giả
    req.useragent = { isMobile: false, browser: 'test', version: '1.0', os: 'testOS', platform: 'testPlatform' };
    next();
  },
}));

// Mock dayjs to control time-based outputs in tests
jest.mock('dayjs', () => {
  const actualDayjs = jest.requireActual('dayjs');
  const relativeTime = require('dayjs/plugin/relativeTime');

  // Extend the actual dayjs with the plugin.
  // This ensures the actual extend method works if we use it later.
  actualDayjs.extend(relativeTime);

  // Create a mock function that simulates calling dayjs(date)
  const mockDayjsInstance = (date) => ({
    fromNow: jest.fn(() => 'a few seconds ago'),
    format: jest.fn((formatString) => {
      // Simple mock for format, adjust if needed
      if (formatString === 'YYYY-MM-DD HH:mm:ss') {
        return 'YYYY-MM-DD HH:mm:ss'; // Trả về định dạng mock
      }
      // Use actual format for other cases if needed by the controller
      return actualDayjs(date).format(formatString);
    }),
  });

  const mockDayjs = jest.fn(mockDayjsInstance); // This function is what dayjs(date) calls

  mockDayjs.extend = actualDayjs.extend;
  return mockDayjs; // Return the callable mock function with the extend property
});

// Mock formatCreatedAt (if used in controller and needs consistent output)
jest.mock('../utils/timeConverter', () => jest.fn(() => 'YYYY-MM-DD HH:mm:ss'));

// Mock analyzeContent service to prevent loading issues during route setup
jest.mock('../services/analyzeContent', () => jest.fn((req, res, next) => next()));

// Thêm mock cho userInputValidator middleware
jest.mock('../middlewares/post/userInputValidator', () => ({
  commentValidator: jest.fn((req, res, next) => next()),
  postValidator: jest.fn((req, res, next) => next()),
  validatorHandler: jest.fn((req, res, next) => next()),
}));

// Thêm mock cho processPost service
jest.mock('../services/processPost', () => jest.fn((req, res, next) => next()));

// Thêm mock cho fileUpload middleware
jest.mock('../middlewares/post/fileUpload', () => jest.fn((req, res, next) => {
  // Mock file upload logic if needed for routes that use it
  req.file = { filename: 'mockfile.jpg', path: './assets/userFiles/mockfile.jpg' };
  req.fileUrl = 'http://example.com/mockfile.jpg';
  req.fileType = 'image/jpeg';
  next();
}));

// Thêm mock cho postConfirmation middleware
jest.mock('../middlewares/post/postConfirmation', () => jest.fn((req, res, next) => next()));


describe('GET /posts Integration Tests (with real DB)', () => {
  let app; // Instance ứng dụng Express cho thử nghiệm
  let db; // Instance kết nối cơ sở dữ liệu
  let server; // Biến để lưu trữ instance server HTTP

  // Thiết lập trước khi tất cả các test chạy
  beforeAll(async () => {
    // Sử dụng MONGODB_URI từ .env của bạn
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI không được định nghĩa trong .env!');
    }
    console.log(`Kết nối đến cơ sở dữ liệu thật: ${uri}`);
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      // Thêm option dbName nếu bạn muốn kết nối đến một database test cụ thể
      // dbName: 'socialecho_test'
    });
    db = mongoose.connection; // Lưu connection instance

    app = express();
    app.use(express.json()); // Phân tích cú pháp body JSON
    // Gắn middleware decodeToken trước khi gắn routes cần xác thực
    app.use(require('../middlewares/auth/decodeToken'));
    app.use('/posts', postRoutes); // Gắn route post dưới /posts

    process.env.SECRET = process.env.SECRET || 'testsecret'; // Đảm bảo SECRET có giá trị

    // Tạo server HTTP thủ công và lưu trữ nó
    server = http.createServer(app);
    // Bắt đầu lắng nghe trên một cổng ngẫu nhiên để tránh xung đột
    await new Promise(resolve => server.listen(0, resolve));
  });

  // Dọn dẹp sau khi tất cả test hoàn tất
  afterAll(async () => {
    // Xóa tất cả dữ liệu test
    await Post.deleteMany({});
    await Community.deleteMany({});
    await Comment.deleteMany({});
    await User.deleteMany({});
    await Relationship.deleteMany({});
    await Report.deleteMany({});
    await PendingPost.deleteMany({});
    console.log('Đã xóa dữ liệu thử nghiệm khỏi cơ sở dữ liệu thật.'); // Cập nhật thông báo

    await mongoose.disconnect(); // Use disconnect to ensure all connections are closed

    // Đóng server HTTP
    await new Promise(resolve => server.close(resolve));
  });

  // Dọn dẹp dữ liệu trước mỗi test
  beforeEach(async () => {
    // Clear all collections before each test to ensure a clean state
    await Post.deleteMany({});
    await Community.deleteMany({});
    await Comment.deleteMany({});
    await User.deleteMany({});
    await Relationship.deleteMany({});
    await Report.deleteMany({});
    await PendingPost.deleteMany({});
    // TODO: Add other models if they are involved in post controller tests
  });

  // Hàm trợ giúp để tạo user thử nghiệm trong cơ sở dữ liệu THỰC
  const createTestUser = async (emailPrefix, name, role = 'general') => {
    const timestamp = Date.now(); // Dùng timestamp để email độc nhất
    const email = `${emailPrefix}-${timestamp}@test.com`;
    const user = new User({
      name, // Tên của user
      email, // Email độc nhất
      password: 'hashedpassword', // Mật khẩu giả
      avatar: 'http://example.com/avatar.jpg', // URL avatar giả
      role, // Vai trò của user
    });
    await user.save();
    console.log(`Đã tạo user thử nghiệm: ${user._id}`);
    return user;
  };

  // Hàm trợ giúp để tạo community thử nghiệm trong cơ sở dữ liệu THỰC
  const createTestCommunity = async (name, members = []) => {
    const community = new Community({
      name,
      description: `Description for ${name}`,
      members: members.map(m => m._id),
      // Thêm các trường khác nếu cần
    });
    await community.save();
    console.log(`Đã tạo community thử nghiệm: ${community._id}`);
    return community;
  };

  // Hàm trợ giúp để tạo post thử nghiệm trong cơ sở dữ liệu THỰC
  const createTestPost = async (user, community, content, fileUrl = null, fileType = null, createdAt = new Date()) => {
    const post = new Post({
      user: user._id,
      community: community._id,
      content,
      fileUrl,
      fileType,
      createdAt: createdAt, // Cho phép đặt thời gian tạo để kiểm tra sắp xếp
    });
    await post.save();
    console.log(`Đã tạo post thử nghiệm: ${post._id}`);
    return post;
  };

  // Hàm trợ giúp để tạo comment thử nghiệm trong cơ sở dữ liệu THỰC
  const createTestComment = async (user, post, content) => {
    const comment = new Comment({
      user: user._id,
      post: post._id,
      content,
    });
    await comment.save();
    // Cập nhật post để thêm comment ID
    await Post.findByIdAndUpdate(post._id, { $push: { comments: comment._id } });
    console.log(`Đã tạo comment thử nghiệm: ${comment._id} cho post ${post._id}`);
    return comment;
  };

  // Hàm trợ giúp để tạo report thử nghiệm trong cơ sở dữ liệu THỰC
  const createTestReport = async (user, post, community, reason = 'Inappropriate content') => {
    const report = new Report({
      post: post._id,
      community: community._id,
      reportedBy: [user._id],
      reportReason: reason,
    });
    await report.save();
    console.log(`Đã tạo report thử nghiệm: ${report._id} cho post ${post._id} bởi user ${user._id}`);
    return report;
  };

  // Hàm trợ giúp để lưu post cho user thử nghiệm trong cơ sở dữ liệu THỰC
  const saveTestPostForUser = async (user, post) => {
    await User.findByIdAndUpdate(user._id, { $addToSet: { savedPosts: post._id } });
    console.log(`Đã lưu post ${post._id} cho user ${user._id}`);
  };


  describe('GET /posts', () => {

    // Test Case ID: GET_POSTS_001
    // Script: Should retrieve posts from communities the user is a member of
    it('GET_POSTS_001: Should retrieve posts from communities the user is a member of', async () => {
      // Input: User ID who is a member of communities with posts.
      // Expected Output: Status 200, list of posts from member communities, totalPosts count.

      const user1 = await createTestUser('getpostsuser1', 'GetPosts User 1');
      const user2 = await createTestUser('getpostsuser2', 'GetPosts User 2'); // User không phải thành viên

      const community1 = await createTestCommunity('Community A', [user1]);
      const community2 = await createTestCommunity('Community B', [user1, user2]);
      const community3 = await createTestCommunity('Community C', [user2]); // User1 không phải thành viên

      const post1_comm1 = await createTestPost(user1, community1, 'Post 1 in Comm A');
      const post2_comm1 = await createTestPost(user1, community1, 'Post 2 in Comm A');
      const post3_comm2 = await createTestPost(user2, community2, 'Post 3 in Comm B');
      const post4_comm3 = await createTestPost(user2, community3, 'Post 4 in Comm C'); // User1 không thấy post này

      const res = await request(server)
        .get('/posts')
        .set('user-id', user1._id.toString());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('formattedPosts');
      expect(Array.isArray(res.body.formattedPosts)).toBe(true);
      expect(res.body.formattedPosts.length).toBe(3); // Should see posts from Comm A and Comm B
      expect(res.body).toHaveProperty('totalPosts', 3);

      // Check if posts from Comm C are NOT included
      const postIds = res.body.formattedPosts.map(p => p._id.toString());
      expect(postIds).toContain(post1_comm1._id.toString());
      expect(postIds).toContain(post2_comm1._id.toString());
      expect(postIds).toContain(post3_comm2._id.toString());
      expect(postIds).not.toContain(post4_comm3._id.toString());

      // Check sorting (newest first) - depends on creation order in test
      // Assuming createTestPost creates them sequentially, post3_comm2 is newest among visible
      expect(res.body.formattedPosts[0]._id.toString()).toBe(post3_comm2._id.toString());
    });

    // Test Case ID: GET_POSTS_002
    // Script: Should return an empty array and totalPosts 0 if the user is not a member of any community with posts
    it('GET_POSTS_002: Should return empty array if user is not member of any community with posts', async () => {
      // Input: User ID who is not a member of any community with posts.
      // Expected Output: Status 200, formattedPosts array is empty, totalPosts is 0.

      const user1 = await createTestUser('getpostsuser3', 'GetPosts User 3'); // User không là thành viên của community nào có post
      const user2 = await createTestUser('getpostsuser4', 'GetPosts User 4');

      const community1 = await createTestCommunity('Community D', [user2]); // User1 không phải thành viên
      await createTestPost(user2, community1, 'Post in Comm D');

      const res = await request(server)
        .get('/posts')
        .set('user-id', user1._id.toString());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('formattedPosts');
      expect(Array.isArray(res.body.formattedPosts)).toBe(true);
      expect(res.body.formattedPosts.length).toBe(0);
      expect(res.body).toHaveProperty('totalPosts', 0);
    });

    // Test Case ID: GET_POSTS_003
    // Script: Should handle pagination correctly using limit and skip
    it('GET_POSTS_003: Should handle pagination correctly', async () => {
      // Input: User ID, limit and skip query parameters.
      // Expected Output: Status 200, formattedPosts array with correct number of posts based on limit/skip, correct totalPosts count.

      const user1 = await createTestUser('getpostsuser5', 'GetPosts User 5');
      const community1 = await createTestCommunity('Community E', [user1]);

      // Create 15 posts
      const posts = [];
      for (let i = 0; i < 15; i++) {
        // Create posts with slightly different times for sorting check
        const createdAt = new Date(Date.now() - (15 - i) * 1000);
        posts.push(await createTestPost(user1, community1, `Post ${i + 1}`, null, null, createdAt));
      }

      // Get first 10 posts (default limit)
      const res1 = await request(server)
        .get('/posts')
        .set('user-id', user1._id.toString());

      expect(res1.status).toBe(200);
      expect(res1.body.formattedPosts.length).toBe(10);
      expect(res1.body.totalPosts).toBe(15);
      // Check sorting: newest (post 15) should be first
      expect(res1.body.formattedPosts[0].content).toBe('Post 15');
      expect(res1.body.formattedPosts[9].content).toBe('Post 6');


      // Get next 5 posts (skip=10, limit=10)
      const res2 = await request(server)
        .get('/posts?skip=10&limit=10')
        .set('user-id', user1._id.toString());

      expect(res2.status).toBe(200);
      expect(res2.body.formattedPosts.length).toBe(5);
      expect(res2.body.totalPosts).toBe(15);
      // Check sorting: post 5 should be first in this batch
      expect(res2.body.formattedPosts[0].content).toBe('Post 5');
      expect(res2.body.formattedPosts[4].content).toBe('Post 1');

      // Get posts with limit=5, skip=5
      const res3 = await request(server)
        .get('/posts?skip=5&limit=5')
        .set('user-id', user1._id.toString());

      expect(res3.status).toBe(200);
      expect(res3.body.formattedPosts.length).toBe(5);
      expect(res3.body.totalPosts).toBe(15);
      // Check sorting: post 10 should be first in this batch
      expect(res3.body.formattedPosts[0].content).toBe('Post 10');
      expect(res3.body.formattedPosts[4].content).toBe('Post 6');
    });

    // Test Case ID: GET_POSTS_004
    // Script: Should return an empty array and totalPosts 0 if the user is a member of communities but they have no posts
    it('GET_POSTS_004: Should return empty array if member communities have no posts', async () => {
      // Input: User ID who is a member of communities that have no posts.
      // Expected Output: Status 200, formattedPosts array is empty, totalPosts is 0.

      const user1 = await createTestUser('getpostsuser6', 'GetPosts User 6');
      const community1 = await createTestCommunity('Community F', [user1]); // Community with no posts
      const community2 = await createTestCommunity('Community G', [user1]); // Another community with no posts

      const res = await request(server)
        .get('/posts')
        .set('user-id', user1._id.toString());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('formattedPosts');
      expect(Array.isArray(res.body.formattedPosts)).toBe(true);
      expect(res.body.formattedPosts.length).toBe(0);
      expect(res.body).toHaveProperty('totalPosts', 0);
    });

    // Test Case ID: GET_POSTS_005
    // Script: Should return posts sorted by creation date descending
    it('GET_POSTS_005: Should return posts sorted by creation date descending', async () => {
      // Input: User ID, multiple posts created at different times in member communities.
      // Expected Output: Status 200, formattedPosts array sorted from newest to oldest.

      const user1 = await createTestUser('getpostsuser7', 'GetPosts User 7');
      const community1 = await createTestCommunity('Community H', [user1]);

      // Create posts with specific creation times
      const postOldest = await createTestPost(user1, community1, 'Oldest Post', null, null, new Date(Date.now() - 30000)); // 30 seconds ago
      const postMiddle = await createTestPost(user1, community1, 'Middle Post', null, null, new Date(Date.now() - 20000)); // 20 seconds ago
      const postNewest = await createTestPost(user1, community1, 'Newest Post', null, null, new Date(Date.now() - 10000)); // 10 seconds ago

      const res = await request(server)
        .get('/posts')
        .set('user-id', user1._id.toString());

      expect(res.status).toBe(200);
      expect(res.body.formattedPosts.length).toBe(3);

      // Check sorting order
      expect(res.body.formattedPosts[0].content).toBe('Newest Post');
      expect(res.body.formattedPosts[1].content).toBe('Middle Post');
      expect(res.body.formattedPosts[2].content).toBe('Oldest Post');
    });

    // Test Case ID: GET_POSTS_006
    // Script: Should return an empty array and totalPosts 0 if no user ID is provided (mocked decodeToken behavior)
    it('GET_POSTS_006: Should return empty array if no user ID is provided', async () => {
      // Input: No user-id header.
      // Expected Output: Status 200, formattedPosts array is empty, totalPosts is 0 (based on mock decodeToken returning 'defaultTestUserId' which won't be a member of any community).

      // Create some data that the defaultTestUserId won't be a member of
      const user1 = await createTestUser('getpostsuser8', 'GetPosts User 8');
      const community1 = await createTestCommunity('Community I', [user1]);
      await createTestPost(user1, community1, 'Post in Comm I');

      // Request without setting user-id header
      const res = await request(server)
        .get('/posts');

      // Based on the mock decodeToken, req.userId will be 'defaultTestUserId'.
      // This user ID is unlikely to be a member of any created communities.
      // The controller will find no communities for this user and return empty.
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('formattedPosts');
      expect(Array.isArray(res.body.formattedPosts)).toBe(true);
      expect(res.body.formattedPosts.length).toBe(0);
      expect(res.body).toHaveProperty('totalPosts', 0);
    });

  });
});