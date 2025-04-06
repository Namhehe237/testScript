const request = require('supertest'); // Thư viện để mô phỏng yêu cầu HTTP
const express = require('express'); // Framework Express để tạo server thử nghiệm
const mongoose = require('mongoose'); // Mongoose để tương tác với MongoDB
const jwt = require('jsonwebtoken'); // Thư viện để tạo token JWT
const User = require('../models/user.model'); // Model User để thao tác cơ sở dữ liệu
const Relationship = require('../models/relationship.model'); // Model Relationship cho follow/unfollow
const userRoutes = require('../routes/user.route'); // Các route user để thử nghiệm
const Database = require('../config/database'); // Lớp kết nối cơ sở dữ liệu
const { followUser } = require('../controllers/profile.controller'); // Hàm follow cần thử nghiệm
require('dotenv').config(); // Load biến môi trường từ .env

// Mock middleware để bỏ qua xác thực và các phụ thuộc khác
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => next(), // Mock passport để bỏ qua xác thực thực
}));
jest.mock('../middlewares/auth/decodeToken', () => (req, res, next) => {
  req.userId = req.headers['user-id']; // Mock decodeToken để lấy userId từ header
  next();
});
jest.mock('../middlewares/limiter/limiter', () => ({
  followLimiter: (req, res, next) => next(), // Mock giới hạn tốc độ cho follow
  signUpSignInLimiter: (req, res, next) => next(), // Mock giới hạn tốc độ cho signin/signup
}));
jest.mock('express-useragent', () => ({
  express: () => (req, res, next) => {
    // Mock useragent để cung cấp dữ liệu user-agent giả
    req.useragent = { isMobile: false, browser: 'test', version: '1.0', os: 'testOS', platform: 'testPlatform' };
    next();
  },
}));

describe('User Follow API - Real Database', () => {
  let app; // Instance ứng dụng Express cho thử nghiệm
  let db; // Instance kết nối cơ sở dữ liệu
  let testUsers = []; // Lưu danh sách user thử nghiệm
  let testsFailed = false; // Cờ để kiểm tra nếu có test thất bại

  // Thiết lập trước khi tất cả các test chạy
  beforeAll(async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI không được định nghĩa trong .env!');
    }
    console.log(`Kết nối đến cơ sở dữ liệu thật: ${uri}`);
    db = new Database(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    await db.connect(); // Kết nối đến cơ sở dữ liệu thật

    app = express();
    app.use(express.json()); // Phân tích cú pháp body JSON
    app.use('/users', userRoutes); // Gắn route user dưới /users

    process.env.SECRET = process.env.SECRET || 'testsecret';
  });

  // Dọn dẹp sau khi tất cả test hoàn tất
  afterAll(async () => {
    if (!testsFailed) {
      for (const user of testUsers) {
        await User.deleteOne({ _id: user._id }); // Xóa user thử nghiệm
        await Relationship.deleteMany({ $or: [{ follower: user._id }, { following: user._id }] }); // Xóa mối quan hệ liên quan
        console.log(`Đã xóa user thử nghiệm: ${user.email}`);
      }
      console.log('Tất cả test thành công - Đã xóa các user thử nghiệm khỏi cơ sở dữ liệu thật.');
    } else {
      console.log('Có test thất bại - Giữ lại các user thử nghiệm trong cơ sở dữ liệu thật để kiểm tra.');
      console.log('Các user thử nghiệm còn lại:', testUsers.map(u => ({ id: u._id, email: u.email })));
    }
    await db.disconnect(); // Ngắt kết nối khỏi cơ sở dữ liệu thật
  });

  // Đánh dấu nếu có test thất bại
  afterEach(async () => {
    if (expect.getState().currentTestName && expect.getState().testPath && expect.getState().assertionCalls === 0) {
      testsFailed = true; // Nếu không có assertion nào chạy (test lỗi), đặt cờ
    }
  });

  // Hàm trợ giúp để tạo user thử nghiệm trong cơ sở dữ liệu THỰC
  const createTestUser = async (emailPrefix, name) => {
    const timestamp = Date.now(); // Dùng timestamp để email độc nhất
    const email = `${emailPrefix}-${timestamp}@test.com`;
    const user = new User({
      name, // Tên của user
      email, // Email độc nhất
      password: 'hashedpassword', // Mật khẩu giả
      avatar: 'http://example.com/avatar.jpg', // URL avatar giả
    });
    await user.save(); // Lưu user vào cơ sở dữ liệu THỰC
    testUsers.push(user); // Thêm vào danh sách để quản lý
    console.log(`Đã tạo user thử nghiệm: ${email} (ID: ${user._id})`);
    return user;
  };

  // Hàm trợ giúp để tạo token JWT cho xác thực
  const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.SECRET, { expiresIn: '6h' }); // Tạo token có hiệu lực 6 giờ
  };

  // Bộ thử nghiệm cho endpoint follow
  describe('PATCH /users/:id/follow', () => {
    it('should allow a user to follow another user', async () => {
      const user1 = await createTestUser('user1', 'Test User One');
      const user2 = await createTestUser('user2', 'Test User Two');
      const token = generateToken(user1._id);

      const response = await request(app)
        .patch(`/users/${user2._id}/follow`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User followed successfully');

      const updatedUser1 = await User.findById(user1._id);
      const updatedUser2 = await User.findById(user2._id);
      const relationship = await Relationship.findOne({
        follower: user1._id,
        following: user2._id,
      });

      expect(updatedUser1.following).toContainEqual(user2._id);
      expect(updatedUser2.followers).toContainEqual(user1._id);
      expect(relationship).toBeTruthy();
      console.log(`Follow test passed: ${user1.email} đã follow ${user2.email}`);
    });

    it('should return 400 if user is already followed', async () => {
      const user1 = await createTestUser('user1', 'Test User One');
      const user2 = await createTestUser('user2', 'Test User Two');
      await Relationship.create({ follower: user1._id, following: user2._id });
      await User.findByIdAndUpdate(user1._id, { $addToSet: { following: user2._id } });
      await User.findByIdAndUpdate(user2._id, { $addToSet: { followers: user1._id } });
      const token = generateToken(user1._id);

      const response = await request(app)
        .patch(`/users/${user2._id}/follow`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Already following this user');
      console.log(`Already followed test passed: ${user1.email} không thể follow lại ${user2.email}`);
    });

    it('should return 500 if an error occurs', async () => {
      const user1 = await createTestUser('user1', 'Test User One');
      const token = generateToken(user1._id);
      jest.spyOn(User, 'findByIdAndUpdate').mockImplementationOnce(() => { throw new Error('DB error'); });

      const response = await request(app)
        .patch(`/users/${user1._id}/follow`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('Some error occurred while following the user');
      console.log(`Error test passed: Follow gây lỗi như mong đợi`);
    });
  });
});