// Nhập các thư viện cần thiết để test API
const request = require('supertest'); // Thư viện để gửi yêu cầu HTTP giả lập
const express = require('express'); // Framework Express để tạo server thử nghiệm
const mongoose = require('mongoose'); // Thư viện để tương tác với MongoDB
const jwt = require('jsonwebtoken'); // Thư viện để tạo và xử lý token JWT
const User = require('../models/user.model'); // Model User để thao tác với collection users trong DB
const Relationship = require('../models/relationship.model'); // Model Relationship để quản lý quan hệ follow
const userRoutes = require('../routes/user.route'); // File định tuyến cho các endpoint liên quan đến user
const Database = require('../config/database'); // Lớp kết nối cơ sở dữ liệu MongoDB
const { getPublicUsers, getPublicUser } = require('../controllers/profile.controller'); // Hai hàm cần test từ profile controller
require('dotenv').config(); // Load các biến môi trường từ file .env (ví dụ: MONGODB_URI, SECRET)

// Mock các middleware để đơn giản hóa quá trình test
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => next(), // Mock passport để bỏ qua xác thực JWT thực tế
}));
jest.mock('../middlewares/auth/decodeToken', () => (req, res, next) => {
  req.userId = req.headers['user-id']; // Mock decodeToken để gán userId từ header vào req
  next(); // Chuyển sang middleware hoặc handler tiếp theo
});
jest.mock('../middlewares/limiter/limiter', () => ({
  followLimiter: (req, res, next) => next(), // Mock giới hạn tốc độ cho follow/unfollow
  signUpSignInLimiter: (req, res, next) => next(), // Mock giới hạn tốc độ cho signup/signin
}));
jest.mock('express-useragent', () => ({
  express: () => (req, res, next) => {
    req.useragent = { isMobile: false, browser: 'test', version: '1.0', os: 'testOS', platform: 'testPlatform' }; // Mock useragent để giả lập thông tin thiết bị
    next(); // Chuyển sang middleware hoặc handler tiếp theo
  },
}));

jest.setTimeout(30000); // Đặt timeout mặc định cho Jest là 30 giây để tránh lỗi timeout khi kết nối DB chậm

// Bắt đầu suite test cho API Suggested Users
describe('Suggested Users API - Real Database', () => {
  let app; // Biến để lưu instance ứng dụng Express
  let db; // Biến để lưu instance kết nối cơ sở dữ liệu
  let testUsers = []; // Mảng để lưu danh sách user thử nghiệm được tạo trong test
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
    app.use('/users', userRoutes); // Gắn các route user vào endpoint /users

    process.env.SECRET = process.env.SECRET || 'testsecret'; // Đặt SECRET cho JWT nếu không có trong .env
  }, 20000); // Timeout 20 giây cho beforeAll

  // Hook chạy sau tất cả các test để dọn dẹp
  afterAll(async () => {
    if (!testsFailed) { // Nếu không có test nào thất bại
      for (const user of testUsers) { // Duyệt qua từng user thử nghiệm
        await User.deleteOne({ _id: user._id }); // Xóa user khỏi collection users
        await Relationship.deleteMany({ $or: [{ follower: user._id }, { following: user._id }] }); // Xóa các mối quan hệ liên quan
        console.log(`Đã xóa user thử nghiệm: ${user.email}`); // Log khi xóa thành công
      }
      console.log('Tất cả test thành công - Đã xóa các user thử nghiệm.'); // Log khi hoàn tất dọn dẹp
    } else {
      console.log('Có test thất bại - Giữ lại các user thử nghiệm để kiểm tra.'); // Log nếu có test thất bại
      console.log('Các user thử nghiệm còn lại:', testUsers.map(u => ({ id: u._id, email: u.email }))); // Hiển thị danh sách user còn lại
    }
    await db.disconnect(); // Ngắt kết nối cơ sở dữ liệu
  }, 20000); // Timeout 20 giây cho afterAll

  // Hook chạy sau mỗi test để kiểm tra lỗi
  afterEach(async () => {
    if (expect.getState().currentTestName && expect.getState().testPath && expect.getState().assertionCalls === 0) {
      testsFailed = true; // Đặt cờ nếu không có assertion nào chạy (test lỗi)
    }
  });

  // Hàm trợ giúp để tạo user thử nghiệm trong cơ sở dữ liệu thật
  const createTestUser = async (emailPrefix, name, role = 'general') => {
    const timestamp = Date.now(); // Lấy timestamp để tạo email độc nhất
    const email = `${emailPrefix}-${timestamp}@test.com`; // Tạo email với timestamp
    const user = new User({ // Tạo object user mới
      name, // Tên của user
      email, // Email độc nhất
      password: 'hashedpassword', // Mật khẩu giả (không cần hash thật trong test)
      avatar: 'http://example.com/avatar.jpg', // Avatar mặc định
      role, // Vai trò của user (general hoặc moderator)
    });
    await user.save(); // Lưu user vào cơ sở dữ liệu thật
    testUsers.push(user); // Thêm user vào danh sách để quản lý và xóa sau
    console.log(`Đã tạo user thử nghiệm: ${email} (ID: ${user._id})`); // Log khi tạo thành công
    return user; // Trả về user vừa tạo
  };

  // Hàm trợ giúp để tạo token JWT giả lập cho xác thực
  const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.SECRET, { expiresIn: '6h' }); // Tạo token với userId, SECRET, hết hạn sau 6 giờ
  };

  // Test endpoint GET /users/public-users/:id (lấy thông tin một user công khai)
  describe('GET /users/public-users/:id - Get Public User', () => {
    it('should return public user info by ID', async () => {
      const currentUser = await createTestUser('current', 'Current User'); // Tạo user hiện tại
      const targetUser = await createTestUser('target', 'Target User'); // Tạo user mục tiêu để lấy thông tin
      const token = generateToken(currentUser._id); // Tạo token cho currentUser

      const response = await request(app) // Gửi yêu cầu GET đến endpoint
        .get(`/users/public-users/${targetUser._id}`) // Endpoint với ID của targetUser
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization với token
        .set('user-id', currentUser._id.toString()); // Thêm header user-id để middleware decodeToken sử dụng

      expect(response.status).toBe(200); // Kiểm tra status trả về là 200 (OK)
      expect(response.body).toHaveProperty('name', 'Target User'); // Kiểm tra response có tên của targetUser
      expect(response.body).toHaveProperty('avatar', 'http://example.com/avatar.jpg'); // Kiểm tra response có avatar của targetUser
      expect(response.body).toHaveProperty('totalPosts', 0); // Kiểm tra số bài post là 0 (vì chưa tạo post)
      expect(response.body).toHaveProperty('isFollowing', false); // Kiểm tra currentUser chưa follow targetUser
      console.log(`Get public user test passed: ${targetUser.email}`); // Log khi test thành công
    });

    it('should return 404 if user not found', async () => {
      const currentUser = await createTestUser('current', 'Current User'); // Tạo user hiện tại
      const fakeId = new mongoose.Types.ObjectId(); // Tạo một ID giả không tồn tại trong DB
      const token = generateToken(currentUser._id); // Tạo token cho currentUser

      const response = await request(app) // Gửi yêu cầu GET đến endpoint
        .get(`/users/public-users/${fakeId}`) // Endpoint với ID giả
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', currentUser._id.toString()); // Thêm header user-id

      expect(response.status).toBe(404); // Kiểm tra status trả về là 404 (Not Found)
      expect(response.body.message).toBe('User not found'); // Kiểm tra thông báo lỗi
      console.log('Non-existent user test passed'); // Log khi test thành công
    });

    it('should show isFollowing as true if relationship exists', async () => {
      const currentUser = await createTestUser('current', 'Current User'); // Tạo user hiện tại
      const targetUser = await createTestUser('target', 'Target User'); // Tạo user mục tiêu
      await Relationship.create({ follower: currentUser._id, following: targetUser._id }); // Tạo mối quan hệ follow
      await User.findByIdAndUpdate(currentUser._id, { $addToSet: { following: targetUser._id } }); // Cập nhật following của currentUser
      await User.findByIdAndUpdate(targetUser._id, { $addToSet: { followers: currentUser._id } }); // Cập nhật followers của targetUser
      const token = generateToken(currentUser._id); // Tạo token cho currentUser

      const response = await request(app) // Gửi yêu cầu GET đến endpoint
        .get(`/users/public-users/${targetUser._id}`) // Endpoint với ID của targetUser
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', currentUser._id.toString()); // Thêm header user-id

      expect(response.status).toBe(200); // Kiểm tra status trả về là 200
      expect(response.body).toHaveProperty('isFollowing', true); // Kiểm tra currentUser đang follow targetUser
      expect(response.body).toHaveProperty('followingSince'); // Kiểm tra có ngày bắt đầu follow
      console.log(`Following status test passed: ${targetUser.email}`); // Log khi test thành công
    });
  });

  // Test endpoint GET /users/public-users (lấy danh sách user công khai gợi ý)
  describe('GET /users/public-users - Get Public Users', () => {
    it('should return up to 5 public users not followed by current user', async () => {
      const currentUser = await createTestUser('current', 'Current User'); // Tạo user hiện tại
      const user1 = await createTestUser('user1', 'User One'); // Tạo user 1
      const user2 = await createTestUser('user2', 'User Two'); // Tạo user 2
      const user3 = await createTestUser('user3', 'User Three'); // Tạo user 3
      const modUser = await createTestUser('mod', 'Moderator', 'moderator'); // Tạo user moderator
      await Relationship.create({ follower: currentUser._id, following: user1._id }); // Tạo mối quan hệ: currentUser follow user1
      await User.findByIdAndUpdate(currentUser._id, { $addToSet: { following: user1._id } }); // Cập nhật following của currentUser
      await User.findByIdAndUpdate(user1._id, { $addToSet: { followers: currentUser._id } }); // Cập nhật followers của user1
      const token = generateToken(currentUser._id); // Tạo token cho currentUser

      const response = await request(app) // Gửi yêu cầu GET đến endpoint
        .get('/users/public-users') // Endpoint lấy danh sách user gợi ý
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', currentUser._id.toString()); // Thêm header user-id

      expect(response.status).toBe(200); // Kiểm tra status trả về là 200
      expect(response.body).toBeInstanceOf(Array); // Kiểm tra response là một mảng
      expect(response.body.length).toBeLessThanOrEqual(5); // Kiểm tra số lượng user trả về không quá 5
      expect(response.body.some(u => u.name === 'User One')).toBe(false); // Kiểm tra User One không xuất hiện (đã follow)
      expect(response.body.some(u => u.name === 'User Two')).toBe(true); // Kiểm tra User Two xuất hiện (chưa follow)
      expect(response.body.some(u => u.name === 'Moderator')).toBe(false); // Kiểm tra Moderator không xuất hiện (role != general)
      console.log('Get public users test passed'); // Log khi test thành công
    });

    it('should return empty array if no eligible public users', async () => {
      const currentUser = await createTestUser('current', 'Current User'); // Tạo user hiện tại
      const user1 = await createTestUser('user1', 'User One'); // Tạo user 1
      await Relationship.create({ follower: currentUser._id, following: user1._id }); // Tạo mối quan hệ: currentUser follow user1
      await User.findByIdAndUpdate(currentUser._id, { $addToSet: { following: user1._id } }); // Cập nhật following của currentUser
      await User.findByIdAndUpdate(user1._id, { $addToSet: { followers: currentUser._id } }); // Cập nhật followers của user1
      const token = generateToken(currentUser._id); // Tạo token cho currentUser

      await User.deleteMany({ _id: { $nin: [currentUser._id, user1._id] } }); // Xóa tất cả user khác để chỉ còn currentUser và user1

      const response = await request(app) // Gửi yêu cầu GET đến endpoint
        .get('/users/public-users') // Endpoint lấy danh sách user gợi ý
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', currentUser._id.toString()); // Thêm header user-id

      expect(response.status).toBe(200); // Kiểm tra status trả về là 200
      expect(response.body).toEqual([]); // Kiểm tra mảng rỗng vì không còn user nào chưa follow
      console.log('Empty public users test passed'); // Log khi test thành công
    });

    it('should sort by follower count', async () => {
      const currentUser = await createTestUser('current', 'Current User'); // Tạo user hiện tại
      const user1 = await createTestUser('user1', 'User One'); // Tạo user 1 (0 follower)
      const user2 = await createTestUser('user2', 'User Two'); // Tạo user 2 (1 follower)
      const follower = await createTestUser('follower', 'Follower'); // Tạo user follower để follow user2
      await Relationship.create({ follower: follower._id, following: user2._id }); // Tạo mối quan hệ: follower follow user2
      await User.findByIdAndUpdate(follower._id, { $addToSet: { following: user2._id } }); // Cập nhật following của follower
      await User.findByIdAndUpdate(user2._id, { $addToSet: { followers: follower._id } }); // Cập nhật followers của user2
      const token = generateToken(currentUser._id); // Tạo token cho currentUser

      const response = await request(app) // Gửi yêu cầu GET đến endpoint
        .get('/users/public-users') // Endpoint lấy danh sách user gợi ý
        .set('Authorization', `Bearer ${token}`) // Thêm header Authorization
        .set('user-id', currentUser._id.toString()); // Thêm header user-id

      expect(response.status).toBe(200); // Kiểm tra status trả về là 200
      expect(response.body[0].name).toBe('User Two'); // Kiểm tra User Two xếp đầu (1 follower)
      expect(response.body[1].name).toBe('User One'); // Kiểm tra User One xếp sau (0 follower)
      console.log('Sort by follower count test passed'); // Log khi test thành công
    });
  });
});