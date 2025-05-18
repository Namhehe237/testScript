const request = require('supertest'); // Import supertest
const express = require('express'); // Import express
const mongoose = require('mongoose'); // Import mongoose
const jwt = require('jsonwebtoken'); // Import jwt
const http = require('http'); // Import http module
const fs = require('fs'); // Import fs module
const dayjs = require('dayjs'); // Import dayjs
const relativeTime = require('dayjs/plugin/relativeTime'); // Import relativeTime plugin
dayjs.extend(relativeTime); // Extend dayjs with the plugin

const formatCreatedAt = require("../utils/timeConverter"); // Import formatCreatedAt

require('dotenv').config(); // Load environment variables

// Import models
const Post = require('../models/post.model');
const Community = require('../models/community.model');
const Comment = require('../models/comment.model');
const User = require('../models/user.model');
const Relationship = require('../models/relationship.model');
const Report = require('../models/report.model');
const PendingPost = require('../models/pendingPost.model');

// Import routes (only postRoutes needed for unlikePost test)
const postRoutes = require('../routes/post.route');
const decodeTokenMiddleware = require('../middlewares/auth/decodeToken'); // Require decodeToken here
// Mock necessary middleware and services for the route
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => next(), // Mock passport to skip actual authentication
}));
jest.mock('../middlewares/auth/decodeToken', () => (req, res, next) => {
  // Mock decodeToken to get userId from header or assign default if needed
  // In real tests, you might set req.userId based on a test user's ID
  req.userId = req.headers['user-id'] || 'defaultTestUserId';
  next();
});
jest.mock('../middlewares/limiter/limiter', () => ({
  followLimiter: (req, res, next) => next(), // Mock rate limiter for follow
  signUpSignInLimiter: (req, res, next) => next(), // Mock rate limiter for signin/signup
  createPostLimiter: jest.fn((req, res, next) => next()), // Add mock for createPostLimiter
  likeSaveLimiter: jest.fn((req, res, next) => next()), // Add mock for likeSaveLimiter
  commentLimiter: jest.fn((req, res, next) => next()), // Add mock for commentLimiter
}));
jest.mock('express-useragent', () => ({
  express: () => (req, res, next) => {
    // Mock useragent to provide fake user-agent data
    req.useragent = { isMobile: false, browser: 'test', version: '1.0', os: 'testOS', platform: 'testPlatform' };
    next();
  },
}));

// Mock dayjs().fromNow() to return a consistent value for testing
jest.mock('dayjs', () => {
  const actualDayjs = jest.requireActual('dayjs');
  const relativeTime = require('dayjs/plugin/relativeTime');

  // Extend the actual dayjs with the plugin.
  actualDayjs.extend(relativeTime);

  // Create a mock function that simulates calling dayjs(date)
  const mockDayjsInstance = (date) => ({
    fromNow: jest.fn(() => 'a few seconds ago'), // Mock fromNow
    format: jest.fn((formatString) => {
      // Simple mock for format, adjust if needed
      if (formatString === 'YYYY-MM-DD HH:mm:ss') {
        return 'YYYY-MM-DD HH:mm:ss'; // Return mock format
      }
      // Use actual format for other cases if needed by the controller
      return actualDayjs(date).format(formatString);
    }),
    // Add subtract method mock if needed by the controller logic itself
    subtract: jest.fn((amount, unit) => actualDayjs(date).subtract(amount, unit)),
    toDate: jest.fn(() => actualDayjs(date).toDate()),
  });

  const mockDayjs = jest.fn(mockDayjsInstance); // This function is what dayjs(date) calls

  mockDayjs.extend = actualDayjs.extend;
  return mockDayjs; // Return the callable mock function with the extend property
});


// Mock formatCreatedAt (if used in controller and needs consistent output)
jest.mock('../utils/timeConverter', () => jest.fn(() => 'YYYY-MM-DD HH:mm:ss'));

// Mock analyzeContent service to prevent loading issues during route setup
jest.mock('../services/analyzeContent', () => jest.fn((req, res, next) => next()));

// Add mock for userInputValidator middleware
jest.mock('../middlewares/post/userInputValidator', () => ({
  commentValidator: jest.fn((req, res, next) => next()),
  postValidator: jest.fn((req, res, next) => next()),
  validatorHandler: jest.fn((req, res, next) => next()),
}));

// Add mock for processPost service
jest.mock('../services/processPost', () => jest.fn((req, res, next) => next()));

// Add mock for fileUpload middleware
jest.mock('../middlewares/post/fileUpload', () => jest.fn((req, res, next) => {
  // Mock file upload logic if needed for routes that use it
  req.file = { filename: 'mockfile.jpg', path: './assets/userFiles/mockfile.jpg' };
  req.fileUrl = 'http://example.com/mockfile.jpg';
  req.fileType = 'image/jpeg';
  next();
}));

// Add mock for postConfirmation middleware
jest.mock('../middlewares/post/postConfirmation', () => jest.fn((req, res, next) => next()));

// Mock fs.unlink to prevent deleting real files during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'), // Keep actual fs functions if needed
  unlink: jest.fn((path, callback) => {
    console.log(`Mock fs.unlink called for: ${path}`);
    callback(null); // Assume successful deletion
  }),
}));


describe('PATCH /posts/:id/unlike Integration Tests (with real DB)', () => {
  jest.setTimeout(30000); // Increase timeout for this test suite
  let app; // Express application instance for testing
  let db; // Database connection instance
  let server; // Variable to store the HTTP server instance
  let testUser; // Store a test user
  let testCommunity; // Store a test community
  let testPost; // Store a test post

  // Setup before all tests run
  beforeAll(async () => {
    // Use MONGODB_URI from your .env
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI is not defined in .env!');
    }
    console.log(`Connecting to real database: ${uri}`);
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      // Add dbName option if you want to connect to a specific test database
      // dbName: 'socialecho_test' // Uncomment and set if you use a dedicated test DB
    });
    db = mongoose.connection; // Save connection instance

    app = express();
    app.use(express.json()); // Parse JSON body
    // Attach decodeToken middleware before routes that require authentication
    app.use(require('../middlewares/auth/decodeToken'));
    app.use('/posts', postRoutes); // Attach post routes under /posts

    process.env.SECRET = process.env.SECRET || 'testsecret'; // Ensure SECRET has a value

    // Create HTTP server manually and store it
    server = http.createServer(app);
    // Start listening on a random port to avoid conflicts
    await new Promise(resolve => server.listen(0, resolve));
  });

  // Cleanup after all tests complete
  afterAll(async () => {
    // Delete all test data
    await Post.deleteMany({});
    await Community.deleteMany({});
    await Comment.deleteMany({});
    await User.deleteMany({});
    await Relationship.deleteMany({});
    await Report.deleteMany({});
    await PendingPost.deleteMany({});
    console.log('Deleted test data from real database.'); // Update message

    await mongoose.disconnect(); // Use disconnect to ensure all connections are closed

    // Close the HTTP server
    await new Promise(resolve => server.close(resolve));
  });

  // Cleanup data and create base data before each test
  beforeEach(async () => {
    // Clear all collections before each test to ensure a clean state
    await Post.deleteMany({});
    await Community.deleteMany({});
    await Comment.deleteMany({});
    await User.deleteMany({});
    await Relationship.deleteMany({});
    await Report.deleteMany({});
    await PendingPost.deleteMany({});

    // Create a test user and community for each test
    testUser = await createTestUser('unlikeuser', 'Unlike User');
    testCommunity = await createTestCommunity('UnlikePostCommunity', [testUser]);
    // Create a post that the testUser has liked
    testPost = await createTestPost(testUser, testCommunity, 'This is a test post to be unliked.', [testUser._id]);
  });

  // Helper function to create a test user in the REAL database
  const createTestUser = async (emailPrefix, name, role = 'general') => {
    const timestamp = Date.now(); // Use timestamp for unique email
    const email = `${emailPrefix}-${timestamp}@test.com`;
    const user = new User({
      name, // User's name
      email, // Unique email
      password: 'hashedpassword', // Fake password
      avatar: 'avatar.jpg',
      role,
      isVerified: true, // Assume verified for tests
      isSuspended: false,
      isBanned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await user.save();
    return user;
  };

  // Helper function to create a test community in the REAL database
  const createTestCommunity = async (name, members = [], moderators = []) => {
    const community = new Community({
      name,
      description: `Description for ${name}`,
      members: members.map(m => m._id),
      moderators: moderators.map(m => m._id),
      isPrivate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await community.save();
    return community;
  };

  // Helper function to create a test post in the REAL database
  const createTestPost = async (user, community, content, likes = [], comments = []) => {
    const post = new Post({
      user: user._id,
      community: community._id,
      content,
      likes, // Array of user IDs who liked the post
      comments, // Array of comment IDs
      status: 'approved', // Assume approved for tests
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await post.save();
    return post;
  };

  // Test Case ID: UNLIKE_POST_001
  test('should successfully unlike a post that the user has liked', async () => {
    // Goal: The user should be able to successfully unlike a post they have previously liked.
    // Script: Send an unlike request to the endpoint /posts/:id/unlike with the post ID and the ID of the user who liked the post.
    // Input: PATCH /posts/:testPost._id/unlike, Header: 'user-id': testUser._id
    // Output Expected: Status: 200, Body: The updated post information (the likes array should no longer contain this user's ID).
    // Assert: Check that the status code is 200, the returned data reflects that the user has unliked the post, and verify the database.

    const res = await request(server)
      .patch(`/posts/${testPost._id}/unlike`)
      .set('user-id', testUser._id.toString()); // Set the user ID in the header

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('_id', testPost._id.toString());
    expect(res.body.likes).not.toContain(testUser._id.toString());

    // Verify the change in the database
    const updatedPost = await Post.findById(testPost._id);
    expect(updatedPost.likes).not.toContain(testUser._id);
  });

  // Test Case ID: UNLIKE_POST_002
  test('should return 404 if the post does not exist', async () => {
    // Goal: Unlike a post that does not exist.
    // Script: Send an unlike request to the endpoint with a non-existent post ID.
    // Input: PATCH /posts/:nonExistentPostId/unlike, Header: 'user-id': testUser._id
    // Output Expected: Status: 404, Body: { message: "Post not found. It may have been deleted already" }
    // Assert: Check that the status code is 404 and the returned message is correct.

    const nonExistentPostId = new mongoose.Types.ObjectId();

    const res = await request(server)
      .patch(`/posts/${nonExistentPostId}/unlike`)
      .set('user-id', testUser._id.toString());

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Post not found. It may have been deleted already" });
  });

  // Test Case ID: UNLIKE_POST_003
  test('should return 404 if the user has not liked the post', async () => {
    // Goal: Unlike a post that the user has not liked.
    // Script: Send an unlike request to the endpoint with the ID of a post that the user has not liked.
    // Input: PATCH /posts/:postNotLikedByTestUser._id/unlike, Header: 'user-id': testUser._id
    // Output Expected: Status: 404, Body: { message: "Post not found. It may have been deleted already" }
    // Assert: Check that the status code is 404 and the returned message is correct.

    // Create a new post that testUser has NOT liked
    const postNotLikedByTestUser = await createTestPost(testUser, testCommunity, 'This post is not liked by the test user.', []);

    const res = await request(server)
      .patch(`/posts/${postNotLikedByTestUser._id}/unlike`)
      .set('user-id', testUser._id.toString());

    // Based on the controller logic (findOneAndUpdate with { _id: id, likes: userId }),
    // if the user's ID is not in the likes array, the post won't be found, resulting in 404.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Post not found. It may have been deleted already" });

    // Verify the post's likes array remains unchanged in the database
    const postAfterAttempt = await Post.findById(postNotLikedByTestUser._id);
    expect(postAfterAttempt.likes).toEqual([]);
  });

     // Test Case ID: UNLIKE_POST_004
  test('should return 500 if a server error occurs', async () => {
    // Goal: Handle a server error when unliking a post.
    // Script: Simulate an error occurring during database interaction.
    // Input: PATCH /posts/:testPost._id/unlike, Header: 'user-id': testUser._id (with mocked error)
    // Output Expected: Status: 500, Body: { message: "Error unliking post" }
    // Assert: Check that the status code is 500 and the returned message is correct.

    // Mock the entire Post model's findOneAndUpdate method
    Post.findOneAndUpdate = jest.fn(() => {
      throw new Error('Simulated database error');
    });

    const res = await request(server)
      .patch(`/posts/${testPost._id}/unlike`)
      .set('user-id', testUser._id.toString());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Error unliking post" });

    // Restore the original implementation after test
    jest.restoreAllMocks();
  });
});