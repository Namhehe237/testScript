const mongoose = require("mongoose");
const Database = require("../config/database"); // Your database config
const { addUser } = require("../controllers/user.controller"); // Import addUser directly
const User = require("../models/user.model"); // User model for assertions and cleanup
require("dotenv").config(); // Load environment variables

// Database instance
const db = new Database(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Mock Express request and response objects
const mockRequest = (body, files = null) => ({
  body,
  files,
  protocol: "http",
  get: () => "localhost", // Mock host for avatar URL generation
});

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Mock next function for middleware chain
const mockNext = jest.fn();

describe("addUser Function Tests", () => {
  // Connect to the real database before all tests
  beforeAll(async () => {
    await db.connect();
    console.log("Database connected:", mongoose.connection.readyState); // 1 = connected
  });

  // Clean up the database after each test (commented out to retain changes)
  // afterEach(async () => {
  //   await User.deleteMany({
  //     email: {
  //       $in: [/testuser/, "duplicate@example.com", /moduser/],
  //     },
  //   });
  //   console.log("Database cleaned up after test");
  // });

  // Disconnect from the database after all tests
  afterAll(async () => {
    await db.disconnect();
    console.log("Database disconnected");
  });

  // Test case: Successful user creation
  it("should add a new user successfully with valid data", async () => {
    const initialUsers = await User.countDocuments({ email: "testuser@example.com" });
    console.log("Initial users with testuser@example.com:", initialUsers);

    const req = mockRequest({
      name: "Test User",
      email: "testuser@example.com",
      password: "Password123!",
      isConsentGiven: "false",
    });
    const res = mockResponse();

    await addUser(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "User added successfully",
    });

    const savedUser = await User.findOne({ email: "testuser@example.com" });
    expect(savedUser).toBeTruthy();
    expect(savedUser.name).toBe("Test User");
    expect(savedUser.email).toBe("testuser@example.com");
    expect(savedUser.role).toBe("general");
    expect(savedUser.avatar).toBe(
      "https://raw.githubusercontent.com/nz-m/public-files/main/dp.jpg"
    );

    const finalUsers = await User.countDocuments({ email: "testuser@example.com" });
    console.log("Final users with testuser@example.com:", finalUsers);
    expect(finalUsers).toBe(initialUsers + 1);
  });

  // Test case: Failed user creation with duplicate email
  it("should fail to add a user with an existing email", async () => {
    const existingUser = new User({
      name: "Existing User",
      email: "duplicate@example.com",
      password: await require("bcrypt").hash("Password123!", 10),
      role: "general",
    });
    await existingUser.save();
    console.log("Existing user added:", await User.findOne({ email: "duplicate@example.com" }));

    const req = mockRequest({
      name: "New User",
      email: "duplicate@example.com",
      password: "Password123!",
      isConsentGiven: "false",
    });
    const res = mockResponse();

    await addUser(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Failed to add user",
    });

    const users = await User.find({ email: "duplicate@example.com" });
    expect(users.length).toBe(1);
  });

  // Test case: Moderator role assignment
  it("should assign moderator role for mod.socialecho.com email", async () => {
    const initialUsers = await User.countDocuments({ email: "moduser@mod.socialecho.com" });
    console.log("Initial users with moduser@mod.socialecho.com:", initialUsers);

    const req = mockRequest({
      name: "Moderator User",
      email: "moduser@mod.socialecho.com",
      password: "Password123!",
      isConsentGiven: "false",
    });
    const res = mockResponse();

    await addUser(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "User added successfully",
    });

    const savedUser = await User.findOne({ email: "moduser@mod.socialecho.com" });
    expect(savedUser).toBeTruthy();
    expect(savedUser.role).toBe("moderator");

    const finalUsers = await User.countDocuments({ email: "moduser@mod.socialecho.com" });
    console.log("Final users with moduser@mod.socialecho.com:", finalUsers);
    expect(finalUsers).toBe(initialUsers + 1);
  });
});