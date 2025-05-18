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

// Import routes (only postRoutes needed for getFollowingUsersPosts test)
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

// Mock analyzeContent service (not directly used by getFollowingUsersPosts, but included for consistency)
jest.mock('../services/analyzeContent', () => jest.fn((req, res, next) => {
  req.failedDetection = false;
  next();
}));

// Mock userInputValidator middleware (not directly used by getFollowingUsersPosts, but included for consistency)
jest.mock('../middlewares/post/userInputValidator', () => ({
  commentValidator: jest.fn((req, res, next) => next()),
  postValidator: jest.fn((req, res, next) => next()),
  validatorHandler: jest.fn((req, res, next) => next()),
}));

// Mock processPost service (not directly used by getFollowingUsersPosts, but included for consistency)
jest.mock('../services/processPost', () => jest.fn((req, res, next) => next()));

// Mock fileUpload middleware (not directly used by getFollowingUsersPosts, but included for consistency)
jest.mock('../middlewares/post/fileUpload', () => jest.fn((req, res, next) => {
  req.file = null;
  req.fileUrl = null;
  req.fileType = null;
  next();
}));

// Mock postConfirmation middleware (not directly used by getFollowingUsersPosts, but included for consistency)
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
const createTestUser = async (emailPrefix, name, role = 'general', following = []) => {
  const timestamp = Date.now(); // Use timestamp for unique email
  const email = `${emailPrefix}-${timestamp}@test.com`;
  const user = new User({
    name, // User's name
    email, // Unique email
    password: 'hashedpassword', // Fake password
    avatar: 'http://example.com/avatar.jpg', // Fake avatar URL
    role, // User's role
    following, // Array of user ObjectIds being followed
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
const createTestPost = async (user, community, content, createdAt = new Date()) => {
  const post = new Post({
    user: user._id,
    community: community._id,
    content,
    createdAt, // Allow setting creation date for sorting tests
    // Add other fields if needed
  });
  await post.save();
  console.log(`Created test post: ${post._id} by user ${user._id} in community ${community._id}`);
  return post;
};

// Helper function to establish a follow relationship
const followUser = async (follower, following) => {
    const relationship = new Relationship({
        follower: follower._id,
        following: following._id,
    });
    await relationship.save();
    console.log(`User ${follower._id} is now following user ${following._id}`);
};


describe('GET /posts/:id/following Integration Tests (with real DB)', () => {
  jest.setTimeout(30000); // Increase timeout for this test suite
  let app; // Express application instance for testing
  let db; // Database connection instance
  let server; // Variable to store the HTTP server instance
  let testUser; // The user whose following's posts we are fetching
  let followedUser1; // A user that testUser follows
  let followedUser2; // Another user that testUser follows
  let unfollowedUser; // A user that testUser does not follow
  let testCommunity; // A community for posts
  let postByFollowedUser1_1; // Post by followedUser1
  let postByFollowedUser1_2; // Another post by followedUser1
  let postByFollowedUser2; // Post by followedUser2
  let postByUnfollowedUser; // Post by unfollowedUser

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

    // Create test users
    testUser = await createTestUser('testuser', 'Test User');
    followedUser1 = await createTestUser('followeduser1', 'Followed User 1');
    followedUser2 = await createTestUser('followeduser2', 'Followed User 2');
    unfollowedUser = await createTestUser('unfolloweduser', 'Unfollowed User');

    // Create a test community
    testCommunity = await createTestCommunity('TestCommunityForFollowingPosts', [testUser, followedUser1, followedUser2, unfollowedUser]);

    // Establish follow relationships
    await followUser(testUser, followedUser1);
    await followUser(testUser, followedUser2);

    // Create posts by different users
    const now = new Date();
    postByFollowedUser1_1 = await createTestPost(followedUser1, testCommunity, 'Post 1 by Followed User 1', new Date(now.getTime() - 5000)); // 5 seconds ago
    postByFollowedUser2 = await createTestPost(followedUser2, testCommunity, 'Post by Followed User 2', new Date(now.getTime() - 3000)); // 3 seconds ago
    postByFollowedUser1_2 = await createTestPost(followedUser1, testCommunity, 'Post 2 by Followed User 1', new Date(now.getTime() - 1000)); // 1 second ago
    postByUnfollowedUser = await createTestPost(unfollowedUser, testCommunity, 'Post by Unfollowed User', new Date(now.getTime() - 2000)); // 2 seconds ago

    console.log('Finished setting up data for test.');
  });

  // Test Case 1: Successfully retrieve posts from followed users
  it('Test Case ID: GFUP_001 - Should return posts from followed users', async () => {
    // Goal: Verify that the endpoint returns posts only from users that the authenticated user follows.
    // Script: Make a GET request to /posts/:id/following with the testUser's ID in the header.
    // Input: Request header 'user-id' set to testUser._id.
    // Expected Output: Status 200, an array of posts from followedUser1 and followedUser2, sorted by creation date (newest first).
    // Assert: Check status code, check the number of returned posts, check if the returned posts belong to followed users, check sorting.

    console.log(`Starting Test Case GFUP_001 for user ${testUser._id}`);

    const response = await request(server)
      .get(`/posts/${testUser._id}/following`) // Using testUser._id in the URL as per route definition, but controller likely uses req.userId
      .set('user-id', testUser._id.toString()); // Set the authenticated user's ID in the header

    console.log('Response Status:', response.status);
    console.log('Response Body:', response.body);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);

    // Expect 3 posts from the two followed users
    expect(response.body.length).toBe(3);

    const returnedPostIds = response.body.map(post => post._id);
    const expectedPostIds = [
        postByFollowedUser1_2._id.toString(), // Newest post by followedUser1
        postByFollowedUser2._id.toString(), // Post by followedUser2
        postByFollowedUser1_1._id.toString(), // Oldest post by followedUser1
    ];

    // Check if all expected posts are present and in the correct order (newest first)
    expect(returnedPostIds).toEqual(expectedPostIds);

    // Verify that posts from the unfollowed user are NOT included
    const unfollowedPostId = postByUnfollowedUser._id.toString();
    expect(returnedPostIds).not.toContain(unfollowedPostId);

    console.log('Test Case GFUP_001 Passed.');
  });

  // Test Case 2: User is following no one
  it('Test Case ID: GFUP_002 - Should return an empty array if the user follows no one', async () => {
    // Goal: Verify that the endpoint returns an empty array when the authenticated user is not following anyone.
    // Script: Create a new user who follows no one. Make a GET request to /posts/:id/following with this new user's ID in the header.
    // Input: Request header 'user-id' set to newUser._id.
    // Expected Output: Status 200, an empty array.
    // Assert: Check status code, check if the response body is an empty array.

    const newUser = await createTestUser('nofollowinguser', 'No Following User');
    console.log(`Starting Test Case GFUP_002 for user ${newUser._id}`);

    const response = await request(server)
      .get(`/posts/${newUser._id}/following`) // Using newUser._id in the URL
      .set('user-id', newUser._id.toString()); // Set the authenticated user's ID in the header

    console.log('Response Status:', response.status);
    console.log('Response Body:', response.body);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(0);

    console.log('Test Case GFUP_002 Passed.');
  });

  // Test Case 3: Followed users have no posts
  it('Test Case ID: GFUP_003 - Should return an empty array if followed users have no posts', async () => {
    // Goal: Verify that the endpoint returns an empty array when the authenticated user follows users who have not created any posts.
    // Script: Create a new user (testUserWithNoPosts). Create two users (followedUserWithNoPosts1, followedUserWithNoPosts2) who have no posts. Make testUserWithNoPosts follow these two users. Make a GET request to /posts/:id/following with testUserWithNoPosts's ID in the header.
    // Input: Request header 'user-id' set to testUserWithNoPosts._id.
    // Expected Output: Status 200, an empty array.
    // Assert: Check status code, check if the response body is an empty array.

    const testUserWithNoPosts = await createTestUser('userwithnoposts', 'User With No Posts');
    const followedUserWithNoPosts1 = await createTestUser('followeduserwithnoposts1', 'Followed User With No Posts 1');
    const followedUserWithNoPosts2 = await createTestUser('followeduserwithnoposts2', 'Followed User With No Posts 2');

    await followUser(testUserWithNoPosts, followedUserWithNoPosts1);
    await followUser(testUserWithNoPosts, followedUserWithNoPosts2);

    console.log(`Starting Test Case GFUP_003 for user ${testUserWithNoPosts._id}`);

    const response = await request(server)
      .get(`/posts/${testUserWithNoPosts._id}/following`) // Using testUserWithNoPosts._id in the URL
      .set('user-id', testUserWithNoPosts._id.toString()); // Set the authenticated user's ID in the header

    console.log('Response Status:', response.status);
    console.log('Response Body:', response.body);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(0);

    console.log('Test Case GFUP_003 Passed.');
  });

    // Test Case 4: User ID in URL parameter is different from authenticated user ID
    // NOTE: Based on the route definition and typical API design, the controller *should* use req.userId.
    // This test case assumes the controller correctly uses req.userId and ignores req.params.id for fetching *the authenticated user's* following feed.
    // If the controller actually uses req.params.id, this test would fail and the controller logic would need review.
    it('Test Case ID: GFUP_004 - Should return posts for the authenticated user, ignoring the URL parameter ID', async () => {
        // Goal: Verify that the endpoint returns posts based on the authenticated user (from req.userId), not the user ID in the URL parameter.
        // Script: Create two users, userA and userB. Make userA follow followedUser1 and followedUser2. Make userB follow no one. Make a GET request to /posts/:id/following using userB's ID in the URL parameter, but userA's ID in the 'user-id' header.
        // Input: URL parameter :id set to userB._id, Request header 'user-id' set to userA._id.
        // Expected Output: Status 200, an array of posts from followedUser1 and followedUser2 (userA's following feed).
        // Assert: Check status code, check if the returned posts belong to userA's followed users, check that no posts from userB's potential following (none in this case) are returned.

        const userA = await createTestUser('userA', 'User A');
        const userB = await createTestUser('userB', 'User B'); // User B follows no one

        // Make userA follow the test followed users
        await followUser(userA, followedUser1);
        await followUser(userA, followedUser2);

        console.log(`Starting Test Case GFUP_004: Authenticated user ${userA._id}, URL ID ${userB._id}`);

        const response = await request(server)
            .get(`/posts/${userB._id}/following`) // URL parameter is userB's ID
            .set('user-id', userA._id.toString()); // Authenticated user is userA

        console.log('Response Status:', response.status);
        console.log('Response Body:', response.body);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);

        // Expect 3 posts from userA's followed users (followedUser1 and followedUser2)
        expect(response.body.length).toBe(3);

        const returnedPostIds = response.body.map(post => post._id);
        const expectedPostIds = [
            postByFollowedUser1_2._id.toString(), // Newest post by followedUser1
            postByFollowedUser2._id.toString(), // Post by followedUser2
            postByFollowedUser1_1._id.toString(), // Oldest post by followedUser1
        ];

        // Check if all expected posts are present and in the correct order (newest first)
        expect(returnedPostIds).toEqual(expectedPostIds);

        // Verify that posts from the unfollowed user are NOT included
        const unfollowedPostId = postByUnfollowedUser._id.toString();
        expect(returnedPostIds).not.toContain(unfollowedPostId);

        console.log('Test Case GFUP_004 Passed.');
    });

});