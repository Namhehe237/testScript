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

// Import routes (only postRoutes needed for deletePost test)
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


describe('DELETE /posts/:id Integration Tests (with real DB)', () => {
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
    testUser = await createTestUser('deletepostuser', 'Delete Post User');
    testCommunity = await createTestCommunity('DeletePostCommunity', [testUser]);
    // Create a test post for deletion tests
    testPost = await createTestPost(testUser, testCommunity, 'This post will be deleted.');
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
      // Add other community fields if needed
    });
    await community.save();
    console.log(`Created test community: ${community._id}`);
    return community;
  };

  // Helper function to create a test post in the REAL database
  const createTestPost = async (user, community, content, fileUrl = null, fileType = null) => {
    const post = new Post({
      user: user._id,
      community: community._id,
      content,
      fileUrl,
      fileType,
    });
    await post.save();
    console.log(`Created test post: ${post._id} in community ${community.name}`);
    return post;
  };

  // Helper function to get the server address
  const getApp = () => {
    const address = server.address();
    // Check if address is a string (named pipe or domain socket) or an object (TCP)
    const port = typeof address === 'string' ? null : address.port;
    return request(`http://localhost:${port}`);
  };


  // Test Case 1: Successfully delete an existing post
  test('TC_DELETE_POST_01: Should delete a post successfully', async () => {
    // Script: Use the pre-created testPost ID to send a DELETE request.
    // Input: Valid post ID in the URL parameter.
    // Expected Output: Status 200, success message.
    // Assertions: Check status code, response body message, and verify the post is removed from the DB.

    const postIdToDelete = testPost._id.toString();

    const response = await getApp()
      .delete(`/posts/${postIdToDelete}`)
      .set('user-id', testUser._id.toString()); // Set user ID if needed by middleware (though deletePost doesn't use it directly)

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'Post deleted successfully');

    // Verify the post is no longer in the database
    const deletedPost = await Post.findById(postIdToDelete);
    expect(deletedPost).toBeNull();
  });

  // Test Case 2: Attempt to delete a non-existent post
  test('TC_DELETE_POST_02: Should return 404 if the post does not exist', async () => {
    // Script: Use a non-existent post ID to send a DELETE request.
    // Input: Non-existent post ID in the URL parameter.
    // Expected Output: Status 404, error message.
    // Assertions: Check status code and response body message.

    const nonExistentPostId = new mongoose.Types.ObjectId().toString(); // Generate a valid-looking but non-existent ID

    const response = await getApp()
      .delete(`/posts/${nonExistentPostId}`)
      .set('user-id', testUser._id.toString());

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'Post not found. It may have been deleted already');

    // Verify the original testPost still exists (if it wasn't the one we tried to delete)
    const originalPost = await Post.findById(testPost._id);
    expect(originalPost).not.toBeNull();
  });

  // Test Case 3: Handle invalid post ID format
  test('TC_DELETE_POST_03: Should return 404 for an invalid post ID format', async () => {
    // Script: Use an invalid string format for the post ID in the URL.
    // Input: Invalid post ID string (e.g., "invalid-id").
    // Expected Output: Status 404, error message (Mongoose might throw a CastError, which the controller catches and returns 404).
    // Assertions: Check status code and response body message.

    const invalidPostId = "invalid-id-format";

    const response = await getApp()
      .delete(`/posts/${invalidPostId}`)
      .set('user-id', testUser._id.toString());

    // The controller catches the CastError and returns 404
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'An error occurred while deleting the post'); // Controller's generic error message

    // Verify the original testPost still exists
    const originalPost = await Post.findById(testPost._id);
    expect(originalPost).not.toBeNull();
  });

  // Test Case 4: Handle database error during deletion
  test('TC_DELETE_POST_04: Should return 404 if a database error occurs during deletion', async () => {
    // Script: Mock Post.findById to return a post, but mock post.remove() to throw an error. Send a DELETE request.
    // Input: Valid post ID in the URL parameter.
    // Expected Output: Status 404, error message.
    // Assertions: Check status code and response body message.

    const postIdToDelete = testPost._id.toString();

    // Mock the remove method of the Post model instance
    const originalRemove = Post.prototype.remove;
    Post.prototype.remove = jest.fn().mockRejectedValue(new Error('Mock DB remove error'));

    const response = await getApp()
      .delete(`/posts/${postIdToDelete}`)
      .set('user-id', testUser._id.toString());

    // Restore original remove function after the test
    Post.prototype.remove = originalRemove;

    // The controller catches the error and returns 404
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'An error occurred while deleting the post');

    // Verify the post was NOT deleted from the database
    const postAfterAttempt = await Post.findById(postIdToDelete);
    expect(postAfterAttempt).not.toBeNull();
    expect(postAfterAttempt._id.toString()).toBe(postIdToDelete);
  });

});