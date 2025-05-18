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

// Import routes (only postRoutes needed for confirmPost test)
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


describe('POST /posts/confirm/:confirmationToken Integration Tests (with real DB)', () => {
  let app; // Express application instance for testing
  let db; // Database connection instance
  let server; // Variable to store the HTTP server instance
  let testUser; // Store a test user
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
    testUser = await createTestUser('confirmpostuser', 'Confirm Post User');
    testCommunity = await createTestCommunity('ConfirmPostCommunity', [testUser]);
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
  const createTestPendingPost = async (user, community, content, status = 'pending', fileUrl = null, fileType = null) => {
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
      status: status, // Set specific status
    });
    await pendingPost.save();
    console.log(`Created test pending post: ${pendingPost._id} with token ${confirmationToken} and status ${status}`);
    return pendingPost;
  };


  // Test Case 1: Successful confirmation
  test('TC_CONFIRM_POST_01: Should confirm a pending post and return the new post', async () => {
    // Goal: Verify that a valid pending post is successfully confirmed and converted to a regular post.
    // Script: Create a pending post. Send a POST request to /posts/confirm/:confirmationToken with the correct token and user ID.
    // Input: Valid confirmationToken in URL, matching user-id header.
    // Expected Output: Status 200, response body contains the newly created post object with populated user/community and formatted createdAt.
    // Assertions: Check status code, response body structure and content (especially populated fields and formatted date), verify the pending post is deleted from DB, verify a new post exists in DB with the same content.
    const pendingPost = await createTestPendingPost(testUser, testCommunity, 'This pending post will be confirmed.');
    const confirmationToken = pendingPost.confirmationToken;

    const response = await request(app)
      .post(`/posts/confirm/${confirmationToken}`)
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('_id');
    expect(response.body).toHaveProperty('content', 'This pending post will be confirmed.');
    expect(response.body).toHaveProperty('user');
    expect(response.body.user).toHaveProperty('name', testUser.name);
    expect(response.body).toHaveProperty('community');
    expect(response.body.community).toHaveProperty('name', testCommunity.name);
    expect(response.body).toHaveProperty('createdAt', 'a few seconds ago'); // Check formatted date

    // Verify the pending post is deleted from the database
    const deletedPendingPost = await PendingPost.findById(pendingPost._id);
    expect(deletedPendingPost).toBeNull();

    // Verify a new post exists in the database with the same content
    const newPost = await Post.findOne({ content: 'This pending post will be confirmed.' });
    expect(newPost).not.toBeNull();
    expect(newPost.user.toString()).toBe(testUser._id.toString());
    expect(newPost.community.toString()).toBe(testCommunity._id.toString());
  });

  // Test Case 2: Pending post not found (Invalid token)
  test('TC_CONFIRM_POST_02: Should return 404 if pending post is not found (invalid token)', async () => {
    // Goal: Verify that the endpoint returns 404 if the confirmation token is invalid or doesn't exist.
    // Script: Send a POST request to /posts/confirm/:confirmationToken with an invalid token and a valid user ID.
    // Input: Invalid confirmationToken in URL, valid user-id header.
    // Expected Output: Status 404, message "Post not found".
    // Assertions: Check status code, response body message, verify the original pending post (if any) still exists.
    const invalidToken = 'invalidtoken123'; // A token that does not exist
    const pendingPost = await createTestPendingPost(testUser, testCommunity, 'This post should not be confirmed.'); // Create a post that won't be found

    const response = await request(app)
      .post(`/posts/confirm/${invalidToken}`)
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'Post not found');

    // Verify the original pending post still exists
    const existingPendingPost = await PendingPost.findById(pendingPost._id);
    expect(existingPendingPost).not.toBeNull();
  });

  // Test Case 3: Pending post not found (User ID mismatch)
  test('TC_CONFIRM_POST_03: Should return 404 if user ID does not match the pending post user', async () => {
    // Goal: Verify that the endpoint returns 404 if the user ID in the header does not match the user ID associated with the pending post.
    // Script: Create a pending post for testUser. Create another user. Send a POST request to /posts/confirm/:confirmationToken using testUser's token but with the other user's ID in the header.
    // Input: Valid confirmationToken in URL (for testUser's post), different user ID in headers.
    // Expected Output: Status 404, message "Post not found".
    // Assertions: Check status code and response body message. Verify the original pending post still exists.
    const pendingPost = await createTestPendingPost(testUser, testCommunity, 'This post should not be confirmed by another user.');
    const confirmationToken = pendingPost.confirmationToken;
    const anotherUser = await createTestUser('anotherconfirmuser', 'Another Confirm User'); // Create another user

    const response = await request(app)
      .post(`/posts/confirm/${confirmationToken}`)
      .set('User-Id', anotherUser._id.toString()); // Set the user ID header to another user

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'Post not found'); // The controller returns 404 if user doesn't match

    // Verify the original pending post still exists
    const existingPendingPost = await PendingPost.findById(pendingPost._id);
    expect(existingPendingPost).not.toBeNull();
  });

  // Test Case 4: Pending post not found (Status not pending)
  test('TC_CONFIRM_POST_04: Should return 404 if pending post is not found (e.g., already confirmed or deleted)', async () => {
    // Goal: Verify that the endpoint returns 404 if the pending post with the given token is not found in the database.
    // Script: Create a pending post. Manually delete the pending post from the DB. Send a POST request to /posts/confirm/:confirmationToken with the token and user ID.
    // Input: Valid confirmationToken in URL, matching user-id header, but pending post is deleted from DB.
    // Expected Output: Status 404, message "Post not found".
    // Assertions: Check status code and response body message. Verify no new post was created.

    // Create a pending post
    const pendingPost = await createTestPendingPost(testUser, testCommunity, 'This post will be deleted before confirmation.');
    const confirmationToken = pendingPost.confirmationToken;

    // Manually delete the pending post to simulate it being processed or removed
    await PendingPost.findByIdAndDelete(pendingPost._id);
    console.log(`Manually deleted pending post: ${pendingPost._id}`);


    // Send request with the token of the deleted pending post
    const response = await request(app)
      .post(`/posts/confirm/${confirmationToken}`)
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'Post not found');

    // Verify no new post was created
    const newPost = await Post.findOne({ content: 'This post will be deleted before confirmation.' });
    expect(newPost).toBeNull();
  });


  // Test Case 5: Database error during finding pending post
  test('TC_CONFIRM_POST_05: Should return 500 if a database error occurs during finding pending post', async () => {
    // Goal: Verify that the endpoint handles database errors when trying to find the pending post.
    // Script: Mock PendingPost.findOne to throw an error. Send a POST request to /posts/confirm/:confirmationToken with a valid token and user ID.
    // Input: Valid confirmationToken in URL, matching user-id header.
    // Expected Output: Status 500, message "Error publishing post".
    // Assertions: Check status code, response body message, verify the pending post still exists, verify no new post was created.
    const pendingPost = await createTestPendingPost(testUser, testCommunity, 'This post should cause a find error.');
    const confirmationToken = pendingPost.confirmationToken;

    // Mock PendingPost.findOne to throw an error
    jest.spyOn(PendingPost, 'findOne').mockImplementationOnce(() => {
      throw new Error('Simulated find database error');
    });

    const response = await request(app)
      .post(`/posts/confirm/${confirmationToken}`)
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    // Restore the original findOne implementation
    jest.restoreAllMocks();

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('message', 'Error publishing post');

    // Verify the pending post still exists
    const existingPendingPost = await PendingPost.findById(pendingPost._id);
    expect(existingPendingPost).not.toBeNull();

    // Verify no new post was created
    const newPost = await Post.findOne({ content: 'This post should cause a find error.' });
    expect(newPost).toBeNull();
  });

  // Test Case 6: Database error during deleting pending post
  test('TC_CONFIRM_POST_06: Should return 500 if a database error occurs during deleting pending post', async () => {
    // Goal: Verify that the endpoint handles database errors when trying to delete the pending post after finding it.
    // Script: Create a pending post. Mock PendingPost.findOneAndDelete to throw an error after finding the post. Send a POST request to /posts/confirm/:confirmationToken with the token and user ID.
    // Input: Valid confirmationToken in URL, matching user-id header.
    // Expected Output: Status 500, message "Error publishing post".
    // Assertions: Check status code and response body message. Verify the pending post still exists, verify no new post was created.
    const pendingPost = await createTestPendingPost(testUser, testCommunity, 'This post should cause a delete error.');
    const confirmationToken = pendingPost.confirmationToken;

    // Mock PendingPost.findOneAndDelete to throw an error
    jest.spyOn(PendingPost, 'findOneAndDelete').mockImplementationOnce(() => {
      // Simulate finding the post first, then error on delete
      return { // Return a mock object that looks like the found pending post
        user: pendingPost.user,
        community: pendingPost.community,
        content: pendingPost.content,
        fileUrl: pendingPost.fileUrl,
        fileType: pendingPost.fileType,
        confirmationToken: pendingPost.confirmationToken,
        status: pendingPost.status,
        // Mock a method that is called after findOneAndDelete if needed, or just throw
        exec: () => { throw new Error('Simulated delete database error'); }
      };
    });

    const response = await request(app)
      .post(`/posts/confirm/${confirmationToken}`)
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    // Restore the original findOneAndDelete implementation
    jest.restoreAllMocks();

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('message', 'Error publishing post');

    // Verify the pending post still exists
    const existingPendingPost = await PendingPost.findById(pendingPost._id);
    expect(existingPendingPost).not.toBeNull();

    // Verify no new post was created
    const newPost = await Post.findOne({ content: 'This post should cause a delete error.' });
    expect(newPost).toBeNull();
  });

  // Test Case 7: Database error during saving new post
  test('TC_CONFIRM_POST_07: Should return 500 if a database error occurs during saving new post', async () => {
    // Goal: Verify that the endpoint handles database errors when trying to save the new post after deleting the pending one.
    // Script: Create a pending post. Mock Post.prototype.save to throw an error after the pending post is deleted. Send a POST request to /posts/confirm/:confirmationToken with the token and user ID.
    // Input: Valid confirmationToken in URL, matching user-id header.
    // Expected Output: Status 500, message "Error publishing post".
    // Assertions: Check status code and response body message. Verify the pending post is deleted, verify no new post was created.
    const pendingPost = await createTestPendingPost(testUser, testCommunity, 'This post should cause a save error.');
    const confirmationToken = pendingPost.confirmationToken;

    // Mock Post.prototype.save to throw an error
    jest.spyOn(Post.prototype, 'save').mockImplementationOnce(function() {
        // Ensure pending post is deleted before throwing error, simulating the controller flow
        // This requires a more complex mock setup or relying on the order of operations
        // A simpler mock is to just throw when save is called.
        throw new Error('Simulated save database error');
    });

    const response = await request(app)
      .post(`/posts/confirm/${confirmationToken}`)
      .set('User-Id', testUser._id.toString()); // Set the user ID header

    // Restore the original save implementation
    jest.restoreAllMocks();

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('message', 'Error publishing post');

    // Verify the pending post is deleted (assuming deleteOneAndDelete succeeded before save failed)
    // Note: This test case relies on the controller's sequence: find -> delete pending -> create new -> save new.
    // If save fails, the pending post *should* have been deleted already.
    const deletedPendingPost = await PendingPost.findById(pendingPost._id);
    expect(deletedPendingPost).toBeNull(); // Expect pending post to be deleted

    // Verify no new post was created
    const newPost = await Post.findOne({ content: 'This post should cause a save error.' });
    expect(newPost).toBeNull();
  });

});