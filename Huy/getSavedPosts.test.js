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

// Import routes (only postRoutes needed for getSavedPosts test)
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
    // In real tests, you might set req.userId based on a test user's ID
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

// Mock analyzeContent service (not directly used by getSavedPosts, but included for consistency)
jest.mock('../services/analyzeContent', () => jest.fn((req, res, next) => {
  req.failedDetection = false;
  next();
}));

// Mock userInputValidator middleware (not directly used by getSavedPosts, but included for consistency)
jest.mock('../middlewares/post/userInputValidator', () => ({
  commentValidator: jest.fn((req, res, next) => next()),
  postValidator: jest.fn((req, res, next) => next()),
  validatorHandler: jest.fn((req, res, next) => next()),
}));

// Mock processPost service (not directly used by getSavedPosts, but included for consistency)
jest.mock('../services/processPost', () => jest.fn((req, res, next) => next()));

// Mock fileUpload middleware (not directly used by getSavedPosts, but included for consistency)
jest.mock('../middlewares/post/fileUpload', () => jest.fn((req, res, next) => {
  req.file = null;
  req.fileUrl = null;
  req.fileType = null;
  next();
}));

// Mock postConfirmation middleware (not directly used by getSavedPosts, but included for consistency)
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

// Helper function to save a post for a user
const savePostForUser = async (user, post) => {
    await User.findByIdAndUpdate(
        user._id,
        { $addToSet: { savedPosts: post._id } },
        { new: true }
    );
    console.log(`Saved post ${post._id} for user ${user._id}`);
};


describe('GET /posts/saved Integration Tests (with real DB)', () => {
  jest.setTimeout(30000); // Increase timeout for this test suite
  let app; // Express application instance for testing
  let db; // Database connection instance
  let server; // Variable to store the HTTP server instance
  let testUser; // Store a test user
  let testCommunity; // Store a test community
  let testPost1; // Store a test post 1
  let testPost2; // Store a test post 2
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
    testUser = await createTestUser('getsavedpostsuser', 'Get Saved Posts User');
    testCommunity = await createTestCommunity('GetSavedPostsCommunity', [testUser]);
    testPost1 = await createTestPost(testUser, testCommunity, 'This is the first saved post.');
    testPost2 = await createTestPost(testUser, testCommunity, 'This is the second saved post.');

    // Generate token for the test user
    userToken = generateToken(testUser);
  });

  // Test Case 1: Successfully retrieve saved posts when the user has saved posts
  test('Test Case ID: GSPS_001 - Should return saved posts for a user who has saved posts', async () => {
    // Goal: Verify that the API returns the correct list of posts saved by the authenticated user.
    // Script:
    // 1. Create a user and two posts.
    // 2. Save both posts for the user.
    // 3. Make a GET request to /posts/saved with the user's token.
    // 4. Assert that the response status is 200 and the response body contains the two saved posts.
    // Input: User ID via token, two posts saved by the user.
    // Output Expected: Status 200, array of two saved posts.

    // Save the posts for the test user
    await savePostForUser(testUser, testPost1);
    await savePostForUser(testUser, testPost2);

    // Assert: Check if the posts were actually saved in the user document
    const userAfterSave = await User.findById(testUser._id);
    console.log(`User ${testUser._id} savedPosts after saving: ${userAfterSave.savedPosts}`);
    expect(userAfterSave.savedPosts).toHaveLength(2);
    expect(userAfterSave.savedPosts).toContainEqual(testPost1._id);
    expect(userAfterSave.savedPosts).toContainEqual(testPost2._id);

    // Make the request
    const response = await request(server)
      .get('/posts/saved')
      .set('user-id', testUser._id.toString()); // Use user-id header for mock decodeToken

    // Assertions
    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body).toHaveLength(2);

    // Check if the returned posts are the ones saved
    const returnedPostIds = response.body.map(post => post._id);
    expect(returnedPostIds).toContain(testPost1._id.toString());
    expect(returnedPostIds).toContain(testPost2._id.toString());

    // Optional: Check structure of returned posts (e.g., populated fields)
    const returnedPost1 = response.body.find(post => post._id.toString() === testPost1._id.toString());
    expect(returnedPost1).toHaveProperty('content', testPost1.content);
    expect(returnedPost1).toHaveProperty('user');
    expect(returnedPost1.user).toHaveProperty('name', testUser.name);
    expect(returnedPost1).toHaveProperty('community');
    expect(returnedPost1.community).toHaveProperty('name', testCommunity.name);

    console.log('Test Case GSPS_001 Passed: Successfully retrieved saved posts.');
    console.log('Response Body:', response.body);
  });

  // Test Case 2: Retrieve saved posts when the user has not saved any posts
  test('Test Case ID: GSPS_002 - Should return an empty array for a user with no saved posts', async () => {
    // Goal: Verify that the API returns an empty array when the authenticated user has not saved any posts.
    // Script:
    // 1. Create a user.
    // 2. Ensure the user has no saved posts (default state after creation).
    // 3. Make a GET request to /posts/saved with the user's token.
    // 4. Assert that the response status is 200 and the response body is an empty array.
    // Input: User ID via token, user has no saved posts.
    // Output Expected: Status 200, empty array [].

    // Ensure the user has no saved posts
    const userBeforeTest = await User.findById(testUser._id);
    console.log(`User ${testUser._id} savedPosts before test: ${userBeforeTest.savedPosts}`);
    expect(userBeforeTest.savedPosts).toHaveLength(0);

    // Make the request
    const response = await request(server)
      .get('/posts/saved')
      .set('user-id', testUser._id.toString()); // Use user-id header for mock decodeToken

    // Assertions
    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body).toHaveLength(0);

    console.log('Test Case GSPS_002 Passed: Returned empty array for user with no saved posts.');
    console.log('Response Body:', response.body);
  });

});