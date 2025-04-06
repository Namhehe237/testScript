const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const Post = require('../server/models/post.model');
const User = require('../server/models/user.model');
const postRoutes = require('../server/routes/post.route');
const Database = require('../server/config/database');

// 🧪 Bypass middlewares
jest.mock('passport', () => ({
  authenticate: () => (req, res, next) => next(),
}));
jest.mock('../server/middlewares/auth/decodeToken', () => (req, res, next) => {
  req.userId = req.headers['user-id'];
  next();
});

describe('Post Save API - Real DB', () => {
  let app;
  let db;
  let user;
  let post;

  const connect = async () => {
    const uri = 'mongodb+srv://sontungnguyen16:sontungbadao@cluster0.wk6kr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
    if (!uri) throw new Error('MONGODB_URI is missing in .env');
    db = new Database(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    await db.connect();
  };

  const disconnect = async () => {
    await Post.deleteMany({});
    await User.deleteMany({});
    await db.disconnect();
  };

  const createTestUser = async () => {
    const newUser = new User({
      name: 'Test User',
      email: `saveuser_${Date.now()}@example.com`,
      password: 'password123',
      avatar: 'https://avatar.url/default.jpg',
    });
    await newUser.save();
    return newUser;
  };

  const createTestPost = async (ownerId) => {
    const newPost = new Post({
      content: 'Post for save test',
      user: ownerId,
      community: new mongoose.Types.ObjectId(), // fake required field
    });
    await newPost.save();
    return newPost;
  };

  const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.SECRET || 'testsecret', {
      expiresIn: '6h',
    });
  };

  beforeAll(async () => {
    await connect();
    app = express();
    app.use(express.json());
    app.use('/posts', postRoutes);

    user = await createTestUser();
    post = await createTestPost(user._id);
  });

  afterAll(async () => {
    await disconnect();
  });

  it('✅ should allow a user to save a post', async () => {
    const token = generateToken(user._id);
    const res = await request(app)
      .patch(`/posts/${post._id}/save`)
      .set('Authorization', `Bearer ${token}`)
      .set('user-id', user._id.toString());

    expect(res.status).toBe(200);
    expect(res.body.saves).toContain(user._id.toString());
    console.log('✅ Save post test passed');
  });

  it('🚫 should return 404 if post is already saved', async () => {
    const token = generateToken(user._id);
    // First save
    await Post.findByIdAndUpdate(post._id, {
      $addToSet: { saves: user._id },
    });

    // Try saving again
    const res = await request(app)
      .patch(`/posts/${post._id}/save`)
      .set('Authorization', `Bearer ${token}`)
      .set('user-id', user._id.toString());

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Post not found. It may have been deleted already');
    console.log('🚫 Already saved test passed');
  });

  it('🧨 should return 500 if DB error occurs', async () => {
    const token = generateToken(user._id);
    jest
      .spyOn(Post, 'findOneAndUpdate')
      .mockImplementationOnce(() => {
        throw new Error('DB crash');
      });

    const res = await request(app)
      .patch(`/posts/${post._id}/save`)
      .set('Authorization', `Bearer ${token}`)
      .set('user-id', user._id.toString());

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error saving post');
    console.log('🧨 DB error test passed');
  });
});
