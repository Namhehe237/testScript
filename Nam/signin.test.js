// Setup timeout vì các thao tác MongoDB có thể chậm
jest.setTimeout(30000);

const mongoose = require('mongoose');
const { signin } = require('../controllers/user.controller');
const User = require('../models/user.model');
const SuspiciousLogin = require('../models/suspiciousLogin.model');
const UserContext = require('../models/context.model');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

// Load .env cấu hình
dotenv.config();

// ⚠️ Chỉ mock JWT, không mock MongoDB để test logic thực
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'test-token')
}));

describe('Unit test: signin Function (user.controller)', () => {
  let req, res, next;
  let testUser;

  // 🛠 Kết nối MongoDB trước khi test
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB successfully');
  });

  // 🔄 Tạo user test cho mỗi test case
  beforeEach(async () => {
    const testEmail = `test-${Date.now()}@example.com`;
    await User.deleteMany({ email: testEmail });
    await SuspiciousLogin.deleteMany({ email: testEmail });
    await UserContext.deleteMany({ email: testEmail });

    req = {
      body: {
        email: testEmail,
        password: 'testPassword123'
      },
      clientIp: '192.168.1.1',
      useragent: {
        browser: 'Chrome',
        os: 'Windows',
        platform: 'Microsoft Windows',
        isMobile: false,
        isDesktop: true,
        source: 'Mozilla/5.0...'
      }
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((data) => {
        console.log('Response JSON:', data);
      })
    };

    next = jest.fn();

    const hashedPassword = await bcrypt.hash('testPassword123', 10);
    testUser = new User({
      email: req.body.email,
      password: hashedPassword,
      name: 'Test User',
      role: 'general',
      avatar: 'https://raw.githubusercontent.com/nz-m/public-files/main/dp.jpg',
      followers: [],
      following: [],
      location: '',
      bio: '',
      interests: '',
      savedPosts: [],
      isEmailVerified: false
    });
    await testUser.save();
  });

  // ✅ Test Case TC01: Thiếu email/password → return 404
  test('TC01 - should return 404 if email or password is missing', async () => {
    req.body = {};
    await signin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: expect.any(String) });
  });

  // ✅ Test Case TC02: Email không tồn tại → return 404
  test('TC02 - should return status 404 if user is not found', async () => {
    req.body.email = `nonexistent-${Date.now()}@example.com`;
    await signin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: expect.any(String) });
  });

  // ✅ Test Case TC03: Sai mật khẩu → return 400
  test('TC03 - should return 400 if password is incorrect', async () => {
    req.body.password = 'wrongPassword';
    await signin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: expect.any(String) });
  });

  // ✅ Test Case TC04: Đăng nhập thành công với thông tin hợp lệ
  test('TC04 - should authenticate user with correct credentials', async () => {
    const userContext = new UserContext({
      user: testUser._id,
      email: testUser.email,
      ip: '192.168.1.1',
      browser: 'Chrome',
      os: 'Windows',
      platform: 'Microsoft Windows',
      device: 'Desktop',
      deviceType: 'desktop',
      city: 'Unknown',
      country: 'Unknown',
      trusted: true
    });

    try {
      await userContext.save();
    } catch (error) {
      console.error('Error saving userContext:', error);
    }

    await signin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'test-token',
        refreshToken: 'test-token',
        accessTokenUpdatedAt: expect.any(String),
        user: expect.objectContaining({
          name: 'Test User',
          email: testUser.email,
          role: 'general',
          avatar: 'https://raw.githubusercontent.com/nz-m/public-files/main/dp.jpg'
        })
      })
    );
  });

  // ✅ Test Case TC05: Đăng nhập từ device mới → tạo context mới
  test('TC05 - should create new context when logging in from new device', async () => {
    req.clientIp = '10.0.0.1';
    req.useragent.browser = 'Firefox';

    await signin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const contexts = await UserContext.find({ user: testUser._id });
    expect(contexts.length).toBeGreaterThanOrEqual(1);
    const newContext = await UserContext.findOne({
      user: testUser._id,
      ip: '10.0.0.1',
      browser: 'Firefox'
    });
    expect(newContext).toBeTruthy();
  });

  // ✅ Test Case TC06: Đăng nhập không đáng tin → tạo suspicious login
  test('TC06 - should create suspicious login record for untrusted context', async () => {
    req.clientIp = '1.2.3.4';
    req.useragent.browser = 'Edge';
    req.useragent.os = 'MacOS';

    await signin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const suspiciousLogin = await SuspiciousLogin.findOne({
      user: testUser._id,
      ip: '1.2.3.4'
    });
    expect(suspiciousLogin).toBeTruthy();
  });

  // 🧹 Dọn dẹp sau mỗi test case
  afterEach(async () => {
    await User.deleteMany({ email: testUser.email });
    await UserContext.deleteMany({ user: testUser._id });
    await SuspiciousLogin.deleteMany({ user: testUser._id });
  });

  // 🔌 Ngắt kết nối MongoDB
  afterAll(async () => {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  });
});
