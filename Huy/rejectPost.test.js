const request = require('supertest'); // Import supertest
const express = require('express'); // Import express
const mongoose = require('mongoose'); // Import mongoose
const jwt = require('jsonwebtoken'); // Import jwt
const http = require('http'); // Import http module
const fs = require('fs'); // Import fs module

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

// Import routes (only postRoutes needed for rejectPost test)
const postRoutes = require('../routes/post.route');

// Mock necessary middleware and services for the route
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => next(), // Mock passport to skip actual authentication
}));
jest.mock('../middlewares/auth/decodeToken', () => (req, res, next) => {
  // Mock decodeToken to get userId from header or assign default if needed
  req.userId = req.headers['user-id'] || 'defaultTestUserId';
  next();
});
jest.mock('../middlewares/limiter/limiter', () => ({
  followLimiter: (req, res, next) => next(), // Mock rate limiter for follow
  signUpSignInLimiter: (req, res, next) => next(), // Mock rate limiter for signin/signup
  createPostLimiter: (req, res, next) => next(), // Add mock for createPostLimiter
  likeSaveLimiter: (req, res, next) => next(), // Add mock for likeSaveLimiter
  commentLimiter: (req, res, next) => next(), // Add mock for commentLimiter
}));
jest.mock('express-useragent', () => ({
  express: () => (req, res, next) => {
    // Mock useragent to provide fake user-agent data
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
        return 'YYYY-MM-DD HH:mm:ss'; // Return mock format
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


describe('POST /posts/reject/:confirmationToken Integration Tests (with real DB)', () => {
  let app; // Express application instance for testing
  let db; // Database connection instance
  let server; // Variable to store the HTTP server instance
  let testUser; // Store a test user
  let testCommunity; // Store a test community
  let testPendingPost; // Store a test pending post

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
      // dbName: 'socialecho_test'
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
    testUser = await createTestUser('rejectpostuser', 'Reject Post User');
    testCommunity = await createTestCommunity('RejectPostCommunity', [testUser]);
    // Create a test pending post for rejection tests
    testPendingPost = await createTestPendingPost(testUser, testCommunity, 'This pending post will be rejected.');
  });

  // Helper function to create a test user in the REAL database
  const createTestUser = async (emailPrefix, name, role = 'general') => {
    const timestamp = Date.now(); // Use timestamp for unique email
    const email = `${emailPrefix}-${timestamp}@test.com`;
    const user = new User({
      name, // User's name
      email, // Unique email
      password: 'hashedpassword', // Fake password
      avatar: 'http://example.com/avatar.jpg', // Fake avatar URL
      role, // User's role
    });
    await user.save();
    console.log(`Created test user: ${user._id}`);
    return user;
  };

  // Helper function to create a test community in the REAL database
  const createTestCommunity = async (name, members = []) => {
    const community = new Community({
      name,
      description: `Description for ${name}`,
      members: members.map(m => m._id),
      // Add other fields if needed
    });
    await community.save();
    console.log(`Created test community: ${community._id}`);
    return community;
  };

  // Helper function to create a test pending post in the REAL database
  const createTestPendingPost = async (user, community, content, fileUrl = null, fileType = null) => {
    const confirmationToken = jwt.sign(
      {
        userId: user._id,
        communityId: community._id,
        content: content,
        fileUrl: fileUrl,
        fileType: fileType,
      },
      process.env.SECRET,
      { expiresIn: '15m' } // Token expires in 15 minutes
    );

    const pendingPost = new PendingPost({
      user: user._id,
      community: community._id,
      content,
      fileUrl,
      fileType,
      confirmationToken,
      status: 'pending',
    });
    await pendingPost.save();
    console.log(`Created test pending post: ${pendingPost._id} with token ${confirmationToken}`);
    return pendingPost;
  };


  // Test Case 1: Successfully reject a pending post
  test('TC_REJECT_POST_01: should reject a pending post and return 201', async () => {
    // Script: Use the confirmation token of the pre-created testPendingPost to send a POST request to the reject endpoint.
    // Input: Valid confirmation token in the URL parameter, user ID in headers.
    // Expected Output: Status 201, success message.
    // Assertions: Check status code, response body message, and verify the pending post is removed from the DB.
    const confirmationToken = testPendingPost.confirmationToken;

    const response = await request(app)
      .post(`/posts/reject/${confirmationToken}`)
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('message', 'Post rejected');

    // Verify the pending post is deleted from the database
    const deletedPendingPost = await PendingPost.findById(testPendingPost._id);
    expect(deletedPendingPost).toBeNull();
  });

  // Test Case 2: Attempt to reject a non-existent pending post
  test('TC_REJECT_POST_02: should return 404 if pending post is not found', async () => {
    // Script: Use an invalid or non-existent confirmation token to send a POST request to the reject endpoint.
    // Input: Invalid confirmation token in the URL parameter, user ID in headers.
    // Expected Output: Status 404, error message.
    // Assertions: Check status code and response body message. Verify the original pending post still exists.
    const invalidToken = 'invalidtoken123'; // A token that does not exist

    const response = await request(app)
      .post(`/posts/reject/${invalidToken}`)
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'Post not found');

    // Verify the original pending post still exists
    const existingPendingPost = await PendingPost.findById(testPendingPost._id);
    expect(existingPendingPost).not.toBeNull();
  });

  // Test Case 3: Attempt to reject a pending post with incorrect user ID
  test('TC_REJECT_POST_03: should return 404 if user ID does not match the pending post user', async () => {
    // Script: Create a pending post for testUser. Create another user. Send a POST request to reject the pending post using the confirmation token but with the other user's ID in the header.
    // Input: Valid confirmation token in the URL parameter, different user ID in headers.
    // Expected Output: Status 404, error message (as the controller checks user ID).
    // Assertions: Check status code and response body message. Verify the original pending post still exists.
    const confirmationToken = testPendingPost.confirmationToken;
    const anotherUser = await createTestUser('anotherrejectuser', 'Another Reject User'); // Create another user

    const response = await request(app)
      .post(`/posts/reject/${confirmationToken}`)
      .set('User-Id', anotherUser._id.toString()); // Set the user ID header to another user

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'Post not found'); // The controller returns 404 if user doesn't match

    // Verify the original pending post still exists
    const existingPendingPost = await PendingPost.findById(testPendingPost._id);
    expect(existingPendingPost).not.toBeNull();
  });

  // Test Case 4: Handle database error during rejection
  test('TC_REJECT_POST_04: should return 500 if a database error occurs during rejection', async () => {
    // Script: Mock the PendingPost.prototype.remove method to throw an error. Send a POST request to reject the pending post.
    // Input: Valid confirmation token in the URL parameter, user ID in headers.
    // Expected Output: Status 500, error message.
    // Assertions: Check status code and response body message. Verify the pending post was NOT deleted from the DB.
    const confirmationToken = testPendingPost.confirmationToken;

    // Mock the remove method of the PendingPost model to simulate a database error
    jest.spyOn(PendingPost.prototype, 'remove').mockImplementationOnce(() => {
      throw new Error('Simulated database error');
    });

    const response = await request(app)
      .post(`/posts/reject/${confirmationToken}`)
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('message', 'Error rejecting post');

    // Restore the original remove implementation
    jest.restoreAllMocks();

    // Verify the pending post still exists because the removal failed
    const existingPendingPost = await PendingPost.findById(testPendingPost._id);
    expect(existingPendingPost).not.toBeNull();
  });
});