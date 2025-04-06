const mongoose = require("mongoose");
const Database = require("../config/database"); // Your database config
const { deleteUser } = require("../controllers/user.controller"); // Import deleteUser directly
const User = require("../models/user.model"); // User model for setup and assertions
require("dotenv").config(); // Load environment variables

// Database instance
const db = new Database(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Mock Express request and response objects
const mockRequest = (params) => ({
  params, // Pass params like { id: "userId" }
});

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("deleteUser Function Tests", () => {
  // Connect to the real database before all tests
  beforeAll(async () => {
    await db.connect();
    console.log("Database connected:", mongoose.connection.readyState); // 1 = connected
  });

  // Clean up the database after each test (optional, can be removed to retain data)
  afterEach(async () => {
    await User.deleteMany({
      email: { $in: [/testuser/] },
    });
    console.log("Database cleaned up after test");
  });

  // Disconnect from the database after all tests
  afterAll(async () => {
    await db.disconnect();
    console.log("Database disconnected");
  });

  // Test case: Successful user deletion
  it("should delete an existing user successfully", async () => {
    // Create a user to delete
    const testUser = new User({
      name: "Test User",
      email: "testuser@example.com",
      password: await require("bcrypt").hash("Password123!", 10),
      role: "general",
    });
    await testUser.save();
    console.log("Test user created:", testUser._id);

    // Check initial database state
    const initialUsers = await User.countDocuments({ email: "testuser@example.com" });
    console.log("Initial users with testuser@example.com:", initialUsers);
    expect(initialUsers).toBe(1);

    const req = mockRequest({ id: testUser._id.toString() });
    const res = mockResponse();

    await deleteUser(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: "User deleted successfully",
    });

    // Verify the user was removed from the database
    const deletedUser = await User.findById(testUser._id);
    expect(deletedUser).toBeNull();

    const finalUsers = await User.countDocuments({ email: "testuser@example.com" });
    console.log("Final users with testuser@example.com:", finalUsers);
    expect(finalUsers).toBe(0);
  });

  // Test case: Fail to delete non-existent user
  it("should return 404 when trying to delete a non-existent user", async () => {
    const nonExistentId = new mongoose.Types.ObjectId(); // Generate a random valid ID
    const req = mockRequest({ id: nonExistentId.toString() });
    const res = mockResponse();

    await deleteUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      message: "User not found",
    });

    // Verify no unintended changes (optional, depends on your DB state)
    const userCount = await User.countDocuments();
    console.log("Total users after failed delete:", userCount);
  });

  // Test case: Handle invalid ID format
  it("should return 500 for an invalid user ID format", async () => {
    const req = mockRequest({ id: "invalid-id" }); // Non-ObjectId string
    const res = mockResponse();

    await deleteUser(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Error deleting user",
        error: expect.any(String), // Error message from Mongoose
      })
    );
  });
});