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

// Import routes (only postRoutes needed for likePost test)
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


describe('PATCH /posts/:id/like and /posts/:id/unlike Integration Tests (with real DB)', () => {
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
    testUser = await createTestUser('likeuser', 'Like User');
    testCommunity = await createTestCommunity('LikePostCommunity', [testUser]);
    testPost = await createTestPost(testUser, testCommunity, 'This is a test post to be liked.');
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
      likes: likes, // Set initial likes
      // Add other fields if needed
    });
    await post.save();
    console.log(`Created test post: ${post._id}`);
    return post;
  };


  // Test Case 1: Successful like
  test('TC_LIKE_POST_01: Should successfully like a post', async () => {
    // Goal: Verify that a user can successfully like a post they haven't liked before.
    // Script: Create a user and a post. Send a POST request to /posts/:postId/like with the user's ID.
    // Input: Post ID in URL, User ID in header.
    // Expected Output: Status 200, response body contains the updated post with the user's ID in the `likes` array and correct formatting.
    // Assertions: Check status code, response body structure, check `likes` array includes user ID, check `savedByCount` and `createdAt` formatting. Verify the post in the DB is updated.

    const response = await request(app)
      .patch(`/posts/${testPost._id}/like`) // Use PATCH method
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('_id', testPost._id.toString());
    expect(response.body).toHaveProperty('content', testPost.content);
    expect(response.body).toHaveProperty('user');
    expect(response.body.user).toHaveProperty('name', testUser.name);
    expect(response.body).toHaveProperty('community');
    expect(response.body.community).toHaveProperty('name', testCommunity.name);
    expect(response.body).toHaveProperty('createdAt', 'a few seconds ago'); // Check formatted date
    expect(response.body).toHaveProperty('likes');
    expect(response.body.likes).toHaveLength(1);
    expect(response.body.likes[0].toString()).toBe(testUser._id.toString());
    expect(response.body).toHaveProperty('savedByCount', 0); // Assuming no users have saved it yet

    // Verify the post in the database is updated
    const updatedPostInDB = await Post.findById(testPost._id);
    expect(updatedPostInDB.likes).toHaveLength(1);
    expect(updatedPostInDB.likes[0].toString()).toBe(testUser._id.toString());
  });

   // Test Case 2: Already liked
   test('TC_LIKE_POST_02: Should return 404 if already liked by the user', async () => {
    // Goal: Verify that attempting to like a post already liked by the user returns 404, as the post won't match the find query.
    // Script: Create a user and a post. Manually add the user's ID to the post's `likes` array. Send a PATCH request to /posts/:postId/like with the user's ID.
    // Input: Post ID in URL, User ID in header.
    // Expected Output: Status 404, message "Post not found. It may have been deleted already".
    // Assertions: Check status code, response body message. Verify the post in the DB is unchanged (likes array size remains 1).

    // Manually add the user's ID to the post's likes array
    testPost.likes.push(testUser._id);
    await testPost.save();
    console.log(`Manually added like to post: ${testPost._id}`);

    const response = await request(app)
      .patch(`/posts/${testPost._id}/like`) // Use PATCH method
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    expect(response.status).toBe(404); // Expect 404 based on controller logic
    expect(response.body).toHaveProperty('message', 'Post not found. It may have been deleted already');

    // Verify the post in the database is unchanged (likes array size remains 1)
    const updatedPostInDB = await Post.findById(testPost._id);
    expect(updatedPostInDB.likes).toHaveLength(1);
    expect(updatedPostInDB.likes[0].toString()).toBe(testUser._id.toString());
  });

  // Test Case 3: Post not found (for like)
  test('TC_LIKE_POST_03: Should return 404 if post is not found for liking', async () => {
    // Goal: Verify that attempting to like a non-existent post returns 404.
    // Script: Create a user. Generate a non-existent post ID. Send a PATCH request to /posts/:nonExistentPostId/like with the user's ID.
    // Input: Non-existent Post ID in URL, User ID in header.
    // Expected Output: Status 404, message "Post not found. It may have been deleted already".
    // Assertions: Check status code, response body message.

    const nonExistentPostId = new mongoose.Types.ObjectId(); // Generate a valid but non-existent ObjectId

    const response = await request(app)
      .patch(`/posts/${nonExistentPostId}/like`) // Use PATCH method
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'Post not found. It may have been deleted already');
  });

  // Test Case 4: Database error during update (for like)
  test('TC_LIKE_POST_04: Should return 500 if a database error occurs during like update', async () => {
    // Goal: Verify that the endpoint handles database errors during the update operation for liking.
    // Script: Create a user and a post. Mock Post.findOneAndUpdate to throw an error. Send a PATCH request to /posts/:postId/like with the user's ID.
    // Input: Post ID in URL, User ID in header.
    // Expected Output: Status 500, message "Error liking post".
    // Assertions: Check status code, response body message. Verify the post in the DB is unchanged.

    // Mock Post.findOneAndUpdate to throw an error
    jest.spyOn(Post, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error('Simulated database error during like update');
    });

    const response = await request(app)
      .patch(`/posts/${testPost._id}/like`) // Use PATCH method
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    // Restore the original findOneAndUpdate implementation
    jest.restoreAllMocks();

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('message', 'Error liking post');

    // Verify the post in the database is unchanged
    const postAfterError = await Post.findById(testPost._id);
    expect(postAfterError.likes).toHaveLength(0); // Should still be 0 as the update failed
  });

});