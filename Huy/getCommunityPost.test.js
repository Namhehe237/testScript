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

// Import routes (only postRoutes needed for getCommunityPosts test)
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


describe('GET /posts/community/:communityId Integration Tests (with real DB)', () => {
  let app; // Express application instance for testing
  let db; // Database connection instance
  let server; // Variable to store the HTTP server instance
  let testUser; // Store a test user
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
    console.log('Deleted test data from real database.'); // Update message

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

    // Create a test user and community for each test
    testUser = await createTestUser('communitytestuser', 'Community Test User');
    testCommunity = await createTestCommunity('TestCommunity', [testUser]);
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
    testPosts.push(post); // Add to test posts array
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


  // Test Case 1: Successfully retrieve posts for a community
  test('TC_GET_COM_POSTS_01: Should return posts for a valid community ID', async () => {
    // Script: Create a user, a community, and a post in that community. Then, request posts for that community.
    // Input: Valid community ID, user ID in headers.
    // Expected Output: Status 200, array of posts including the created post.
    // Assertions: Check status code, response body structure, and content of the returned posts.

    // Create a post in the test community
    const post1 = await createTestPost(testUser, testCommunity, 'This is the first post.');
    const post2 = await createTestPost(testUser, testCommunity, 'This is the second post.');

    const response = await getApp()
      .get(`/posts/community/${testCommunity._id}`)
      .set('user-id', testUser._id.toString()); // Set user ID in headers for mock decodeToken

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(2);

    // Check if the created posts are in the response
    const returnedPostIds = response.body.map(p => p._id);
    expect(returnedPostIds).toContain(post1._id.toString());
    expect(returnedPostIds).toContain(post2._id.toString());

    // Check structure of returned posts (basic check)
    const returnedPost1 = response.body.find(p => p._id === post1._id.toString());
    expect(returnedPost1).toHaveProperty('_id');
    expect(returnedPost1).toHaveProperty('content', 'This is the first post.');
    expect(returnedPost1).toHaveProperty('user');
    expect(returnedPost1.user).toHaveProperty('name', testUser.name);
    expect(returnedPost1).toHaveProperty('community');
    expect(returnedPost1.community).toHaveProperty('name', testCommunity.name);
    expect(returnedPost1).toHaveProperty('createdAt', 'a few seconds ago'); // Mocked time
  });

  // Test Case 2: Retrieve posts from a community with no posts
  test('TC_GET_COM_POSTS_02: Should return an empty array for a community with no posts', async () => {
    // Script: Create a user and a community. Request posts for that community which has no posts.
    // Input: Valid community ID, user ID in headers.
    // Expected Output: Status 200, empty array.
    // Assertions: Check status code and that the response body is an empty array.

    const response = await getApp()
      .get(`/posts/community/${testCommunity._id}`)
      .set('user-id', testUser._id.toString());

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(0);
  });

  // Test Case 3: Handle invalid community ID
  test('TC_GET_COM_POSTS_03: Should return 404 for an invalid community ID', async () => {
    // Script: Use a non-existent community ID to request posts.
    // Input: Invalid community ID (e.g., a random ObjectId string), user ID in headers.
    // Expected Output: Status 404, error message.
    // Assertions: Check status code and error message.

    const invalidCommunityId = new mongoose.Types.ObjectId(); // Generate a valid-looking but non-existent ID

    const response = await getApp()
      .get(`/posts/community/${invalidCommunityId}`)
      .set('user-id', testUser._id.toString());

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'Community not found');
  });

  // Test Case 4: Handle user not being a member of the community
  test('TC_GET_COM_POSTS_04: Should return 401 if user is not a member of the community', async () => {
    // Script: Create a user and a community. Create another user who is NOT a member of the community. Request posts for the community using the non-member user's ID.
    // Input: Valid community ID, non-member user ID in headers.
    // Expected Output: Status 401, unauthorized message.
    // Assertions: Check status code and unauthorized message.

    const nonMemberUser = await createTestUser('nonmember', 'Non Member User');
    // testCommunity already created with testUser as member

    // Create a post in the community (by the member user)
    await createTestPost(testUser, testCommunity, 'Post by member.');

    const response = await getApp()
      .get(`/posts/community/${testCommunity._id}`)
      .set('user-id', nonMemberUser._id.toString()); // Use non-member user's ID

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('message', 'Unauthorized to view posts in this community');
  });

  // Test Case 5: Test pagination with limit and skip
  test('TC_GET_COM_POSTS_05: Should return paginated posts based on limit and skip', async () => {
    // Script: Create a user, a community, and several posts. Request posts with limit and skip parameters.
    // Input: Valid community ID, user ID in headers, limit and skip query parameters.
    // Expected Output: Status 200, array of posts matching the pagination criteria.
    // Assertions: Check status code, number of returned posts, and the content of the returned posts.

    // Create multiple posts (e.g., 5 posts)
    const posts = [];
    for (let i = 0; i < 5; i++) {
      posts.push(await createTestPost(testUser, testCommunity, `Post number ${i + 1}`));
    }

    // Request with limit=2, skip=1 (should return posts 2 and 3)
    const limit = 2;
    const skip = 1;
    const response = await getApp()
      .get(`/posts/community/${testCommunity._id}?limit=${limit}&skip=${skip}`)
      .set('user-id', testUser._id.toString());

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(limit);

    // Check if the correct posts are returned (posts[1] and posts[2])
    const returnedPostIds = response.body.map(p => p._id);
    expect(returnedPostIds).toContain(posts[1]._id.toString());
    expect(returnedPostIds).toContain(posts[2]._id.toString());
    expect(returnedPostIds).not.toContain(posts[0]._id.toString());
    expect(returnedPostIds).not.toContain(posts[3]._id.toString());
    expect(returnedPostIds).not.toContain(posts[4]._id.toString());

    // Check content of the returned posts
    expect(response.body[0].content).toBe('Post number 2');
    expect(response.body[1].content).toBe('Post number 3');
  });

  // Test Case 6: Test pagination with limit only
  test('TC_GET_COM_POSTS_06: Should return posts based on limit when skip is not provided', async () => {
    // Script: Create a user, a community, and several posts. Request posts with only limit parameter.
    // Input: Valid community ID, user ID in headers, limit query parameter.
    // Expected Output: Status 200, array of posts matching the limit criteria starting from the beginning.
    // Assertions: Check status code, number of returned posts, and the content of the returned posts.

    // Create multiple posts (e.g., 5 posts)
    const posts = [];
    for (let i = 0; i < 5; i++) {
      posts.push(await createTestPost(testUser, testCommunity, `Post number ${i + 1}`));
    }

    // Request with limit=3, skip=0 (default)
    const limit = 3;
    const response = await getApp()
      .get(`/posts/community/${testCommunity._id}?limit=${limit}`)
      .set('user-id', testUser._id.toString());

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(limit);

    // Check if the correct posts are returned (posts[0], posts[1], posts[2])
    const returnedPostIds = response.body.map(p => p._id);
    expect(returnedPostIds).toContain(posts[0]._id.toString());
    expect(returnedPostIds).toContain(posts[1]._id.toString());
    expect(returnedPostIds).toContain(posts[2]._id.toString());
    expect(returnedPostIds).not.toContain(posts[3]._id.toString());
    expect(returnedPostIds).not.toContain(posts[4]._id.toString());

    // Check content of the returned posts
    expect(response.body[0].content).toBe('Post number 1');
    expect(response.body[1].content).toBe('Post number 2');
    expect(response.body[2].content).toBe('Post number 3');
  });

  // Test Case 7: Test pagination with skip only
  test('TC_GET_COM_POSTS_07: Should return posts based on skip when limit is not provided (uses default limit)', async () => {
    // Script: Create a user, a community, and several posts. Request posts with only skip parameter.
    // Input: Valid community ID, user ID in headers, skip query parameter.
    // Expected Output: Status 200, array of posts matching the skip criteria using the default limit.
    // Assertions: Check status code, number of returned posts, and the content of the returned posts.

    // Create multiple posts (e.g., 15 posts, assuming default limit is 10)
    const posts = [];
    for (let i = 0; i < 15; i++) {
      posts.push(await createTestPost(testUser, testCommunity, `Post number ${i + 1}`));
    }

    // Request with skip=5, limit=10 (default)
    const skip = 5;
    const response = await getApp()
      .get(`/posts/community/${testCommunity._id}?skip=${skip}`)
      .set('user-id', testUser._id.toString());

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(10); // Default limit

    // Check if the correct posts are returned (posts[5] to posts[14])
    const returnedPostIds = response.body.map(p => p._id);
    expect(returnedPostIds).toContain(posts[5]._id.toString());
    expect(returnedPostIds).toContain(posts[14]._id.toString());
    expect(returnedPostIds).not.toContain(posts[0]._id.toString());
    expect(returnedPostIds).not.toContain(posts[4]._id.toString());

    // Check content of the first and last returned posts
    expect(response.body[0].content).toBe('Post number 6');
    expect(response.body[9].content).toBe('Post number 15');
  });

  // Test Case 8: Test pagination with limit and skip exceeding total posts
  test('TC_GET_COM_POSTS_08: Should return empty array if skip exceeds total posts', async () => {
    // Script: Create a user, a community, and a few posts. Request posts with skip value greater than the total number of posts.
    // Input: Valid community ID, user ID in headers, skip query parameter > total posts.
    // Expected Output: Status 200, empty array.
    // Assertions: Check status code and that the response body is an empty array.

    // Create 3 posts
    for (let i = 0; i < 3; i++) {
      await createTestPost(testUser, testCommunity, `Post number ${i + 1}`);
    }

    // Request with skip=5 (total posts is 3)
    const skip = 5;
    const response = await getApp()
      .get(`/posts/community/${testCommunity._id}?skip=${skip}`)
      .set('user-id', testUser._id.toString());

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(0);
  });

  // Test Case 9: Test pagination with limit 0
  test('TC_GET_COM_POSTS_09: Should return empty array if limit is 0', async () => {
    // Script: Create a user, a community, and some posts. Request posts with limit=0.
    // Input: Valid community ID, user ID in headers, limit=0.
    // Expected Output: Status 200, empty array.
    // Assertions: Check status code and that the response body is an empty array.

    // Create 3 posts
    for (let i = 0; i < 3; i++) {
      await createTestPost(testUser, testCommunity, `Post number ${i + 1}`);
    }

    // Request with limit=0
    const limit = 0;
    const response = await getApp()
      .get(`/posts/community/${testCommunity._id}?limit=${limit}`)
      .set('user-id', testUser._id.toString());

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(0);
  });

});