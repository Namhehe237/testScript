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

// Import routes (only postRoutes needed for getPublicPosts test)
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


describe('GET /posts/:publicUserId/userPosts Integration Tests (with real DB)', () => {
  jest.setTimeout(30000); // Increase timeout for this test suite
  let app; // Express application instance for testing
  let db; // Database connection instance
  let server; // Variable to store the HTTP server instance
  let testUserWithPosts; // Store a test user who will have posts
  let testUserWithoutPosts; // Store a test user who will have no posts
  let testCommunity; // Store a test community
  let testPosts = []; // Store test posts

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
    console.log('Deleted test data from the real database.'); // Update message

    await mongoose.disconnect(); // Use disconnect to ensure all connections are closed

    // Close the HTTP server
    await new Promise(resolve => server.close(resolve));
  });

  // Cleanup data before each test
  beforeEach(async () => {
    // Clear all collections before each test to ensure a clean state
    await Post.deleteMany({});
    await Community.deleteMany({});
    await Comment.deleteMany({});
    await User.deleteMany({});
    await Relationship.deleteMany({});
    await Report.deleteMany({});
    await PendingPost.deleteMany({});
    testPosts = []; // Reset test posts array

    // Create test users and a community for each test
    testUserWithPosts = await createTestUser('userwithposts', 'User With Posts');
    testUserWithoutPosts = await createTestUser('userwithoutposts', 'User Without Posts');
    testCommunity = await createTestCommunity('TestCommunityForPublicPosts', [testUserWithPosts, testUserWithoutPosts]);

    // Create some posts for testUserWithPosts
    const post1 = await createTestPost(testUserWithPosts, testCommunity, 'This is the first post by userwithposts.');
    const post2 = await createTestPost(testUserWithPosts, testCommunity, 'This is the second post by userwithposts.');
    testPosts.push(post1, post2);

    console.log(`Created test data: User with posts ID ${testUserWithPosts._id}, User without posts ID ${testUserWithoutPosts._id}, Community ID ${testCommunity._id}, Post IDs: ${testPosts.map(p => p._id).join(', ')}`);
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
    return community;
  };

  // Helper function to create a test post in the REAL database
  const createTestPost = async (user, community, content, likes = []) => {
    const post = new Post({
      user: user._id,
      community: community._id,
      content,
      likes, // Array of user ObjectIds who liked the post
      // Add other fields if needed
    });
    await post.save();
    return post;
  };


  // Test Cases
  it('Test Case ID: GP_001 - Goal: Retrieve public posts of a user who has posts', async () => {
    // Script: Send a GET request to the /posts/:publicUserId/userPosts endpoint with the ID of a user who has posts.
    // Input: publicUserId = testUserWithPosts._id
    console.log(`--- Test Case GP_001 ---`);
    console.log(`Goal: Retrieve public posts for user ID: ${testUserWithPosts._id}`);
    console.log(`Input: publicUserId = ${testUserWithPosts._id}`);

    const response = await request(server)
      .get(`/posts/${testUserWithPosts._id}/userPosts`)
      .set('user-id', 'someUserId'); // Need to set user-id because decodeToken middleware is applied to this route

    // Output Expected: Status 200, body is an array of posts by that user.
    console.log(`Output Expected: Status 200, body is an array containing ${testPosts.length} posts.`);
    console.log(`Output Actual Status: ${response.status}`);
    console.log(`Output Actual Body (partial): ${JSON.stringify(response.body).substring(0, 200)}...`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(testPosts.length); // Check the number of posts
    // Check if the returned posts belong to the correct user
    response.body.forEach(post => {
      expect(post.user._id).toBe(testUserWithPosts._id.toString());
    });
    console.log(`Assertion: Received ${response.body.length} posts for user ${testUserWithPosts._id}.`);
    console.log(`--- End Test Case GP_001 ---`);
  });

  it('Test Case ID: GP_002 - Goal: Retrieve public posts of a user who has no posts', async () => {
    // Script: Send a GET request to the /posts/:publicUserId/userPosts endpoint with the ID of a user who has no posts.
    // Input: publicUserId = testUserWithoutPosts._id
    console.log(`--- Test Case GP_002 ---`);
    console.log(`Goal: Retrieve public posts for user with no posts, ID: ${testUserWithoutPosts._id}`);
    console.log(`Input: publicUserId = ${testUserWithoutPosts._id}`);

    const response = await request(server)
      .get(`/posts/${testUserWithoutPosts._id}/userPosts`)
      .set('user-id', 'someUserId'); // Need to set user-id because decodeToken middleware is applied to this route

    // Output Expected: Status 200, body is an empty array.
    console.log(`Output Expected: Status 200, body is an empty array.`);
    console.log(`Output Actual Status: ${response.status}`);
    console.log(`Output Actual Body: ${JSON.stringify(response.body)}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(0); // Check for empty array
    console.log(`Assertion: Received an empty array for user with no posts.`);
    console.log(`--- End Test Case GP_002 ---`);
  });

  it('Test Case ID: GP_003 - Goal: Retrieve public posts with a non-existent user ID', async () => {
    // Script: Send a GET request to the /posts/:publicUserId/userPosts endpoint with a non-existent user ID.
    // Input: publicUserId = 'nonexistentUserId' (a valid ObjectId but not in DB)
    const nonExistentUserId = new mongoose.Types.ObjectId();
    console.log(`--- Test Case GP_003 ---`);
    console.log(`Goal: Retrieve public posts with a non-existent user ID: ${nonExistentUserId}`);
    console.log(`Input: publicUserId = ${nonExistentUserId}`);

    const response = await request(server)
      .get(`/posts/${nonExistentUserId}/userPosts`)
      .set('user-id', 'someUserId'); // Need to set user-id because decodeToken middleware is applied to this route

    // Output Expected: Status 200, body is an empty array (because the query won't find any posts).
    // Note: The current controller returns an empty array if the user is not found or the user has no posts.
    console.log(`Output Expected: Status 200, body is an empty array.`);
    console.log(`Output Actual Status: ${response.status}`);
    console.log(`Output Actual Body: ${JSON.stringify(response.body)}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(0); // Check for empty array
    console.log(`Assertion: Received an empty array for a non-existent user ID.`);
    console.log(`--- End Test Case GP_003 ---`);
  });
});