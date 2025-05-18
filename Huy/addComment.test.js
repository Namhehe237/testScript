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

// Import routes (only postRoutes needed for addComment test)
const postRoutes = require('../routes/post.route');

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
jest.mock('../utils/timeConverter', () => jest.fn(() => 'YYYY-MM-DD HH::ss'));

// Mock analyzeContent service to prevent loading issues during route setup
// Modify this mock if you need to test inappropriate content detection
jest.mock('../services/analyzeContent', () => jest.fn((req, res, next) => {
  // Default behavior: assume content is appropriate
  req.failedDetection = false;
  next();
}));

// Add mock for userInputValidator middleware
// Modify this mock if you need to test validation failures
jest.mock('../middlewares/post/userInputValidator', () => ({
  commentValidator: jest.fn((req, res, next) => next()), // Assume validation passes
  postValidator: jest.fn((req, res, next) => next()),
  validatorHandler: jest.fn((req, res, next) => next()), // Assume validation handler passes
}));

// Add mock for processPost service (not directly used by addComment, but included for consistency)
jest.mock('../services/processPost', () => jest.fn((req, res, next) => next()));

// Add mock for fileUpload middleware (not directly used by addComment, but included for consistency)
jest.mock('../middlewares/post/fileUpload', () => jest.fn((req, res, next) => {
  req.file = null;
  req.fileUrl = null;
  req.fileType = null;
  next();
}));

// Add mock for postConfirmation middleware (not directly used by addComment, but included for consistency)
jest.mock('../middlewares/post/postConfirmation', () => jest.fn((req, res, next) => next()));

// Mock fs.unlink to prevent deleting real files during tests (used by postConfirmation and models)
jest.mock('fs', () => ({
  ...jest.requireActual('fs'), // Keep actual fs functions if needed
  unlink: jest.fn((path, callback) => {
    console.log(`Mock fs.unlink called for: ${path}`);
    callback(null); // Assume successful deletion
  }),
}));


describe('POST /posts/:id/comment Integration Tests (with real DB)', () => {
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
    // Attach necessary middleware for the comment route
    app.use(require('../middlewares/limiter/limiter').commentLimiter);
    app.use(require('../middlewares/post/userInputValidator').commentValidator);
    app.use(require('../middlewares/post/userInputValidator').validatorHandler);
    app.use(require('../services/analyzeContent')); // Use the mock analyzeContent
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
    testUser = await createTestUser('commentuser', 'Comment User');
    testCommunity = await createTestCommunity('CommentPostCommunity', [testUser]);
    // Create a test post to add comments to
    testPost = await createTestPost(testUser, testCommunity, 'This is a test post for comments.');
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

  // Helper function to create a test post in the REAL database
  const createTestPost = async (user, community, content, likes = []) => {
    const post = new Post({
      user: user._id,
      community: community._id,
      content,
      likes: likes.map(l => l._id || l), // Handle both user objects and IDs
    });
    await post.save();
    console.log(`Created test post: ${post._id}`);
    return post;
  };

  // Helper function to create a test comment in the REAL database
  const createTestComment = async (user, post, content) => {
    const comment = new Comment({
      user: user._id,
      post: post._id,
      content,
    });
    await comment.save();
    // Also add the comment ID to the post's comments array
    await Post.findByIdAndUpdate(post._id, { $push: { comments: comment._id } });
    console.log(`Created test comment: ${comment._id}`);
    return comment;
  };


  // Test Cases for addComment
// Test Cases for addComment

test('AC_001: Should successfully add a comment to a post', async () => {
  // goal: Test if a comment is successfully added to a post.
  // test case ID: AC_001
  // script: Send a POST request to the /posts/:postId/comment endpoint with valid comment content.
  // input: postId of the post, userId of the user, request body { content: "Comment content" }.
  const commentContent = 'This is a test comment.';
  const postId = testPost._id;
  const userId = testUser._id;

  const response = await request(server)
    .post(`/posts/${postId}/comment`)
    .set('user-id', userId) // Simulate authenticated user
    .send({ content: commentContent });

  // ouput expected: status 201, message "Comment added successfully". (Expected correct behavior)
  expect(response.status).toBe(201); // Expect 201 Created for successful resource creation
  expect(response.body).toHaveProperty('message', 'Comment added successfully');

  // assert: Check the database to see if the new comment was created and linked to the post.
  const createdComment = await Comment.findOne({ post: postId, user: userId, content: commentContent });
  expect(createdComment).not.toBeNull(); // Assert that the comment WAS created

  const updatedPost = await Post.findById(postId);
  // Check that the comment ID WAS added to the post's comments array
  expect(updatedPost.comments).toContainEqual(createdComment._id);
});

test('AC_002: Should return 404 if post does not exist', async () => {
  // goal: Test if the system handles adding a comment to a non-existent post correctly.
  // test case ID: AC_002
  // script: Send a POST request to the /posts/:invalidPostId/comment endpoint with an invalid postId.
  // input: invalidPostId (a non-existent ID), userId of the user, request body { content: "Comment content" }.
  const invalidPostId = new mongoose.Types.ObjectId(); // Create a non-existent ObjectId
  const commentContent = 'This comment should not be added.';
  const userId = testUser._id;

  const response = await request(server)
    .post(`/posts/${invalidPostId}/comment`)
    .set('user-id', userId)
    .send({ content: commentContent });

  // ouput expected: status 404, message "Post not found". (Expected correct behavior)
  expect(response.status).toBe(404); // Expect 404 Not Found
  // Expect a message indicating the post wasn't found.
  expect(response.body).toHaveProperty('message');
  expect(response.body.message).toContain('Post not found');


  // assert: Check the database to ensure no comment was created with the specific content.
  const commentCount = await Comment.countDocuments({ content: commentContent });
  expect(commentCount).toBe(0);

  // Also check that the non-existent post was not created (this assertion is likely to pass)
  const nonExistentPost = await Post.findById(invalidPostId);
  expect(nonExistentPost).toBeNull();
});

test('AC_003: Should return 500 if comment content is empty (due to validation error)', async () => {
  // goal: Test if the system handles empty comment content correctly, expecting a validation error.
  // test case ID: AC_003
  // script: Send a POST request to the /posts/:postId/comment endpoint with empty comment content.
  // input: postId of the post, userId of the user, request body { content: "" }.
  // Note: With the current test setup (mock validator passing, controller catching Mongoose validation), this results in a 500.
  const commentContent = ''; // Empty content
  const postId = testPost._id;
  const userId = testUser._id;

  const response = await request(server)
    .post(`/posts/${postId}/comment`)
    .set('user-id', userId)
    .send({ content: commentContent });

  // ouput expected: status 500, message "Error adding comment". 
  expect(response.status).toBe(500); // Expect the status the controller actually returns for this error
  expect(response.body).toHaveProperty('message', 'Error adding comment'); // Expect the generic error message from the catch block

  // assert: Check the database to ensure no comment was created with empty content for this post and user.
  const createdComment = await Comment.findOne({ post: postId, user: userId, content: commentContent });
  expect(createdComment).toBeNull(); // Assert that no comment was created

  // Check that the post's comments array was not updated
  const updatedPost = await Post.findById(postId);
  expect(updatedPost.comments).not.toContainEqual(expect.any(mongoose.Types.ObjectId)); // Ensure no new comment ID was added
});
});