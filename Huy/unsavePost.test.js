const request = require('supertest'); // Import supertest
const express = require('express'); // Import express
const mongoose = require('mongoose'); // Import mongoose
const http = require('http'); // Import http module
const dayjs = require('dayjs'); // Import dayjs
const relativeTime = require('dayjs/plugin/relativeTime'); // Import relativeTime plugin
dayjs.extend(relativeTime); // Extend dayjs with the plugin

require('dotenv').config(); // Load environment variables
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
// Import models
const Post = require('../models/post.model');
const Community = require('../models/community.model');
const User = require('../models/user.model');
const Relationship = require('../models/relationship.model');
const Report = require('../models/report.model');
const PendingPost = require('../models/pendingPost.model');
const Comment = require('../models/comment.model'); // Import Comment model
// Import routes (only postRoutes needed for unsavePost test)
const postRoutes = require('../routes/post.route');

// Mock necessary middleware and services for the route
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => next(), // Mock passport to skip actual authentication
}));

// Mock decodeToken directly within jest.mock
jest.mock('../middlewares/auth/decodeToken', () => {
  // Return a mock function that simulates the middleware behavior
  return jest.fn((req, res, next) => {
    // Default mock implementation: get userId from header or assign default
    req.userId = req.headers['user-id'] || 'defaultTestUserId';
    next();
  });
});

// Import the mocked decodeToken after it has been mocked
const decodeToken = require('../middlewares/auth/decodeToken');


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

// Mock analyzeContent service (not directly used by unsavePost, but included for consistency)
jest.mock('../services/analyzeContent', () => jest.fn((req, res, next) => {
  req.failedDetection = false;
  next();
}));

// Mock userInputValidator middleware (not directly used by unsavePost, but included for consistency)
jest.mock('../middlewares/post/userInputValidator', () => ({
  commentValidator: jest.fn((req, res, next) => next()),
  postValidator: jest.fn((req, res, next) => next()),
  validatorHandler: jest.fn((req, res, next) => next()),
}));

// Mock processPost service (not directly used by unsavePost, but included for consistency)
jest.mock('../services/processPost', () => jest.fn((req, res, next) => next()));

// Mock fileUpload middleware (not directly used by unsavePost, but included for consistency)
jest.mock('../middlewares/post/fileUpload', () => jest.fn((req, res, next) => {
  req.file = null;
  req.fileUrl = null;
  req.fileType = null;
  next();
}));

// Mock postConfirmation middleware (not directly used by unsavePost, but included for consistency)
jest.mock('../middlewares/post/postConfirmation', () => jest.fn((req, res, next) => next()));

// Mock fs.unlink to prevent deleting real files during tests (used by postConfirmation and models)
jest.mock('fs', () => ({
  ...jest.requireActual('fs'), // Keep actual fs functions if needed
  unlink: jest.fn((path, callback) => {
    console.log(`Mock fs.unlink called for: ${path}`);
    callback(null); // Assume successful deletion
  }),
}));

// Helper function to generate a JWT token for a test user
const generateToken = (user) => {
  const payload = {
    id: user._id,
    email: user.email,
  };
  // Use a test secret for signing the token
  return jwt.sign(payload, process.env.SECRET || 'testsecret', {
    expiresIn: '1h', // Token expires in 1 hour
  });
};

// Helper function to create a test user in the REAL database
const createTestUser = async (emailPrefix, name, role = 'general', savedPosts = []) => {
  const timestamp = Date.now(); // Use timestamp for unique email
  const email = `${emailPrefix}-${timestamp}@test.com`;
  const user = new User({
    name, // User's name
    email, // Unique email
    password: 'hashedpassword', // Fake password
    avatar: 'http://example.com/avatar.jpg', // Fake avatar URL
    role, // User's role
    savedPosts, // Array of saved post ObjectIds
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
    likes, // Array of user ObjectIds who liked the post
    // Add other fields if needed
  });
  await post.save();
  console.log(`Created test post: ${post._id}`);
  return post;
};


describe('PATCH /posts/:id/unsave Integration Tests (with real DB)', () => {
  jest.setTimeout(30000); // Increase timeout for this test suite
  let app; // Express application instance for testing
  let db; // Database connection instance
  let server; // Variable to store the HTTP server instance
  let testUser; // Store a test user
  let testCommunity; // Store a test community
  let testPost; // Store a test post
  let userToken; // Store the JWT token for the test user

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
    // Attach necessary middleware for the unsave route
    app.use(require('../middlewares/limiter/limiter').likeSaveLimiter); // unsavePost uses likeSaveLimiter
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
    console.log('Deleted test data from real database.');

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
    testUser = await createTestUser('unsaveuser', 'Unsave User');
    testCommunity = await createTestCommunity('UnsavePostCommunity', [testUser]);
    // Create a test post
    testPost = await createTestPost(testUser, testCommunity, 'This is a test post to be unsaved.');

    // Generate token for the test user
    userToken = generateToken(testUser);

    // Mock req.userId in decodeToken middleware for this specific user
    decodeToken.mockImplementation((req, res, next) => {
      req.userId = testUser._id.toString(); // Use the actual test user's ID
      next();
    });
  });

  // Reset mock implementation after each test
  afterEach(() => {
    decodeToken.mockRestore();
  });


  // Test Cases
  it('Test Case ID: UNSAVE_POST_001 - Goal: Should successfully unsave a post that was previously saved by the user', async () => {
    // Script: User saves a post, then unsaves it. Verify the post is removed from user's savedPosts.
    // Input: User ID, Post ID (saved by user)
    // Output Expected: Status 200, User's savedPosts array does not contain the post ID.
    // Assert: Response status is 200, User document in DB does not have the post ID in savedPosts.

    // Arrange: Save the post first
    await User.findByIdAndUpdate(testUser._id, { $addToSet: { savedPosts: testPost._id } });
    let userBeforeUnsave = await User.findById(testUser._id);
    expect(userBeforeUnsave.savedPosts).toContainEqual(testPost._id);

    // Act: Send PATCH request to unsave the post
    const response = await request(server)
      .patch(`/posts/${testPost._id}/unsave`)
      .set('Authorization', `Bearer ${userToken}`) // Include token for authentication
      .set('User-Id', testUser._id.toString()); // Mock user ID header

    // Assert: Check response status and body
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'Post unsaved successfully');

    // Assert: Verify the post is removed from the user's savedPosts in the database
    const userAfterUnsave = await User.findById(testUser._id);
    expect(userAfterUnsave.savedPosts).not.toContainEqual(testPost._id);
  });

  it('Test Case ID: UNSAVE_POST_002 - Goal: Should return 404 if the post does not exist', async () => {
    // Script: Attempt to unsave a post with a non-existent ID.
    // Input: User ID, Non-existent Post ID
    // Output Expected: Status 404, message "Post not found".
    // Assert: Response status is 404, Response body contains the expected message.

    // Arrange: Generate a non-existent post ID
    const nonExistentPostId = new mongoose.Types.ObjectId();

    // Act: Send PATCH request to unsave the non-existent post
    const response = await request(server)
      .patch(`/posts/${nonExistentPostId}/unsave`)
      .set('Authorization', `Bearer ${userToken}`) // Include token for authentication
      .set('User-Id', testUser._id.toString()); // Mock user ID header

    // Assert: Check response status and body
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'Post not found');

    // Assert: Verify the user's savedPosts array remains unchanged
    const userAfterAttempt = await User.findById(testUser._id);
    expect(userAfterAttempt.savedPosts).toEqual([]); // Assuming user started with no saved posts
  });

  it('Test Case ID: UNSAVE_POST_003 - Goal: Should successfully unsave a post even if it was not previously saved by the user', async () => {
    // Script: Attempt to unsave a post that the user had not saved. Verify no error occurs and user's savedPosts remains unchanged.
    // Input: User ID, Post ID (not saved by user)
    // Output Expected: Status 200, User's savedPosts array remains unchanged.
    // Assert: Response status is 200, User document in DB does not have the post ID in savedPosts (and didn't before).

    // Arrange: Ensure the post is NOT in the user's savedPosts
    let userBeforeUnsave = await User.findById(testUser._id);
    expect(userBeforeUnsave.savedPosts).not.toContainEqual(testPost._id);

    // Act: Send PATCH request to unsave the post
    const response = await request(server)
      .patch(`/posts/${testPost._id}/unsave`)
      .set('Authorization', `Bearer ${userToken}`) // Include token for authentication
      .set('User-Id', testUser._id.toString()); // Mock user ID header

    // Assert: Check response status and body
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'Post unsaved successfully'); // Controller should handle this gracefully

    // Assert: Verify the user's savedPosts array remains unchanged (still doesn't contain the post ID)
    const userAfterUnsave = await User.findById(testUser._id);
    expect(userAfterUnsave.savedPosts).not.toContainEqual(testPost._id);
    expect(userAfterUnsave.savedPosts.length).toBe(0); // Assuming user started with no saved posts
  });

  it('Test Case ID: UNSAVE_POST_004 - Goal: Should return 401 if the user is not authenticated', async () => {
    // Script: Attempt to unsave a post without providing an authentication token.
    // Input: Post ID, No User ID/Token
    // Output Expected: Status 401.
    // Assert: Response status is 401.

    // Arrange: Save the post first so there's something to potentially unsave
    await User.findByIdAndUpdate(testUser._id, { $addToSet: { savedPosts: testPost._id } });
    let userBeforeUnsave = await User.findById(testUser._id);
    expect(userBeforeUnsave.savedPosts).toContainEqual(testPost._id);

    // Act: Send PATCH request to unsave the post WITHOUT token or User-Id header
    const response = await request(server)
      .patch(`/posts/${testPost._id}/unsave`);
      // No .set('Authorization', ...) or .set('User-Id', ...)

    // Assert: Check response status
    expect(response.status).toBe(401); // Expecting Unauthorized

    // Assert: Verify the post is still in the user's savedPosts in the database
    const userAfterAttempt = await User.findById(testUser._id);
    expect(userAfterAttempt.savedPosts).toContainEqual(testPost._id);
  });

  it('Test Case ID: UNSAVE_POST_005 - Goal: Should handle invalid post ID format', async () => {
    // Script: Attempt to unsave a post using an invalidly formatted post ID.
    // Input: User ID, Invalid Post ID format (e.g., not a valid ObjectId string)
    // Output Expected: Status 500 (or 400 depending on Mongoose/Express error handling).
    // Assert: Response status indicates an error (e.g., 500 or 400).

    // Arrange: An invalid post ID string
    const invalidPostId = 'invalid-object-id-string';

    // Act: Send PATCH request with the invalid post ID
    const response = await request(server)
      .patch(`/posts/${invalidPostId}/unsave`)
      .set('Authorization', `Bearer ${userToken}`) // Include token for authentication
      .set('User-Id', testUser._id.toString()); // Mock user ID header

    // Assert: Check response status (Mongoose/Express might return 500 or 400 for invalid ObjectId)
    // We expect an error status, not success (200) or not found (404)
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(501); // Should be a client or server error related to ID format

    // Assert: Verify the user's savedPosts array remains unchanged
    const userAfterAttempt = await User.findById(testUser._id);
    expect(userAfterAttempt.savedPosts.length).toBe(0); // Assuming user started with no saved posts
  });

});