const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { addComment } = require('../controllers/post.controller');
const Comment = require('../models/comment.model'); // Adjust path
const Post = require('../models/post.model'); // Adjust path

// Load environment variables
dotenv.config();

// Suppress Mongoose strictQuery warning
mongoose.set('strictQuery', false);

// Mock middleware
jest.mock('../services/analyzeContent', () => (req, res, next) => next());
jest.mock('../middlewares/limiter/limiter', () => ({
  commentLimiter: (req, res, next) => next(),
}));
jest.mock('../middlewares/post/userInputValidator', () => ({
  commentValidator: (req, res, next) => next(),
  validatorHandler: (req, res, next) => next(),
}));

// Increase timeout for real DB operations
jest.setTimeout(10000);

describe('Post Controller - addComment (with real DB)', () => {
  let req, res, postId, userId, communityId;

  // Connect to the real database before all tests
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB for testing');
  });

  // Set up req/res and clean the database before each test
  beforeEach(async () => {
    // Generate IDs
    userId = new mongoose.Types.ObjectId();
    postId = new mongoose.Types.ObjectId();
    communityId = new mongoose.Types.ObjectId(); // Required for Post

    // Create a mock Post with required fields
    await Post.deleteMany({});
    await Post.create({
      _id: postId,
      content: 'Test Post Content',
      community: communityId,
      user: userId,
      comments: [],
    });

    req = {
      body: {
        content: 'This is a test comment',
        postId: postId.toString(),
      },
      userId: userId.toString(), // Matches addComment's expectation
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    // Clear the Comment collection
    await Comment.deleteMany({});
  });

  // Disconnect from the database after all tests
  afterAll(async () => {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  });

  it('should create a new comment and return 200 status', async () => {
    await addComment(req, res);

    // Check the database for the created comment
    const savedComment = await Comment.findOne({ content: 'This is a test comment' });
    const updatedPost = await Post.findById(postId);

    expect(savedComment).toBeTruthy();
    expect(savedComment.content).toBe('This is a test comment');
    expect(savedComment.user.toString()).toBe(userId.toString());
    expect(savedComment.post.toString()).toBe(postId.toString());
    expect(updatedPost.comments).toContainEqual(savedComment._id);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Comment added successfully',
    });
  });

  it('should return 500 if content is missing', async () => {
    req.body.content = ''; // Mongoose will reject this due to 'required: true'

    await addComment(req, res);

    expect(res.status).toHaveBeenCalledWith(500); // Current behavior
    expect(res.json).toHaveBeenCalledWith({
      message: 'Error adding comment',
    });

    // Verify no comment was created
    const commentCount = await Comment.countDocuments();
    expect(commentCount).toBe(0);
  });

  it('should return 500 if there is a server error', async () => {
    // Simulate a server error by closing the connection
    await mongoose.connection.close();

    await addComment(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Error adding comment',
    });

    // Reconnect for subsequent tests
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  });
});