const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Import models
const Post = require('../server/models/post.model');
const User = require('../server/models/user.model');
const Community = require('../server/models/community.model');
const postRoutes = require('../server/routes/post.route');

// Mock required middlewares
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => next(),
}));

jest.mock('../server/middlewares/auth/decodeToken', () => (req, res, next) => {
  const { ObjectId } = require('mongoose').Types;
  req.userId = new ObjectId(req.headers['user-id']); // force cast to ObjectId
  next();
});

// Mock rate limiters to avoid test delays
jest.mock('../server/middlewares/limiter/limiter', () => ({
  createPostLimiter: (req, res, next) => next(),
  likeSaveLimiter: (req, res, next) => next(),
  commentLimiter: (req, res, next) => next(),
}));

/**
 * Test Suite for Post Like/Unlike API
 * Tests the functionality for liking and unliking posts
 */
describe('Post Like/Unlike API', () => {
  let app;
  let mongoServer;
  let testUser;
  let anotherTestUser;
  let testPost;
  let testCommunity;
  let userToken;
  let anotherUserToken;

  /**
   * Before all tests: 
   * - Start in-memory MongoDB server
   * - Connect mongoose to it
   * - Set up Express app with routes
   * - Set JWT secret for testing
   */
  beforeAll(async () => {
    // Create in-memory MongoDB instance
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    
    // Connect to in-memory database
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    // Create Express app and route
    app = express();
    app.use(express.json());
    app.use('/posts', postRoutes);
    
    // Set a fixed JWT secret for testing
    process.env.SECRET = 'test-jwt-secret';
  });

  /**
   * After all tests:
   * - Disconnect from MongoDB
   * - Stop in-memory server
   */
  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  /**
   * Before each test:
   * - Create test users, community, and post
   * - Generate JWT tokens
   */
  beforeEach(async () => {
    // Create test users
    testUser = new User({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
      avatar: 'default.jpg',
    });
    await testUser.save();
    
    anotherTestUser = new User({
      name: 'Another Test User',
      email: 'another@example.com',
      password: 'password123',
      avatar: 'default2.jpg',
    });
    await anotherTestUser.save();
    
    // Create test community
    testCommunity = new Community({
      name: 'Test Community',
      description: 'A test community',
      members: [testUser._id, anotherTestUser._id],
    });
    await testCommunity.save();
    
    // Create test post
    testPost = new Post({
      content: 'This is a test post',
      community: testCommunity._id,
      user: testUser._id,
      likes: [],
      comments: []
    });
    await testPost.save();
    
    // Generate JWT tokens
    userToken = jwt.sign({ id: testUser._id }, process.env.SECRET, { expiresIn: '1h' });
    anotherUserToken = jwt.sign({ id: anotherTestUser._id }, process.env.SECRET, { expiresIn: '1h' });
  });

  /**
   * After each test:
   * - Clean up created documents
   */
  afterEach(async () => {
    await User.deleteMany({});
    await Community.deleteMany({});
    await Post.deleteMany({});
  });

  /**
   * Test: Successfully liking a post
   * - User should be able to like a post they haven't liked before
   * - Response should include the user's ID in the likes array
   */
  it('should allow a user to like a post', async () => {
    const res = await request(app)
      .patch(`/posts/${testPost._id}/like`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('user-id', testUser._id.toString());

    expect(res.status).toBe(200);
    expect(res.body.likes).toContain(testUser._id.toString());
    
    // Verify database was updated correctly
    const updatedPost = await Post.findById(testPost._id);
    expect(updatedPost.likes).toContainEqual(testUser._id);
  });

  /**
   * Test: Multiple users liking a post
   * - Different users should be able to like the same post
   * - Likes array should contain both user IDs
   */
  it('should allow multiple users to like a post', async () => {
    // First user likes post
    await request(app)
      .patch(`/posts/${testPost._id}/like`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('user-id', testUser._id.toString());
      
    // Second user likes post
    const res = await request(app)
      .patch(`/posts/${testPost._id}/like`)
      .set('Authorization', `Bearer ${anotherUserToken}`)
      .set('user-id', anotherTestUser._id.toString());

    expect(res.status).toBe(200);
    expect(res.body.likes).toContain(testUser._id.toString());
    expect(res.body.likes).toContain(anotherTestUser._id.toString());
    
    // Verify database was updated correctly
    const updatedPost = await Post.findById(testPost._id);
    expect(updatedPost.likes).toContainEqual(testUser._id);
    expect(updatedPost.likes).toContainEqual(anotherTestUser._id);
  });

  /**
   * Test: Liking a post that's already liked
   * - Should return 404 as the controller uses findOneAndUpdate with $ne
   */
  it('should return 404 if post is already liked by user', async () => {
    // Like the post first
    await Post.findByIdAndUpdate(
      testPost._id,
      { $addToSet: { likes: testUser._id } },
      { new: true }
    );
    
    // Try to like it again
    const res = await request(app)
      .patch(`/posts/${testPost._id}/like`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('user-id', testUser._id.toString());

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Post not found. It may have been deleted already');
  });

  /**
   * Test: Unlike a previously liked post
   * - User should be able to unlike a post they previously liked
   * - Likes array should no longer contain the user's ID
   */
  it('should allow a user to unlike a post', async () => {
    // Like the post first
    await Post.findByIdAndUpdate(
      testPost._id,
      { $addToSet: { likes: testUser._id } },
      { new: true }
    );
    
    // Unlike the post
    const res = await request(app)
      .patch(`/posts/${testPost._id}/unlike`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('user-id', testUser._id.toString());

    expect(res.status).toBe(200);
    expect(res.body.likes).not.toContain(testUser._id.toString());
    
    // Verify database was updated correctly
    const updatedPost = await Post.findById(testPost._id);
    expect(updatedPost.likes).not.toContainEqual(testUser._id);
  });

  /**
   * Test: Unlike a post that wasn't liked
   * - Should return 404 as the controller uses findOneAndUpdate with likes: userId
   */
  it('should return 404 if unliking a post that was not liked', async () => {
    // Unlike without liking first
    const res = await request(app)
      .patch(`/posts/${testPost._id}/unlike`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('user-id', testUser._id.toString());

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Post not found. It may have been deleted already');
  });

  /**
   * Test: Liking a non-existent post
   * - Should return 404 when post ID doesn't exist
   */
  it('should return 404 when liking a non-existent post', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    
    const res = await request(app)
      .patch(`/posts/${fakeId}/like`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('user-id', testUser._id.toString());

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Post not found. It may have been deleted already');
  });

  /**
   * Test: Database error when liking a post
   * - Should return 500 if database error occurs
   */
  it('should return 500 if DB error occurs during like', async () => {
    // Mock database error
    jest.spyOn(Post, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error('Database error');
    });

    const res = await request(app)
      .patch(`/posts/${testPost._id}/like`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('user-id', testUser._id.toString());

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error liking post');
    
    // Restore original implementation
    jest.restoreAllMocks();
  });

  /**
   * Test: Database error when unliking a post
   * - Should return 500 if database error occurs
   */
  it('should return 500 if DB error occurs during unlike', async () => {
    // Like the post first
    await Post.findByIdAndUpdate(
      testPost._id,
      { $addToSet: { likes: testUser._id } },
      { new: true }
    );
    
    // Mock database error
    jest.spyOn(Post, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error('Database error');
    });

    const res = await request(app)
      .patch(`/posts/${testPost._id}/unlike`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('user-id', testUser._id.toString());

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error unliking post');
    
    // Restore original implementation
    jest.restoreAllMocks();
  });
});