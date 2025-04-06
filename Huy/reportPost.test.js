// Nhập các thư viện cần thiết để test API
const request = require('supertest'); // Thư viện để gửi yêu cầu HTTP giả lập
const express = require('express'); // Framework Express để tạo server thử nghiệm
const mongoose = require('mongoose'); // Thư viện để tương tác với MongoDB
const jwt = require('jsonwebtoken'); // Thư viện để tạo và xử lý token JWT
const Community = require('../models/community.model'); // Model Community để thao tác với collection communities
const Post = require('../models/post.model'); // Model Post để thao tác với collection posts
const Report = require('../models/report.model'); // Model Report để thao tác với collection reports
const User = require('../models/user.model'); // Model User để thao tác với collection users
const communityRoutes = require('../routes/community.route'); // File định tuyến cho các endpoint community
const Database = require('../config/database'); // Lớp kết nối cơ sở dữ liệu MongoDB
require('dotenv').config(); // Load các biến môi trường từ file .env (MONGODB_URI, SECRET)

// Mock các middleware để đơn giản hóa test
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => next(), // Mock passport để bỏ qua xác thực JWT thực tế
}));
jest.mock('../middlewares/auth/decodeToken', () => (req, res, next) => {
  req.userId = req.headers['user-id']; // Mock decodeToken để gán userId từ header vào req
  next(); // Chuyển sang middleware hoặc handler tiếp theo
});
jest.mock('express-useragent', () => ({
  express: () => (req, res, next) => {
    req.useragent = { isMobile: false, browser: 'test', version: '1.0', os: 'testOS', platform: 'testPlatform' }; // Mock useragent để giả lập thông tin thiết bị
    next(); // Chuyển sang middleware hoặc handler tiếp theo
  },
}));

jest.setTimeout(30000); // Đặt timeout mặc định cho Jest là 30 giây để tránh lỗi timeout khi kết nối DB chậm

// Bắt đầu suite test cho API Reporting Posts
describe('Reporting Posts API - Real Database', () => {
  let app; // Biến để lưu instance ứng dụng Express
  let db; // Biến để lưu instance kết nối cơ sở dữ liệu
  let testUsers = []; // Mảng để lưu danh sách user thử nghiệm
  let testCommunities = []; // Mảng để lưu danh sách community thử nghiệm
  let testPosts = []; // Mảng để lưu danh sách post thử nghiệm
  let testsFailed = false; // Cờ để kiểm tra nếu có test thất bại (nếu có, không xóa dữ liệu)

  // Hook chạy trước tất cả các test để thiết lập môi trường
  beforeAll(async () => {
    const uri = process.env.MONGODB_URI; // Lấy URI của MongoDB từ biến môi trường
    if (!uri) {
      throw new Error('MONGODB_URI không được định nghĩa trong .env!'); // Ném lỗi nếu URI không tồn tại
    }
    console.log(`Kết nối đến cơ sở dữ liệu thật: ${uri}`); // Log URI để kiểm tra
    db = new Database(uri); // Khởi tạo instance Database với URI
    try {
      await db.connect(); // Kết nối đến cơ sở dữ liệu thật
      console.log('Kết nối cơ sở dữ liệu thành công'); // Log khi kết nối thành công
    } catch (error) {
      console.error('Lỗi khi kết nối cơ sở dữ liệu:', error); // Log lỗi nếu kết nối thất bại
      throw error; // Ném lỗi để dừng test nếu không kết nối được
    }

    app = express(); // Tạo instance ứng dụng Express
    app.use(express.json()); // Middleware để parse body dạng JSON
    app.use('/communities', communityRoutes); // Gắn các route community vào endpoint /communities

    process.env.SECRET = process.env.SECRET || 'testsecret'; // Đặt SECRET cho JWT nếu không có trong .env
  }, 20000); // Timeout 20 giây cho beforeAll

  // Hook chạy sau tất cả các test để dọn dẹp
  afterAll(async () => {
    if (!testsFailed) { // Nếu không có test nào thất bại
      for (const user of testUsers) { // Duyệt qua từng user thử nghiệm
        await User.deleteOne({ _id: user._id }); // Xóa user khỏi collection users
        console.log(`Đã xóa user thử nghiệm: ${user.email}`); // Log khi xóa thành công
      }
      for (const community of testCommunities) { // Duyệt qua từng community thử nghiệm
        await Community.deleteOne({ _id: community._id }); // Xóa community khỏi collection communities
        console.log(`Đã xóa community thử nghiệm: ${community.name}`); // Log khi xóa thành công
      }
      for (const post of testPosts) { // Duyệt qua từng post thử nghiệm
        await Post.deleteOne({ _id: post._id }); // Xóa post khỏi collection posts
        console.log(`Đã xóa post thử nghiệm: ${post._id}`); // Log khi xóa thành công
      }
      await Report.deleteMany({}); // Xóa tất cả report thử nghiệm
      console.log('Tất cả test thành công - Đã xóa dữ liệu thử nghiệm.');
    } else {
      console.log('Có test thất bại - Giữ lại dữ liệu thử nghiệm để kiểm tra.');
      console.log('Các user thử nghiệm còn lại:', testUsers.map(u => ({ id: u._id, email: u.email })));
      console.log('Các community thử nghiệm còn lại:', testCommunities.map(c => ({ id: c._id, name: c.name })));
      console.log('Các post thử nghiệm còn lại:', testPosts.map(p => ({ id: p._id })));
    }
    await db.disconnect(); // Ngắt kết nối cơ sở dữ liệu
  }, 20000); // Timeout 20 giây cho afterAll

  // Hook chạy sau mỗi test để kiểm tra lỗi
  afterEach(async () => {
    if (expect.getState().currentTestName && expect.getState().testPath && expect.getState().assertionCalls === 0) {
      testsFailed = true; // Đặt cờ nếu không có assertion nào chạy (test lỗi)
    }
  });

  // Hàm trợ giúp để tạo user thử nghiệm
  const createTestUser = async (emailPrefix, name) => {
    const timestamp = Date.now(); // Lấy timestamp để tạo email độc nhất
    const email = `${emailPrefix}-${timestamp}@test.com`; // Tạo email với timestamp
    const user = new User({
      name, // Tên của user
      email, // Email độc nhất
      password: 'hashedpassword', // Mật khẩu giả (không cần hash thật trong test)
      avatar: 'http://example.com/avatar.jpg', // Avatar mặc định
      role: 'general', // Vai trò mặc định là general
    });
    await user.save(); // Lưu user vào cơ sở dữ liệu thật
    testUsers.push(user); // Thêm user vào danh sách để quản lý và xóa sau
    console.log(`Đã tạo user thử nghiệm: ${email} (ID: ${user._id})`); // Log khi tạo thành công
    return user; // Trả về user vừa tạo
  };

  // Hàm trợ giúp để tạo community thử nghiệm
  const createTestCommunity = async (name) => {
    const community = new Community({
      name, // Tên của community
      description: `Description for ${name}`, // Mô tả mặc định
      banner: 'http://example.com/banner.jpg', // Banner mặc định
    });
    await community.save(); // Lưu community vào cơ sở dữ liệu thật
    testCommunities.push(community); // Thêm community vào danh sách để quản lý và xóa sau
    console.log(`Đã tạo community thử nghiệm: ${name} (ID: ${community._id})`); // Log khi tạo thành công
    return community; // Trả về community vừa tạo
  };

  // Hàm trợ giúp để tạo post thử nghiệm
  const createTestPost = async (userId, communityId) => {
    const post = new Post({
      content: 'This is a test post', // Nội dung bài post
      user: userId, // ID của user đăng bài
      community: communityId, // ID của community chứa bài post
    });
    await post.save(); // Lưu post vào cơ sở dữ liệu thật
    testPosts.push(post); // Thêm post vào danh sách để quản lý và xóa sau
    console.log(`Đã tạo post thử nghiệm: ${post._id}`); // Log khi tạo thành công
    return post; // Trả về post vừa tạo
  };

  // Hàm trợ giúp để tạo token JWT giả lập cho xác thực
  const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.SECRET, { expiresIn: '6h' }); // Tạo token với userId, SECRET, hết hạn sau 6 giờ
  };

  // Test endpoint POST /communities/report (báo cáo bài post)
  describe('POST /communities/report - Report Post', () => {
    it('should create a new report for a post', async () => {
      const user = await createTestUser('reporter', 'Reporter User'); // Tạo user báo cáo
      const community = await createTestCommunity('test-community'); // Tạo community thử nghiệm
      const post = await createTestPost(user._id, community._id); // Tạo post thử nghiệm
      const token = generateToken(user._id); // Tạo token cho user
  
      const response = await request(app) // Gửi yêu cầu POST đến endpoint
        .post('/communities/report') // Endpoint báo cáo bài post (đúng route thực tế)
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', user._id.toString()) // Thêm header user-id
        .send({ info: { postId: post._id, reportReason: 'Inappropriate content', communityId: community._id } }); // Body yêu cầu
  
      expect(response.status).toBe(200); // Kiểm tra status trả về là 200 (OK)
      expect(response.body).toHaveProperty('message', 'Post reported successfully.'); // Kiểm tra thông báo thành công (thêm dấu chấm)
      const report = await Report.findOne({ post: post._id }); // Kiểm tra report trong DB
      expect(report).toBeTruthy(); // Kiểm tra report tồn tại
      expect(report.reportedBy).toContainEqual(user._id); // Kiểm tra user có trong danh sách reportedBy
      console.log(`Report post test passed: Post ${post._id} reported`); // Log khi test thành công
    });

    it('should add user to existing report if post already reported', async () => {
      const user1 = await createTestUser('reporter1', 'Reporter One'); // Tạo user 1 báo cáo
      const user2 = await createTestUser('reporter2', 'Reporter Two'); // Tạo user 2 báo cáo
      const community = await createTestCommunity('test-community-2'); // Tạo community thử nghiệm
      const post = await createTestPost(user1._id, community._id); // Tạo post thử nghiệm
      await Report.create({ post: post._id, community: community._id, reportedBy: [user1._id], reportReason: 'Spam' }); // Tạo report ban đầu
      const token = generateToken(user2._id); // Tạo token cho user 2

      const response = await request(app) // Gửi yêu cầu POST đến endpoint
        .post('/communities/report') // Endpoint báo cáo bài post (đúng route thực tế)
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', user2._id.toString()) // Thêm header user-id
        .send({ info: { postId: post._id, reportReason: 'Spam', communityId: community._id } }); // Body yêu cầu

      expect(response.status).toBe(200); // Kiểm tra status trả về là 200 (OK)
      const report = await Report.findOne({ post: post._id }); // Kiểm tra report trong DB
      expect(report.reportedBy.length).toBe(2); // Kiểm tra có 2 user báo cáo
      expect(report.reportedBy).toContainEqual(user2._id); // Kiểm tra user 2 được thêm vào
      console.log(`Add to existing report test passed: Post ${post._id}`); // Log khi test thành công
    });

    it('should return 400 if user already reported the post', async () => {
      const user = await createTestUser('reporter', 'Reporter User'); // Tạo user báo cáo
      const community = await createTestCommunity('test-community-3'); // Tạo community thử nghiệm
      const post = await createTestPost(user._id, community._id); // Tạo post thử nghiệm
      await Report.create({ post: post._id, community: community._id, reportedBy: [user._id], reportReason: 'Offensive' }); // Tạo report ban đầu
      const token = generateToken(user._id); // Tạo token cho user

      const response = await request(app) // Gửi yêu cầu POST đến endpoint
        .post('/communities/report') // Endpoint báo cáo bài post (đúng route thực tế)
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', user._id.toString()) // Thêm header user-id
        .send({ info: { postId: post._id, reportReason: 'Offensive', communityId: community._id } }); // Body yêu cầu

      expect(response.status).toBe(400); // Kiểm tra status trả về là 400 (Bad Request)
      expect(response.body.message).toBe('You have already reported this post.'); // Kiểm tra thông báo lỗi
      console.log(`Already reported test passed: Post ${post._id}`); // Log khi test thành công
    });
  });

  // Test endpoint GET /communities/:name/reported-posts (lấy danh sách bài post bị báo cáo)
  describe('GET /communities/:name/reported-posts - Get Reported Posts', () => {
    it('should return reported posts for a community', async () => {
      const user = await createTestUser('reporter', 'Reporter User'); // Tạo user báo cáo
      const community = await createTestCommunity('test-community-4'); // Tạo community thử nghiệm
      const post = await createTestPost(user._id, community._id); // Tạo post thử nghiệm
      await Report.create({ post: post._id, community: community._id, reportedBy: [user._id], reportReason: 'Violation' }); // Tạo report
      const token = generateToken(user._id); // Tạo token cho user

      const response = await request(app) // Gửi yêu cầu GET đến endpoint
        .get(`/communities/${community.name}/reported-posts`) // Endpoint lấy danh sách bài post bị báo cáo
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', user._id.toString()); // Thêm header user-id

      expect(response.status).toBe(200); // Kiểm tra status trả về là 200 (OK)
      expect(response.body).toHaveProperty('reportedPosts'); // Kiểm tra response có trường reportedPosts
      expect(response.body.reportedPosts.length).toBe(1); // Kiểm tra có 1 bài post bị báo cáo
      expect(response.body.reportedPosts[0].post._id).toBe(post._id.toString()); // Kiểm tra post ID khớp
      console.log(`Get reported posts test passed: Community ${community.name}`); // Log khi test thành công
    });

    it('should return 404 if community not found', async () => {
      const user = await createTestUser('reporter', 'Reporter User'); // Tạo user báo cáo
      const token = generateToken(user._id); // Tạo token cho user

      const response = await request(app) // Gửi yêu cầu GET đến endpoint
        .get('/communities/non-existent-community/reported-posts') // Endpoint với community không tồn tại
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', user._id.toString()); // Thêm header user-id

      expect(response.status).toBe(404); // Kiểm tra status trả về là 404 (Not Found)
      expect(response.body.message).toBe('Community not found'); // Kiểm tra thông báo lỗi
      console.log('Community not found test passed'); // Log khi test thành công
    });
  });

  // Test endpoint DELETE /communities/reported-posts/:postId (xóa báo cáo bài post)
  describe('DELETE /communities/reported-posts/:postId - Remove Reported Post', () => {
    it('should remove a reported post report', async () => {
      const user = await createTestUser('reporter', 'Reporter User'); // Tạo user báo cáo
      const community = await createTestCommunity('test-community-5'); // Tạo community thử nghiệm
      const post = await createTestPost(user._id, community._id); // Tạo post thử nghiệm
      await Report.create({ post: post._id, community: community._id, reportedBy: [user._id], reportReason: 'Spam' }); // Tạo report
      const token = generateToken(user._id); // Tạo token cho user

      const response = await request(app) // Gửi yêu cầu DELETE đến endpoint
        .delete(`/communities/reported-posts/${post._id}`) // Endpoint xóa báo cáo bài post
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', user._id.toString()); // Thêm header user-id

      expect(response.status).toBe(200); // Kiểm tra status trả về là 200 (OK)
      expect(response.body.message).toBe('Reported post removed successfully'); // Kiểm tra thông báo thành công
      const report = await Report.findOne({ post: post._id }); // Kiểm tra report trong DB
      expect(report).toBeNull(); // Kiểm tra report đã bị xóa
      console.log(`Remove reported post test passed: Post ${post._id}`); // Log khi test thành công
    });

    it('should still return 200 if no report exists for the post', async () => {
      const user = await createTestUser('reporter', 'Reporter User'); // Tạo user báo cáo
      const community = await createTestCommunity('test-community-6'); // Tạo community thử nghiệm
      const post = await createTestPost(user._id, community._id); // Tạo post thử nghiệm (chưa có report)
      const token = generateToken(user._id); // Tạo token cho user

      const response = await request(app) // Gửi yêu cầu DELETE đến endpoint
        .delete(`/communities/reported-posts/${post._id}`) // Endpoint xóa báo cáo bài post
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', user._id.toString()); // Thêm header user-id

      expect(response.status).toBe(200); // Kiểm tra status trả về là 200 (OK)
      expect(response.body.message).toBe('Reported post removed successfully'); // Kiểm tra thông báo thành công
      console.log(`Remove non-existent report test passed: Post ${post._id}`); // Log khi test thành công
    });
  });
});