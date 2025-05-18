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

// Import routes (only postRoutes needed for createPost test)
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
jest.mock('../services/analyzeContent', () => jest.fn((req, res, next) => {
  // Mock analyzeContent to not perform actual analysis
  // If testing analysis logic is needed, you'll need a more detailed mock
  req.failedDetection = false; // Assume no bad content detected
  next();
}));

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
  // Assume file has been processed and info is attached to req
  if (req.file) { // Check if a file was sent in the request
    req.fileUrl = `http://example.com/userFiles/${req.file.filename}`;
    req.fileType = req.file.mimetype;
  } else {
    req.fileUrl = null; // Use null instead of undefined for consistency with schema
    req.fileType = null; // Use null instead of undefined for consistency with schema
  }
  next();
}));

// Add mock for postConfirmation middleware
jest.mock('../middlewares/post/postConfirmation', () => jest.fn((req, res, next) => {
  // Mock postConfirmation to not perform actual confirmation logic
  // If testing confirmation logic is needed, you'll need a more detailed mock
  // Require jwt inside the mock factory to avoid ReferenceError
  const jwt = require('jsonwebtoken');
  const PendingPost = require('../models/pendingPost.model'); // Also require PendingPost here
  const fs = require('fs'); // Also require fs here

  if (req.failedDetection) {
    // Assume logic when bad content is detected
    // Create a mock confirmation token
    const mockConfirmationToken = jwt.sign(
      {
        userId: req.userId,
        communityId: req.body.communityId,
        content: req.body.content,
        fileUrl: req.fileUrl, // Include file info
        fileType: req.fileType, // Include file info
      },
      process.env.SECRET,
      { expiresIn: '15m' } // Token expires in 15 minutes
    );

    // Save pending post
    const pendingPost = new PendingPost({
      user: req.userId,
      community: req.body.communityId,
      content: req.body.content,
      fileUrl: req.fileUrl,
      fileType: req.fileType,
      confirmationToken: mockConfirmationToken,
      status: 'pending',
    });
    // Use async/await for saving the pending post
    pendingPost.save().catch(err => console.error('Error saving pending post in mock:', err));


    // If there was a file uploaded, unlink it as it's now stored in pendingPost
    if (req.file && req.file.path) {
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('Error unlinking mock file:', err);
            else console.log('Mock file unlinked:', req.file.path);
        });
    }


    return res.status(403).json({ type: 'failedDetection', confirmationToken: mockConfirmationToken });
  }
  next();
}));

// Mock fs.unlink to prevent deleting real files during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'), // Keep actual fs functions if needed
  unlink: jest.fn((path, callback) => {
    console.log(`Mock fs.unlink called for: ${path}`);
    callback(null); // Assume successful deletion
  }),
}));


describe('POST /posts Integration Tests (with real DB)', () => {
  let app; // Express application instance for testing
  let db; // Database connection instance
  let server; // Variable to store the HTTP server instance
  let testUsers = []; // Store list of test users

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
    // Attach fileUpload and postConfirmation middleware before the route handler
    app.use(require('../middlewares/post/fileUpload'));
    app.use(require('../middlewares/post/postConfirmation'));
    app.use('/posts', postRoutes); // Mount post route under /posts

    process.env.SECRET = process.env.SECRET || 'testsecret'; // Ensure SECRET has a value

    // Manually create an HTTP server and store it
    server = http.createServer(app);
    // Start listening on a random port to avoid conflicts
    await new Promise(resolve => server.listen(0, resolve));
  });

  // Cleanup after all tests are complete
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
    testUsers = []; // Reset test user list
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
    await user.save(); // Save user to the REAL database
    testUsers.push(user); // Add to list for management
    console.log(`Created test user: ${email} (ID: ${user._id})`);
    return user;
  };

  // Helper function to create a test community in the REAL database
  const createTestCommunity = async (name, members = []) => {
      const community = new Community({
          name,
          description: `Description for ${name}`,
          members: members.map(m => m._id || m), // Accept user object or user ID
          // Add other community fields if needed
      });
      await community.save();
      console.log(`Created test community: ${name} (ID: ${community._id})`);
      return community;
  };

  // Helper function to create a test post (if needed for more complex test cases)
  const createTestPost = async (user, community, content, fileUrl = null, fileType = null) => {
    const post = new Post({
      user: user._id,
      community: community._id,
      content,
      fileUrl,
      fileType,
    });
    await post.save();
    console.log(`Created test post: ${post._id}`);
    return post;
  };


  // Test Case 1: Successful post creation without file
  it('CREATE_POST_001: should create a post successfully without a file', async () => {
    // Script: Create user and community, then send a POST request to create the post.
    const user = await createTestUser('user1', 'Test User 1');
    const community = await createTestCommunity('Test Community 1', [user]);

    // Input: Request body and userId header
    const postData = {
      communityId: community._id.toString(),
      content: 'This is a test post without a file.',
    };
    // Expected Output: Status 200 and the created post object
    const response = await request(app)
      .post('/posts')
      .set('user-id', user._id.toString()) // Set userId in header to be picked up by mock decodeToken
      .send(postData);

    // Assert: Check status code and response body
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('_id');
    expect(response.body.content).toBe(postData.content);
    expect(response.body.community._id).toBe(community._id.toString());
    expect(response.body.user._id).toBe(user._id.toString());
    expect(response.body.fileUrl).toBeNull();
    expect(response.body.fileType).toBeNull();
    expect(response.body).toHaveProperty('createdAt'); // Check if createdAt field is added
    expect(response.body.createdAt).toBe('a few seconds ago'); // Check mock dayjs format

    // Check if the post was saved in the DB
    const savedPost = await Post.findById(response.body._id);
    expect(savedPost).not.toBeNull();
    expect(savedPost.content).toBe(postData.content);
    expect(savedPost.community.toString()).toBe(community._id.toString());
    expect(savedPost.user.toString()).toBe(user._id.toString());
    expect(savedPost.fileUrl).toBeNull(); // Should be null if not provided
    expect(savedPost.fileType).toBeNull(); // Should be null if not provided
  });

  // Test Case 2: Successful post creation with file
  it('CREATE_POST_002: should create a post successfully with a file', async () => {
    // Script: Create user and community, then send a POST request with mock file info.
    const user = await createTestUser('user2', 'Test User 2');
    const community = await createTestCommunity('Test Community 2', [user]);

    // Input: Request body, userId header, and mock file info (added by mock middleware)
    const postData = {
      communityId: community._id.toString(),
      content: 'This is a test post with a file.',
    };

    // Mock fileUpload middleware to add file info to req
    // Note: fileUpload middleware is already mocked above to add req.fileUrl and req.fileType
    // We just need to ensure the request sent can trigger that middleware.
    // Supertest can send real files, but with the mock middleware, we don't need a real file.
    // Just send the request body and rely on the mock middleware to add file info.

    // Expected Output: Status 200 and the created post object with file info
    const response = await request(app)
      .post('/posts')
      .set('user-id', user._id.toString()) // Set userId in header
      .send(postData); // Send body data

    // Assert: Check status code and response body
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('_id');
    expect(response.body.content).toBe(postData.content);
    expect(response.body.community._id).toBe(community._id.toString());
    expect(response.body.user._id).toBe(user._id.toString());
    // Check fileUrl and fileType added by mock fileUpload middleware
    expect(response.body.fileUrl).toBe('http://example.com/userFiles/mockfile.jpg');
    expect(response.body.fileType).toBe('image/jpeg');
    expect(response.body).toHaveProperty('createdAt');
    expect(response.body.createdAt).toBe('a few seconds ago');

    // Check if the post was saved in the DB
    const savedPost = await Post.findById(response.body._id);
    expect(savedPost).not.toBeNull();
    expect(savedPost.content).toBe(postData.content);
    expect(savedPost.community.toString()).toBe(community._id.toString());
    expect(savedPost.user.toString()).toBe(user._id.toString());
    expect(savedPost.fileUrl).toBe('http://example.com/userFiles/mockfile.jpg');
    expect(savedPost.fileType).toBe('image/jpeg');
  });

  // Test Case 3: Unauthorized user (not a member) attempts to post
  it('CREATE_POST_003: should return 401 if user is not a member of the community', async () => {
    // Script: Create user and community. The user is not a member of the community. Send a POST request.
    const user = await createTestUser('user3', 'Test User 3');
    const community = await createTestCommunity('Test Community 3', []); // User is not a member

    // Input: Request body and userId header
    const postData = {
      communityId: community._id.toString(),
      content: 'This post should not be created.',
    };
    // Expected Output: Status 401 and an error message
    const response = await request(app)
      .post('/posts')
      .set('user-id', user._id.toString()) // Set userId in header
      .send(postData);

    // Assert: Check status code and response body
    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('message', 'Unauthorized to post in this community');

    // Check that no post was created in the DB
    const postCount = await Post.countDocuments({ content: postData.content });
    expect(postCount).toBe(0);
  });

  // Test Case 4: Posting to a non-existent community
  it('CREATE_POST_004: should return 401 if community does not exist', async () => {
    // Script: Create user, use a non-existent communityId, send a POST request.
    const user = await createTestUser('user4', 'Test User 4');
    const nonExistentCommunityId = new mongoose.Types.ObjectId().toString(); // Non-existent ID

    // Input: Request body and userId header
    const postData = {
      communityId: nonExistentCommunityId,
      content: 'This post should not be created in a non-existent community.',
    };
    // Expected Output: Status 401 and an error message
    const response = await request(app)
      .post('/posts')
      .set('user-id', user._id.toString()) // Set userId in header
      .send(postData);

    // Assert: Check status code and response body
    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('message', 'Unauthorized to post in this community');

    // Check that no post was created in the DB
    const postCount = await Post.countDocuments({ content: postData.content });
    expect(postCount).toBe(0);
  });

  // Test Case 5: Error during post saving
  it('CREATE_POST_005: should return 500 if there is a database error during post saving', async () => {
    // Script: Create user and community, mock Post.prototype.save to throw an error, send a POST request.
    const user = await createTestUser('user5', 'Test User 5');
    const community = await createTestCommunity('Test Community 5', [user]);

    // Input: Request body and userId header
    const postData = {
      communityId: community._id.toString(),
      content: 'This post should fail to save.',
    };

    // Mock Post.prototype.save to throw error
    const originalSave = Post.prototype.save;
    Post.prototype.save = jest.fn().mockRejectedValue(new Error('Mock DB save error'));

    // Expected Output: Status 500 and an error message
    const response = await request(app)
      .post('/posts')
      .set('user-id', user._id.toString()) // Set userId in header
      .send(postData);

    // Restore original save function after the test
    Post.prototype.save = originalSave;

    // Assert: Check status code and response body
    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('message', 'Error creating post');

    // Check that no post was created in the DB
    const postCount = await Post.countDocuments({ content: postData.content });
    expect(postCount).toBe(0);
  });

  // Test Case 6: Check when analyzeContent detects bad content
  it('CREATE_POST_006: should return 403 with confirmation token if analyzeContent fails', async () => {
    // Script: Create user and community, mock analyzeContent to fail, send a POST request.
    // 1. Setup: Create user and community
    const user = await createTestUser('user6', 'Test User 6');
    const community = await createTestCommunity('Test Community 6', [user]);

    const postContent = 'This content should be flagged.';

    // Mock analyzeContent to set req.failedDetection = true
    const analyzeContentMock = require('../services/analyzeContent');
    analyzeContentMock.mockImplementationOnce((req, res, next) => {
      req.failedDetection = true;
      req.userId = user._id.toString(); // Ensure userId is available for postConfirmation
      next();
    });

    // Mock postConfirmation to check if it's called and returns 403
    const postConfirmationMock = require('../middlewares/post/postConfirmation');
    // postConfirmationMock is already mocked above to handle req.failedDetection = true
    // We just need to ensure it's called.

    // Input: Request body and userId header
    // 2. Action: Send POST request
    const res = await request(server)
      .post('/posts')
      .set('user-id', user._id.toString())
      .send({
        communityId: community._id.toString(),
        content: postContent,
      });

    // Expected Output: Status 403 with a confirmation token
    // 3. Assertion: Check response and DB state
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('type', 'failedDetection');
    expect(res.body).toHaveProperty('confirmationToken'); // Check for the presence of the token

    // Check that the post was NOT saved in the Post collection
    const savedPost = await Post.findOne({ content: postContent });
    expect(savedPost).toBeNull();

    // Check that a pending post WAS saved in the PendingPost collection
    const pendingPost = await PendingPost.findOne({ content: postContent });
    expect(pendingPost).not.toBeNull();
    expect(pendingPost.user.toString()).toBe(user._id.toString());
    expect(pendingPost.community.toString()).toBe(community._id.toString());
    expect(pendingPost.status).toBe('pending');
    expect(pendingPost.confirmationToken).toBe(res.body.confirmationToken); // Check the token matches the response

    // Check that fs.unlink was NOT called (because the post was moved to pending)
    expect(fs.unlink).not.toHaveBeenCalled();

    // Reset analyzeContent mock to default state for subsequent tests
    analyzeContentMock.mockImplementation((req, res, next) => {
      req.failedDetection = false;
      next();
    });
  });

  // Test Case 7: Check when analyzeContent detects bad content and there is a file
  it('CREATE_POST_007: should return 403 with confirmation token and unlink file if analyzeContent fails with file', async () => {
    // Script: Create user and community, mock analyzeContent to fail, send a POST request with a file.
    // 1. Setup: Create user and community
    const user = await createTestUser('user7', 'Test User 7');
    const community = await createTestCommunity('Test Community 7', [user]);

    const postContent = 'This content with file should be flagged.';
    const mockFilename = 'flagged_image.jpg';
    const mockFilepath = `./assets/userFiles/${mockFilename}`; // Mock path
    const mockFileType = 'image/jpeg';

    // Mock analyzeContent to set req.failedDetection = true and simulate file upload info
    const analyzeContentMock = require('../services/analyzeContent');
    analyzeContentMock.mockImplementationOnce((req, res, next) => {
      req.failedDetection = true;
      req.userId = user._id.toString(); // Ensure userId is available for postConfirmation
      // Simulate fileUpload having run and attached req.file and req.fileUrl/fileType
      req.file = { filename: mockFilename, path: mockFilepath, mimetype: mockFileType };
      req.fileUrl = `http://example.com/userFiles/${mockFilename}`;
      req.fileType = mockFileType;
      next();
    });

    // Mock postConfirmation to check if it's called and handles the file
    const postConfirmationMock = require('../middlewares/post/postConfirmation');
    // postConfirmationMock is already mocked above to handle req.failedDetection = true
    // and call fs.unlink if a file exists.

    // Input: Request body (multipart/form-data) with file and userId header
    // 2. Action: Send POST request with file
    const res = await request(server)
      .post('/posts')
      .set('user-id', user._id.toString())
      .field('communityId', community._id.toString())
      .field('content', postContent)
      .attach('file', Buffer.from('fake image data'), { filename: mockFilename, contentType: mockFileType });


    // Expected Output: Status 403 with a confirmation token
    // 3. Assertion: Check response and DB state
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('type', 'failedDetection');
    expect(res.body).toHaveProperty('confirmationToken'); // Check for the presence of the token

    // Check that the post was NOT saved in the Post collection
    const savedPost = await Post.findOne({ content: postContent });
    expect(savedPost).toBeNull();

    // Check that a pending post WAS saved in the PendingPost collection
    const pendingPost = await PendingPost.findOne({ content: postContent });
    expect(pendingPost).not.toBeNull();
    expect(pendingPost.user.toString()).toBe(user._id.toString());
    expect(pendingPost.community.toString()).toBe(community._id.toString());
    expect(pendingPost.status).toBe('pending');
    expect(pendingPost.confirmationToken).toBe(res.body.confirmationToken);
    expect(pendingPost.fileUrl).toBe(`http://example.com/userFiles/${mockFilename}`); // File info saved in pending post
    expect(pendingPost.fileType).toBe(mockFileType);

    // Check that fs.unlink WAS called (because the file was uploaded and then moved to pending)
    expect(fs.unlink).toHaveBeenCalledWith(mockFilepath, expect.any(Function));


    // Reset analyzeContent mock to default state for subsequent tests
    analyzeContentMock.mockImplementation((req, res, next) => {
      req.failedDetection = false;
      next();
    });
  });

});