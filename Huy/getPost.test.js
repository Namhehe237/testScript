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

// Import routes (chỉ cần postRoutes vì test getPost)
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


describe('GET /posts/:id Integration Tests (with real DB)', () => {
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
  const createTestPost = async (user, community, content, fileUrl = null, fileType = null) => {
    const post = new Post({
      user: user._id,
      community: community._id,
      content,
      fileUrl,
      fileType,
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


  describe('GET /posts/:id', () => {

    // Test Case ID: GET_POST_001
    // Script: Should retrieve a post successfully with all details including comments, report status, and saved status
    it('GET_POST_001: Should retrieve a post successfully with all details', async () => {
      // Input: Existing post ID, User ID who commented, reported, and saved the post.
      // Expected Output: Status 200, post details including user, community, comments (sorted), dateTime, createdAt, savedByCount, isReported.

      // 1. Tạo dữ liệu test: user, community, post, comments, report, saved post
      const user1 = await createTestUser('getposttest1', 'GetPost Test User 1'); // Author
      const user2 = await createTestUser('getposttest2', 'GetPost Test User 2'); // User sẽ comment, report và lưu post
      const community = await createTestCommunity('getposttestcommunity', [user1, user2]);
      const post = await createTestPost(user1, community, 'This is a test post content.');
      const comment1 = await createTestComment(user2, post, 'This is the first comment.'); // Comment cũ hơn
      const comment2 = await createTestComment(user1, post, 'This is the second comment.'); // Comment mới hơn
      const report = await createTestReport(user2, post, community, 'Spam');
      await saveTestPostForUser(user2, post); // User2 lưu post này

      // 2. Mô phỏng yêu cầu API từ user2 (người comment, report và lưu post)
      const res = await request(server)
        .get(`/posts/${post._id}`)
        .set('user-id', user2._id.toString()); // Đặt user-id header để mock decodeToken

      // 3. Kiểm tra phản hồi
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('_id', post._id.toString());
      expect(res.body).toHaveProperty('content', 'This is a test post content.');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toHaveProperty('_id', user1._id.toString());
      expect(res.body).toHaveProperty('community');
      expect(res.body.community).toHaveProperty('_id', community._id.toString());
      expect(res.body).toHaveProperty('comments');
      expect(Array.isArray(res.body.comments)).toBe(true);
      expect(res.body.comments.length).toBe(2); // Kiểm tra số lượng comment
      // Kiểm tra comment được sắp xếp theo thời gian tạo giảm dần (mới nhất trước)
      expect(res.body.comments[0]._id.toString()).toBe(comment2._id.toString());
      expect(res.body.comments[1]._id.toString()).toBe(comment1._id.toString());

      // Kiểm tra định dạng comment
      expect(res.body.comments[0]).toHaveProperty('content', 'This is the second comment.');
      expect(res.body.comments[0]).toHaveProperty('user');
      expect(res.body.comments[0].user).toHaveProperty('_id', user1._id.toString());
      expect(res.body.comments[0]).toHaveProperty('createdAt'); // Kiểm tra trường createdAt đã được format
      expect(res.body.comments[0].createdAt).toBe('a few seconds ago'); // Kiểm tra giá trị mock dayjs

      expect(res.body).toHaveProperty('dateTime'); // Kiểm tra trường dateTime đã được format
      expect(res.body.dateTime).toBe('YYYY-MM-DD HH:mm:ss'); // Kiểm tra giá trị mock formatCreatedAt

      expect(res.body).toHaveProperty('createdAt'); // Kiểm tra trường createdAt của post đã được format
      expect(res.body.createdAt).toBe('a few seconds ago'); // Kiểm tra giá trị mock dayjs

      expect(res.body).toHaveProperty('savedByCount');
      expect(res.body.savedByCount).toBe(1); // User2 đã lưu post này

      expect(res.body).toHaveProperty('isReported');
      expect(res.body.isReported).toBe(true); // User2 đã report post này
    });

    // Test Case ID: GET_POST_002
    // Script: Should return 404 if the post ID does not exist
    it('GET_POST_002: Should return 404 if the post ID does not exist', async () => {
      // Input: Non-existent post ID, any valid User ID.
      // Expected Output: Status 404, error message "Post not found".

      const user1 = await createTestUser('getposttest3', 'GetPost Test User 3');
      const nonExistentPostId = new mongoose.Types.ObjectId();

      const res = await request(server)
        .get(`/posts/${nonExistentPostId}`)
        .set('user-id', user1._id.toString());

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('message', 'Post not found');
    });

    // Test Case ID: GET_POST_003
    // Script: Should retrieve a post with an empty comments array if no comments exist
    it('GET_POST_003: Should retrieve a post with an empty comments array', async () => {
      // Input: Post ID with no comments, any valid User ID.
      // Expected Output: Status 200, post details, comments array is empty.

      const user1 = await createTestUser('getposttest4', 'GetPost Test User 4');
      const community = await createTestCommunity('getposttestcommunity2', [user1]);
      const post = await createTestPost(user1, community, 'This post has no comments.');

      const res = await request(server)
        .get(`/posts/${post._id}`)
        .set('user-id', user1._id.toString());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('_id', post._id.toString());
      expect(res.body).toHaveProperty('comments');
      expect(Array.isArray(res.body.comments)).toBe(true);
      expect(res.body.comments.length).toBe(0);
    });

    // Test Case ID: GET_POST_004
    // Script: Should retrieve a post including fileUrl and fileType if a file is attached
    it('GET_POST_004: Should retrieve a post including file details', async () => {
      // Input: Post ID with file, any valid User ID.
      // Expected Output: Status 200, post details including fileUrl and fileType.

      const user1 = await createTestUser('getposttest5', 'GetPost Test User 5');
      const community = await createTestCommunity('getposttestcommunity3', [user1]);
      const post = await createTestPost(user1, community, 'This post has a file.', 'http://example.com/testfile.png', 'image/png');

      const res = await request(server)
        .get(`/posts/${post._id}`)
        .set('user-id', user1._id.toString());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('_id', post._id.toString());
      expect(res.body).toHaveProperty('fileUrl', 'http://example.com/testfile.png');
      expect(res.body).toHaveProperty('fileType', 'image/png');
    });

    // Test Case ID: GET_POST_005
    // Script: Should retrieve a post by its author
    it('GET_POST_005: Should retrieve a post by its author', async () => {
      // Input: Post ID, Author's User ID.
      // Expected Output: Status 200, post details.

      const user1 = await createTestUser('getposttest6', 'GetPost Test User 6'); // Author
      const community = await createTestCommunity('getposttestcommunity4', [user1]);
      const post = await createTestPost(user1, community, 'This post is viewed by author.');

      const res = await request(server)
        .get(`/posts/${post._id}`)
        .set('user-id', user1._id.toString()); // Author views the post

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('_id', post._id.toString());
      expect(res.body.user).toHaveProperty('_id', user1._id.toString()); // Ensure author is correct
    });

    // Test Case ID: GET_POST_006
    // Script: Should retrieve a post by a user who has no interaction with it
    it('GET_POST_006: Should retrieve a post by a user with no interaction', async () => {
      // Input: Post ID, User ID with no interaction.
      // Expected Output: Status 200, post details, isReported: false, savedByCount reflecting only users who saved it.

      const user1 = await createTestUser('getposttest7', 'GetPost Test User 7'); // Author
      const user2 = await createTestUser('getposttest8', 'GetPost Test User 8'); // User with no interaction
      const community = await createTestCommunity('getposttestcommunity5', [user1, user2]);
      const post = await createTestPost(user1, community, 'This post is viewed by a non-interacting user.');

      // Add a save from a third user to check savedByCount
      const user3 = await createTestUser('getposttest9', 'GetPost Test User 9');
      await saveTestPostForUser(user3, post);

      const res = await request(server)
        .get(`/posts/${post._id}`)
        .set('user-id', user2._id.toString()); // User2 views the post

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('_id', post._id.toString());
      expect(res.body).toHaveProperty('isReported', false); // User2 did not report
      expect(res.body).toHaveProperty('savedByCount', 1); // Only user3 saved it
    });

  });
});