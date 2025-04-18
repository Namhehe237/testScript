const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const Database = require('../config/database');
const userRoutes = require('../routes/user.route');
const User = require('../models/user.model');
const Relationship = require('../models/relationship.model');
const Post = require('../models/post.model');
const Community = require('../models/community.model');
const Token = require('../models/token.model');

// Mock middleware để bypass authentication và rate limiting
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => {
    if (!req.headers.authorization || req.headers.authorization === 'Bearer invalid_token') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    next();
  },
}));
jest.mock('../middlewares/auth/decodeToken', () => (req, res, next) => {
  req.userId = req.headers['user-id'];
  next();
});
jest.mock('../middlewares/limiter/limiter', () => ({
  followLimiter: (req, res, next) => next(),
  signUpSignInLimiter: (req, res, next) => next(),
}));
jest.mock('express-useragent', () => ({
  express: () => (req, res, next) => {
    req.useragent = { isMobile: false, browser: 'test', version: '1.0', os: 'testOS', platform: 'testPlatform' };
    next();
  },
}));

describe('Profile Controller Tests - Real Database', () => {
  let app;
  let db;
  let testUsers = [];
  let testCommunities = [];
  let testPosts = [];
  let testRelationships = [];
  let testTokens = [];
  let testsFailed = false;

  // Thiết lập kết nối tới cơ sở dữ liệu thực tế và cấu hình ứng dụng Express
  beforeAll(async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI không được định nghĩa trong .env!');
    }
    console.log(`Kết nối đến cơ sở dữ liệu thật: ${uri}`);
    db = new Database(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    await db.connect();

    app = express();
    app.use(express.json());
    app.use('/users', userRoutes);

    process.env.SECRET = process.env.SECRET || 'test-secret';
    process.env.REFRESH_SECRET = process.env.REFRESH_SECRET || 'test-refresh-secret';
  });

  // Dọn dẹp dữ liệu thử nghiệm, kể cả khi test fail
  afterAll(async () => {
    // Log dữ liệu trước khi xóa để debug
    if (testsFailed) {
      console.log('Có test thất bại - Log dữ liệu trước khi xóa để kiểm tra:');
      console.log('Users còn lại:', testUsers.map(u => ({ id: u._id, email: u.email })));
      console.log('Communities còn lại:', testCommunities.map(c => ({ id: c._id, name: c.name })));
      console.log('Posts còn lại:', testPosts.map(p => ({ id: p._id, content: p.content })));
      console.log('Relationships còn lại:', testRelationships.map(r => ({ id: r._id, follower: r.follower, following: r.following })));
      console.log('Tokens còn lại:', testTokens.map(t => ({ id: t._id, user: t.user })));
    }

    // Xóa dữ liệu thử nghiệm
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
      console.log(`Đã xóa post thử nghiệm: ${post.content}`);
    }
    for (const relationship of testRelationships) {
      await Relationship.deleteOne({ _id: relationship._id });
      console.log(`Đã xóa relationship thử nghiệm: follower ${relationship.follower}, following ${relationship.following}`);
    }
    for (const token of testTokens) {
      await Token.deleteOne({ _id: token._id });
      console.log(`Đã xóa token thử nghiệm: user ${token.user}`);
    }
    console.log('Đã xóa toàn bộ dữ liệu thử nghiệm khỏi cơ sở dữ liệu thật.');

    await db.disconnect();
    console.log('Ngắt kết nối khỏi cơ sở dữ liệu thật');
  });

  // Đánh dấu testsFailed nếu có test thất bại
  afterEach(() => {
    if (expect.getState().currentTestName && expect.getState().testPath && expect.getState().assertionCalls === 0) {
      testsFailed = true;
    }
  });

  // Hàm hỗ trợ tạo dữ liệu thử nghiệm
  const createTestUser = async (emailPrefix, name) => {
    const timestamp = Date.now();
    const email = `${emailPrefix}-${timestamp}@test.com`;
    const user = new User({
      name,
      email,
      password: 'hashedpassword',
      avatar: 'http://example.com/avatar.jpg',
      location: `${emailPrefix} City`,
      bio: `Bio for ${name}`,
      interests: `${emailPrefix} interests`,
      role: 'general',
    });
    await user.save();
    testUsers.push(user);
    console.log(`Đã thêm user vào database thật: ${email} (ID: ${user._id})`);
    return user;
  };

  const createTestCommunity = async (name, members) => {
    const community = new Community({
      name,
      description: `Description for ${name}`,
      members,
    });
    await community.save();
    testCommunities.push(community);
    console.log(`Đã thêm community vào database thật: ${name} (ID: ${community._id})`);
    return community;
  };

  const createTestPost = async (userId, content, communityId) => {
    const post = new Post({
      user: userId,
      content,
      community: communityId,
      createdAt: new Date(),
    });
    await post.save();
    testPosts.push(post);
    console.log(`Đã thêm post vào database thật: ${content} (ID: ${post._id})`);
    return post;
  };

  const createTestToken = async (userId, refreshToken, accessToken) => {
    const token = new Token({
      user: userId,
      refreshToken,
      accessToken,
    });
    await token.save();
    testTokens.push(token);
    console.log(`Đã thêm token vào database thật: user ${userId} (ID: ${token._id})`);
    return token;
  };

  const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.SECRET, { expiresIn: '6h' });
  };

  const generateRefreshToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.REFRESH_SECRET, { expiresIn: '7d' });
  };

  // Test cho endpoint GET /users/public-users
  describe('GET /users/public-users - getPublicUsers', () => {
    test('TC_PU01_GET_PUBLIC_USERS_SUCCESS: should return public users not followed', async () => {
      console.log('Starting TC_PU01');
      const user1 = await createTestUser('user1', 'User One');
      const user2 = await createTestUser('user2', 'User Two');
      const user3 = await createTestUser('user3', 'User Three');
      const relationship = await Relationship.create({ follower: user1._id, following: user2._id });
      testRelationships.push(relationship);
      console.log(`Đã thêm relationship vào database thật: follower ${user1._id}, following ${user2._id} (ID: ${relationship._id})`);
      await User.findByIdAndUpdate(user1._id, { $addToSet: { following: user2._id } });
      await User.findByIdAndUpdate(user2._id, { $addToSet: { followers: user1._id } });
      const token = generateToken(user1._id);

      const res = await request(app)
        .get('/users/public-users')
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_PU01 Response:', res.status, res.body);

      if (res.status === 200) {
        console.log(`TC_PU01 passed - Status: ${res.status}, Message: Lấy danh sách người dùng công khai thành công`);
      } else {
        console.log(`TC_PU01 failed - Status: ${res.status}, Message: không thể lấy danh sách người dùng công khai`);
      }
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });

    test('TC_PU02_GET_PUBLIC_USERS_NO_USERS: should return empty array when no public users available', async () => {
      console.log('Starting TC_PU02');
      const user1 = await createTestUser('user1', 'User One');
      const user2 = await createTestUser('user2', 'User Two');
      const user3 = await createTestUser('user3', 'User Three');
      const relationships = await Relationship.create([
        { follower: user1._id, following: user2._id },
        { follower: user1._id, following: user3._id },
      ]);
      relationships.forEach(r => {
        testRelationships.push(r);
        console.log(`Đã thêm relationship vào database thật: follower ${r.follower}, following ${r.following} (ID: ${r._id})`);
      });
      await User.findByIdAndUpdate(user1._id, { $addToSet: { following: [user2._id, user3._id] } });
      await User.findByIdAndUpdate(user2._id, { $addToSet: { followers: user1._id } });
      await User.findByIdAndUpdate(user3._id, { $addToSet: { followers: user1._id } });
      const token = generateToken(user1._id);

      const res = await request(app)
        .get('/users/public-users')
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_PU02 Response:', res.status, res.body);

      if (res.status === 404) {
        console.log(`TC_PU02 passed - Status: ${res.status}, Message: Không có người dùng công khai nào để hiển thị`);
      } else {
        console.log(`TC_PU02 failed - Status: ${res.status}, Message: Tồn tại danh sách người dùng công khai`);
      }
      expect(res.status).toBe(404);
      expect(res.body).toHaveLength(0);
    });

    test('TC_PU03_GET_PUBLIC_USERS_INVALID_TOKEN: should return 401 for invalid token', async () => {
      console.log('Starting TC_PU03');
      const res = await request(app)
        .get('/users/public-users')
        .set('Authorization', 'Bearer invalid_token')
        .set('user-id', new mongoose.Types.ObjectId().toString());

      console.log('TC_PU03 Response:', res.status, res.body);

      if (res.status === 401) {
        console.log(`TC_PU03 passed - Status: ${res.status}, Message: Token không hợp lệ, không có quyền truy cập`);
      } else {
        console.log(`TC_PU03 failed - Status: ${res.status}, Message: Không từ chối truy cập dù token không hợp lệ`);
      }
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/jwt|Unauthorized/i);
    });
  });

  // Test cho endpoint GET /users/public-users/:id
  describe('GET /users/public-users/:id - getPublicUser', () => {
    test('TC_PU04_GET_PUBLIC_USER_SUCCESS: should return public user profile', async () => {
      console.log('Starting TC_PU04');
      const user1 = await createTestUser('user1', 'User One');
      const user2 = await createTestUser('user2', 'User Two');
      const community1 = await createTestCommunity('Tech Community', [user1._id, user2._id]);
      const relationship = await Relationship.create({ follower: user1._id, following: user2._id });
      testRelationships.push(relationship);
      console.log(`Đã thêm relationship vào database thật: follower ${user1._id}, following ${user2._id} (ID: ${relationship._id})`);
      await User.findByIdAndUpdate(user2._id, { $addToSet: { followers: user1._id } });
      await User.findByIdAndUpdate(user1._id, { $addToSet: { following: user2._id } });
      const post = await createTestPost(user2._id, 'Recent post', community1._id);
      const token = generateToken(user1._id);

      const res = await request(app)
        .get(`/users/public-users/${user2._id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_PU04 Response:', res.status, res.body);

      if (res.status === 200) {
        console.log(`TC_PU04 passed - Status: ${res.status}, Message: Lấy thông tin người dùng công khai thành công`);
      } else {
        console.log(`TC_PU04 failed - Status: ${res.status}, Message: Không thể lấy thông tin người dùng công khai`);
      }
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'User Two',
        avatar: 'http://example.com/avatar.jpg',
        location: 'user2 City',
        bio: 'Bio for User Two',
        role: 'general',
        interests: 'user2 interests',
        totalPosts: 1,
        totalCommunities: 1,
        joinedOn: expect.any(String),
        totalFollowers: 1,
        totalFollowing: 0,
        isFollowing: true,
        followingSince: expect.any(String),
        postsLast30Days: 1,
      });
    });

    test('TC_PU05_GET_PUBLIC_USER_NOT_FOUND: should return 404 for non-existent user', async () => {
      console.log('Starting TC_PU05');
      const user1 = await createTestUser('user1', 'User One');
      const token = generateToken(user1._id);

      const res = await request(app)
        .get(`/users/public-users/${new mongoose.Types.ObjectId()}`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_PU05 Response:', res.status, res.body);

      if (res.status === 404) {
        console.log(`TC_PU05 passed - Status: ${res.status}, Message: Người dùng không tồn tại`);
      } else {
        console.log(`TC_PU05 failed - Status: ${res.status}, Message: Không báo lỗi đúng khi người dùng không tồn tại`);
      }
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'User not found' });
    });

    test('TC_PU06_GET_PUBLIC_USER_INVALID_ID: should return 500 for invalid user ID', async () => {
      console.log('Starting TC_PU06');
      const user1 = await createTestUser('user1', 'User One');
      const token = generateToken(user1._id);

      const res = await request(app)
        .get('/users/public-users/invalid_id')
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_PU06 Response:', res.status, res.body);

      if (res.status === 500) {
        console.log(`TC_PU06 passed - Status: ${res.status}, Message: ID không hợp lệ, không thể lấy thông tin người dùng`);
      } else {
        console.log(`TC_PU06 failed - Status: ${res.status}, Message: Không báo lỗi đúng khi ID không hợp lệ`);
      }
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: 'Some error occurred while retrieving the user' });
    });
  });

  // Test cho endpoint PATCH /users/:id/follow
  describe('PATCH /users/:id/follow - followUser', () => {
    test('TC_FU01_FOLLOW_USER_SUCCESS: should successfully follow a user', async () => {
      console.log('Starting TC_FU01');
      const user1 = await createTestUser('user1', 'User One');
      const user2 = await createTestUser('user2', 'User Two');
      const token = generateToken(user1._id);

      const res = await request(app)
        .patch(`/users/${user2._id}/follow`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_FU01 Response:', res.status, res.body);

      if (res.status === 200) {
        console.log(`TC_FU01 passed - Status: ${res.status}, Message: Theo dõi người dùng thành công`);
      } else {
        console.log(`TC_FU01 failed - Status: ${res.status}, Message: Không thể theo dõi người dùng`);
      }
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'User followed successfully' });

      const relationship = await Relationship.findOne({ follower: user1._id, following: user2._id });
      if (relationship) testRelationships.push(relationship);
      expect(relationship).toBeTruthy();
    });

    test('TC_FU02_FOLLOW_USER_ALREADY_FOLLOWING: should return 400 when already following', async () => {
      console.log('Starting TC_FU02');
      const user1 = await createTestUser('user1', 'User One');
      const user2 = await createTestUser('user2', 'User Two');
      const relationship = await Relationship.create({ follower: user1._id, following: user2._id });
      testRelationships.push(relationship);
      console.log(`Đã thêm relationship vào database thật: follower ${user1._id}, following ${user2._id} (ID: ${relationship._id})`);
      const token = generateToken(user1._id);

      const res = await request(app)
        .patch(`/users/${user2._id}/follow`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_FU02 Response:', res.status, res.body);

      if (res.status === 400) {
        console.log(`TC_FU02 passed - Status: ${res.status}, Message: Đã theo dõi người dùng này trước đó`);
      } else {
        console.log(`TC_FU02 failed - Status: ${res.status}, Message: Không báo lỗi đúng khi đã theo dõi người dùng`);
      }
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Already following this user' });
    });

    test('TC_FU03_FOLLOW_USER_NOT_FOUND: should return 404 for non-existent user', async () => {
      console.log('Starting TC_FU03');
      const user1 = await createTestUser('user1', 'User One');
      const token = generateToken(user1._id);
      const nonExistentUserId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/users/${nonExistentUserId}/follow`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_FU03 Response:', res.status, res.body);

      if (res.status === 404) {
        console.log(`TC_FU03 passed - Status: ${res.status}, Message: Không thể theo dõi người dùng không tồn tại`);
      } else {
        console.log(`TC_FU03 failed - Status: ${res.status}, Message: Hệ thống sai - không kiểm tra người dùng tồn tại hay không`);
      }
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'User not found' });

      const relationship = await Relationship.findOne({ follower: user1._id, following: nonExistentUserId });
      expect(relationship).toBeNull();
    });

    test('TC_FU04_FOLLOW_USER_SELF: should return 400 when attempting to follow self', async () => {
      console.log('Starting TC_FU04');
      const user1 = await createTestUser('user1', 'User One');
      const token = generateToken(user1._id);

      const res = await request(app)
        .patch(`/users/${user1._id}/follow`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_FU04 Response:', res.status, res.body);

      if (res.status === 400) {
        console.log(`TC_FU04 passed - Status: ${res.status}, Message: Không thể tự theo dõi chính mình`);
      } else {
        console.log(`TC_FU04 failed - Status: ${res.status}, Message: Hệ thống sai - cho phép tự theo dõi`);
      }
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Cannot follow yourself' });

      const relationship = await Relationship.findOne({ follower: user1._id, following: user1._id });
      expect(relationship).toBeNull();
    });
  });

  // Test cho endpoint PATCH /users/:id/unfollow
  describe('PATCH /users/:id/unfollow - unfollowUser', () => {
    test('TC_UF01_UNFOLLOW_USER_SUCCESS: should successfully unfollow a user', async () => {
      console.log('Starting TC_UF01');
      const user1 = await createTestUser('user1', 'User One');
      const user2 = await createTestUser('user2', 'User Two');
      const relationship = await Relationship.create({ follower: user1._id, following: user2._id });
      testRelationships.push(relationship);
      console.log(`Đã thêm relationship vào database thật: follower ${user1._id}, following ${user2._id} (ID: ${relationship._id})`);
      await User.findByIdAndUpdate(user2._id, { $addToSet: { followers: user1._id } });
      await User.findByIdAndUpdate(user1._id, { $addToSet: { following: user2._id } });
      const token = generateToken(user1._id);

      const res = await request(app)
        .patch(`/users/${user2._id}/unfollow`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_UF01 Response:', res.status, res.body);

      if (res.status === 200) {
        console.log(`TC_UF01 passed - Status: ${res.status}, Message: Bỏ theo dõi người dùng thành công`);
      } else {
        console.log(`TC_UF01 failed - Status: ${res.status}, Message: Không thể bỏ theo dõi người dùng`);
      }
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'User unfollowed successfully' });

      const relationshipAfter = await Relationship.findOne({ follower: user1._id, following: user2._id });
      expect(relationshipAfter).toBeNull();
    });

    test('TC_UF02_UNFOLLOW_USER_NO_RELATIONSHIP: should return 400 for non-existent relationship', async () => {
      console.log('Starting TC_UF02');
      const user1 = await createTestUser('user1', 'User One');
      const user2 = await createTestUser('user2', 'User Two');
      const token = generateToken(user1._id);

      const res = await request(app)
        .patch(`/users/${user2._id}/unfollow`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_UF02 Response:', res.status, res.body);

      if (res.status === 400) {
        console.log(`TC_UF02 passed - Status: ${res.status}, Message: Không có quan hệ theo dõi để bỏ`);
      } else {
          console.log(`TC_UF02 failed - Status: ${res.status}, Message: Hệ thống sai - Không kiểm tra có quan hệ theo dõi hay không`);
      }
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Relationship does not exist' });
    });

    test('TC_UF03_UNFOLLOW_USER_NOT_FOUND: should return 404 for non-existent user', async () => {
      console.log('Starting TC_UF03');
      const user1 = await createTestUser('user1', 'User One');
      const token = generateToken(user1._id);
      const nonExistentUserId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/users/${nonExistentUserId}/unfollow`)
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_UF03 Response:', res.status, res.body);

      if (res.status === 404) {
        console.log(`TC_UF03 passed - Status: ${res.status}, Message: Không thể bỏ theo dõi người dùng không tồn tại`);
      } else {
        console.log(`TC_UF03 failed - Status: ${res.status}, Message: Hệ thống sai - không kiểm tra người dùng tồn tại hay không`);
      }
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'User not found' });

      const relationship = await Relationship.findOne({ follower: user1._id, following: nonExistentUserId });
      expect(relationship).toBeNull();
    });
  });

  // Test cho endpoint GET /users/following
  describe('GET /users/following - getFollowingUsers', () => {
    test('TC_FO01_GET_FOLLOWING_USERS_SUCCESS: should return following users', async () => {
      console.log('Starting TC_FO01');
      const user1 = await createTestUser('user1', 'User One');
      const user2 = await createTestUser('user2', 'User Two');
      const user3 = await createTestUser('user3', 'User Three');
      const relationships = await Relationship.create([
        { follower: user1._id, following: user2._id, createdAt: new Date('2023-01-01') },
        { follower: user1._id, following: user3._id, createdAt: new Date('2023-02-01') },
      ]);
      relationships.forEach(r => {
        testRelationships.push(r);
        console.log(`Đã thêm relationship vào database thật: follower ${r.follower}, following ${r.following} (ID: ${r._id})`);
      });
      const token = generateToken(user1._id);

      const res = await request(app)
        .get('/users/following')
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_FO01 Response:', res.status, res.body);

      if (res.status === 200) {
        console.log(`TC_FO01 passed - Status: ${res.status}, Message: Lấy danh sách người dùng đang theo dõi thành công`);
      } else {
        console.log(`TC_FO01 failed - Status: ${res.status}, Message: Không thể lấy danh sách người dùng đang theo dõi`);
      }
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body).toEqual(expect.arrayContaining([
        expect.objectContaining({
          _id: user2._id.toString(),
          name: 'User Two',
          avatar: 'http://example.com/avatar.jpg',
          location: 'user2 City',
          followingSince: expect.any(String),
        }),
        expect.objectContaining({
          _id: user3._id.toString(),
          name: 'User Three',
          avatar: 'http://example.com/avatar.jpg',
          location: 'user3 City',
          followingSince: expect.any(String),
        }),
      ]));
    });

    test('TC_FO02_GET_FOLLOWING_USERS_NONE: should return empty array when no following', async () => {
      console.log('Starting TC_FO02');
      const user1 = await createTestUser('user1', 'User One');
      const token = generateToken(user1._id);

      const res = await request(app)
        .get('/users/following')
        .set('Authorization', `Bearer ${token}`)
        .set('user-id', user1._id.toString());

      console.log('TC_FO02 Response:', res.status, res.body);

      if (res.status === 200) {
        console.log(`TC_FO02 passed - Status: ${res.status}, Message: Không có người dùng nào đang theo dõi`);
      } else {
        console.log(`TC_FO02 failed - Status: ${res.status}, Message: Không thể lấy danh sách người dùng đang theo dõi`);
      }
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    test('TC_FO03_GET_FOLLOWING_USERS_INVALID_TOKEN: should return 401 for invalid token', async () => {
      console.log('Starting TC_FO03');
      const res = await request(app)
        .get('/users/following')
        .set('Authorization', 'Bearer invalid_token')
        .set('user-id', new mongoose.Types.ObjectId().toString());

      console.log('TC_FO03 Response:', res.status, res.body);

      if (res.status === 401) {
        console.log(`TC_FO03 passed - Status: ${res.status}, Message: Token không hợp lệ, không có quyền truy cập`);
      } else {
        console.log(`TC_FO03 failed - Status: ${res.status}, Message: Không từ chối truy cập dù token không hợp lệ`);
      }
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/jwt|Unauthorized/i);
    });
  });
});