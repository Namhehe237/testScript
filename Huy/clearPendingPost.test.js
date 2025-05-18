const request = require('supertest'); // Import supertest
const express = require('express'); // Import express
const mongoose = require('mongoose'); // Import mongoose
const jwt = require('jsonwebtoken'); // Import jwt
const http = require('http'); // Import http module
const fs = require('fs'); // Import fs module
const dayjs = require('dayjs'); // Import dayjs - Keep this line

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

// Import routes (only postRoutes needed for clearPendingPosts test)
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


describe('DELETE /posts/pending Integration Tests (with real DB)', () => {
  let app; // Express application instance for testing
  let db; // Database connection instance
  let server; // Variable to store the HTTP server instance
  let moderatorUser; // Store a moderator user
  let generalUser; // Store a general user
  let testCommunity; // Store a test community

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
    // We still create the server here, but will use request(app) instead of request(server_url)
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

    // Create test users (moderator and general) and a community
    moderatorUser = await createTestUser('moduser', 'Moderator User', 'moderator');
    generalUser = await createTestUser('generaluser', 'General User', 'general');
    testCommunity = await createTestCommunity('PendingPostCommunity', [moderatorUser, generalUser]);
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
    console.log(`Created test user: ${user._id} with role ${role}`);
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
  const createTestPendingPost = async (user, community, content, createdAt, fileUrl = null, fileType = null) => {
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
      createdAt: createdAt, // Set specific creation time
    });
    await pendingPost.save();
    console.log(`Created test pending post: ${pendingPost._id} created at ${createdAt}`);
    return pendingPost;
  };

  // Test Case 1: Successfully clear pending posts older than 1 hour by a moderator
  test('TC_CLEAR_PENDING_01: Should clear pending posts older than 1 hour for a moderator', async () => {
    // Script: Create pending posts, some older than 1 hour, some newer. Send a DELETE request to the /posts/pending endpoint as a moderator.
    // Input: Moderator user ID in headers.
    // Expected Output: Status 200, success message.
    // Assertions: Check status code, response body message, and verify only older pending posts are deleted from the DB.

    // Create a pending post older than 1 hour
    const oldPostTime = dayjs().subtract(2, 'hour').toDate();
    const oldPendingPost = await createTestPendingPost(generalUser, testCommunity, 'This is an old pending post.', oldPostTime);

    // Create a pending post newer than 1 hour
    const newPostTime = dayjs().subtract(30, 'minute').toDate();
    const newPendingPost = await createTestPendingPost(generalUser, testCommunity, 'This is a new pending post.', newPostTime);

    // Send request as moderator - Use request(app) directly
    const response = await request(app)
      .delete('/posts/pending')
      .set('user-id', moderatorUser._id.toString()); // Set moderator user ID

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'Pending posts cleared');

    // Verify the old pending post is deleted
    const deletedOldPost = await PendingPost.findById(oldPendingPost._id);
    expect(deletedOldPost).toBeNull();

    // Verify the new pending post still exists
    const existingNewPost = await PendingPost.findById(newPendingPost._id);
    expect(existingNewPost).not.toBeNull();
  });

  // Test Case 2: Attempt to clear pending posts by a non-moderator user
  test('TC_CLEAR_PENDING_02: Should return 401 if user is not a moderator', async () => {
    // Script: Create some pending posts. Send a DELETE request to the /posts/pending endpoint as a general user.
    // Input: General user ID in headers.
    // Expected Output: Status 401, unauthorized message.
    // Assertions: Check status code and response body message. Verify no pending posts were deleted.

    // Create a pending post
    const oldPostTime = dayjs().subtract(2, 'hour').toDate();
    const pendingPost = await createTestPendingPost(generalUser, testCommunity, 'This post should not be deleted.', oldPostTime);

    // Send request as general user - Use request(app) directly
    const response = await request(app)
      .delete('/posts/pending')
      .set('user-id', generalUser._id.toString()); // Set general user ID

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('message', 'Unauthorized');

    // Verify the pending post still exists
    const existingPost = await PendingPost.findById(pendingPost._id);
    expect(existingPost).not.toBeNull();
  });

  // Test Case 3: Clear pending posts when none are older than 1 hour
  test('TC_CLEAR_PENDING_03: Should return 200 and message if no pending posts are older than 1 hour', async () => {
    // Script: Create pending posts, all newer than 1 hour. Send a DELETE request to the /posts/pending endpoint as a moderator.
    // Input: Moderator user ID in headers.
    // Expected Output: Status 200, success message.
    // Assertions: Check status code and response body message. Verify no pending posts were deleted.

    // Create a pending post newer than 1 hour
    const newPostTime = dayjs().subtract(30, 'minute').toDate();
    const newPendingPost = await createTestPendingPost(generalUser, testCommunity, 'This is a new pending post.', newPostTime);

    // Send request as moderator - Use request(app) directly
    const response = await request(app)
      .delete('/posts/pending')
      .set('user-id', moderatorUser._id.toString()); // Set moderator user ID

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'Pending posts cleared');

    // Verify the pending post still exists
    const existingPost = await PendingPost.findById(newPendingPost._id);
    expect(existingPost).not.toBeNull();
  });

  // Test Case 4: Clear pending posts when there are no pending posts at all
  test('TC_CLEAR_PENDING_04: Should return 200 and message if no pending posts exist', async () => {
    // Script: Ensure no pending posts exist in the DB. Send a DELETE request to the /posts/pending endpoint as a moderator.
    // Input: Moderator user ID in headers.
    // Expected Output: Status 200, success message.
    // Assertions: Check status code and response body message. Verify no pending posts were deleted (as none existed).

    // Send request as moderator - Use request(app) directly
    const response = await request(app)
      .delete('/posts/pending')
      .set('user-id', moderatorUser._id.toString()); // Set moderator user ID

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'Pending posts cleared');

    // Verify no pending posts exist
    const pendingPostsCount = await PendingPost.countDocuments({});
    expect(pendingPostsCount).toBe(0);
  });

  // Test Case 5: Handle database error during deletion
  test('TC_CLEAR_PENDING_05: Should return 500 if a database error occurs during deletion', async () => {
    // Script: Create a pending post older than 1 hour. Mock PendingPost.deleteMany to throw an error. Send a DELETE request as a moderator.
    // Input: Moderator user ID in headers.
    // Expected Output: Status 500, error message.
    // Assertions: Check status code and response body message. Verify the pending post was NOT deleted.

    // Create a pending post older than 1 hour
    const oldPostTime = dayjs().subtract(2, 'hour').toDate();
    const pendingPost = await createTestPendingPost(generalUser, testCommunity, 'This post should not be deleted due to error.', oldPostTime);

    // Mock the deleteMany method of the PendingPost model to simulate a database error
    jest.spyOn(PendingPost, 'deleteMany').mockImplementationOnce(() => {
      throw new Error('Simulated database error');
    });

    // Send request as moderator - Use request(app) directly
    const response = await request(app)
      .delete('/posts/pending')
      .set('user-id', moderatorUser._id.toString()); // Set moderator user ID

    // Restore the original deleteMany implementation
    jest.restoreAllMocks();

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('message', 'Error clearing pending posts');

    // Verify the pending post still exists because the deletion failed
    const existingPost = await PendingPost.findById(pendingPost._id);
    expect(existingPost).not.toBeNull();
  });

});