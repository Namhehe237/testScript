require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const mongoose = require('mongoose');
const { createPost } = require('../controllers/post.controller');
const Community = require('../models/community.model');
const Post = require('../models/post.model');
const Database = require('../config/database');
const fs = require('fs');

// Mock the fs module
jest.mock('fs');

describe('createPost Controller', () => {
  let db;
  let req;
  let res;
  let connection;

  beforeAll(async () => {
    try {
      const baseUri = process.env.MONGODB_URI;
      if (!baseUri) {
        throw new Error('MONGODB_URI is not defined in .env');
      }

      // Ensure the URI ends with the test database name
      const mongoUri = `${baseUri.split('?')[0]}/test?${baseUri.split('?')[1] || ''}`;
      console.log('Connecting to:', mongoUri);

      db = new Database(mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });

      connection = await db.connect();
      console.log('Connected to test database');
    } catch (error) {
      console.error('Failed to connect to database:', error);
      throw error;
    }
  });

  afterAll(async () => {
    try {
      if (connection) {
        await mongoose.connection.db.dropDatabase();
        await db.disconnect();
        console.log('Disconnected from test database');
      }
    } catch (error) {
      console.error('Failed to cleanup database:', error);
    }
  });

  beforeEach(async () => {
    if (!connection) {
      throw new Error('Database connection not established');
    }
    await Community.deleteMany({});
    await Post.deleteMany({});
    
    jest.clearAllMocks();
    
    req = {
      body: {
        communityId: null,
        content: 'Test post content'
      },
      userId: new mongoose.Types.ObjectId(),
      file: null,
      fileUrl: null,
      fileType: null
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
  });

  it('should create a post successfully when user is a community member', async () => {
    const community = await Community.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Test Community',
      members: [req.userId]
    });

    req.body.communityId = community._id;

    await createPost(req, res);

    expect(res.json).toHaveBeenCalled();
    const createdPost = res.json.mock.calls[0][0];
    expect(createdPost.content).toBe('Test post content');
    expect(createdPost.user._id.toString()).toBe(req.userId.toString());
    expect(createdPost.community._id.toString()).toBe(community._id.toString());
    expect(createdPost.createdAt).toBeDefined();

    const dbPost = await Post.findById(createdPost._id);
    expect(dbPost).toBeTruthy();
    expect(dbPost.content).toBe('Test post content');
  });

  it('should return 401 when user is not a community member', async () => {
    const community = await Community.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Test Community',
      members: [new mongoose.Types.ObjectId()] // Different user
    });

    req.body.communityId = community._id;

    await createPost(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Unauthorized to post in this community'
    });

    const postsCount = await Post.countDocuments();
    expect(postsCount).toBe(0);
  });

  it('should handle file cleanup on unauthorized attempt', async () => {
    const community = await Community.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Test Community',
      members: [new mongoose.Types.ObjectId()] // Different user
    });

    req.body.communityId = community._id;
    req.file = { filename: 'testfile.jpg' };
    
    fs.unlink.mockImplementation((path, callback) => callback(null));

    await createPost(req, res);

    expect(fs.unlink).toHaveBeenCalledWith(
      expect.stringContaining('testfile.jpg'),
      expect.any(Function)
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 500 on database error', async () => {
    jest.spyOn(Community, 'findOne').mockRejectedValue(new Error('DB Error'));

    req.body.communityId = new mongoose.Types.ObjectId();

    await createPost(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Error creating post'
    });
  });
});