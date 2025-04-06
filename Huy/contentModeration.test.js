// Nhập các thư viện cần thiết để test API
const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Community = require('../models/community.model');
const Post = require('../models/post.model');
const Report = require('../models/report.model');
const User = require('../models/user.model');
const UserContext = require('../models/context.model');
const SuspiciousLogin = require('../models/suspiciousLogin.model');
const Config = require('../models/config.model');
const communityRoutes = require('../routes/community.route');
const authRoutes = require('../routes/context-auth.route'); 
const Database = require('../config/database');
const formatCreatedAt = require('../utils/timeConverter');
const analyzeContent = require('../services/analyzeContent');
const createCategoryFilterService = require('../services/categoryFilterService');
require('dotenv').config();

// Mock middleware và thư viện
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => next(),
}));
jest.mock('../middlewares/auth/decodeToken', () => (req, res, next) => {
  req.userId = req.headers['user-id'];
  next();
});
jest.mock('express-useragent', () => ({
  express: () => (req, res, next) => {
    req.useragent = { isMobile: false, browser: 'test', version: '1.0', os: 'testOS', platform: 'testPlatform', device: 'testDevice' };
    next();
  },
}));
jest.mock('geoip-lite', () => ({
  lookup: () => ({ country: 'US', city: 'TestCity' }),
}));
jest.mock('../middlewares/logger/logInfo', () => ({
  saveLogInfo: jest.fn(),
}));
jest.mock('googleapis', () => ({
  google: {
    discoverAPI: jest.fn().mockResolvedValue({
      comments: {
        analyze: jest.fn().mockResolvedValue({
          data: {
            attributeScores: {
              TOXICITY: { summaryScore: { value: 0.8 } },
              INSULT: { summaryScore: { value: 0.6 } },
            },
          },
        }),
      },
    }),
  },
}));
jest.mock('../services/apiServices', () => ({
  getCategoriesFromTextRazor: jest.fn().mockResolvedValue({ Spam: 0.9 }),
  getCategoriesFromInterfaceAPI: jest.fn().mockResolvedValue({ Spam: 0.7 }),
  getCategoriesFromClassifierAPI: jest.fn().mockResolvedValue({ Spam: 0.8 }),
}));

jest.setTimeout(30000);

describe('Content Moderation API - Real Database', () => {
  let app;
  let db;
  let testUsers = [];
  let testCommunities = [];
  let testPosts = [];
  let testsFailed = false;

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI không được định nghĩa trong .env!');
    console.log(`Kết nối đến cơ sở dữ liệu thật: ${uri}`);
    db = new Database(uri);
    await db.connect();
    console.log('Kết nối cơ sở dữ liệu thành công');

    app = express();
    app.use(express.json());
    app.use('/communities', communityRoutes);
    app.use('/auth', authRoutes);
    app.post('/test-content', analyzeContent, (req, res) => res.status(200).json({ message: 'Content OK' }));

    process.env.SECRET = process.env.SECRET || 'testsecret';
    process.env.CRYPTO_KEY = process.env.CRYPTO_KEY || 'testkey';
    process.env.PERSPECTIVE_API_KEY = 'mockkey';
    process.env.PERSPECTIVE_API_DISCOVERY_URL = 'mockurl';
  }, 20000);

  afterAll(async () => {
    if (!testsFailed) {
      for (const user of testUsers) {
        await User.deleteOne({ _id: user._id });
        console.log(`Đã xóa user thử nghiệm: ${user.email}`);
      }
      for (const community of testCommunities) {
        await Community.deleteOne({ _id: community._id });
        console.log(`Đã xóa community thử nghiệm: ${community.name}`);
      }
      for (const post of testPosts) {
        await Post.deleteOne({ _id: post._id });
        console.log(`Đã xóa post thử nghiệm: ${post._id}`);
      }
      await Report.deleteMany({});
      await UserContext.deleteMany({});
      await SuspiciousLogin.deleteMany({});
      await Config.deleteMany({});
      console.log('Tất cả test thành công - Đã xóa dữ liệu thử nghiệm.');
    } else {
      console.log('Có test thất bại - Giữ lại dữ liệu thử nghiệm để kiểm tra.');
    }
    await db.disconnect();
  }, 20000);

  afterEach(async () => {
    if (expect.getState().assertionCalls === 0) testsFailed = true;
  });

  const createTestUser = async (emailPrefix, name) => {
    const timestamp = Date.now();
    const email = `${emailPrefix}-${timestamp}@test.com`;
    const user = new User({
      name,
      email,
      password: 'hashedpassword',
      avatar: 'http://example.com/avatar.jpg',
      role: 'general',
    });
    await user.save();
    testUsers.push(user);
    console.log(`Đã tạo user thử nghiệm: ${email} (ID: ${user._id})`);
    return user;
  };

  const createTestCommunity = async (name) => {
    const community = new Community({
      name,
      description: `Description for ${name}`,
      banner: 'http://example.com/banner.jpg',
    });
    await community.save();
    testCommunities.push(community);
    console.log(`Đã tạo community thử nghiệm: ${name} (ID: ${community._id})`);
    return community;
  };

  const createTestPost = async (userId, communityId) => {
    const post = new Post({
      content: 'This is a test post',
      user: userId,
      community: communityId,
    });
    await post.save();
    testPosts.push(post);
    console.log(`Đã tạo post thử nghiệm: ${post._id}`);
    return post;
  };

  const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.SECRET, { expiresIn: '6h' });
  };

  // Test Automated Moderation & Contextual Analysis (verifyContextData)
  describe('Automated Moderation & Contextual Analysis - verifyContextData', () => {
    it('should return NO_CONTEXT_DATA if no context exists', async () => {
      const user = await createTestUser('user1', 'Test User');
      const token = generateToken(user._id);

      const response = await request(app)
        .get('/auth/verify')
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user._id.toString())
        .query({ email: user.email });

      const result = await require('../controllers/auth.controller').verifyContextData(response.req, user);
      expect(result).toBe('no_context_data');
    });

    it('should return MATCH if context matches', async () => {
      const user = await createTestUser('user2', 'Test User');
      const context = new UserContext({
        user: user._id,
        email: user.email,
        ip: '127.0.0.1',
        country: 'US',
        city: 'TestCity',
        browser: 'test 1.0',
        platform: 'testPlatform',
        os: 'testOS',
        device: 'testDevice',
        deviceType: 'Desktop',
      });
      await context.save();
      const token = generateToken(user._id);

      const response = await request(app)
        .get('/auth/verify')
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user._id.toString())
        .query({ email: user.email });

      const result = await require('../controllers/auth.controller').verifyContextData(response.req, user);
      expect(result).toBe('match');
    });

    it('should block device after 3 unverified attempts', async () => {
      const user = await createTestUser('user3', 'Test User');
      const context = new UserContext({
        user: user._id,
        email: user.email,
        ip: '192.168.1.1',
        country: 'UK',
        city: 'London',
        browser: 'chrome 1.0',
        platform: 'windows',
        os: 'win10',
        device: 'pc',
        deviceType: 'Desktop',
      });
      await context.save();
      const suspicious = new SuspiciousLogin({
        user: user._id,
        email: user.email,
        ip: '127.0.0.1',
        country: 'US',
        city: 'TestCity',
        browser: 'test 1.0',
        platform: 'testPlatform',
        os: 'testOS',
        device: 'testDevice',
        deviceType: 'Desktop',
        unverifiedAttempts: 2,
      });
      await suspicious.save();
      const token = generateToken(user._id);

      const response = await request(app)
        .get('/auth/verify')
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user._id.toString())
        .query({ email: user.email });

      const result = await require('../controllers/auth.controller').verifyContextData(response.req, user);
      expect(result).toBe('blocked');
    });
  });

  // Test Toxicity Detection (analyzeContent)
  describe('Toxicity Detection - analyzeContent', () => {
    it('should block toxic content with Perspective API', async () => {
      await Config.create({ usePerspectiveAPI: true });
      const response = await request(app)
        .post('/test-content')
        .send({ content: 'This is toxic content' });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('type', 'inappropriateContent');
    });

    it('should allow non-toxic content', async () => {
      jest.spyOn(require('googleapis').google, 'discoverAPI').mockResolvedValueOnce({
        comments: {
          analyze: jest.fn().mockResolvedValue({
            data: { attributeScores: { TOXICITY: { summaryScore: { value: 0.1 } } } },
          }),
        },
      });
      await Config.create({ usePerspectiveAPI: true });
      const response = await request(app)
        .post('/test-content')
        .send({ content: 'This is safe content' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Content OK');
    });

    it('should proceed if Perspective API is disabled', async () => {
      await Config.create({ usePerspectiveAPI: false });
      const response = await request(app)
        .post('/test-content')
        .send({ content: 'This is toxic content' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Content OK');
    });
  });

  // Test Spam Filtering (categoryFilterService)
  describe('Spam Filtering - categoryFilterService', () => {
    it('should detect spam with TextRazor', async () => {
      const service = createCategoryFilterService('TextRazor');
      const result = await service.getCategories('This is spam content', 5000);
      expect(result).toHaveProperty('Spam', 0.9);
    });

    it('should detect spam with InterfaceAPI', async () => {
      const service = createCategoryFilterService('InterfaceAPI');
      const result = await service.getCategories('This is spam content', 5000);
      expect(result).toHaveProperty('Spam', 0.7);
    });

    it('should detect spam with ClassifierAPI', async () => {
      const service = createCategoryFilterService('ClassifierAPI');
      const result = await service.getCategories('This is spam content', 5000);
      expect(result).toHaveProperty('Spam', 0.8);
    });
  });

  // Test Manual Moderation (reportPost, getReportedPosts, removeReportedPost)
  describe('Manual Moderation - Community Posts', () => {
    it('should report a post successfully', async () => {
      const user = await createTestUser('moderator1', 'Moderator');
      const community = await createTestCommunity('mod-community');
      const post = await createTestPost(user._id, community._id);
      const token = generateToken(user._id);

      const response = await request(app)
        .post('/communities/report')
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user._id.toString())
        .send({ info: { postId: post._id, reportReason: 'Spam', communityId: community._id } });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Post reported successfully.');
    });

    it('should get reported posts', async () => {
      const user = await createTestUser('moderator2', 'Moderator');
      const community = await createTestCommunity('mod-community-2');
      const post = await createTestPost(user._id, community._id);
      await Report.create({ post: post._id, community: community._id, reportedBy: [user._id], reportReason: 'Toxic' });
      const token = generateToken(user._id);

      const response = await request(app)
        .get(`/communities/${community.name}/reported-posts`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user._id.toString());

      expect(response.status).toBe(200);
      expect(response.body.reportedPosts.length).toBe(1);
    });

    it('should remove reported post', async () => {
      const user = await createTestUser('moderator3', 'Moderator');
      const community = await createTestCommunity('mod-community-3');
      const post = await createTestPost(user._id, community._id);
      await Report.create({ post: post._id, community: community._id, reportedBy: [user._id], reportReason: 'Spam' });
      const token = generateToken(user._id);

      const response = await request(app)
        .delete(`/communities/reported-posts/${post._id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user._id.toString());

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Reported post removed successfully');
    });
  });

  // Test Manual Moderation (block/unblock context)
  describe('Manual Moderation - Context Data', () => {
    it('should block suspicious context', async () => {
      const user = await createTestUser('user4', 'Test User');
      const suspicious = new SuspiciousLogin({
        user: user._id,
        email: user.email,
        ip: '127.0.0.1',
        country: 'US',
        city: 'TestCity',
        browser: 'test 1.0',
        platform: 'testPlatform',
        os: 'testOS',
        device: 'testDevice',
        deviceType: 'Desktop',
      });
      await suspicious.save();
      const token = generateToken(user._id);

      const response = await request(app)
        .patch(`/auth/context-data/block/${suspicious._id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user._id.toString());

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Blocked successfully');
    });

    it('should unblock suspicious context', async () => {
      const user = await createTestUser('user5', 'Test User');
      const suspicious = new SuspiciousLogin({
        user: user._id,
        email: user.email,
        ip: '127.0.0.1',
        country: 'US',
        city: 'TestCity',
        browser: 'test 1.0',
        platform: 'testPlatform',
        os: 'testOS',
        device: 'testDevice',
        deviceType: 'Desktop',
        isBlocked: true,
      });
      await suspicious.save();
      const token = generateToken(user._id);

      const response = await request(app)
        .patch(`/auth/context-data/unblock/${suspicious._id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user._id.toString());

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Unblocked successfully');
    });
  });
});